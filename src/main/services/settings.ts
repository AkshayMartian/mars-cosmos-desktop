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
  const db = getDb()
  const used = !!db.prepare('SELECT 1 FROM bills LIMIT 1').get() || !!db.prepare('SELECT 1 FROM products LIMIT 1').get()
  // A shop that already has a name, bills or products was set up before this wizard existed.
  const setupDone = getSetting<boolean>('setup_done', false) || !!shop.name || used
  const last = db.prepare('SELECT at FROM backups ORDER BY id DESC LIMIT 1').get() as { at: string } | undefined
  const backupDays = last ? Math.floor((Date.now() - new Date(last.at).getTime()) / 864e5) : null
  return {
    shopName: shop.name || 'Your Shop', counter: getSetting('counter', 'C1'), idleMinutes: security.idleMinutes ?? 10,
    recoveryCodeSet: !!getSetting('recovery', null), tourDone: getSetting<boolean>('tour_done', false), setupDone, backupDays, backupWarn: used && (backupDays === null || backupDays > 2)
  }
}

/** The guided tour was shown or skipped: it does not open by itself again (anyone can replay it from the menu). */
export function markTourDone(): true {
  current() // someone must be logged in
  getDb().prepare("INSERT INTO settings (key,value) VALUES ('tour_done','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  return true
}
