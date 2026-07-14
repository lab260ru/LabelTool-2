/**
 * Client-side CSV export: the file is assembled in the browser
 * from the CURRENT table selection (after the student/group/search filters),
 * without calling the backend.
 */

type CsvValue = string | number | null | undefined

function escapeCell(value: CsvValue): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build the CSV (comma separator, CRLF line break). */
export function buildCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}

const UTF8_BOM = String.fromCharCode(0xfeff)

/** Download the CSV as a file; the BOM makes Excel read UTF-8 correctly. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
