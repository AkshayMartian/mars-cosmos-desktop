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
