import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { createBill, openDay } from './billing'
import { billDetail, cancelBill, listBills } from './bills'
import { createProduct, getProduct, listCategories } from './catalogue'
import { createCustomer } from './customers'
import { daySummary } from './dayend'
import { doReturn, usableCreditNotes } from './returns'
import { setCurrent } from './session'
import { mySalesToday } from './settings'
import { stockOf } from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

function setup() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const p = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 10 } })
  const shirt = getProduct(p.id).variants[0]!
  as('cashier'); openDay(0)
  const cust = createCustomer({ mobile: '9876500045', name: 'Rahul Shah', waConsent: false, offersConsent: false })
  const bill = (customerId: string | null = null, qty = 1, over: object = {}) =>
    createBill({ lines: [{ variantId: shirt.id, qty, disc: 0 }], customerId, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 149_900 * qty }], ...over })
  return { shirt, cust, bill }
}

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('the bill list', () => {
  it('lists newest first and filters by number, mobile, name and period', () => {
    const { bill, cust } = setup()
    const a = bill(cust.id)
    const b = bill()
    expect(listBills('today', '').map((r) => r.id)).toEqual([b.id, a.id])
    expect(listBills('today', '0001').map((r) => r.id)).toEqual([a.id])
    expect(listBills('all', '98765').map((r) => r.id)).toEqual([a.id])
    expect(listBills('all', 'rahul').map((r) => r.id)).toEqual([a.id])
    expect(listBills('all', 'nobody')).toEqual([])
    getDb().prepare('UPDATE bills SET at=? WHERE id=?').run(new Date(Date.now() - 20 * 864e5).toISOString(), a.id)
    expect(listBills('today', '').map((r) => r.id)).toEqual([b.id])
    expect(listBills('7', '').map((r) => r.id)).toEqual([b.id])
    expect(listBills('all', '')).toHaveLength(2)
  })
  it('shows payment modes and the customer', () => {
    const { shirt, cust } = setup()
    createBill({ lines: [{ variantId: shirt.id, qty: 1, disc: 0 }], customerId: cust.id, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 49_900 }, { mode: 'upi', amount: 100_000 }] })
    const r = listBills('today', '')[0]!
    expect(r.customerName).toBe('Rahul Shah')
    expect([...r.modes].sort()).toEqual(['cash', 'upi'])
  })
  it('is closed to store staff', () => {
    setup()
    as('store')
    expect(() => listBills('today', '')).toThrow('not allowed')
  })
})

describe('cancelling a bill', () => {
  it('needs a reason', () => {
    const { bill } = setup()
    as('manager')
    expect(() => cancelBill({ billId: bill().id, reason: '  ' })).toThrow('reason')
  })

  it('puts stock back, drops the sale from totals and keeps the bill as Cancelled', () => {
    const { bill, shirt } = setup()
    const b = bill()
    expect(stockOf(shirt.id)).toBe(9)
    const cashBefore = daySummary().expected
    as('manager')
    const d = cancelBill({ billId: b.id, reason: 'Customer changed mind' })
    expect(d.bill.status).toBe('cancelled')
    expect(d).toMatchObject({ cancelReason: 'Customer changed mind', cancelledBy: 'Manager', cancellable: false })
    expect(stockOf(shirt.id)).toBe(10)
    as('cashier')
    expect(daySummary().expected).toBe(cashBefore - 149_900)
    expect(listBills('today', '').find((r) => r.id === b.id)!.status).toBe('cancelled')
    expect(() => cancelBill({ billId: b.id, reason: 'again' })).toThrow('already cancelled')
  })

  it('removes the sale from "My sales today"', () => {
    const { bill } = setup()
    const b = bill()
    expect(mySalesToday()).toBe(149_900)
    as('owner')
    cancelBill({ billId: b.id, reason: 'mistake' })
    as('cashier')
    expect(mySalesToday()).toBe(0)
  })

  it('a cashier needs a manager approval, and the approver is recorded', () => {
    const { bill } = setup()
    const b = bill()
    as('cashier')
    expect(billDetail(b.id).needsApproval).toBe(true)
    expect(() => cancelBill({ billId: b.id, reason: 'x' })).toThrow('approve')
    expect(() => cancelBill({ billId: b.id, reason: 'x', approval: { staffId: id('manager'), pin: '0000' } })).toThrow('not correct')
    const d = cancelBill({ billId: b.id, reason: 'x', approval: { staffId: id('manager'), pin: '2222' } })
    expect(d.cancelledBy).toBe('Manager')
  })

  it("refuses yesterday's bill (it belongs to a closed day)", () => {
    const { bill } = setup()
    const b = bill()
    getDb().prepare("UPDATE day_sessions SET status='closed'").run()
    openDay(0)
    as('owner')
    expect(billDetail(b.id).cancellable).toBe(false)
    expect(() => cancelBill({ billId: b.id, reason: 'late' })).toThrow('Return / exchange')
  })

  it('refuses a bill that already had items returned, and return bills', () => {
    const { bill } = setup()
    const b = bill(null, 2)
    const line = (getDb().prepare('SELECT id FROM bill_lines WHERE bill_id=?').get(b.id) as { id: number }).id
    const r = doReturn({ billId: b.id, lines: [{ lineId: line, qty: 1 }], newLines: [], settle: 'cash', payMode: 'cash' })
    as('owner')
    expect(() => cancelBill({ billId: b.id, reason: 'x' })).toThrow('already returned')
    expect(() => cancelBill({ billId: r.returnBill.id, reason: 'x' })).toThrow('return bill')
  })

  it('gives a credit note used as payment its balance back', () => {
    const { bill, cust } = setup()
    const first = bill(cust.id, 2)
    const line = (getDb().prepare('SELECT id FROM bill_lines WHERE bill_id=?').get(first.id) as { id: number }).id
    doReturn({ billId: first.id, lines: [{ lineId: line, qty: 1 }], newLines: [], settle: 'credit_note', payMode: 'cash' })
    const note = usableCreditNotes(cust.id)[0]!
    const paid = bill(cust.id, 1, { payments: [], creditNotes: [{ id: note.id, amount: 149_900 }] })
    expect(usableCreditNotes(cust.id)).toEqual([])
    as('owner')
    cancelBill({ billId: paid.id, reason: 'wrong item' })
    expect(usableCreditNotes(cust.id)[0]!.balance).toBe(149_900)
  })
})

describe('cancelling (the rules the shop asked for)', () => {
  it('a cashier always needs a manager PIN, even if the old "can cancel" flag is on', () => {
    const { bill } = setup()
    const b = bill()
    getDb().prepare("UPDATE staff SET can_cancel=1 WHERE role='cashier'").run()
    as('cashier')
    expect(billDetail(b.id).needsApproval).toBe(true)
    expect(() => cancelBill({ billId: b.id, reason: 'wrong size' })).toThrow('approve')
    expect(cancelBill({ billId: b.id, reason: 'wrong size', approval: { staffId: id('owner'), pin: '1111' } }).bill.status).toBe('cancelled')
  })
  it('needs a reason', () => {
    const { bill } = setup()
    const b = bill()
    as('owner')
    expect(() => cancelBill({ billId: b.id, reason: '   ' })).toThrow('reason')
  })
  it('puts the stock back, keeps the bill as Cancelled and never reuses its number', () => {
    const { bill, shirt } = setup()
    const a = bill(null, 2)
    expect(stockOf(shirt.id)).toBe(8)
    as('owner')
    const d = cancelBill({ billId: a.id, reason: 'customer left' })
    expect(d.bill.status).toBe('cancelled')
    expect(stockOf(shirt.id)).toBe(10)
    as('cashier')
    const next = bill()
    expect(next.no).not.toBe(a.no)
    expect(next.no).toMatch(/\/0002$/)
    expect(listBills('today', '').map((r) => r.no)).toEqual(expect.arrayContaining([a.no, next.no]))
    expect((getDb().prepare('SELECT COUNT(*) AS n FROM bills WHERE no=?').get(a.no) as { n: number }).n).toBe(1)
  })
})
