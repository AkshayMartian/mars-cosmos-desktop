import { getDb } from '../db'
import type { AppInfo } from '@shared/types'
import { current } from './session'

export function getSetting<T>(key: string, fallback: T): T {
  const r = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  return r ? (JSON.parse(r.value) as T) : fallback
}

/** Today's completed sales (returns subtracted) where this person was the salesperson. Top-bar chip. */
export function mySalesToday(): number {
  const a = current()
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const r = getDb()
    .prepare(`SELECT COALESCE(SUM(grand),0) AS t FROM bills WHERE status='completed' AND COALESCE(sales_by,staff_id)=? AND at>=?`)
    .get(a.id, start.toISOString()) as { t: number }
  return r.t
}

/** Shown in the top bar and used by the idle lock. Shop details are edited in Settings (milestone 8). */
export function appInfo(): AppInfo {
  const shop = getSetting<{ name?: string }>('shop', {})
  const security = getSetting<{ idleMinutes?: number }>('security', {})
  return { shopName: shop.name || 'Your Shop', counter: getSetting('counter', 'C1'), idleMinutes: security.idleMinutes ?? 10 }
}
