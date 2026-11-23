/** Indian financial year starts 1 April: 2026-27 runs Apr 2026 to Mar 2027. */
export function fyOf(d: Date = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

const pad = (n: number): string => String(n).padStart(2, '0')
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // Feb 29 allowed: a birthday has no year

/**
 * Birthdays and anniversaries are typed as DD-MM and stored as MM-DD (no year, so they match every year).
 * Returns '' for blank, null when it is not a real date (31-02, 13-13, text).
 */
export function parseDayMonth(text: string): string | null {
  const t = text.trim()
  if (!t) return ''
  const m = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})$/.exec(t)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]!) return null
  return `${pad(month)}-${pad(day)}`
}

/** Stored MM-DD back to the DD-MM the shop types. */
export const toDayMonth = (md: string | null): string => (md ? md.split('-').reverse().join('-') : '')

/** Today as MM-DD, to match stored birthdays. */
export const todayMonthDay = (d: Date = new Date()): string => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "21 Aug" for a stored MM-DD. */
export function formatMonthDay(md: string | null): string {
  if (!md) return '—'
  const [mo, d] = md.split('-').map(Number)
  return new Date(2000, (mo ?? 1) - 1, d ?? 1).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Types a DD-MM date for the shop: keeps digits only, puts the dash in by itself, and adds the leading 0 when the
 * first digit of the day (4-9) or of the month (2-9) could not start a two-digit number. "5" -> "05-", "2108" -> "21-08".
 */
export function autoDayMonth(raw: string): string {
  let d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length >= 1 && Number(d[0]) > 3) d = '0' + d
  if (d.length >= 3 && Number(d[2]) > 1) d = d.slice(0, 2) + '0' + d.slice(2)
  d = d.slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d.length === 2 && raw.endsWith('-') ? `${d}-` : d
}
