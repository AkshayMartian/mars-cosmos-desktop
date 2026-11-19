import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { receiptText } from '@shared/receipt'
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
