import Database from 'better-sqlite3'
import { MIGRATIONS } from './schema'
import { seedIfEmpty } from './seed'

let db: Database.Database | null = null
let dbFile = ''

export const getDbFile = (): string => dbFile

/** Closes the database (used before a restore replaces the file). */
export function closeDb(): void {
  db?.close()
  db = null
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not opened')
  return db
}

/** file = path to the .db file, or ':memory:' for tests. */
export function openDb(file: string): Database.Database {
  db = new Database(file)
  dbFile = file
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  seedIfEmpty(db)
  return db
}

function migrate(d: Database.Database): void {
  const current = d.pragma('user_version', { simple: true }) as number
  for (const m of MIGRATIONS.filter((x) => x.version > current)) {
    d.transaction(() => {
      d.exec(m.sql)
      d.pragma(`user_version = ${m.version}`)
    })()
  }
}
