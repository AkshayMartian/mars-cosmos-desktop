import { BrowserWindow, dialog } from 'electron'
import { copyFileSync, renameSync, rmSync } from 'node:fs'
import { closeDb, getDb, getDbFile, openDb } from './db'
import { MIGRATIONS } from './db/schema'
import { audit } from './services/auth'
import { keepPins, pinSnapshot, runBackup, validateBackup, type PinSnapshot } from './services/backup'
import { enableSerialsEverywhere } from './services/catalogue'
import { requireRole, setCurrent } from './services/session'

/**
 * Restore: check the file, back up the current database first, close it, copy the backup over it, open it again and reload the window.
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
  const pins = pinSnapshot() // everything is restored except PINs: today's PINs stay
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
  reopenRestored(target, a.id, file, safety.file, pins)
  return { restarting: true }
}

/**
 * Opens the restored database in this same process and reloads the window, instead of restarting the program
 * (app.relaunch + exit broke a development run: the dev server stopped with the old process, so the new window had nothing to load).
 * Everyone is logged out: the restored data may have other staff and PINs.
 */
function reopenRestored(target: string, actorId: string, from: string, safety: string, pins: PinSnapshot): void {
  openDb(target) // brings an older backup up to the current schema
  keepPins(pins)
  enableSerialsEverywhere()
  setCurrent(null)
  try { audit(actorId, 'restore', { from, safety }) } catch { /* the restored data may not know this staff member; the safety copy holds the first record */ }
  setTimeout(() => { for (const w of BrowserWindow.getAllWindows()) w.webContents.reload() }, 600) // let "Restored" reach the screen first
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
  const r = await dialog.showOpenDialog({ title: 'Choose a Mars Cosmos backup', properties: ['openFile'], filters: [{ name: 'Mars Cosmos backup', extensions: ['db'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  return restore(r.filePaths[0])
}
