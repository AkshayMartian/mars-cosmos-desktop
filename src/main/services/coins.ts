import { getDb } from '../db'
import { coinExpiry, coinsEarned, coinPaise } from '@shared/coins'
import type { CoinSettings } from '@shared/settings'
import { getSetting } from './settings'

export const coinCfg = (): CoinSettings => getSetting<CoinSettings>('coins', { on: false, per: 100, value: 1, expiryMonths: 6, maxPct: 20 })

export function coinBalance(customerId: string): number {
  return (getDb().prepare('SELECT COALESCE(SUM(coins),0) AS n FROM coin_ledger WHERE customer_id=?').get(customerId) as { n: number }).n
}

function add(customerId: string, billId: string | null, type: 'earn' | 'use' | 'reverse' | 'expire', coins: number, at: string): void {
  if (coins === 0) return
  getDb().prepare('INSERT INTO coin_ledger (customer_id,bill_id,type,coins,at) VALUES (?,?,?,?,?)').run(customerId, billId, type, coins, at)
}

/**
 * Coins earned long enough ago are written off, oldest first: what is spent or taken back uses the oldest coins,
 * and whatever is left of a batch past its expiry gets an `expire` row. Safe to run any number of times.
 */
export function expireCoins(customerId: string, now: Date = new Date()): number {
  const cfg = coinCfg()
  const rows = getDb().prepare('SELECT type,coins,at FROM coin_ledger WHERE customer_id=? ORDER BY at,id').all(customerId) as { type: string; coins: number; at: string }[]
  const lots: { left: number; at: string }[] = []
  for (const r of rows) {
    if (r.coins > 0) lots.push({ left: r.coins, at: r.at })
    else {
      let take = -r.coins
      for (const l of lots) {
        const t = Math.min(l.left, take)
        l.left -= t
        take -= t
        if (!take) break
      }
    }
  }
  let gone = 0
  for (const l of lots) if (l.left > 0 && coinExpiry(l.at, cfg.expiryMonths) <= now) gone += l.left
  if (gone) add(customerId, null, 'expire', -gone, now.toISOString())
  return gone
}

/** Balance after dropping expired coins. */
export function liveBalance(customerId: string): number {
  expireCoins(customerId)
  return coinBalance(customerId)
}

/** Written inside the bill's transaction. */
export function recordSale(customerId: string, billId: string, used: number, grand: number, at: string): number {
  const earned = coinsEarned(grand, coinCfg())
  add(customerId, billId, 'use', -used, at)
  add(customerId, billId, 'earn', earned, at)
  return earned
}

/** A return takes back the coins earned on the value returned (never more than the customer still has). */
export function reverseForReturn(customerId: string, billId: string, returned: number, at: string): number {
  const take = Math.min(coinsEarned(returned, coinCfg()), Math.max(0, coinBalance(customerId)))
  add(customerId, billId, 'reverse', -take, at)
  return take
}

/** A cancelled bill gives back the coins it used and takes back the coins it earned. */
export function reverseForCancel(billId: string, at: string): { back: number; taken: number } {
  const b = getDb().prepare('SELECT customer_id AS c,coins_used AS u,coins_earned AS e FROM bills WHERE id=?').get(billId) as { c: string | null; u: number; e: number }
  if (!b.c) return { back: 0, taken: 0 }
  const taken = Math.min(b.e, Math.max(0, coinBalance(b.c)))
  add(b.c, billId, 'reverse', b.u, at)
  add(b.c, billId, 'reverse', -taken, at)
  return { back: b.u, taken }
}

export { coinPaise }
