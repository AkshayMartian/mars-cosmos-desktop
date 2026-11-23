import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { changePin, login } from './auth'
import { archiveProduct, createProduct, getProduct, listCategories, listProducts, restoreProduct, setBrandBarcode, updatePrices } from './catalogue'
import { setCurrent } from './session'
import { createSupplier, recentPurchases, searchVariants, stockHistory, stockIn, stockLevels } from './stock'

const staffId = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(staffId(role))

const shirt = () => ({
  name: 'Slim Shirt', brand: 'Own', categoryId: listCategories().find((c) => c.name === 'Shirts')!.id,
  mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['S', 'M'], colours: ['Blue', 'White'],
  opening: { 'Blue|S': 5, 'White|M': 3 }
})

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('login', () => {
  it('gives no session until a default PIN is changed', () => {
    getDb().prepare("UPDATE staff SET must_change_pin=1 WHERE role='cashier'").run() // seed has it off while developing
    const r = login(staffId('cashier'), '3333')
    expect(r.mustChangePin).toBe(true)
    expect(() => listProducts()).not.toThrow() // reads are open
    expect(() => createProduct(shirt())).toThrow('Not logged in')
    expect(changePin('3333').ok).toBe(false) // the PIN they were given is not allowed
    expect(changePin('7391').ok).toBe(true)
    expect(() => createProduct(shirt())).toThrow('not allowed') // cashier cannot create products
  })
  it('locks after 5 wrong PINs', () => {
    const id = staffId('manager')
    for (let i = 0; i < 4; i++) expect(login(id, '9999').ok).toBe(false)
    expect(login(id, '9999').lockedFor).toBe(60)
    expect(login(id, '2222').ok).toBe(false)
  })
})

describe('catalogue', () => {
  it('creates one variant per size × colour with unique barcodes and opening stock', () => {
    as('owner')
    const { id } = createProduct(shirt())
    const p = getProduct(id)
    expect(p.variants).toHaveLength(4)
    expect(new Set(p.variants.map((v) => v.barcode)).size).toBe(4)
    expect(p.variants.every((v) => v.barcode.length === 13)).toBe(true)
    expect(p.variants.reduce((a, v) => a + v.stock, 0)).toBe(8)
    expect(listProducts()[0]).toMatchObject({ name: 'Slim Shirt', stock: 8, sizes: ['S', 'M'] })
  })
  it('rejects duplicate names and missing data', () => {
    as('manager')
    createProduct(shirt())
    expect(() => createProduct(shirt())).toThrow('already exists')
    expect(() => createProduct({ ...shirt(), name: 'X', sizes: [] })).toThrow('size')
    expect(() => createProduct({ ...shirt(), name: 'Y', mrp: 0 })).toThrow('MRP')
  })
  it('archives a product out of the list and restores it with everything intact', () => {
    as('owner')
    const { id } = createProduct(shirt())
    archiveProduct(id)
    expect(listProducts()).toHaveLength(0)
    expect(listProducts('', '', true).map((p) => p.name)).toEqual(['Slim Shirt']) // visible under "Show archived"
    expect(getProduct(id)).toMatchObject({ active: false })
    expect(getProduct(id).variants).toHaveLength(4)
    restoreProduct(id)
    expect(listProducts()[0]).toMatchObject({ name: 'Slim Shirt', stock: 8 })
    expect(listProducts('', '', true)).toHaveLength(0)
  })
  it('will not restore over a newer product with the same name, and only for owner/manager', () => {
    as('owner')
    const old = createProduct(shirt()).id
    archiveProduct(old)
    createProduct(shirt()) // same name is free again while the first is archived
    expect(() => restoreProduct(old)).toThrow('Another product with this name')
    as('cashier')
    expect(() => archiveProduct(old)).toThrow('not allowed')
    expect(() => restoreProduct(old)).toThrow('not allowed')
  })
  it('only price-permitted staff can change prices', () => {
    as('owner')
    const v = getProduct(createProduct(shirt()).id).variants[0]!
    as('cashier')
    expect(() => updatePrices(v.id, 100_000, 100_000)).toThrow('not allowed')
    as('manager')
    updatePrices(v.id, 100_000, 90_000)
    expect(getProduct(v.productId).variants[0]!.salePrice).toBe(90_000)
  })
  it('keeps brand barcodes unique and findable by scan', () => {
    as('owner')
    const vs = getProduct(createProduct(shirt()).id).variants
    setBrandBarcode(vs[0]!.id, '8901234567890')
    expect(() => setBrandBarcode(vs[1]!.id, '8901234567890')).toThrow('already used')
    expect(searchVariants('8901234567890').map((r) => r.id)).toEqual([vs[0]!.id])
  })
})

describe('stock in', () => {
  it('adds stock, updates cost and records history', () => {
    as('store')
    // store staff cannot create products, so make one as owner first
    as('owner')
    const v = getProduct(createProduct(shirt()).id).variants[0]!
    as('store')
    const sup = createSupplier({ name: 'Shree Textiles' })
    const r = stockIn({ supplierId: sup.id, billNo: 'ST/1', billDate: '2026-11-01', lines: [{ variantId: v.id, qty: 6, cost: 80_000 }] })
    expect(r.qty).toBe(6)
    expect(stockLevels('Slim')[0]!.qty).toBe(11) // 5 opening + 6
    expect(stockHistory(v.id)[0]).toMatchObject({ type: 'purchase', qty: 6, ref: 'ST/1' })
    expect(getProduct(v.productId).variants[0]!.cost).toBe(80_000)
  })
  it('lists recent purchases with supplier, bill number, pieces and value, newest first', () => {
    as('owner')
    const v = getProduct(createProduct(shirt()).id).variants[0]!
    as('store')
    const sup = createSupplier({ name: 'Om Accessories', mobile: '9909033344', gstin: '24ccccc3333c1z2' })
    expect(sup.gstin).toBe('24CCCCC3333C1Z2') // stored upper-case
    stockIn({ supplierId: sup.id, billNo: 'OM/1', billDate: '2026-11-01', lines: [{ variantId: v.id, qty: 4, cost: 50_000 }] })
    stockIn({ supplierId: null, billNo: '', billDate: '', lines: [{ variantId: v.id, qty: 2, cost: 60_000 }] })
    const r = recentPurchases()
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ supplier: null, billNo: null, qty: 2, total: 120_000 })
    expect(r[1]).toMatchObject({ supplier: 'Om Accessories', billNo: 'OM/1', qty: 4, total: 200_000 })
  })
  it('product list: cost (lowest to highest) is for the owner and manager, hidden from the cashier', () => {
    as('owner')
    const id = createProduct(shirt()).id
    const name = getProduct(id).name
    getDb().prepare("UPDATE variants SET cost=cost+10000 WHERE id=(SELECT id FROM variants WHERE product_id=? LIMIT 1)").run(id)
    const row = listProducts(name)[0]!
    expect(row.cost).not.toBeNull()
    expect(row.costMax! - row.cost!).toBe(10_000)
    as('cashier')
    expect(listProducts(name)[0]).toMatchObject({ cost: null, costMax: null })
  })
  it('refuses a bad supplier GSTIN or an empty name', () => {
    as('store')
    expect(() => createSupplier({ name: 'X', gstin: '123' })).toThrow('15 letters')
    expect(() => createSupplier({ name: '  ' })).toThrow('supplier name')
  })
  it('mobile is optional, but when given it must be 10 digits (stored as digits only)', () => {
    as('store')
    for (const m of ['12345', '99090333445', 'abcdefghij', '5909033344']) expect(() => createSupplier({ name: 'M', mobile: m })).toThrow('Indian mobile')
    expect(createSupplier({ name: 'No mobile', mobile: '  ' }).mobile).toBeNull()
    expect(createSupplier({ name: 'Spaced', mobile: '99090 33344' }).mobile).toBe('9909033344')
  })
  it('rejects bad quantities and cashiers, and is all-or-nothing', () => {
    as('owner')
    const vs = getProduct(createProduct(shirt()).id).variants
    expect(() => stockIn({ supplierId: null, billNo: '', billDate: '', lines: [{ variantId: vs[0]!.id, qty: 0, cost: 0 }] })).toThrow('whole numbers')
    expect(() => stockIn({ supplierId: null, billNo: '', billDate: '', lines: [{ variantId: vs[0]!.id, qty: 2, cost: 1 }, { variantId: 'nope', qty: 1, cost: 1 }] })).toThrow('no longer exists')
    expect(stockLevels('Slim').reduce((a, r) => a + r.qty, 0)).toBe(8)
    as('cashier')
    expect(() => stockIn({ supplierId: null, billNo: '', billDate: '', lines: [{ variantId: vs[0]!.id, qty: 1, cost: 1 }] })).toThrow('not allowed')
  })
  it('flags low stock', () => {
    as('owner')
    createProduct(shirt())
    // opening stock is Blue|S 5, White|M 3, the other two 0; minimum is 2
    expect(stockLevels('', true).map((r) => r.qty)).toEqual([0, 0])
  })
})
