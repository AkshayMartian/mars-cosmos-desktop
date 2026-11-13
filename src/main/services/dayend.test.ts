import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { setBackupDir } from './backup'
import { billingContext, createBill, openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { addExpense, closeDay, daySummary } from './dayend'
import { setCurrent } from './session'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
let backups = ''

/** A shirt at Rs 1,499 with plenty of stock. */
function shirt() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  return getProduct(createProduct({ name: 'Slim Shirt', brand: '', categoryId: cat, mrp: 149_900, salePrice: 0, cost: 0, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 20 } }).id).variants[0]!
}
const sell = (variantId: string, payments: { mode: 'cash' | 'upi' | 'card'; amount: number }[]) =>
  createBill({ lines: [{ variantId, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments })

beforeEach(() => {
  openDb(':memory:'); setCurrent(null)
  backups = mkdtempSync(join(tmpdir(), 'mars-bk-'))
  setBackupDir(backups)
})

describe('the day-end figures', () => {
  it('has no figures when the day has not been started', () => {
    as('cashier')
    expect(daySummary()).toMatchObject({ session: null, expected: 0, salesCount: 0, expenses: [] })
  })
  it('works out the cash that should be in the drawer', () => {
    const v = shirt()
    as('cashier'); openDay(200_000)
    sell(v.id, [{ mode: 'cash', amount: 149_900 }])
    sell(v.id, [{ mode: 'upi', amount: 149_900 }]) // not cash: not in the drawer
    sell(v.id, [{ mode: 'cash', amount: 50_000 }, { mode: 'card', amount: 99_900 }]) // part cash
    addExpense(5_000, 'Tea')
    const s = daySummary()
    expect(s).toMatchObject({ opening: 200_000, cashIn: 199_900, cashOut: 0, salesCount: 3, expensesTotal: 5_000 })
    expect(s.expected).toBe(200_000 + 199_900 - 5_000)
    expect(s.session).toMatchObject({ counter: 'C1', openedBy: 'Cashier' })
    expect(s.expenses).toMatchObject([{ note: 'Tea', amount: 5_000, staff: 'Cashier' }])
  })
  it('counts cash refunds going out of the drawer', () => {
    const v = shirt()
    as('cashier'); openDay(100_000)
    const b = sell(v.id, [{ mode: 'cash', amount: 149_900 }])
    // a refund of Rs 500 in cash (the Returns screen will create these): a negative cash payment on a completed bill
    getDb().prepare("INSERT INTO payments (bill_id,mode,amount) VALUES (?, 'cash', -50000)").run(b.id)
    expect(daySummary()).toMatchObject({ cashIn: 149_900, cashOut: 50_000, expected: 100_000 + 149_900 - 50_000 })
  })
  it('leaves cancelled bills out', () => {
    const v = shirt()
    as('cashier'); openDay(0)
    const b = sell(v.id, [{ mode: 'cash', amount: 149_900 }])
    getDb().prepare("UPDATE bills SET status='cancelled' WHERE id=?").run(b.id)
    expect(daySummary()).toMatchObject({ cashIn: 0, salesCount: 0, expected: 0 })
  })
})

describe('expenses', () => {
  it('needs an open day, an amount and a reason', () => {
    as('cashier')
    expect(() => addExpense(1_000, 'Tea')).toThrow('no open day')
    openDay(0)
    expect(() => addExpense(0, 'Tea')).toThrow('amount')
    expect(() => addExpense(-5, 'Tea')).toThrow('amount')
    expect(() => addExpense(10.5, 'Tea')).toThrow('amount')
    expect(() => addExpense(1_000, '  ')).toThrow('what it was for')
    addExpense(1_000, ' Courier ')
    expect(daySummary().expenses[0]!.note).toBe('Courier')
  })
})

describe('closing the day', () => {
  it('records expected, counted and the difference, locks the day and backs up the database', () => {
    const v = shirt()
    as('cashier'); openDay(200_000)
    sell(v.id, [{ mode: 'cash', amount: 149_900 }])
    addExpense(5_000, 'Tea')
    const expected = 200_000 + 149_900 - 5_000
    const r = closeDay(expected - 10_000) // Rs 100 short
    expect(r).toMatchObject({ expected, counted: expected - 10_000, diff: -10_000 })
    expect(r.backup.ok).toBe(true)
    expect(getDb().prepare("SELECT status,expected_cash,counted_cash,diff,closed_by FROM day_sessions").get())
      .toEqual({ status: 'closed', expected_cash: expected, counted_cash: expected - 10_000, diff: -10_000, closed_by: id('cashier') })
    // the day is locked: no more bills, expenses or closing; the next bill needs a new day
    expect(daySummary().session).toBeNull()
    expect(() => sell(v.id, [{ mode: 'cash', amount: 149_900 }])).toThrow('Start the day first')
    expect(() => addExpense(100, 'x')).toThrow('no open day')
    expect(() => closeDay(0)).toThrow('no open day')
    expect(billingContext().session).toBeNull()
    openDay(0) // a new day can start
    expect(daySummary().session).not.toBeNull()
  })
  it('works out the expected cash itself, and reports an overage as a positive difference', () => {
    as('cashier'); openDay(50_000)
    expect(closeDay(60_000)).toMatchObject({ expected: 50_000, diff: 10_000 })
  })
  it('refuses a missing or invalid count', () => {
    as('cashier'); openDay(0)
    expect(() => closeDay(-1)).toThrow('Enter the cash')
    expect(() => closeDay(1.5)).toThrow('Enter the cash')
    expect(() => closeDay(Number.NaN)).toThrow('Enter the cash')
    expect(daySummary().session).not.toBeNull() // still open
  })
  it('is not for store staff', () => {
    as('store')
    expect(() => daySummary()).toThrow('not allowed')
    expect(() => closeDay(0)).toThrow('not allowed')
  })
})

describe('the backup made when closing', () => {
  it('is a complete, readable copy of the database, recorded in the backups table', () => {
    const v = shirt()
    as('cashier'); openDay(0)
    sell(v.id, [{ mode: 'cash', amount: 149_900 }])
    const r = closeDay(149_900)
    if (!r.backup.ok) throw new Error(r.backup.error)
    expect(r.backup.file.startsWith(backups)).toBe(true)
    expect(readdirSync(backups)).toHaveLength(1)

    const copy = new Database(r.backup.file, { readonly: true })
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(copy.prepare('SELECT COUNT(*) AS n FROM bills').get()).toEqual({ n: 1 })
    expect(copy.prepare("SELECT status FROM day_sessions").get()).toEqual({ status: 'closed' }) // taken after the day was closed
    copy.close()
    expect(getDb().prepare('SELECT file,size_bytes FROM backups').get()).toMatchObject({ file: r.backup.file, size_bytes: expect.any(Number) })
  })
  it('closes the day anyway when the backup cannot be made, and says so', () => {
    as('cashier'); openDay(0)
    setBackupDir('') // nowhere to back up to
    const r = closeDay(0)
    expect(r.backup).toEqual({ ok: false, error: 'No backup folder is set.' })
    expect(daySummary().session).toBeNull() // the day is closed regardless
    expect(getDb().prepare("SELECT action FROM audit_log WHERE action='backup_failed'").all()).toHaveLength(1)
  })
  it('does not overwrite an earlier backup from the same day, and keeps only the newest 30', () => {
    as('cashier')
    for (let i = 0; i < 3; i++) { openDay(0); closeDay(0) }
    expect(readdirSync(backups)).toHaveLength(3) // same date, three different files
    for (let i = 0; i < 33; i++) { openDay(0); closeDay(0) }
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM backups').get()).toEqual({ n: 30 })
    expect(readdirSync(backups)).toHaveLength(30)
    expect(existsSync(join(backups))).toBe(true)
  })
})
