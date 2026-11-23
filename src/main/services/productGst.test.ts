import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { discountParts, receiptText } from '@shared/receipt'
import { billingContext, createBill, openDay, sellableSearch } from './billing'
import { createProduct, listCategories } from './catalogue'
import { setCurrent } from './session'

const make = (name: string, gstRate?: number | null) => {
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  return createProduct({ name, brand: 'Own', categoryId: cat, mrp: 100_000, salePrice: 100_000, cost: 50_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 5 }, ...(gstRate !== undefined ? { gstRate } : {}) })
}
const rule = (name: string) => { return sellableSearch(name)[0]!.gst }

beforeEach(() => {
  openDb(':memory:')
  setCurrent((getDb().prepare("SELECT id FROM staff WHERE role='owner'").get() as { id: string }).id)
})

describe('GST typed on a product', () => {
  it('follows the category when nothing is typed', () => {
    make('Plain')
    expect(rule('Plain').mode).toBe('auto')
  })
  it('a typed rate becomes the product\'s fixed rate in billing, including 0', () => {
    make('Twelve', 12); make('Zero', 0)
    expect(rule('Twelve')).toEqual({ mode: 'fixed', rate: 12 })
    expect(rule('Zero')).toEqual({ mode: 'fixed', rate: 0 })
  })
  it('refuses a rate that is not a whole number from 0 to 28', () => {
    expect(() => make('Bad1', 40)).toThrow(/GST/)
    expect(() => make('Bad2', 5.5)).toThrow(/GST/)
    expect(() => make('Bad3', -1)).toThrow(/GST/)
  })
})

describe('GST on the bill', () => {
  const sell = (name: string) => {
    openDay(0)
    const v = sellableSearch(name)[0]!
    return createBill({ lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 100_000 }] })
  }
  it('the bill line carries the typed GST %, the tax totals follow it, and the receipt prints both', () => {
    make('Twelve', 12)
    const b = sell('Twelve')
    expect(b.lines[0]!.rate).toBe(12)
    expect(b.cgst + b.sgst).toBe(10_714) // 1,000 inclusive at 12%
    expect(b.taxable + b.cgst + b.sgst).toBe(100_000)
    const text = receiptText(b, billingContext().shop, 'regular')
    expect(text).toContain('12%')
    expect(text).toContain('CGST')
  })
  it('a product with GST switched off (0%) bills with no tax', () => {
    make('NoTax', 0)
    const b = sell('NoTax')
    expect(b.lines[0]!.rate).toBe(0)
    expect(b.cgst + b.sgst).toBe(0)
  })
})

describe('item discount and bill discount are shown apart', () => {
  it('the bill keeps each item discount, and the receipt prints item discounts and the bill discount on their own lines', () => {
    make('Disc Shirt')
    openDay(0)
    const v = sellableSearch('Disc Shirt')[0]!
    // 2 x 1,000 = 2,000; item discount 100; bill discount 50; total 1,850
    const b = createBill({ lines: [{ variantId: v.id, qty: 2, disc: 10_000 }], customerId: null, billDisc: 5_000, salesBy: null, payments: [{ mode: 'cash', amount: 185_000 }] })
    expect(b.lines[0]!.itemDisc).toBe(10_000)
    expect(b.discount).toBe(15_000)
    const text = receiptText(b, billingContext().shop, 'regular')
    expect(text).toMatch(/Item discount\s+-100\.00/)
    expect(text).toMatch(/Item discounts\s+-100\.00/)
    expect(text).toMatch(/Bill discount\s+-50\.00/)
    expect(text).not.toMatch(/\nDiscount\s/)
    expect(discountParts(b)).toEqual({ item: 10_000, bill: 5_000 })
  })
  it('only a bill discount: no item lines; an old bill (no item figures) keeps the single Discount line', () => {
    make('Disc Two')
    openDay(0)
    const v = sellableSearch('Disc Two')[0]!
    const b = createBill({ lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: null, billDisc: 5_000, salesBy: null, payments: [{ mode: 'cash', amount: 95_000 }] })
    const text = receiptText(b, billingContext().shop, 'regular')
    expect(text).toMatch(/Bill discount\s+-50\.00/)
    expect(text).not.toContain('Item discount')
    const old = { ...b, lines: b.lines.map((l) => ({ ...l, itemDisc: null })) }
    expect(receiptText(old, billingContext().shop, 'regular')).toMatch(/\nDiscount\s+-50\.00/)
  })
})

describe('first print vs duplicate', () => {
  it('the first print has the fuller design; a reprint is plain with DUPLICATE on top', () => {
    make('Print Shirt')
    openDay(0)
    const v = sellableSearch('Print Shirt')[0]!
    const b = createBill({ lines: [{ variantId: v.id, qty: 2, disc: 10_000 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 190_000 }] })
    const shop = billingContext().shop
    const first = receiptText(b, shop, 'regular')
    expect(first.split('\n')[0]).toMatch(/^=+$/)
    expect(first).toContain('QTY x RATE')
    expect(first).toMatch(/Items 1\s+Qty 2/)
    expect(first).toMatch(/Subtotal\s+2,?000\.00/)
    expect(first).toContain('You saved Rs 100.00!')
    const copy = receiptText(b, shop, 'regular', true)
    expect(copy).toContain('** DUPLICATE **')
    expect(copy).not.toContain('QTY x RATE')
    expect(copy).not.toContain('You saved')
  })
})
