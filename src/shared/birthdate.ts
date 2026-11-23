/**
 * Birthdays and anniversaries are typed as DD-MM-YYYY (21-08-1990) and stored as YYYY-MM-DD.
 * Customers saved before the year was asked for keep their DD-MM (stored MM-DD); both forms are understood everywhere.
 */

const pad = (n: number): string => String(n).padStart(2, '0')
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // Feb 29 allowed while the year is not typed yet

const todayStored = (now: Date): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/**
 * What the shop typed, to what is stored. '' for blank, null when it is not a real date.
 * DD-MM-YYYY gives YYYY-MM-DD (from 1900; a date in the future is refused); DD-MM (an old customer) gives MM-DD.
 */
export function parseBirthDate(text: string, now: Date = new Date()): string | null {
  const t = text.trim()
  if (!t) return ''
  const m = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{4}))?$/.exec(t)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > DAYS[month - 1]!) return null
  if (m[3] === undefined) return `${pad(month)}-${pad(day)}`
  const year = Number(m[3])
  if (day === 29 && month === 2 && !isLeap(year)) return null
  const stored = `${year}-${pad(month)}-${pad(day)}`
  if (year < 1900 || stored > todayStored(now)) return null
  return stored
}

/** Stored value back to what the box shows: YYYY-MM-DD to DD-MM-YYYY, MM-DD to DD-MM. */
export function toBirthInput(stored: string | null): string {
  if (!stored) return ''
  const p = stored.split('-')
  if (p.length === 3) return `${p[2]}-${p[1]}-${p[0]}`
  return p.reverse().join('-')
}

/** The month and day of a stored value, MM-DD, to compare with today. */
export const monthDayOf = (stored: string | null): string => (stored ? stored.slice(-5) : '')

/** "21 Aug 1990", or "21 Aug" when there is no year. */
export function showBirthDate(stored: string | null): string {
  if (!stored) return '—'
  const p = stored.split('-').map(Number)
  const full = p.length === 3
  const d = new Date(full ? p[0]! : 2000, (full ? p[1]! : p[0]!) - 1, full ? p[2]! : p[1]!)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(full ? { year: 'numeric' } : {}) })
}

/**
 * Typing a date: digits only, the dashes come by themselves, and a digit that cannot be part of a real date is not accepted
 * (so a day of 32 or more, a month of 13 or more, 00, 31-04, a year before 1900 or a year or day in the future cannot be
 * typed). A first digit that cannot start a two-digit day or month gets a leading 0 ("5" gives "05"). At most DD-MM-YYYY.
 */
export function autoDate(raw: string, now: Date = new Date()): string {
  let d = ''
  const thisYear = String(now.getFullYear())
  const add = (digit: string): void => {
    const n = d.length
    if (n === 0) { d = Number(digit) > 3 ? '0' + digit : digit; return }
    if (n === 1) {
      const day = Number(d + digit)
      if (day < 1 || day > 31) return
      d += digit; return
    }
    if (n === 2) {
      if (Number(digit) > 1) { // 2-9 can only be a month on its own: 5 is 05
        if (Number(d) > DAYS[Number(digit) - 1]!) return
        d += '0' + digit
      } else d += digit
      return
    }
    if (n === 3) {
      const month = Number(d[2]! + digit)
      if (month < 1 || month > 12 || Number(d.slice(0, 2)) > DAYS[month - 1]!) return
      d += digit; return
    }
    if (n < 8) { // the year: 1900 up to today, never later
      const year = d.slice(4) + digit
      if (year.length === 1 && digit !== '1' && digit !== '2') return
      if (year.length === 2 && year !== '19' && year !== '20') return
      if (year > thisYear.slice(0, year.length)) return
      if (year.length === 4 && `${year}-${d.slice(2, 4)}-${d.slice(0, 2)}` > todayStored(now)) return
      d += digit
    }
  }
  for (const ch of raw.replace(/\D/g, '')) add(ch)
  const out = d.length > 4 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d
  return d.length === 2 && raw.endsWith('-') ? `${d}-` : out
}
