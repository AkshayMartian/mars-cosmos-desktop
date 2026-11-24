import { beforeEach, describe, expect, it } from 'vitest'
import type { NewBillInput } from '@shared/billing'
import { returnPart } from '@shared/returns'
import { getDb, openDb } from '../db'
import { createBill, openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { createCustomer } from './customers'
import { daySummary } from './dayend'
import { doReturn, findBillsForReturn, getBillForReturn, usableCreditNotes } from './returns'
import { setCurrent } from './session'
import { mySalesToday } from './settings'
import { stockOf } from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

function shop() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const a = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 10 } })
  const b = createProduct({ name: 'Polo', brand: 'Own', categoryId: cat, mrp: 89_900, salePrice: 89_900, cost: 42_000, sizes: ['L'], colours: ['Black'], opening: { 'Black|L': 5 } })
  const out = createProduct({ name: 'Rare Shirt', brand: 'Own', categoryId: cat, mrp: 99_900, salePrice: 99_900, cost: 40_000, sizes: ['S'], colours: ['Red'], opening: { 'Red|S': 0 } })
  return { shirt: getProduct(a.id).variants[0]!, polo: getProduct(b.id).variants[0]!, rare: getProduct(out.id).variants[0]! }
}
const sale = (over: Partial<NewBillInput>) => createBill({ lines: [], customerId: null, billDisc: 0, salesBy: null, payments: [], ...over })

/** Sells 2 shirts (Rs 2,998) to Rahul, paid in cash; the cashier is logged in afterwards. */
function sold(qty = 2, customer = true) {
  const s = shop()
  as('cashier'); openDay(0)
  const c = customer ? createCustomer({ mobile: '9876500045', name: 'Rahul', waConsent: false, offersConsent: false }) : null
  const b = sale({ lines: [{ variantId: s.shirt.id, qty, disc: 0 }], customerId: c?.id ?? null, payments: [{ mode: 'cash', amount: 149_900 * qty }] })
  return { ...s, bill: b, customer: c }
}
const lineOf = (billId: string) => getBillForReturn(billId).lines[0]!
const back = (billId: string, qty: number, over: Record<string, unknown> = {}) =>
  doReturn({ billId, lines: [{ lineId: lineOf(billId).id, qty }], newLines: [], settle: 'credit_note', payMode: 'cash', ...over } as Parameters<typeof doReturn>[0])

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('finding the bill', () => {
  it('finds by whole number, last digits, or the customer mobile', () => {
    const { bill } = sold()
    expect(findBillsForReturn(bill.no).map((b) => b.id)).toEqual([bill.id])
    expect(findBillsForReturn('0001').map((b) => b.id)).toEqual([bill.id])
    expect(findBillsForReturn('9876500045').map((b) => b.id)).toEqual([bill.id])
    expect(findBillsForReturn('9999999999')).toEqual([])
    expect(findBillsForReturn('1').map((b) => b.id)).toEqual([bill.id]) // just the running number
    expect(findBillsForReturn('2')).toEqual([])
    expect(findBillsForReturn('98765').map((b) => b.id)).toEqual([bill.id]) // part of the mobile
    expect(findBillsForReturn('00045').map((b) => b.id)).toEqual([bill.id])
    expect(findBillsForReturn(bill.no.slice(0, -1)).map((b) => b.id)).toEqual([bill.id]) // part of the bill number
    expect(findBillsForReturn('').map((b) => b.id)).toEqual([bill.id]) // empty = latest bills
  })
})

describe('plain return', () => {
  it('puts stock back, issues a credit note and writes a negative return bill', () => {
    const { bill, shirt, customer } = sold(2)
    expect(stockOf(shirt.id)).toBe(8)
    const r = back(bill.id, 1)
    expect(stockOf(shirt.id)).toBe(9)
    expect(r.returnBill).toMatchObject({ type: 'return', grand: -149_900 })
    expect(r.returnBill.no).toMatch(/\/0002$/)
    expect(r.returnBill.taxable + r.returnBill.cgst + r.returnBill.sgst).toBe(-149_900)
    expect(r.creditNote?.amount).toBe(149_900)
    expect(usableCreditNotes(customer!.id)).toMatchObject([{ balance: 149_900 }])
    expect(getBillForReturn(bill.id).lines[0]).toMatchObject({ returned: 1, returnable: 1 })
  })

  it('cannot return the same piece twice, nor more than was sold', () => {
    const { bill } = sold(2)
    back(bill.id, 2)
    expect(() => back(bill.id, 1)).toThrow('Only 0')
    expect(getBillForReturn(bill.id).lines[0]!.returnable).toBe(0)
  })

  it('refunds cash out of the open drawer, and Day end sees it', () => {
    const { bill } = sold(1)
    const before = daySummary().expected
    const r = back(bill.id, 1, { settle: 'cash' })
    expect(r.cashRefund).toBe(149_900)
    expect(daySummary()).toMatchObject({ cashOut: 149_900, expected: before - 149_900 })
  })

  it('a credit note needs a customer, so a walk-in bill must refund cash', () => {
    const { bill, shirt } = sold(1, false)
    expect(() => back(bill.id, 1)).toThrow('needs a customer')
    expect(stockOf(shirt.id)).toBe(9) // the failed attempt changed nothing
    expect(back(bill.id, 1, { settle: 'cash' }).cashRefund).toBe(149_900)
  })

  it('needs a started day and something chosen', () => {
    const { bill } = sold(1)
    expect(() => doReturn({ billId: bill.id, lines: [], newLines: [], settle: 'cash', payMode: 'cash' })).toThrow('at least one item')
    getDb().prepare("UPDATE day_sessions SET status='closed'").run()
    expect(() => back(bill.id, 1)).toThrow('Start the day')
  })

  it('takes the sale off the salesperson and the customer total (returns subtract)', () => {
    const { bill } = sold(1)
    const before = mySalesToday()
    back(bill.id, 1)
    expect(mySalesToday()).toBe(before - 149_900)
  })
})

describe('the return window', () => {
  const age = (billId: string, days: number) =>
    getDb().prepare('UPDATE bills SET at=? WHERE id=?').run(new Date(Date.now() - days * 864e5).toISOString(), billId)

  it('asks a cashier for a manager approval on an old bill, and records who approved', () => {
    const { bill } = sold(1)
    age(bill.id, 10)
    expect(getBillForReturn(bill.id)).toMatchObject({ overWindow: true, needsApproval: true })
    expect(() => back(bill.id, 1)).toThrow('approve')
    expect(() => back(bill.id, 1, { approval: { staffId: id('manager'), pin: '0000' } })).toThrow('not correct')
    const r = back(bill.id, 1, { approval: { staffId: id('manager'), pin: '2222' } })
    expect(r.returnBill.grand).toBe(-149_900)
    const log = getDb().prepare("SELECT details FROM audit_log WHERE action='return'").get() as { details: string }
    expect(JSON.parse(log.details)).toMatchObject({ approvedBy: id('manager') })
  })

  it('lets a manager return an old bill alone', () => {
    const { bill } = sold(1)
    age(bill.id, 30)
    as('manager')
    expect(getBillForReturn(bill.id).needsApproval).toBe(false)
    expect(() => back(bill.id, 1)).not.toThrow()
  })
})

describe('exchange', () => {
  it('customer pays the difference when the new item costs more', () => {
    const { bill, polo, shirt } = sold(1)
    const r = back(bill.id, 1, { newLines: [{ variantId: polo.id, qty: 1 }, { variantId: shirt.id, qty: 1 }], payMode: 'upi' })
    // returned 1,499; new = 899 + 1,499 = 2,398 -> customer pays 899
    expect(r.saleBill!.grand).toBe(239_800)
    expect(r.customerPaid).toBe(89_900)
    expect(r.saleBill!.payments).toHaveLength(2)
    expect(r.saleBill!.payments).toEqual(expect.arrayContaining([{ mode: 'credit_note', amount: 149_900 }, { mode: 'upi', amount: 89_900 }]))
    expect(r.returnBill.payments).toEqual([{ mode: 'credit_note', amount: -149_900 }])
    expect(r.creditNote).toBeNull()
    expect(stockOf(polo.id)).toBe(4)
  })

  it('gives the balance back as a credit note when the new item costs less', () => {
    const { bill, polo, customer } = sold(1)
    const r = back(bill.id, 1, { newLines: [{ variantId: polo.id, qty: 1 }] })
    expect(r.saleBill!.grand).toBe(89_900)
    expect(r.creditNote?.amount).toBe(60_000)
    expect(usableCreditNotes(customer!.id)[0]!.balance).toBe(60_000)
    expect(r.customerPaid).toBe(0)
  })

  it('never sells an item without stock, and rolls the whole thing back', () => {
    const { bill, rare, shirt } = sold(1)
    expect(() => back(bill.id, 1, { newLines: [{ variantId: rare.id, qty: 1 }] })).toThrow('out of stock')
    expect(stockOf(shirt.id)).toBe(9)
    expect(getBillForReturn(bill.id).lines[0]!.returned).toBe(0)
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM bills WHERE type='return'").get()).toEqual({ n: 0 })
  })
})

describe('credit notes at the till', () => {
  const pay = (customerId: string, shirtId: string, cn: { id: string; amount: number }[], cash: number) =>
    createBill({ lines: [{ variantId: shirtId, qty: 1, disc: 0 }], customerId, billDisc: 0, salesBy: null, payments: cash ? [{ mode: 'cash', amount: cash }] : [], creditNotes: cn })

  it('pays part of a bill with a credit note and lowers its balance', () => {
    const { bill, shirt, customer } = sold(2)
    back(bill.id, 1) // note of 1,499
    const note = usableCreditNotes(customer!.id)[0]!
    const b = pay(customer!.id, shirt.id, [{ id: note.id, amount: 100_000 }], 49_900)
    expect(b.payments).toEqual([{ mode: 'cash', amount: 49_900 }, { mode: 'credit_note', amount: 100_000 }])
    expect(usableCreditNotes(customer!.id)[0]!.balance).toBe(49_900)
    expect(() => pay(customer!.id, shirt.id, [{ id: note.id, amount: 100_000 }], 49_900)).toThrow('more than its balance')
  })

  it('refuses an expired note (and does not list it)', () => {
    const { bill, shirt, customer } = sold(2)
    back(bill.id, 1)
    const note = usableCreditNotes(customer!.id)[0]!
    getDb().prepare('UPDATE credit_notes SET expires_at=? WHERE id=?').run(new Date(Date.now() - 864e5).toISOString(), note.id)
    expect(usableCreditNotes(customer!.id)).toEqual([])
    expect(() => pay(customer!.id, shirt.id, [{ id: note.id, amount: 149_900 }], 0)).toThrow('expired')
  })

  it("refuses another customer's note and a note on a walk-in bill", () => {
    const { bill, shirt, customer } = sold(2)
    back(bill.id, 1)
    const note = usableCreditNotes(customer!.id)[0]!
    const other = createCustomer({ mobile: '9712300031', name: 'Neha', waConsent: false, offersConsent: false })
    expect(() => pay(other.id, shirt.id, [{ id: note.id, amount: 149_900 }], 0)).toThrow('does not belong')
    expect(() => createBill({ lines: [{ variantId: shirt.id, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [], creditNotes: [{ id: note.id, amount: 149_900 }] })).toThrow('customer is on the bill')
  })
})

describe('splitting a line over several returns', () => {
  it('shares always add up to the line amount', () => {
    for (const [amount, qty] of [[100, 3], [149_900, 7], [33_333, 3]] as const) {
      let got = 0
      for (let i = 0; i < qty; i++) got += returnPart(amount, qty, i, 1)
      expect(got).toBe(amount)
    }
  })
  it('a discounted bill returns what was actually paid', () => {
    const { shirt } = shop()
    as('cashier'); openDay(0)
    const b = createBill({ lines: [{ variantId: shirt.id, qty: 2, disc: 0 }], customerId: null, billDisc: 50_000, salesBy: null, payments: [{ mode: 'cash', amount: 249_800 }], approval: { staffId: id('manager'), pin: '2222' } })
    expect(b.grand).toBe(249_800)
    const r = back(b.id, 2, { settle: 'cash' })
    expect(r.returnBill.grand).toBe(-249_800)
  })
})
