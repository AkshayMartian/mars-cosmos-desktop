import type { Paise } from './money'
import type { CoinSettings } from './settings'

/** Coin rules (Settings → Coins). Money is paise; `per` is rupees spent for 1 coin; `value` is rupees one coin is worth. */
export const coinPaise = (c: CoinSettings): Paise => Math.round(c.value * 100)

/** Coins earned on a bill: 1 coin for every `per` rupees of the bill total. */
export const coinsEarned = (grand: Paise, c: CoinSettings): number => (c.on && grand > 0 ? Math.floor(grand / (c.per * 100)) : 0)

/** Most coins that can pay for a bill: the customer's balance and `maxPct` of the bill total (before coins). */
export function maxCoinsFor(billTotal: Paise, balance: number, c: CoinSettings): number {
  if (!c.on || billTotal <= 0 || balance <= 0) return 0
  const byBill = Math.floor(Math.floor((billTotal * c.maxPct) / 100) / coinPaise(c))
  return Math.max(0, Math.min(balance, byBill))
}

/** Date the coins earned at `at` stop working. */
export function coinExpiry(at: string, months: number): Date {
  const d = new Date(at)
  d.setMonth(d.getMonth() + months)
  return d
}
