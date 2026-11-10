import Papa from 'papaparse'
import type { Alumni, ImportResult } from '../types/alumni'

const aliases: Record<keyof Alumni, string[]> = {
  nama: ['nama', 'nama lengkap', 'nama alumni'],
  nim: ['nim', 'nomor induk mahasiswa'],
  prodi: ['prodi', 'program studi', 'program_studi'],
  tahunLulus: ['tahun lulus', 'tahun_lulus', 'tahun kelulusan'],
  tempatKerja: ['tempat kerja', 'tempat_kerja', 'nama perusahaan', 'instansi', 'apa nama perusahaan/kantor tempat anda bekerja?', 'kolom apa nama perusahaan/kantor tempat anda bekerja?'],
  whatsapp: ['nomor whatsapp', 'nomor_whatsapp', 'whatsapp', 'no wa', 'no hp', 'nomor hp'],
}
const normalize = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ')
const normalizeHeader = (value: string) => normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export function parseCsv(text: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: normalize })
  if (parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length) throw new Error('Header CSV duplikat. Gunakan nama kolom yang unik.')
  // Tracer Study exports may have sparse rows: PapaParse reports missing trailing
  // fields as TooFewFields even though the populated columns are still usable.
  const structuralError = parsed.errors.find(error => error.code !== 'TooFewFields')
  if (structuralError) throw new Error(`CSV tidak valid: ${structuralError.message}`)
  const headers = parsed.meta.fields || []
  const mapping = Object.fromEntries(Object.entries(aliases).map(([key, names]) => {
    const match = headers.find(header => names.some(name => normalizeHeader(name) === normalizeHeader(header)))
      || (key === 'tempatKerja' ? headers.find(header => {
        const normalized = normalizeHeader(header)
        return normalized.includes('apa nama')
          && (normalized.includes('perusahaan') || normalized.includes('kantor'))
          && normalized.includes('bekerja')
      }) : undefined)
    return [key, match]
  })) as Record<keyof Alumni, string | undefined>
  const required: (keyof Alumni)[] = ['nama', 'nim', 'tempatKerja']
  const missing = required.filter(key => !mapping[key])
  if (missing.length) throw new Error(`Kolom wajib belum tersedia: ${missing.map(k => aliases[k][0]).join(', ')}.`)
  const alumni: Alumni[] = [], warnings: string[] = [], seen = new Set<string>()
  let skipped = 0
  if (!mapping.whatsapp) warnings.push('Kolom WhatsApp tidak ditemukan. Nomor dapat diisi melalui detail alumni.')
  if (parsed.data.length > 20000) throw new Error('Maksimal 20.000 baris per impor. Silakan pecah file CSV.')
  parsed.data.forEach((row, index) => {
    const value = (key: keyof Alumni) => (row[mapping[key] || ''] || '').trim()
    const item = Object.fromEntries(Object.keys(aliases).map(key => [key, value(key as keyof Alumni)])) as unknown as Alumni
    if (!item.nama || !item.nim) { skipped++; if (warnings.length < 20) warnings.push(`Baris ${index + 2}: nama atau NIM kosong, dilewati.`); return }
    if (seen.has(item.nim.toLowerCase())) { skipped++; if (warnings.length < 20) warnings.push(`Baris ${index + 2}: NIM duplikat, data pertama dipertahankan.`); return }
    seen.add(item.nim.toLowerCase())
    alumni.push(item)
  })
  if (!alumni.length) throw new Error('Tidak ada data alumni valid di dalam CSV.')
  const incomplete = alumni.filter(a => !a.prodi || !/^\d{4}$/.test(a.tahunLulus) || !a.tempatKerja).length
  if (incomplete) warnings.push(`${incomplete} alumni memiliki data belum lengkap. Lengkapi melalui detail sebelum membuat surat.`)
  return { alumni, warnings, skipped }
}
