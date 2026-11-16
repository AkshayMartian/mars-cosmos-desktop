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

/** Is this file a MARS POS database we can restore? Opens it read-only and checks it has our tables and is not from a newer app. */
export function validateBackup(file: string, latestVersion: number): { ok: true; staff: number } | { ok: false; error: string } {
  if (!existsSync(file)) return { ok: false, error: 'That file was not found.' }
  let d: Database.Database | null = null
  try {
    d = new Database(file, { readonly: true, fileMustExist: true })
    const v = d.pragma('user_version', { simple: true }) as number
    if (v > latestVersion) return { ok: false, error: 'This backup is from a newer version of MARS POS. Update the app first.' }
    const staff = (d.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n
    d.prepare('SELECT COUNT(*) FROM bills').get()
    d.prepare('SELECT COUNT(*) FROM stock_moves').get()
    if (!staff) return { ok: false, error: 'This file has no staff, so it is not a usable backup.' }
    return { ok: true, staff }
  } catch {
    return { ok: false, error: 'This is not a MARS POS backup file.' }
  } finally {
    d?.close()
  }
}
