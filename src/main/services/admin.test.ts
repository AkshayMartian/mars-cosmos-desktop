import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { backupNow, backupInfo, getAllSettings, listStaffAdmin, saveBackupFolder, saveCoins, saveGst, savePrinters, saveReceipt, saveShop, saveStaff, setStaffPin } from './admin'
import { login } from './auth'
import { setBackupDir } from './backup'
import { appInfo } from './settings'
import { setCurrent } from './session'
import { alterationContext, getAltJob } from './alterations'
import { receiptTextFor, openDay, createBill } from './billing'
import { validateBackup } from './backup'
import { createProduct, getProduct, listCategories } from './catalogue'
import { MIGRATIONS } from '../db/schema'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
beforeEach(() => { openDb(':memory:'); setCurrent(null); as('owner') })

const shop = { name: 'Raj Fashion', phone: '98250 00010', address: 'Shop 4, CG Road', gstin: '24AAAAA1111A1Z5', state: '24 Gujarat' }

describe('Settings access', () => {
  it('is for the owner only', () => {
    for (const r of ['manager', 'cashier', 'store']) {
      as(r)
      expect(() => getAllSettings()).toThrow()
      expect(() => saveShop(shop)).toThrow()
      expect(() => listStaffAdmin()).toThrow()
      expect(() => backupNow()).toThrow()
    }
  })
})

describe('Shop and GST', () => {
  it('saves the shop and the top bar follows', () => {
    saveShop(shop)
    expect(getAllSettings().shop).toEqual(shop)
    expect(appInfo().shopName).toBe('Raj Fashion')
    expect(getDb().prepare("SELECT 1 FROM audit_log WHERE action='settings_change'").get()).toBeTruthy()
  })
  it('refuses a missing name, a bad GSTIN and a bad phone', () => {
    expect(() => saveShop({ ...shop, name: ' ' })).toThrow('shop name')
    expect(() => saveShop({ ...shop, gstin: '123' })).toThrow('GSTIN')
    expect(() => saveShop({ ...shop, phone: 'abc' })).toThrow('phone')
    expect(saveShop({ ...shop, gstin: '' }).gstin).toBe('')
  })
  it('keeps the receipt wording when the shop is saved', () => {
    saveReceipt({ footer: 'Thanks!', policy: 'No returns after 7 days', review: '', returnDays: 7, creditNoteDays: 90, width: '80 mm' })
    saveShop(shop)
    expect(getAllSettings().receipt).toMatchObject({ footer: 'Thanks!', policy: 'No returns after 7 days' })
  })
  it('switches the GST type', () => {
    expect(getAllSettings().gst).toBe('regular')
    saveGst('composition')
    expect(getAllSettings().gst).toBe('composition')
    expect(() => saveGst('other' as never)).toThrow('GST type')
  })
})

describe('Receipt, printers, coins', () => {
  const r = { footer: 'x', policy: 'y', review: 'https://g.page/r/abc', returnDays: 10, creditNoteDays: 60, width: '58 mm' as const }
  it('saves and validates the receipt settings', () => {
    saveReceipt(r)
    expect(getAllSettings().receipt).toMatchObject({ returnDays: 10, creditNoteDays: 60, width: '58 mm', review: 'https://g.page/r/abc' })
    expect(() => saveReceipt({ ...r, returnDays: -1 })).toThrow('Return window')
    expect(() => saveReceipt({ ...r, creditNoteDays: 0 })).toThrow('Credit note')
    expect(() => saveReceipt({ ...r, review: 'g.page' })).toThrow('http')
  })
  it('the return window is read by Returns', async () => {
    saveReceipt({ ...r, returnDays: 3 })
    const { returnWindowDays } = await import('./returns')
    expect(returnWindowDays()).toBe(3)
  })
  it('saves printers and coins', () => {
    savePrinters({ receipt: ' TVS RP 3200 ', drawer: true })
    expect(getAllSettings().printers).toEqual({ receipt: 'TVS RP 3200', drawer: true })
    saveCoins({ on: true, per: 50, value: 1, expiryMonths: 12, maxPct: 10 })
    expect(getAllSettings().coins).toEqual({ on: true, per: 50, value: 1, expiryMonths: 12, maxPct: 10 })
    expect(() => saveCoins({ on: true, per: 0, value: 1, expiryMonths: 6, maxPct: 20 })).toThrow('whole number')
    expect(() => saveCoins({ on: true, per: 100, value: 0, expiryMonths: 6, maxPct: 20 })).toThrow('worth')
    expect(() => saveCoins({ on: true, per: 100, value: 1, expiryMonths: 6, maxPct: 150 })).toThrow('0 to 100')
  })
})

describe('Staff', () => {
  const base = { name: 'Priya', role: 'cashier' as const, maxDiscountPct: 10, commissionPct: 1, canCancel: false, canChangePrice: false, active: true }
  it('adds a person who must change the PIN at first login', () => {
    const rows = saveStaff({ ...base, pin: '4821' })
    const p = rows.find((s) => s.name === 'Priya')!
    expect(p).toMatchObject({ role: 'cashier', maxDiscountPct: 10, active: true })
    const r = login(p.id, '4821')
    expect(r).toMatchObject({ ok: true, mustChangePin: true })
  })
  it('checks name, PIN and limits; there is one owner', () => {
    expect(() => saveStaff({ ...base, name: '', pin: '4821' })).toThrow('Name')
    expect(() => saveStaff({ ...base, pin: '12' })).toThrow('4 digits')
    expect(() => saveStaff({ ...base, pin: '1234' })).toThrow('harder')
    expect(() => saveStaff({ ...base, pin: '4821', maxDiscountPct: 120 })).toThrow('0 to 100')
    expect(() => saveStaff({ ...base, role: 'owner', pin: '4821' })).toThrow('one owner')
  })
  it('edits permissions and deactivates, but the owner stays owner and active', () => {
    const rows = saveStaff({ ...base, pin: '4821' })
    const p = rows.find((s) => s.name === 'Priya')!
    const after = saveStaff({ ...base, id: p.id, role: 'manager', canCancel: true, maxDiscountPct: 25, active: false })
    expect(after.find((s) => s.id === p.id)).toMatchObject({ role: 'manager', canCancel: true, maxDiscountPct: 25, active: false })
    const ownerId = id('owner')
    expect(() => saveStaff({ ...base, id: ownerId, name: 'Owner', role: 'owner', active: false })).toThrow('yourself')
    const o = saveStaff({ ...base, id: ownerId, name: 'Owner', role: 'cashier', active: true }).find((s) => s.id === ownerId)!
    expect(o.role).toBe('owner')
  })
  it('the owner sets a PIN; the person logs in with it and must change it', () => {
    const cashier = id('cashier')
    expect(() => setStaffPin(cashier, '12')).toThrow('4 digits')
    expect(() => setStaffPin(cashier, '0000')).toThrow('harder')
    setStaffPin(cashier, '7391')
    expect(login(cashier, '7391')).toMatchObject({ ok: true, mustChangePin: true })
    setCurrent(null); as('owner')
    expect(() => setStaffPin(id('owner'), '482915')).toThrow('4 digits') // every PIN is exactly 4 digits, the owner's too
    expect(() => setStaffPin(id('owner'), '48291')).toThrow('4 digits')
    expect(() => setStaffPin(id('owner'), '48a1')).toThrow('4 digits')
    setStaffPin(id('owner'), '4829')
    expect(login(id('owner'), '4829')).toMatchObject({ ok: true, mustChangePin: false })
  })
})

describe('Backup', () => {
  it('sets the folder, backs up and lists the copy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mars-bk-'))
    setBackupDir(dir)
    expect(backupInfo()).toMatchObject({ folder: dir, isDefault: true, copies: 0 })
    const other = mkdtempSync(join(tmpdir(), 'mars-bk2-'))
    expect(saveBackupFolder(other)).toMatchObject({ folder: other, isDefault: false })
    const i = backupNow()
    expect(i.copies).toBe(1)
    expect(i.list[0]!.file.startsWith(other)).toBe(true)
    expect(i.list[0]!.sizeBytes).toBeGreaterThan(0)
  })
})

describe('Alterations tab uses the existing rules', () => {
  it('shows the tailors and rules the owner can save', () => {
    expect(alterationContext().cfg).toMatchObject({ dueDays: 2, rate: 18 })
  })
})

describe('Receipt settings reach the receipt', () => {
  function bill() {
    const cat = listCategories().find((c) => c.name === 'Shirts')!.id
    const p = createProduct({ name: 'Shirt', brand: 'Own', categoryId: cat, mrp: 100_000, salePrice: 100_000, cost: 50_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 5 } })
    const v = getProduct(p.id).variants[0]!
    as('cashier'); openDay(0)
    return createBill({ lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 100_000 }] })
  }
  it('uses the footer, policy, review link and paper width', () => {
    saveReceipt({ footer: 'See you soon', policy: 'Return in 3 days', review: 'https://g.page/r/abc', returnDays: 3, creditNoteDays: 90, width: '58 mm' })
    const b = bill()
    const r = receiptTextFor(b.id)
    expect(r.width).toBe(32)
    expect(r.text).toContain('See you soon')
    expect(r.text).toContain('Return in 3 days')
    expect(r.text).toContain('https://g.page/r/abc')
    const long = r.text.split('\n').filter((l) => l.length > 32)
    expect(long.every((l) => l === 'https://g.page/r/abc' || l.startsWith('Return'))).toBe(true)
    expect(receiptTextFor(b.id, true).text).toContain('DUPLICATE')
  })
  it('is 48 wide on 80 mm paper (Font A)', () => {
    expect(receiptTextFor(bill().id).width).toBe(48)
  })
})

describe('Restore checks', () => {
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version
  it('accepts a real backup and refuses other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mars-rs-'))
    setBackupDir(dir)
    const made = backupNow().list[0]!.file
    expect(validateBackup(made, latest)).toMatchObject({ ok: true })
    expect(validateBackup(join(dir, 'missing.db'), latest)).toMatchObject({ ok: false })
    const junk = join(dir, 'junk.db')
    writeFileSync(junk, 'not a database')
    expect(validateBackup(junk, latest)).toMatchObject({ ok: false, error: expect.stringContaining('not a Mars Cosmos') })
    expect(validateBackup(made, latest - 1)).toMatchObject({ ok: false, error: expect.stringContaining('newer') })
  })
})

describe('Alteration job for printing', () => {
  it('finds a job by id and refuses an unknown one', () => {
    expect(() => getAltJob('nope')).toThrow('not found')
  })
})
