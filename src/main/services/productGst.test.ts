import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { sellableSearch } from './billing'
import { createProduct, listCategories } from './catalogue'
import { setCurrent } from './session'

const make = (name: string, gstRate?: number | null) => {
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  return createProduct({ name, brand: 'Own', categoryId: cat, mrp: 100_000, salePrice: 100_000, cost: 50_000, sizes: ['M'], colours: ['Blue'], opening: {}, ...(gstRate !== undefined ? { gstRate } : {}) })
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
