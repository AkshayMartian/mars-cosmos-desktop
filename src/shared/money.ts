/** All money in the app is an integer number of paise. Never store floats. */
export type Paise = number

export const toPaise = (rupees: number | string): Paise => Math.round(Number(rupees || 0) * 100)

/** "₹1,499" or "₹1,499.50"; negatives use a real minus sign. */
export function formatRupees(p: Paise): string {
  const neg = p < 0
  const abs = Math.abs(Math.round(p))
  const decimals = abs % 100 ? 2 : 0
  const text = (abs / 100).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
  return `${neg ? '−' : ''}₹${text}`
}

/** Plain amount for receipts: 1,499.00 (always two decimals, Indian grouping, minus sign for negatives). */
export function formatPlain(p: Paise): string {
  return (p < 0 ? '-' : '') + (Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Bills are rounded to the nearest whole rupee. */
export const roundToRupee = (p: Paise): Paise => Math.round(p / 100) * 100

/**
 * Typing a rupee amount (a discount): digits and one dot, at most 2 decimals, no zero at the start.
 * "0" gives "" and "05" gives "5"; a dot first gives "0." so 0.5 can still be typed. With `maxRupees`
 * a bigger number is cut back to the most that is allowed.
 */
export function cleanAmountInput(raw: string, maxRupees?: number): string {
  let t = raw.replace(/[^\d.]/g, '')
  const dot = t.indexOf('.')
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  if (t.startsWith('.')) t = '0' + t
  if (!t.includes('.')) t = t.replace(/^0+/, '')
  else if (/^0\d/.test(t)) t = t.replace(/^0+(?=\d)/, '')
  if (t !== '' && maxRupees !== undefined && Number(t) > maxRupees) t = String(Math.max(0, Math.floor(+(maxRupees * 100).toFixed(4)) / 100))
  return t === '0' ? '' : t
}
