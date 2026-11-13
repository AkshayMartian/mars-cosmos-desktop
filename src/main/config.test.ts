import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { resolveDbPath } from './config'
import { getDb, openDb } from './db'
import { createCategory, listCategories } from './services/catalogue'
import { setCurrent } from './services/session'

const tmp = () => mkdtempSync(join(tmpdir(), 'mars-cfg-'))

describe('resolveDbPath', () => {
  it('uses the default file when nothing is configured', () => {
    const d = tmp()
    expect(resolveDbPath(d, {})).toBe(join(d, 'mars-pos.db'))
  })
  it('reads dbPath from config.json', () => {
    const d = tmp()
    writeFileSync(join(d, 'config.json'), JSON.stringify({ dbPath: 'C:\\Users\\MARS\\Mars-Cosmos.db' }))
    expect(resolveDbPath(d, {})).toBe('C:\\Users\\MARS\\Mars-Cosmos.db')
  })
  it('lets MARS_DB_PATH override the config file, and ignores a broken one', () => {
    const d = tmp()
    writeFileSync(join(d, 'config.json'), '{ not json')
    expect(resolveDbPath(d, {})).toBe(join(d, 'mars-pos.db'))
    expect(resolveDbPath(d, { MARS_DB_PATH: 'X:\\my.db' })).toBe('X:\\my.db')
  })
})

describe('using a database file created by another tool (DB Browser)', () => {
  it('builds the schema in an empty file, stores a new category there and keeps it on reopen', () => {
    const file = join(tmp(), 'Mars-Cosmos.db')
    new Database(file).close() // what DB Browser leaves behind: a valid but empty database

    openDb(file)
    expect(listCategories().map((c) => c.name)).toContain('Shirts') // starter categories were seeded
    setCurrent((getDb().prepare("SELECT id FROM staff WHERE role='owner'").get() as { id: string }).id)
    createCategory({ name: 'Socks', hsn: '6115', gst: 12 })
    getDb().close()

    const raw = new Database(file, { readonly: true }) // read it back the way DB Browser would
    expect(raw.prepare("SELECT name,hsn,gst_mode,gst_rate FROM categories WHERE name='Socks'").get()).toEqual({ name: 'Socks', hsn: '6115', gst_mode: 'fixed', gst_rate: 12 })
    raw.close()
  })
})
