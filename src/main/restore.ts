import { app, dialog } from 'electron'
import { copyFileSync, renameSync, rmSync } from 'node:fs'
import { closeDb, getDb, getDbFile, openDb } from './db'
import { MIGRATIONS } from './db/schema'
import { audit } from './services/auth'
import { runBackup, validateBackup } from './services/backup'
import { requireRole } from './services/session'

/**
 * Restore: check the file, back up the current database first, close it, copy the backup over it and restart the app.
 * Nothing is replaced unless the file passes the checks.
 */
async function restore(file: string): Promise<{ restarting: true }> {
  const a = requireRole('owner')
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version
  const v = validateBackup(file, latest)
  if (!v.ok) throw new Error(v.error)
  const target = getDbFile()
  if (!target || target === ':memory:') throw new Error('The database file is not known.')
  if (file === target) throw new Error('That is the database in use.')
  const safety = runBackup() // a way back if this was the wrong file
  audit(a.id, 'restore', { from: file, safety: safety.file })
  // Copy next to the database first (a failure here changes nothing), then swap it in.
  const staged = target + '.restore'
  try { copyFileSync(file, staged) } catch { throw new Error('Could not read the backup file. Check the drive is connected and try again.') }
  getDb().pragma('wal_checkpoint(TRUNCATE)')
  closeDb()
  try {
    for (const ext of ['-wal', '-shm']) rmSync(target + ext, { force: true })
    renameSync(staged, target)
  } catch {
    // The swap failed (usually another program, such as DB Browser, has the file open): keep working on the current data.
    rmSync(staged, { force: true })
    openDb(target)
    throw new Error('Could not replace the database file. Close any other program that has it open (for example DB Browser for SQLite) and try again. Your current data is unchanged.')
  }
  setTimeout(() => { app.relaunch(); app.exit(0) }, 400) // let the reply reach the screen first
  return { restarting: true }
}

/** A file from the list of backups this app made. */
export async function restoreListed(file: string): Promise<{ restarting: true }> {
  requireRole('owner')
  const known = getDb().prepare('SELECT 1 FROM backups WHERE file=?').get(file)
  if (!known) throw new Error('That backup is not in the list.')
  return restore(file)
}

/** Any backup file the owner picks (for example from a USB drive). Returns null when the dialog is cancelled. */
export async function restoreFromFile(): Promise<{ restarting: true } | null> {
  requireRole('owner')
  const r = await dialog.showOpenDialog({ title: 'Choose a MARS POS backup', properties: ['openFile'], filters: [{ name: 'MARS POS backup', extensions: ['db'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  return restore(r.filePaths[0])
}
