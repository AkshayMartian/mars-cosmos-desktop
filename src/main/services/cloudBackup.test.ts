import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { backupInfo } from './admin'
import { cloudBackupNow, cloudEnabled, cloudLatest, collectTables } from './cloudBackup'
import { machineId, setMachineIdForTests, setPublicKeyForTests } from './licence'
import { signLicence } from './licenceSign'
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

describe('online / offline mode (chosen at onboarding, carried in the licence)', () => {
  const pair = generateKeyPairSync('ed25519')
  const PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const activate = (mode: 'cloud' | 'local') => {
    setMachineIdForTests('AAAABBBBCCCCDDDDEEEEFFFF00001111')
    setPublicKeyForTests(pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
    const token = signLicence({ v: 1, key: 'MARS-7K2Q-9XFD-4LPA', machine: machineId(), shop: 'Test', plan: 'smart', mode, counters: 1, kind: 'full', expires: '2099-12-31', issued: '2026-11-28' }, PEM)
    getDb().prepare("INSERT INTO settings(key,value) VALUES('licence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ token, via: 'code', at: '2026-11-28', checkedAt: null }))
  }
  const owner = () => setCurrent((getDb().prepare("SELECT id FROM staff WHERE role='owner'").get() as { id: string }).id)
  afterEach(() => { setMachineIdForTests(null); setPublicKeyForTests(null) })

  it('online: cloud backup and restore are offered', () => {
    activate('cloud'); owner()
    expect(cloudEnabled()).toBe(true)
    expect(backupInfo().cloudEnabled).toBe(true)
  })
  it('offline: hidden, and refused even if called directly', async () => {
    activate('local'); owner()
    expect(cloudEnabled()).toBe(false)
    expect(backupInfo().cloudEnabled).toBe(false)
    await expect(cloudBackupNow()).rejects.toThrow('offline mode')
    await expect(cloudLatest()).rejects.toThrow('offline mode')
  })
  it('a PC that is not activated has no cloud backup', () => {
    owner()
    expect(cloudEnabled()).toBe(false)
  })
})
