import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DUPLICATE_PURCHASE } from '@shared/catalogue'
import { getDb, openDb } from '../db'
import { finishSetup, saveShop } from './admin'
import { autoBackupIfDue, setBackupDir } from './backup'
import { openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { closeDay, daySlip } from './dayend'
import { setCurrent } from './session'
import { appInfo } from './settings'
import { stockIn } from './stock'
import { stockItems } from './stickers'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
let dir = ''

function product() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const p = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M', 'L'], colours: ['Blue'], opening: { 'Blue|M': 5 } })
  return getProduct(p.id).variants
}

beforeEach(() => { openDb(':memory:'); setCurrent(null); dir = mkdtempSync(join(tmpdir(), 'mars-bk-')); setBackupDir(dir) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('first-run setup', () => {
  it('is not done on a new install, and is done once the owner finishes or names the shop', () => {
    expect(appInfo()).toMatchObject({ setupDone: false, backupWarn: false, backupDays: null })
    as('owner')
    finishSetup()
    expect(appInfo().setupDone).toBe(true)
  })
  it('treats a shop that already has a name or products as set up', () => {
    as('owner')
    saveShop({ name: 'Mars Cosmos', phone: '', address: '', gstin: '', state: '' })
    expect(appInfo().setupDone).toBe(true)
  })
  it('only the owner can finish it', () => {
    as('cashier')
    expect(() => finishSetup()).toThrow('not allowed')
  })
})

describe('backups', () => {
  it('warns when the shop has data and no backup yet, and stops after one', () => {
    product()
    expect(appInfo()).toMatchObject({ backupWarn: true, backupDays: null })
    expect(autoBackupIfDue()).not.toBeNull()
    expect(appInfo()).toMatchObject({ backupWarn: false, backupDays: 0 })
  })
  it('does not back up an empty shop, nor twice in one day', () => {
    expect(autoBackupIfDue()).toBeNull()
    product()
    expect(autoBackupIfDue()).not.toBeNull()
    expect(autoBackupIfDue()).toBeNull()
  })
  it('backs up again after 24 hours', () => {
    product()
    autoBackupIfDue()
    expect(autoBackupIfDue(new Date(Date.now() + 25 * 3600_000))).not.toBeNull()
  })
  it('never throws when the backup folder cannot be used', () => {
    product()
    setBackupDir(join(dir, 'nul\0folder'))
    expect(autoBackupIfDue()).toBeNull()
  })
})

describe('stock in: the same supplier bill twice', () => {
  it('asks before saving it again', () => {
    const v = product()
    const input = { supplierId: null, billNo: 'INV-77', billDate: '2026-11-16', lines: [{ variantId: v[0]!.id, qty: 2, cost: 70_000 }] }
    stockIn(input)
    expect(() => stockIn(input)).toThrow(DUPLICATE_PURCHASE)
    expect(stockIn({ ...input, allowDuplicate: true }).qty).toBe(2)
    stockIn({ ...input, billNo: 'INV-78' }) // a different number is fine
  })
})

describe('labels for what is on the shelf', () => {
  it('gives one label per piece in stock, at least one for items with none', () => {
    const v = product()
    const items = stockItems(v.map((x) => x.id))
    expect(items.find((i) => i.variantId === v[0]!.id)!.qty).toBe(5)
    expect(items.find((i) => i.variantId === v[1]!.id)!.qty).toBe(1)
  })
})

describe('day-end slip', () => {
  it('prints the closed day with cash, expected and the difference', () => {
    as('cashier')
    openDay(200_000)
    const r = closeDay(195_000)
    const text = daySlip(r.sessionId)
    expect(text).toContain('DAY END')
    expect(text).toContain('SHORT')
    expect(text).toContain('2,000.00')
    expect(text.split('\n').every((l) => l.length <= 36)).toBe(true)
  })
  it('refuses a day that is still open', () => {
    as('cashier')
    openDay(0)
    const open = (getDb().prepare("SELECT id FROM day_sessions WHERE status='open'").get() as { id: string }).id
    expect(() => daySlip(open)).toThrow('not closed')
  })
})
