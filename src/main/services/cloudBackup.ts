import Database from 'better-sqlite3'
import { randomInt } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CloudBackupInfo } from '@shared/settings'
import { getDb } from '../db'
import { MIGRATIONS } from '../db/schema'
import { hashPin } from './pin'
import { audit } from './auth'
import { licenceIdentity, licenceStatus, NO_INTERNET, serverRequest } from './licence'
import { requireRole } from './session'

/**
 * "Save to MARS cloud": uploads every table of this PC's SQLite database to MongoDB through the MARS server
 * (POST /v1/backup/cloud/start -> rows -> finish). The server stamps each record with the shop's shopId and keeps
 * one complete copy per shop (pos_<table> collections). The app never connects to MongoDB itself.
 * Never sent: PIN hashes, the owner's recovery code, the licence, and the list of local backup files.
 */

const SKIP_TABLES = new Set(['backups']) // file paths on this PC: meaningless in the cloud
const SKIP_SETTINGS = new Set(['licence', 'recovery', 'cloud_backup'])
const SECRET_COLUMNS: Record<string, readonly string[]> = { staff: ['pin_hash'] }
const BATCH = 500

type Row = Record<string, unknown>

/** Every table's rows as plain JSON (secrets removed, binary as base64). Exported for tests. */
export function collectTables(): Record<string, Row[]> {
  const d = getDb()
  const names = (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name).filter((n) => !SKIP_TABLES.has(n))
  const out: Record<string, Row[]> = {}
  for (const name of names) {
    let rows = d.prepare(`SELECT * FROM "${name}"`).all() as Row[]
    if (name === 'settings') rows = rows.filter((r) => !SKIP_SETTINGS.has(String(r['key'])))
    const drop = SECRET_COLUMNS[name] ?? []
    out[name] = rows.map((r) => {
      const o: Row = {}
      for (const [k, v] of Object.entries(r)) {
        if (drop.includes(k)) continue
        o[k] = Buffer.isBuffer(v) ? { base64: v.toString('base64') } : v
      }
      return o
    })
  }
  return out
}

/** Online (cloud) mode, chosen at onboarding and carried in the licence. An offline (local-only) shop, or a PC that is not activated, has no cloud backup. */
export function cloudEnabled(): boolean {
  const l = licenceStatus()
  return l.mode === 'cloud' && !['none', 'invalid', 'expired'].includes(l.state)
}
const OFFLINE = 'This shop uses the offline mode: data stays on this PC only. Ask MARS to move you to the online mode for cloud backup.'

export function lastCloudBackup(): CloudBackupInfo | null {
  const r = getDb().prepare("SELECT value FROM settings WHERE key='cloud_backup'").get() as { value: string } | undefined
  try { return r ? (JSON.parse(r.value) as CloudBackupInfo) : null } catch { return null }
}

const cloudCall = async <T>(step: string, body: Record<string, unknown>, what: string): Promise<T> => {
  const id = licenceIdentity(`This PC is not activated with MARS, so it cannot ${what}.`)
  try { return await serverRequest<T>('POST', '/v1/backup/cloud/' + step, { ...id, ...body }) } catch (e) {
    if (e instanceof Error && e.message === NO_INTERNET) throw new Error(`No internet connection. Connect to the internet to ${what}.`)
    throw e
  }
}

export interface CloudLatest { backupId: string; at: string; records: number; tables: Record<string, number>; schema: number | null }
/** The newest complete cloud copy of this shop, or null when there is none yet. */
export async function cloudLatest(): Promise<CloudLatest | null> {
  requireRole('owner')
  if (!cloudEnabled()) throw new Error(OFFLINE)
  return (await cloudCall<{ backup: CloudLatest | null }>('latest', {}, 'restore from the cloud')).backup
}

const PAGE = 1000
const fromJson = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { base64?: unknown }).base64 === 'string'
    ? Buffer.from((v as { base64: string }).base64, 'base64') : v

/**
 * Downloads the latest cloud copy and writes it into a new database file (this app's current tables, filled with the cloud rows).
 * Returns the file; restore.ts then restores it like any backup file (safety copy, today's PINs and activation kept, reload).
 * Columns the cloud copy does not have keep their default; columns this app no longer has are ignored.
 */
export async function buildFromCloud(): Promise<{ file: string; backup: CloudLatest }> {
  const backup = await cloudLatest()
  if (!backup) throw new Error('There is no cloud backup for this shop yet. Use "Back up now" → "Save to MARS cloud" first.')
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version
  if (backup.schema !== null && backup.schema > latest) throw new Error('This cloud backup was made by a newer version of Mars Cosmos. Update the app first.')
  // download everything first (the database write below is one transaction)
  const data: Record<string, Row[]> = {}
  for (const [table, count] of Object.entries(backup.tables)) {
    const rows: Row[] = []
    while (rows.length < count) {
      const page = (await cloudCall<{ rows: Row[] }>('download', { backupId: backup.backupId, table, skip: rows.length, limit: PAGE }, 'restore from the cloud')).rows
      if (!page.length) break
      rows.push(...page)
    }
    if (rows.length !== count) throw new Error(`The cloud backup is incomplete (${table}: ${rows.length} of ${count}). Try again.`)
    data[table] = rows
  }
  // start from a copy of this database (same tables, current version), then replace its rows with the cloud's
  const file = join(mkdtempSync(join(tmpdir(), 'mars-cloud-')), 'cloud-restore.db')
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const t = new Database(file)
  try {
    t.pragma('foreign_keys = OFF')
    const pins = new Map((t.prepare('SELECT id, pin_hash FROM staff').all() as { id: string; pin_hash: string }[]).map((r) => [r.id, r.pin_hash]))
    const tables = (t.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).filter((n) => !SKIP_TABLES.has(n))
    t.transaction(() => {
      for (const table of tables) {
        const cols = new Set((t.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name))
        if (table === 'settings') t.prepare(`DELETE FROM settings WHERE key NOT IN (${[...SKIP_SETTINGS].map(() => '?').join(',')})`).run(...SKIP_SETTINGS)
        else t.prepare(`DELETE FROM "${table}"`).run()
        for (const raw of data[table] ?? []) {
          const row: Row = {}
          for (const [k, v] of Object.entries(raw)) if (cols.has(k)) row[k] = fromJson(v)
          if (table === 'staff') {
            // PINs are never in the cloud: today's PIN for this person, else a random one they must change (the owner sets it in Settings → Staff)
            const known = pins.get(String(row['id']))
            row['pin_hash'] = known ?? hashPin(String(randomInt(0, 10_000)).padStart(4, '0'))
            if (!known) row['must_change_pin'] = 1
          }
          if (table === 'settings' && SKIP_SETTINGS.has(String(row['key']))) continue
          const keys = Object.keys(row)
          if (!keys.length) continue
          t.prepare(`INSERT OR REPLACE INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k] as never))
        }
      }
    })()
  } finally { t.close() }
  return { file, backup }
}

export async function cloudBackupNow(): Promise<CloudBackupInfo> {
  const a = requireRole('owner')
  if (!cloudEnabled()) throw new Error(OFFLINE)
  const id = licenceIdentity('This PC is not activated with MARS, so it cannot back up to the cloud.')
  const data = collectTables()
  const call = async <T>(step: string, body: Record<string, unknown>): Promise<T> => {
    try { return await serverRequest<T>('POST', '/v1/backup/cloud/' + step, { ...id, ...body }) } catch (e) {
      // the shared helper talks about the PIN when there is no internet; say it for the backup instead
      if (e instanceof Error && e.message === NO_INTERNET) throw new Error('No internet connection. Connect to the internet to back up to the cloud, or save the backup on this PC.')
      throw e
    }
  }
  const schema = getDb().pragma('user_version', { simple: true }) as number
  const { backupId } = await call<{ backupId: string }>('start', { schema, tables: Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length])) })
  for (const [table, rows] of Object.entries(data)) {
    for (let i = 0; i < rows.length; i += BATCH) await call('rows', { backupId, table, rows: rows.slice(i, i + BATCH) })
  }
  const r = await call<{ records: number; tables: number; at: string }>('finish', { backupId })
  const info: CloudBackupInfo = { at: r.at, records: r.records, tables: r.tables }
  getDb().prepare("INSERT INTO settings(key,value) VALUES('cloud_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(info))
  audit(a.id, 'cloud_backup', { records: info.records, tables: info.tables })
  return info
}
