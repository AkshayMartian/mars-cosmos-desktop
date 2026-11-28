import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { collectTables } from './cloudBackup'
import { setCurrent } from './session'

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('cloud backup data', () => {
  it('has every table except the local backup list, and never PINs, the recovery code or the licence', () => {
    const d = getDb()
    d.prepare("INSERT INTO settings(key,value) VALUES('licence','{\"token\":\"MARSL1.x\"}'),('recovery','{\"hash\":\"h\"}'),('receipt','{}') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const t = collectTables()
    expect(Object.keys(t)).toEqual(expect.arrayContaining(['bills', 'bill_lines', 'stock_moves', 'products', 'variants', 'customers', 'staff', 'settings']))
    expect(t['backups']).toBeUndefined()
    expect(t['staff']!.length).toBeGreaterThan(0)
    expect(t['staff']!.every((s) => !('pin_hash' in s) && 'name' in s)).toBe(true)
    const keys = t['settings']!.map((s) => s['key'])
    expect(keys).toContain('receipt')
    expect(keys).not.toContain('licence')
    expect(keys).not.toContain('recovery')
    expect(JSON.stringify(t)).not.toMatch(/scrypt\$/) // no PIN hash anywhere
  })
})
