import JSZip from 'jszip'
import { parseCsv } from './csv-parser'
import type { ImportResult } from '../types/alumni'

const xml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Struktur file Excel tidak valid.')
  return doc
}

function columnIndex(reference: string) {
  let value = 0
  for (const char of reference.match(/^[A-Z]+/i)?.[0].toUpperCase() || '') value = value * 26 + char.charCodeAt(0) - 64
  return value - 1
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buffer)
  const workbookFile = zip.file('xl/workbook.xml')
  const relationsFile = zip.file('xl/_rels/workbook.xml.rels')
  if (!workbookFile || !relationsFile) throw new Error('File bukan Excel .xlsx yang valid.')
  const workbook = xml(await workbookFile.async('text'))
  const relations = xml(await relationsFile.async('text'))
  const sheet = workbook.getElementsByTagNameNS('*', 'sheet')[0]
  const relationId = sheet?.getAttribute('r:id')
  if (!relationId) throw new Error('Lembar kerja Excel tidak ditemukan.')
  const relation = [...relations.getElementsByTagNameNS('*', 'Relationship')].find(item => item.getAttribute('Id') === relationId)
  const target = relation?.getAttribute('Target')
  if (!target) throw new Error('Lembar kerja Excel tidak dapat dibaca.')
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheetFile = zip.file(sheetPath)
  if (!sheetFile) throw new Error('Isi lembar kerja Excel tidak ditemukan.')
  const sharedFile = zip.file('xl/sharedStrings.xml')
  const shared = sharedFile ? [...xml(await sharedFile.async('text')).getElementsByTagNameNS('*', 'si')].map(item => [...item.getElementsByTagNameNS('*', 't')].map(node => node.textContent || '').join('')) : []
  const sheetXml = xml(await sheetFile.async('text'))
  const rows = [...sheetXml.getElementsByTagNameNS('*', 'row')].map(row => {
    const cells: string[] = []
    for (const cell of [...row.getElementsByTagNameNS('*', 'c')]) {
      const index = columnIndex(cell.getAttribute('r') || '')
      const value = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent || ''
      const inline = [...cell.getElementsByTagNameNS('*', 't')].map(node => node.textContent || '').join('')
      cells[index] = cell.getAttribute('t') === 's' ? (shared[Number(value)] ?? '') : cell.getAttribute('t') === 'inlineStr' ? inline : value
    }
    return cells.map(value => value || '')
  })
  if (!rows.length) throw new Error('Lembar kerja Excel kosong.')
  const csv = rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\n')
  return parseCsv(csv)
}
