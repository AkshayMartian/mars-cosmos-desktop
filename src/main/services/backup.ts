import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db'
import { localDate } from '@shared/dates'
import { getSetting } from './settings'

/**
 * Database backups: a consistent copy of the whole database (VACUUM INTO) in a folder, newest 30 kept.
 * The folder is the "backup_folder" setting if one is set (a USB drive or second disk is best),
 * otherwise the default the app sets at start-up. No electron import, so it can be tested.
 */

const KEEP = 30
let defaultDir = ''

export const setBackupDir = (dir: string): void => { defaultDir = dir }
export const backupFolder = (): string => getSetting<string>('backup_folder', '') || defaultDir

const sqlQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * A restore brings the shop data back, but not what belongs to this PC and today:
 *  - PINs: the PINs people use today stay (staff matched by id; someone only in the backup keeps the backup's PIN), and the owner's recovery code stays the current one.
 *  - Activation: this PC's licence stays, so restoring a backup made before activation (or before a renewal) never asks for the activation key again.
 *  - The setup wizard and guided tour, once finished on this PC, do not come back.
 * `pinSnapshot` reads these from the database in use (before the swap); `keepPins` writes them into the restored one.
 */
const KEPT_SETTINGS = ['licence', 'setup_done', 'tour_done'] as const
export interface PinSnapshot {
  staff: Array<{ id: string; pin_hash: string; must_change_pin: number }>
  recovery: string | null
  settings: Array<{ key: string; value: string }>
}
export function pinSnapshot(): PinSnapshot {
  const d = getDb()
  const staff = d.prepare('SELECT id, pin_hash, must_change_pin FROM staff').all() as PinSnapshot['staff']
  const rec = d.prepare("SELECT value FROM settings WHERE key='recovery'").get() as { value: string } | undefined
  const settings = d.prepare(`SELECT key, value FROM settings WHERE key IN (${KEPT_SETTINGS.map(() => '?').join(',')})`).all(...KEPT_SETTINGS) as PinSnapshot['settings']
  return { staff, recovery: rec?.value ?? null, settings }
}
export function keepPins(s: PinSnapshot): number {
  const d = getDb()
  const upd = d.prepare('UPDATE staff SET pin_hash=?, must_change_pin=?, failed_attempts=0, locked_until=0 WHERE id=?')
  const putSetting = d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  let n = 0
  d.transaction(() => {
    for (const r of s.staff) n += upd.run(r.pin_hash, r.must_change_pin, r.id).changes
    if (s.recovery) putSetting.run('recovery', s.recovery)
    else d.prepare("DELETE FROM settings WHERE key='recovery'").run()
    for (const r of s.settings ?? []) putSetting.run(r.key, r.value) // only what this PC has now; a value missing today leaves the backup's
  })()
  return n
}

export function runBackup(): { file: string; sizeBytes: number } {
  const folder = backupFolder()
  if (!folder) throw new Error('No backup folder is set.')
  try { mkdirSync(folder, { recursive: true }) } catch {
    throw new Error(`The backup folder ${folder} cannot be used. If it is on a USB drive, plug the drive in, or choose another folder in Settings → Backup.`)
  }

  // mars-2026-11-12.db; a second backup the same day gets the time added, and if even that is taken, a counter
  const now = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${localDate(now)}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  let file = join(folder, `mars-${localDate(now)}.db`)
  for (let n = 1; existsSync(file); n++) file = join(folder, `mars-${stamp}${n > 1 ? `-${n}` : ''}.db`)

  getDb().exec(`VACUUM INTO ${sqlQuote(file)}`) // must run outside a transaction
  const sizeBytes = statSync(file).size
  const db = getDb()
  db.prepare('INSERT INTO backups (at,file,size_bytes) VALUES (?,?,?)').run(now.toISOString(), file, sizeBytes)

  // keep only the newest copies (best effort: a locked old file never fails today's backup)
  const old = db.prepare('SELECT id,file FROM backups ORDER BY id DESC LIMIT -1 OFFSET ?').all(KEEP) as { id: number; file: string }[]
  for (const o of old) {
    try { rmSync(o.file, { force: true }) } catch { /* ignore */ }
    db.prepare('DELETE FROM backups WHERE id=?').run(o.id)
  }
  return { file, sizeBytes }
}

/**
 * App start: if the shop has data and the newest backup is older than 24 hours (or there is none), take one.
 * Never throws: a missing USB drive must not stop the shop from opening; the warning bar and Settings show it.
 */
export function autoBackupIfDue(now: Date = new Date()): { file: string } | null {
  try {
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM bills LIMIT 1').get() && !db.prepare('SELECT 1 FROM products LIMIT 1').get()) return null
    const last = db.prepare('SELECT at FROM backups ORDER BY id DESC LIMIT 1').get() as { at: string } | undefined
    if (last && now.getTime() - new Date(last.at).getTime() < 24 * 3600_000) return null
    return { file: runBackup().file }
  } catch { return null }
}

/** Is this file a Mars Cosmos database we can restore? Opens it read-only and checks it has our tables and is not from a newer app. */
export function validateBackup(file: string, latestVersion: number): { ok: true; staff: number } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: false, error: 'That file was not found.' }
  let d: Database.Database | null = null
  try {
    d = new Database(file, { readonly: true, fileMustExist: true })
    const v = d.pragma('user_version', { simple: true }) as number
    if (v > latestVersion) return { ok: false, error: 'This backup is from a newer version of Mars Cosmos. Update the app first.' }
    const staff = (d.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n
    d.prepare('SELECT COUNT(*) FROM bills').get()
    d.prepare('SELECT COUNT(*) FROM stock_moves').get()
    if (!staff) return { ok: false, error: 'This file has no staff, so it is not a usable backup.' }
    return { ok: true, staff }
  } catch {
    return { ok: false, error: 'This is not a Mars Cosmos backup file.' }
  } finally {
    d?.close()
  }
}
