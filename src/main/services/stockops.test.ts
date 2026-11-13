import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { listApprovers } from './approval'
import { createProduct, getProduct, listCategories } from './catalogue'
import { setCurrent } from './session'
import {
  adjustStock, approveCount, countScan, countSet, createSupplier, discardCount, getOpenCount, recentMoves,
  startCount, stockHistory, stockLevels, stockOut
} from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
const qty = (name: string) => stockLevels(name).map((r) => r.qty)

/** Slim Shirt M/L with 5 and 3 pieces, plus a Belt with 1. */
function shop() {
  as('owner')
  const shirts = listCategories().find((c) => c.name === 'Shirts')!.id
  const a = getProduct(createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: shirts, mrp: 149_900, salePrice: 0, cost: 78_000, sizes: ['M', 'L'], colours: ['Blue'], opening: { 'Blue|M': 5, 'Blue|L': 3 } }).id).variants
  const b = getProduct(createProduct({ name: 'Linen Shirt', brand: '', categoryId: shirts, mrp: 279_900, salePrice: 0, cost: 0, sizes: ['M'], colours: ['Beige'], opening: { 'Beige|M': 1 } }).id).variants
  return { m: a[0]!, l: a[1]!, linen: b[0]! }
}

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('stock out', () => {
  it('takes stock down for each reason and records who, why and what', () => {
    const { m } = shop()
    as('store')
    const sup = createSupplier({ name: 'Shree Textiles' })
    expect(stockOut({ type: 'supplier_return', supplierId: sup.id, reason: 'Wrong size', lines: [{ variantId: m.id, qty: 1 }] }).qty).toBe(1)
    stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: m.id, qty: 1 }] })
    stockOut({ type: 'dispatch', supplierId: null, reason: 'Online order 2041', lines: [{ variantId: m.id, qty: 1 }] })
    stockOut({ type: 'other', supplierId: null, reason: 'Shop display', lines: [{ variantId: m.id, qty: 1 }] })
    expect(qty('Slim')[0]).toBe(1)
    expect(stockHistory(m.id).slice(0, 4).map((x) => x.type)).toEqual(['other_out', 'dispatch', 'damage', 'supplier_return'])
    expect(stockHistory(m.id)[3]).toMatchObject({ qty: -1, reason: 'Wrong size', staff: 'Store staff' })
  })
  it('checks the form: reason, supplier, note for "Other", quantities, items', () => {
    const { m } = shop()
    as('store')
    const line = [{ variantId: m.id, qty: 1 }]
    expect(() => stockOut({ type: 'other', supplierId: null, reason: ' ', lines: line })).toThrow('note')
    expect(() => stockOut({ type: 'supplier_return', supplierId: null, reason: '', lines: line })).toThrow('supplier')
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [] })).toThrow('at least one')
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: m.id, qty: 0 }] })).toThrow('whole numbers')
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: 'nope', qty: 1 }] })).toThrow('no longer exists')
    expect(() => stockOut({ type: 'nonsense' as 'damage', supplierId: null, reason: '', lines: line })).toThrow('Choose why')
    expect(qty('Slim')[0]).toBe(5)
  })
  it('needs approval for store staff to go below zero, but not owner or manager', () => {
    const { linen } = shop() // 1 in stock
    as('store')
    const two = { type: 'damage' as const, supplierId: null, reason: '', lines: [{ variantId: linen.id, qty: 2 }] }
    expect(() => stockOut(two)).toThrow('must approve')
    expect(() => stockOut({ ...two, approval: { staffId: id('manager'), pin: '9999' } })).toThrow('not correct')
    expect(() => stockOut({ ...two, approval: { staffId: id('store'), pin: '4444' } })).toThrow('not correct') // staff cannot approve themselves
    stockOut({ ...two, approval: { staffId: id('manager'), pin: '2222' } })
    expect(qty('Linen')[0]).toBe(-1)
    expect(getDb().prepare("SELECT approved_by FROM stock_outs").get()).toEqual({ approved_by: id('manager') })
    as('owner')
    expect(() => stockOut({ ...two, lines: [{ variantId: linen.id, qty: 1 }] })).not.toThrow() // owner needs no approval
  })
  it('is all-or-nothing and blocked for cashiers', () => {
    const { m } = shop()
    as('store')
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: m.id, qty: 2 }, { variantId: 'nope', qty: 1 }] })).toThrow()
    expect(qty('Slim')[0]).toBe(5)
    as('cashier')
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: m.id, qty: 1 }] })).toThrow('not allowed')
  })
})

describe('adjusting one item', () => {
  it('lets owner and manager adjust, and logs the reason', () => {
    const { m } = shop()
    expect(adjustStock({ variantId: m.id, change: -2, reason: 'damaged' })).toEqual({ stock: 3 })
    expect(adjustStock({ variantId: m.id, change: 1, reason: 'found' })).toEqual({ stock: 4 })
    expect(stockHistory(m.id)[0]).toMatchObject({ type: 'adjust', qty: 1, reason: 'found' })
  })
  it('makes store staff get a manager approval, and never lets stock go below zero', () => {
    const { m } = shop()
    as('store')
    expect(() => adjustStock({ variantId: m.id, change: -1, reason: 'lost' })).toThrow('must approve')
    expect(adjustStock({ variantId: m.id, change: -1, reason: 'lost', approval: { staffId: id('owner'), pin: '1111' } })).toEqual({ stock: 4 })
    expect(() => adjustStock({ variantId: m.id, change: -9, reason: 'lost', approval: { staffId: id('owner'), pin: '1111' } })).toThrow('below zero')
    expect(() => adjustStock({ variantId: m.id, change: 0, reason: 'lost' })).toThrow('other than 0')
    expect(() => adjustStock({ variantId: m.id, change: 1, reason: 'whatever' as 'lost' })).toThrow('reason')
    as('cashier')
    expect(() => adjustStock({ variantId: m.id, change: 1, reason: 'found' })).toThrow('not allowed')
  })
})

describe('stock count', () => {
  it('counts the shelf and posts the differences once approved', () => {
    const { m, l } = shop() // system: M 5, L 3, Linen 1
    as('store')
    const c = startCount()
    // listed by product name: Linen Shirt (1), then Slim Shirt M (5) and L (3); nothing counted yet
    expect(c.lines.map((x) => [x.system, x.counted])).toEqual([[1, 0], [5, 0], [3, 0]])
    expect(() => startCount()).toThrow('already open')
    for (let i = 0; i < 4; i++) countScan(m.barcode) // 4 of 5 found
    countScan(l.barcode); countScan(l.barcode); countScan(l.barcode); countScan(l.barcode) // 4 of 3: one extra
    countSet(m.id, 4)
    expect(() => countScan('0000000000000')).toThrow('No item with barcode')
    expect(() => countSet(m.id, -1)).toThrow('whole number')
    expect(getOpenCount()!.lines.find((x) => x.variantId === l.id)).toMatchObject({ system: 3, counted: 4 })
    expect(() => approveCount()).toThrow('must approve') // store staff cannot approve their own count
    // Linen was never scanned, so it counts as 0 when posted
    expect(approveCount({ staffId: id('manager'), pin: '2222' })).toEqual({ adjusted: 3 })
    expect(qty('Slim')).toEqual([4, 4]) // M 5 -> 4, L 3 -> 4
    expect(qty('Linen')).toEqual([0])
    expect(getOpenCount()).toBeNull()
    expect(stockHistory(m.id)[0]).toMatchObject({ type: 'count', qty: -1 })
  })
  it('lets a manager approve directly, and a count can be discarded without changing stock', () => {
    const { m } = shop()
    as('manager')
    startCount()
    countScan(m.barcode)
    discardCount()
    expect(qty('Slim')[0]).toBe(5)
    expect(getOpenCount()).toBeNull()
    expect(() => discardCount()).toThrow('no open count')
    startCount()
    expect(approveCount()).toEqual({ adjusted: 3 }) // nothing scanned: every item with stock goes to 0
    expect(qty('Slim')).toEqual([0, 0])
  })
  it('is for owner, manager and store staff only', () => {
    shop()
    as('cashier')
    expect(() => startCount()).toThrow('not allowed')
  })
})

describe('recent moves and approvers', () => {
  it('lists the latest moves with item names and who did them', () => {
    const { m } = shop()
    adjustStock({ variantId: m.id, change: -1, reason: 'lost' })
    const r = recentMoves(2)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ label: 'Slim Shirt · Blue · M', type: 'adjust', qty: -1, staff: 'Owner' })
  })
  it('lists only owners and managers as approvers', () => {
    as('store')
    expect(listApprovers().map((a) => a.role)).toEqual(['owner', 'manager'])
  })
})
