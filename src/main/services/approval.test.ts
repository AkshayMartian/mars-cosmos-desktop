import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, openDb } from '../db'
import { BASE_LOCK_MS, checkApprover, MAX_APPROVAL_FAILS, MAX_LOCK_MS } from './approval'
import { login } from './auth'
import { billingContext, createBill, openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { setCurrent } from './session'
import { adjustStock, approveCount, startCount, stockOut } from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
const manager = () => ({ staffId: id('manager'), pin: '2222' })
const wrong = (pin = '0000') => ({ staffId: id('manager'), pin })
const count = (action: string) => (getDb().prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action=?').get(action) as { n: number }).n
const tryApprove = (a: { staffId: string; pin: string }): string => { try { return checkApprover(a) } catch (e) { return (e as Error).message } }

beforeEach(() => {
  openDb(':memory:'); setCurrent(null)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

const wait = (ms: number) => vi.setSystemTime(Date.now() + ms)

describe('approver PIN lockout', () => {
  it('counts wrong PINs, then locks that approver, even for the right PIN', () => {
    as('cashier')
    expect(tryApprove(wrong())).toContain('(4 tries left)')
    expect(tryApprove(wrong())).toContain('(3 tries left)')
    expect(tryApprove(wrong())).toContain('(2 tries left)')
    expect(tryApprove(wrong())).toContain('(1 try left)')
    expect(tryApprove(wrong())).toBe('Too many wrong approval PINs. Approvals by this person are locked for 60 seconds.')
    expect(tryApprove(manager())).toBe('Too many wrong approval PINs. Try again in 60 seconds.') // the right PIN is refused while locked
    wait(30_000)
    expect(tryApprove(manager())).toBe('Too many wrong approval PINs. Try again in 30 seconds.')
  })

  it('lets the approver work again once the lock has run out', () => {
    as('cashier')
    for (let i = 0; i < MAX_APPROVAL_FAILS; i++) tryApprove(wrong())
    wait(BASE_LOCK_MS + 1)
    expect(checkApprover(manager())).toBe(id('manager'))
  })

  it('makes each further lock longer (1, 2, 4, 8 minutes) and never more than 15', () => {
    as('cashier')
    const expected = [60, 120, 240, 480, 900, 900]
    for (const secs of expected) {
      let last = ''
      for (let i = 0; i < MAX_APPROVAL_FAILS; i++) last = tryApprove(wrong())
      expect(last).toContain(`locked for ${secs} seconds`)
      wait(secs * 1000 - 1)
      expect(tryApprove(manager())).toContain('Try again in 1 seconds') // still locked one millisecond before the end
      wait(1)
    }
    expect(MAX_LOCK_MS).toBe(900_000)
  })

  it('forgets the failures after a right PIN, and the lock count starts again', () => {
    as('cashier')
    for (let i = 0; i < 4; i++) tryApprove(wrong())
    expect(checkApprover(manager())).toBe(id('manager')) // right PIN just before the limit clears the count
    for (let i = 0; i < 4; i++) tryApprove(wrong()) // 4 more are fine: not locked
    expect(tryApprove(wrong())).toContain('locked for 60 seconds') // the 5th since the clear locks, and it is lock number one (60 s)
    wait(61_000)
    expect(checkApprover(manager())).toBe(id('manager'))
    for (let i = 0; i < MAX_APPROVAL_FAILS; i++) tryApprove(wrong())
    expect(tryApprove(wrong())).toContain('Try again') // locked again
    expect(getDb().prepare('SELECT locks FROM approval_attempts').get()).toEqual({ locks: 1 }) // success reset it, so this is lock number one again
  })

  it('keeps each approver separate, and never touches the approver\'s own login', () => {
    as('cashier')
    for (let i = 0; i < MAX_APPROVAL_FAILS; i++) tryApprove(wrong())
    expect(tryApprove(manager())).toContain('Too many wrong approval PINs') // manager locked as an approver
    expect(checkApprover({ staffId: id('owner'), pin: '1111' })).toBe(id('owner')) // the owner is unaffected
    expect(login(id('manager'), '2222').ok).toBe(true) // the manager can still log in with their own PIN
  })

  it('stops checking PINs while locked, so a brute-force run tries only 5 PINs per lock', () => {
    as('cashier')
    for (let pin = 0; pin < 100; pin++) tryApprove(wrong(String(pin).padStart(4, '0')))
    expect(count('approval_failed')).toBe(MAX_APPROVAL_FAILS) // the other 95 attempts were refused without testing
    expect(count('approval_locked')).toBe(1)
    expect(getDb().prepare('SELECT fails,locks FROM approval_attempts').get()).toEqual({ fails: 0, locks: 1 })
  })

  it('does not count tries on someone who cannot approve, and says the same thing as for a wrong PIN', () => {
    as('cashier')
    for (let i = 0; i < 20; i++) expect(tryApprove({ staffId: id('cashier'), pin: '3333' })).toBe('That PIN is not correct for the chosen manager or owner.')
    expect(tryApprove({ staffId: 'no-such-person', pin: '2222' })).toBe('That PIN is not correct for the chosen manager or owner.')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM approval_attempts').get()).toEqual({ n: 0 })
  })

  it('needs an approval to be sent at all when one is required', () => {
    as('cashier')
    expect(() => checkApprover(undefined)).toThrow('A manager or owner must approve this.')
  })

  it('writes who tried, whom and how many tries were left, in the audit log', () => {
    as('cashier')
    tryApprove(wrong())
    const row = getDb().prepare("SELECT staff_id,details FROM audit_log WHERE action='approval_failed'").get() as { staff_id: string; details: string }
    expect(row.staff_id).toBe(id('cashier')) // the requester, so a guesser can be identified
    expect(JSON.parse(row.details)).toEqual({ approver: id('manager'), triesLeft: 4 })
  })
})

/** The same lockout protects every place that asks for an approval. */
describe('where approvals are asked for', () => {
  function shop() {
    as('owner')
    const cat = listCategories().find((c) => c.name === 'Shirts')!.id
    return getProduct(createProduct({ name: 'Slim Shirt', brand: '', categoryId: cat, mrp: 149_900, salePrice: 0, cost: 0, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 5 } }).id).variants[0]!
  }
  const lock = () => { for (let i = 0; i < MAX_APPROVAL_FAILS; i++) tryApprove(wrong()) }

  it('billing: a cashier\'s big discount cannot be approved while the manager is locked, and works after', () => {
    const v = shop()
    as('cashier'); openDay(0)
    const bill = { lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: null, billDisc: 30_000, salesBy: null, payments: [{ mode: 'cash' as const, amount: 119_900 }] }
    lock()
    expect(() => createBill({ ...bill, approval: manager() })).toThrow('Too many wrong approval PINs')
    expect(billingContext().session).not.toBeNull() // nothing was saved, the day is untouched
    wait(BASE_LOCK_MS + 1)
    expect(createBill({ ...bill, approval: manager() }).grand).toBe(119_900)
  })

  it('stock adjust by store staff', () => {
    const v = shop()
    as('store')
    lock()
    expect(() => adjustStock({ variantId: v.id, change: -1, reason: 'lost', approval: manager() })).toThrow('Too many wrong approval PINs')
    wait(BASE_LOCK_MS + 1)
    expect(adjustStock({ variantId: v.id, change: -1, reason: 'lost', approval: manager() })).toEqual({ stock: 4 })
  })

  it('stock out below zero by store staff', () => {
    const v = shop()
    as('store')
    lock()
    const out = { type: 'damage' as const, supplierId: null, reason: '', lines: [{ variantId: v.id, qty: 9 }] }
    expect(() => stockOut({ ...out, approval: manager() })).toThrow('Too many wrong approval PINs')
    wait(BASE_LOCK_MS + 1)
    expect(stockOut({ ...out, approval: manager() }).qty).toBe(9)
  })

  it('stock count approval by store staff', () => {
    shop()
    as('store')
    startCount()
    lock()
    expect(() => approveCount(manager())).toThrow('Too many wrong approval PINs')
    wait(BASE_LOCK_MS + 1)
    expect(approveCount(manager()).adjusted).toBe(1)
  })
})
