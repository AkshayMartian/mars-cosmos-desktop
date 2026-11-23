import { beforeEach, describe, expect, it } from 'vitest'
import type { NewBillInput } from '@shared/billing'
import { receiptText, whatsappText } from '@shared/receipt'
import { getDb, openDb } from '../db'
import {
  archivedMatches, billingContext, createBill, getBill, holdBill, listHeld, openDay, resumeHeld, sellableByIds, sellableSearch
} from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { createCustomer, findCustomerByMobile } from './customers'
import { setCurrent } from './session'
import { mySalesToday } from './settings'
import { stockLevels } from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

/** One shirt at Rs 1,499 (5% GST) with 10 in stock, plus one at Rs 2,799 (18%). */
function stockedShop() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const a = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 10 } })
  const b = createProduct({ name: 'Linen Shirt', brand: 'Own', categoryId: cat, mrp: 279_900, salePrice: 279_900, cost: 150_000, sizes: ['L'], colours: ['Beige'], opening: { 'Beige|L': 2 } })
  return { shirt: getProduct(a.id).variants[0]!, linen: getProduct(b.id).variants[0]! }
}
const bill = (shirtId: string, over: Partial<NewBillInput> = {}): NewBillInput => ({
  lines: [{ variantId: shirtId, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null,
  payments: [{ mode: 'cash', amount: 149_900 }], ...over
})

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

/** Start the day as the cashier, then leave the current user as the cashier. */
const openDay0 = () => { as('cashier'); openDay(0) }

describe('the working day', () => {
  it('needs the day started (opening cash) before any bill', () => {
    const { shirt } = stockedShop()
    as('cashier')
    expect(billingContext().session).toBeNull()
    expect(() => createBill(bill(shirt.id))).toThrow('Start the day first')
    openDay(200_000)
    expect(billingContext().session).toMatchObject({ opening: 200_000 })
    expect(() => openDay(0)).toThrow('already started')
    expect(() => createBill(bill(shirt.id))).not.toThrow()
  })
  it('keeps the store staff out of billing', () => {
    as('store')
    expect(() => billingContext()).toThrow('not allowed')
  })
})

describe('making a bill', () => {
  it('saves the bill, takes stock down, numbers it per counter and financial year', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    const b1 = createBill(bill(shirt.id))
    expect(b1.no).toMatch(/^C1\/\d{4}-\d{2}\/0001$/)
    expect(b1).toMatchObject({ grand: 149_900, staffName: 'Cashier', status: 'completed' })
    expect(b1.lines[0]).toMatchObject({ name: 'Slim Shirt', qty: 1, rate: 5, total: 149_900 })
    expect(b1.taxable + b1.cgst + b1.sgst).toBe(149_900)
    expect(stockLevels('Slim')[0]!.qty).toBe(9)
    expect(createBill(bill(shirt.id)).no).toMatch(/\/0002$/)
    expect(stockLevels('Slim')[0]!.qty).toBe(8)
    expect(getDb().prepare("SELECT type,qty,ref FROM stock_moves WHERE type='sale' ORDER BY id").all()).toEqual([
      { type: 'sale', qty: -1, ref: b1.no }, { type: 'sale', qty: -1, ref: expect.stringMatching(/\/0002$/) }
    ])
  })
  it('works out price and GST itself, never from the screen', () => {
    const { shirt, linen } = stockedShop()
    as('cashier'); openDay(0)
    const b = createBill({ ...bill(shirt.id), lines: [{ variantId: shirt.id, qty: 2, disc: 0 }, { variantId: linen.id, qty: 1, disc: 0 }], payments: [{ mode: 'upi', amount: 579_700 }] })
    expect(b.grand).toBe(2 * 149_900 + 279_900)
    expect(b.lines.map((l) => l.rate)).toEqual([5, 18]) // 18% above Rs 2,500 per piece
    expect(() => createBill({ ...bill(shirt.id), payments: [{ mode: 'cash', amount: 100 }] })).toThrow('add up')
    expect(() => createBill({ ...bill(shirt.id), payments: [{ mode: 'cash', amount: 149_900 }, { mode: 'upi', amount: 100 }] })).toThrow('add up')
  })
  it('splits payment across modes', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    const b = createBill(bill(shirt.id, { payments: [{ mode: 'cash', amount: 50_000 }, { mode: 'upi', amount: 99_900 }] }))
    expect(b.payments).toEqual([{ mode: 'cash', amount: 50_000 }, { mode: 'upi', amount: 99_900 }])
  })
  it('rejects empty bills, bad quantities and unknown items', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    expect(() => createBill(bill(shirt.id, { lines: [] }))).toThrow('at least one')
    expect(() => createBill(bill(shirt.id, { lines: [{ variantId: shirt.id, qty: 0, disc: 0 }] }))).toThrow('whole numbers')
    expect(() => createBill(bill(shirt.id, { lines: [{ variantId: 'nope', qty: 1, disc: 0 }] }))).toThrow('no longer available')
    expect(() => createBill(bill(shirt.id, { lines: [{ variantId: shirt.id, qty: 1, disc: 999_999 }] }))).toThrow('more than its price')
    expect(stockLevels('Slim')[0]!.qty).toBe(10) // nothing was taken
  })
  it('records the salesperson for commission and counts it in "my sales today"', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    createBill(bill(shirt.id, { salesBy: id('manager') }))
    as('manager'); expect(mySalesToday()).toBe(149_900)
    as('cashier'); expect(mySalesToday()).toBe(0)
  })
})

describe('discount and stock approval', () => {
  it('lets the owner and manager discount freely', () => {
    const { shirt } = stockedShop()
    as('owner'); openDay(0)
    const b = createBill(bill(shirt.id, { billDisc: 75_000, payments: [{ mode: 'cash', amount: 74_900 }] })) // Rs 750 off = 50%
    expect(b.grand).toBe(74_900)
    as('manager')
    expect(() => createBill(bill(shirt.id, { billDisc: 75_000, payments: [{ mode: 'cash', amount: 74_900 }] }))).not.toThrow()
  })
  it('asks a cashier for approval above their limit, and checks the approver PIN', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0) // cashier limit is 10%
    const disc20 = bill(shirt.id, { billDisc: 30_000, payments: [{ mode: 'cash', amount: 119_900 }] }) // Rs 300 off = 20%
    expect(() => createBill(disc20)).toThrow('must approve')
    expect(() => createBill({ ...disc20, approval: { staffId: id('manager'), pin: '0000' } })).toThrow('not correct')
    expect(() => createBill({ ...disc20, approval: { staffId: id('cashier'), pin: '3333' } })).toThrow('not correct') // a cashier cannot approve
    const ok = createBill({ ...disc20, approval: { staffId: id('manager'), pin: '2222' } })
    expect(ok.grand).toBe(119_900)
    expect(getDb().prepare("SELECT details FROM audit_log WHERE action='approve'").get()).toMatchObject({ details: expect.stringContaining(id('manager')) })
    expect(() => createBill(bill(shirt.id, { billDisc: 15_000, payments: [{ mode: 'cash', amount: 134_900 }] }))).not.toThrow() // Rs 150 off = 10%, at the limit
  })
  it('never sells more than the stock, for anyone and even with an approval', () => {
    const { linen } = stockedShop() // 2 in stock
    openDay0()
    const three = { ...bill(linen.id), lines: [{ variantId: linen.id, qty: 3, disc: 0 }], payments: [{ mode: 'cash' as const, amount: 839_700 }] }
    for (const role of ['cashier', 'manager', 'owner']) {
      as(role)
      expect(() => createBill(three)).toThrow('Only 2 of Linen Shirt · Beige · L in stock')
      expect(() => createBill({ ...three, approval: { staffId: id('owner'), pin: '1111' } })).toThrow('in stock')
    }
    expect(stockLevels('Linen')[0]!.qty).toBe(2) // nothing was taken
    const two = { ...three, lines: [{ variantId: linen.id, qty: 2, disc: 0 }], payments: [{ mode: 'cash' as const, amount: 559_800 }] }
    expect(() => createBill(two)).not.toThrow() // exactly the stock is fine
    expect(stockLevels('Linen')[0]!.qty).toBe(0)
  })
  it('refuses an item that has no stock at all', () => {
    const { shirt } = stockedShop()
    openDay0()
    as('owner')
    getDb().prepare("INSERT INTO stock_moves (variant_id,qty,type,staff_id,at) VALUES (?,?, 'adjust', ?, ?)").run(shirt.id, -10, id('owner'), new Date().toISOString())
    expect(() => createBill(bill(shirt.id))).toThrow('Slim Shirt · Blue · M is out of stock')
  })
  it('counts the same item on two lines together against the stock', () => {
    const { linen } = stockedShop() // 2 in stock
    openDay0()
    as('cashier')
    const split = { ...bill(linen.id), lines: [{ variantId: linen.id, qty: 2, disc: 0 }, { variantId: linen.id, qty: 1, disc: 0 }], payments: [{ mode: 'cash' as const, amount: 839_700 }] }
    expect(() => createBill(split)).toThrow('Only 2')
  })
})

describe('customers on a bill', () => {
  it('finds a customer by mobile, records consent with who and when, and refuses duplicates', () => {
    as('cashier')
    expect(findCustomerByMobile('9876500045')).toBeNull()
    const c = createCustomer({ mobile: '98765 00045', name: 'Rahul Shah', waConsent: true, offersConsent: false })
    expect(c).toMatchObject({ mobile: '9876500045', waConsent: true })
    expect(getDb().prepare('SELECT consent_by,consent_at FROM customers').get()).toMatchObject({ consent_by: id('cashier'), consent_at: expect.any(String) })
    expect(findCustomerByMobile('9876500045')?.name).toBe('Rahul Shah')
    expect(() => createCustomer({ mobile: '9876500045', name: 'Other', waConsent: false, offersConsent: false })).toThrow('already exists')
    expect(() => createCustomer({ mobile: '123', name: 'X', waConsent: false, offersConsent: false })).toThrow('Indian mobile')
    expect(() => findCustomerByMobile('12')).toThrow('Indian mobile')
  })
  it('puts the customer on the receipt and the WhatsApp message', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    const c = createCustomer({ mobile: '9876500045', name: 'Rahul Shah', waConsent: true, offersConsent: false })
    const b = createBill(bill(shirt.id, { customerId: c.id }))
    const shop = billingContext().shop
    const text = receiptText(b, shop, 'regular')
    expect(text).toContain(b.no)
    expect(text).toContain('Rahul Shah')
    expect(text).toContain('TOTAL')
    expect(text).toContain('1,499.00')
    expect(text).toContain('CGST')
    expect(receiptText(b, shop, 'unregistered')).not.toContain('CGST')
    expect(whatsappText(b, shop)).toContain('Total: ₹1,499')
  })
})

describe('held bills', () => {
  it('holds a bill and gives it back once', () => {
    const { shirt } = stockedShop()
    as('cashier')
    expect(() => holdBill({ lines: [], customerId: null })).toThrow('Nothing')
    holdBill({ lines: [{ variantId: shirt.id, qty: 2, disc: 0 }], customerId: null })
    expect(listHeld()).toMatchObject([{ items: 1, staffName: 'Cashier' }])
    const held = listHeld()[0]!
    expect(resumeHeld(held.id).lines[0]).toMatchObject({ variantId: shirt.id, qty: 2 })
    expect(listHeld()).toHaveLength(0)
    expect(() => resumeHeld(held.id)).toThrow('no longer')
  })
})

describe('finding items to sell', () => {
  it('finds by scanned barcode, brand barcode or name, with price, stock and GST rule', () => {
    const { shirt } = stockedShop()
    as('cashier')
    expect(sellableSearch(shirt.barcode)).toMatchObject([{ id: shirt.id, price: 149_900, stock: 10, gst: { mode: 'auto' } }])
    expect(sellableSearch('linen')[0]!.label).toBe('Linen Shirt · Beige · L')
    expect(sellableSearch('nothing-like-this')).toEqual([])
    expect(sellableByIds([shirt.id])).toHaveLength(1)
  })
  it('does not offer archived products, but can say that a match is archived', () => {
    const { shirt } = stockedShop()
    getDb().prepare('UPDATE products SET active=0 WHERE id=?').run(shirt.productId)
    as('cashier')
    expect(sellableSearch(shirt.barcode)).toEqual([])
    expect(sellableSearch('slim')).toEqual([])
    expect(archivedMatches('slim')).toEqual(['Slim Shirt'])
    expect(archivedMatches(shirt.barcode)).toEqual(['Slim Shirt'])
    expect(archivedMatches('linen')).toEqual([]) // the other product is active
    expect(archivedMatches('  ')).toEqual([])
    expect(getBill).toBeTypeOf('function')
  })
})

describe('walk-in customers', () => {
  it('bills without a customer or a chosen salesperson; the salesperson is the person billing', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    expect(billingContext().meId).toBe(id('cashier'))
    const b = createBill(bill(shirt.id))
    expect(b.customer).toBeNull()
    expect((getDb().prepare('SELECT sales_by AS s FROM bills WHERE id=?').get(b.id) as { s: string }).s).toBe(id('cashier'))
    expect(whatsappText(b, billingContext().shop).startsWith('Hi, thank you')).toBe(true)
  })
  it('still needs a customer for an alteration, coins or a credit note', () => {
    const { shirt } = stockedShop()
    as('cashier'); openDay(0)
    expect(() => createBill(bill(shirt.id, { coinsUsed: 1 }))).toThrow(/customer|coins/i)
    expect(() => createBill(bill(shirt.id, { payments: [], creditNotes: [{ id: 'x', amount: 149_900 }] }))).toThrow('customer')
  })
})
