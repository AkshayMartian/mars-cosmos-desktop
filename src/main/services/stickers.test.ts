import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { ean13 } from '@shared/barcode'
import { LABEL_SIZES, barcodeSvg, ean13Modules, labelHtml, printDocument, labelSize } from '@shared/stickers'
import { createProduct, getProduct, listCategories } from './catalogue'
import { setCurrent } from './session'
import { lastPurchaseItems, prepareJob, saveStickerPrefs, stickerContext, stickerItems } from './stickers'
import { stockIn } from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

function setup() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const p = createProduct({ name: 'Slim Fit Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 129_900, cost: 70_000, sizes: ['S', 'M'], colours: ['Blue'], opening: {} })
  return getProduct(p.id).variants
}

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('EAN-13 bars', () => {
  it('draws 95 modules with the standard guards', () => {
    const m = ean13Modules('2000000000015')!
    expect(m).toHaveLength(95)
    expect(m.startsWith('101')).toBe(true)
    expect(m.endsWith('101')).toBe(true)
    expect(m.slice(45, 50)).toBe('01010')
  })
  it('matches the standard encoding of 4006381333931 (first digit 4 picks the L G L L G G mix)', () => {
    const m = ean13Modules('4006381333931')!
    expect(m.slice(3, 45)).toBe(['0001101', '0100111', '0101111', '0111101', '0001001', '0110011'].join(''))
    expect(m.slice(50, 92)).toBe(['1000010', '1000010', '1000010', '1110100', '1000010', '1100110'].join(''))
  })
  it('refuses a wrong check digit or length', () => {
    expect(ean13Modules('2000000000014')).toBeNull()
    expect(ean13Modules('12345')).toBeNull()
    expect(barcodeSvg('abc', '10mm', '5mm')).toBe('')
    expect(barcodeSvg(ean13('200000000001'), '44mm', '7mm')).toContain('<rect')
  })
})

describe('label text', () => {
  const item = { variantId: 'v', shop: 'Raj <Fashion>', name: 'Slim Fit Shirt', colour: 'Blue', size: 'S', barcode: '2000000000015', mrp: 149_900, qty: 2 }
  it('shows shop, item, size, barcode and MRP, escaped', () => {
    const h = labelHtml(item, labelSize('50x25'))
    expect(h).toContain('Raj &lt;Fashion&gt;')
    expect(h).toContain('S · Blue')
    expect(h).toContain('2000000000015')
    expect(h).toContain('MRP ₹1,499')
    expect(h).toContain('incl. of all taxes')
    expect(h).toContain('width:50mm;height:25mm')
  })
  it('a print job repeats each item by its quantity at the page size', () => {
    const doc = printDocument([item, { ...item, qty: 1 }], LABEL_SIZES[1]!)
    expect(doc.match(/class="lbl"/g)).toHaveLength(3)
    expect(doc).toContain('@page{size:38mm 25mm')
  })
})

describe('sticker data and rules', () => {
  it('takes the price from the database', () => {
    const [s] = setup()
    const [it] = stickerItems([s!.id])
    expect(it).toMatchObject({ name: 'Slim Fit Shirt', size: 'S', colour: 'Blue', mrp: 149_900, shop: 'Your Shop' })
  })
  it('the last purchase brings each piece received', () => {
    const [s, m] = setup()
    expect(lastPurchaseItems()).toEqual([])
    stockIn({ supplierId: null, billNo: 'B1', billDate: new Date().toISOString().slice(0, 10), lines: [{ variantId: s!.id, qty: 4, cost: 70_000 }, { variantId: m!.id, qty: 2, cost: 70_000 }] })
    const items = lastPurchaseItems()
    expect(items.map((i) => [i.size, i.qty])).toEqual([['S', 4], ['M', 2]])
  })
  it('checks a print request', () => {
    const [s] = setup()
    expect(() => prepareJob([])).toThrow('Add at least one item')
    expect(() => prepareJob([{ variantId: s!.id, qty: 0 }])).toThrow('Enter how many stickers')
    expect(() => prepareJob([{ variantId: s!.id, qty: 501 }])).toThrow('At most 500')
    expect(() => prepareJob([{ variantId: 'nope', qty: 1 }])).toThrow('no longer exists')
    expect(prepareJob([{ variantId: s!.id, qty: 3 }])[0]!.qty).toBe(3)
  })
  it('keeps the label size and printer; only owner or manager may change them', () => {
    setup()
    expect(stickerContext()).toMatchObject({ sizeId: '50x25', printer: '', canManage: true })
    expect(saveStickerPrefs({ size: '38x25', printer: ' TSC TE244 ' })).toMatchObject({ sizeId: '38x25', printer: 'TSC TE244' })
    expect(() => saveStickerPrefs({ size: '1x1', printer: '' })).toThrow('Choose a label size')
    as('store')
    expect(stickerContext().canManage).toBe(false)
    expect(() => saveStickerPrefs({ size: '50x25', printer: '' })).toThrow()
    as('cashier')
    expect(() => stickerContext()).toThrow()
  })
})
