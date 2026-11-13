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
  mkdirSync(folder, { recursive: true })

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
