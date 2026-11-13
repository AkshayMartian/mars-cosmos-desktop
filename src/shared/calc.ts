import { roundToRupee, type Paise } from './money'
import type { GstRule, GstScheme } from './types'

/** Clothing threshold: up to Rs 2,500 per piece is 5%, above is 18%. Confirm with the CA before go-live. */
export const APPAREL_THRESHOLD: Paise = 250_000

export interface CalcLineInput {
  variantId: string
  qty: number
  /** unit selling price, GST inclusive */
  price: Paise
  /** line discount in paise (total for the line) */
  disc?: Paise
  gst: GstRule
}

export interface CalcLine extends CalcLineInput {
  /** share of bill discount + coins allocated to this line */
  share: Paise
  net: Paise
  rate: number
  taxable: Paise
  cgst: Paise
  sgst: Paise
}

export interface CalcResult {
  lines: CalcLine[]
  subtotal: Paise
  lineDisc: Paise
  billDisc: Paise
  coinValue: Paise
  discount: Paise
  taxable: Paise
  cgst: Paise
  sgst: Paise
  roundOff: Paise
  grand: Paise
  qty: number
}

export function gstRate(scheme: GstScheme, rule: GstRule, unitNet: Paise): number {
  if (scheme !== 'regular') return 0
  if (rule.mode === 'exempt') return 0
  if (rule.mode === 'fixed') return rule.rate
  return unitNet <= APPAREL_THRESHOLD ? 5 : 18
}

/**
 * Prices are GST-inclusive. Bill discount and coin value are spread over the lines in
 * proportion to their value (last line takes the remainder so the parts always add up),
 * then GST is backed out of each line's net.
 */
export function calc(
  scheme: GstScheme,
  lines: CalcLineInput[],
  billDisc: Paise = 0,
  coinValue: Paise = 0
): CalcResult {
  const gross = lines.map((l) => l.price * l.qty - (l.disc ?? 0))
  const grossSum = gross.reduce((a, b) => a + b, 0)
  const extra = Math.min(grossSum, billDisc + coinValue)

  let given = 0
  const out: CalcLine[] = lines.map((l, i) => {
    const share =
      i === lines.length - 1 ? extra - given : Math.round(extra * (grossSum ? (gross[i] ?? 0) / grossSum : 0))
    given += share
    const net = (gross[i] ?? 0) - share
    const rate = gstRate(scheme, l.gst, l.qty ? net / l.qty : 0)
    const taxable = Math.round((net * 100) / (100 + rate))
    const tax = net - taxable
    const cgst = Math.floor(tax / 2)
    return { ...l, share, net, rate, taxable, cgst, sgst: tax - cgst }
  })

  const sum = (f: (l: CalcLine) => number) => out.reduce((a, l) => a + f(l), 0)
  const total = sum((l) => l.net)
  const grand = roundToRupee(total)
  const lineDisc = lines.reduce((a, l) => a + (l.disc ?? 0), 0)

  return {
    lines: out,
    subtotal: lines.reduce((a, l) => a + l.price * l.qty, 0),
    lineDisc,
    billDisc: Math.min(billDisc, grossSum),
    coinValue,
    discount: lineDisc + billDisc,
    taxable: sum((l) => l.taxable),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    roundOff: grand - total,
    grand,
    qty: lines.reduce((a, l) => a + l.qty, 0)
  }
}
