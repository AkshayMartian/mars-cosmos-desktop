import { beforeEach, describe, expect, it } from 'vitest'
import { stickerCode } from '@shared/serials'
import type { NewBillInput } from '@shared/billing'
import { getDb, openDb } from '../db'
import { billingContext, createBill, holdBill, makeBunch, openDay, resumeHeld, scanPiece } from './billing'
import { cancelBill } from './bills'
import { createProduct, getProduct, listCategories, setTrackSerials } from './catalogue'
import { doReturn, getBillForReturn } from './returns'
import { inStockSerials, pieceHistory } from './serials'
import { setCurrent } from './session'
import { adjustStock, approveCount, countScan, countSet, getOpenCount, startCount, stockIn, stockLevels, stockOut } from './stock'
import { prepareJob, stockItems } from './stickers'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
const qtyOf = (variantId: string) => stockLevels().find((s) => s.variantId === variantId)!.qty
const piecesIn = (variantId: string) => (getDb().prepare("SELECT COUNT(*) AS n FROM pieces WHERE variant_id=? AND status='in_stock'").get(variantId) as { n: number }).n
const code = (barcode: string, serial: string) => stickerCode(barcode, serial)

/** Slim Shirt Blue M, 6 pieces with serial numbers (0001..0006), plus Jeans (not tracked). */
function shop(track = true) {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const a = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 100_000, salePrice: 100_000, cost: 50_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 6 }, trackSerials: track })
  const b = createProduct({ name: 'Jeans', brand: 'Own', categoryId: cat, mrp: 100_000, salePrice: 100_000, cost: 50_000, sizes: ['32'], colours: ['Black'], opening: { 'Black|32': 5 } })
  return { shirt: getProduct(a.id).variants[0]!, jeans: getProduct(b.id).variants[0]!, shirtProduct: a.id }
}
const bill = (lines: NewBillInput['lines'], grand: number): NewBillInput => ({ lines, customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: grand }] })
const cashier = () => { as('cashier'); openDay(0) }

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('serials: stock in and tracking switch', () => {
  it('opening stock of a tracked product gets 0001.. and stock still equals the pieces', () => {
    const { shirt, jeans } = shop()
    expect(inStockSerials(shirt.id)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006'])
    expect(qtyOf(shirt.id)).toBe(6)
    expect(inStockSerials(jeans.id)).toEqual([]) // not tracked
  })
  it('stock in creates one serial per unit, continuing the numbers', () => {
    const { shirt } = shop()
    stockIn({ supplierId: null, billNo: 'S1', billDate: '', lines: [{ variantId: shirt.id, qty: 4, cost: 1 }] })
    expect(inStockSerials(shirt.id)).toHaveLength(10)
    expect(inStockSerials(shirt.id).at(-1)).toBe('0010')
    expect(qtyOf(shirt.id)).toBe(10)
    // the stickers of "what just arrived" are those 4 serials
    const item = stockItems([shirt.id])[0]!
    expect(item.serials).toHaveLength(10)
  })
  it('switching a product on gives existing stock its serials; the stock number does not change', () => {
    const { jeans } = shop()
    const jp = (getDb().prepare('SELECT product_id AS p FROM variants WHERE id=?').get(jeans.id) as { p: string }).p
    expect(setTrackSerials(jp, true)).toEqual({ newSerials: 5 })
    expect(inStockSerials(jeans.id)).toHaveLength(5)
    expect(qtyOf(jeans.id)).toBe(5)
    expect(setTrackSerials(jp, true)).toEqual({ newSerials: 0 }) // switching again changes nothing
  })
})

describe('serials: billing rules', () => {
  it('scans a sticker; a new piece of the same variant is fine; the same piece again says Already added', () => {
    const { shirt } = shop()
    cashier()
    const a = scanPiece(code(shirt.barcode, '0001'), [])!
    expect(a.variant.id).toBe(shirt.id)
    expect(a.serial).toBe('0001')
    expect(() => scanPiece(code(shirt.barcode, '0001'), [{ variantId: shirt.id, serial: '0001' }])).toThrow('Already added')
    expect(scanPiece(code(shirt.barcode, '0002'), [{ variantId: shirt.id, serial: '0001' }])!.serial).toBe('0002')
  })
  it('refuses an unknown serial, and a plain barcode is not a sticker', () => {
    const { shirt } = shop()
    cashier()
    expect(() => scanPiece(code(shirt.barcode, '0099'), [])).toThrow('This serial number is not in the stock records')
    expect(scanPiece(shirt.barcode, [])).toBeNull()
  })
  it('saves the bill: pieces are sold and linked, stock drops by the exact pieces, a sold piece is refused', () => {
    const { shirt } = shop()
    cashier()
    const b = createBill(bill([{ variantId: shirt.id, qty: 2, disc: 0, serials: ['0001', '0002'] }], 200_000))
    expect(qtyOf(shirt.id)).toBe(4)
    expect(inStockSerials(shirt.id)).toEqual(['0003', '0004', '0005', '0006'])
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM pieces WHERE bill_id=? AND status='sold'").get(b.id)).toEqual({ n: 2 })
    expect(() => scanPiece(code(shirt.barcode, '0001'), [])).toThrow('This piece is not in stock')
    expect(() => createBill(bill([{ variantId: shirt.id, qty: 1, disc: 0, serials: ['0001'] }], 100_000))).toThrow('This piece is not in stock')
    expect(qtyOf(shirt.id)).toBe(4)
  })
  it('a quantity without matching serials is refused; the same serial twice is refused', () => {
    const { shirt } = shop()
    cashier()
    expect(() => createBill(bill([{ variantId: shirt.id, qty: 2, disc: 0, serials: ['0001'] }], 200_000))).toThrow('Scan the sticker of every piece')
    expect(() => createBill(bill([{ variantId: shirt.id, qty: 2, disc: 0, serials: ['0001', '0001'] }], 200_000))).toThrow('Already added')
    expect(() => createBill(bill([{ variantId: shirt.id, qty: 1, disc: 0 }], 100_000))).toThrow('Scan the sticker of every piece')
    expect(qtyOf(shirt.id)).toBe(6)
  })
  it('untracked items still sell by quantity', () => {
    const { jeans } = shop()
    cashier()
    createBill(bill([{ variantId: jeans.id, qty: 2, disc: 0 }], 200_000))
    expect(qtyOf(jeans.id)).toBe(3)
  })
})

describe('serials: bunches', () => {
  it('picks the pieces (the scanned one first), gives the bunch its own barcode, and sells it as one line', () => {
    const { shirt } = shop()
    cashier()
    const bn = makeBunch(shirt.id, 4, [], '0003')
    expect(bn.serials).toEqual(['0003', '0001', '0002', '0004'])
    expect(bn.code).toMatch(/^21\d{11}$/)
    const b = createBill(bill([{ variantId: shirt.id, qty: 4, disc: 0, serials: bn.serials, bunch: bn.code }], 400_000))
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0]!.qty).toBe(4)
    expect(qtyOf(shirt.id)).toBe(2)
    expect(getDb().prepare('SELECT qty FROM bunches WHERE code=?').get(bn.code)).toEqual({ qty: 4 })
    expect(() => createBill(bill([{ variantId: shirt.id, qty: 2, disc: 0, serials: ['0005', '0006'], bunch: bn.code }], 200_000))).toThrow('already on a bill')
  })
  it('says how many are free when there are not enough, counting what is already on the bill', () => {
    const { shirt } = shop()
    cashier()
    expect(() => makeBunch(shirt.id, 7, [])).toThrow('Only 6 are free')
    expect(() => makeBunch(shirt.id, 6, ['0001', '0002'])).toThrow('Only 4 are free')
    expect(() => makeBunch(shirt.id, 1, [])).toThrow('2 or more')
  })
  it('a normal line and a bunch line of the same variant can be on one bill', () => {
    const { shirt } = shop()
    cashier()
    const bn = makeBunch(shirt.id, 3, ['0001'])
    const b = createBill(bill([
      { variantId: shirt.id, qty: 1, disc: 0, serials: ['0001'] },
      { variantId: shirt.id, qty: 3, disc: 0, serials: bn.serials, bunch: bn.code }
    ], 400_000))
    expect(b.lines[0]!.qty).toBe(4)
    expect(qtyOf(shirt.id)).toBe(2)
  })
})

describe('serials: held bills', () => {
  it('a held bill keeps its pieces reserved until it is resumed', () => {
    const { shirt } = shop()
    cashier()
    holdBill({ lines: [{ variantId: shirt.id, qty: 2, disc: 0, serials: ['0001', '0002'] }], customerId: null })
    expect(() => scanPiece(code(shirt.barcode, '0001'), [])).toThrow('This piece is in another bill on hold')
    expect(() => createBill(bill([{ variantId: shirt.id, qty: 1, disc: 0, serials: ['0002'] }], 100_000))).toThrow('another bill on hold')
    expect(makeBunch(shirt.id, 4, []).serials).toEqual(['0003', '0004', '0005', '0006'])
    expect(() => makeBunch(shirt.id, 5, [])).toThrow('Only 4 are free')
    const held = (getDb().prepare('SELECT id FROM held_bills').get() as { id: string }).id
    const back = resumeHeld(held)
    expect(back.lines[0]!.serials).toEqual(['0001', '0002'])
    expect(back.notes).toEqual([])
    expect(scanPiece(code(shirt.barcode, '0001'), [])!.serial).toBe('0001') // free again
  })
  it('refuses to hold a piece that is already sold', () => {
    const { shirt } = shop()
    cashier()
    createBill(bill([{ variantId: shirt.id, qty: 1, disc: 0, serials: ['0001'] }], 100_000))
    expect(() => holdBill({ lines: [{ variantId: shirt.id, qty: 1, disc: 0, serials: ['0001'] }], customerId: null })).toThrow('not in stock')
  })
})

describe('serials: cancel and return', () => {
  it('cancelling a bill puts every piece back', () => {
    const { shirt } = shop()
    as('cashier'); openDay(0)
    const b = createBill(bill([{ variantId: shirt.id, qty: 3, disc: 0, serials: ['0001', '0002', '0003'] }], 300_000))
    as('owner')
    cancelBill({ billId: b.id, reason: 'mistake' })
    expect(qtyOf(shirt.id)).toBe(6)
    expect(piecesIn(shirt.id)).toBe(6)
  })
  it('returns exactly the chosen pieces by serial, and the same piece can be sold again', () => {
    const { shirt } = shop()
    cashier()
    const b = createBill(bill([{ variantId: shirt.id, qty: 3, disc: 0, serials: ['0001', '0002', '0003'] }], 300_000))
    const line = getBillForReturn(b.id).lines[0]!
    expect(line.pieces).toEqual(['0001', '0002', '0003'])
    expect(() => doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 2 }], newLines: [], settle: 'cash', payMode: 'cash' })).toThrow('Choose the 2 piece(s)')
    expect(() => doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 1, serials: ['0006'] }], newLines: [], settle: 'cash', payMode: 'cash' })).toThrow('was not sold on this bill')
    doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 2, serials: ['0002', '0003'] }], newLines: [], settle: 'cash', payMode: 'cash' })
    expect(qtyOf(shirt.id)).toBe(5)
    expect(inStockSerials(shirt.id)).toEqual(['0002', '0003', '0004', '0005', '0006'])
    expect(getBillForReturn(b.id).lines[0]!.pieces).toEqual(['0001']) // 0001 is still sold
    expect(scanPiece(code(shirt.barcode, '0002'), [])!.serial).toBe('0002')
  })
  it('an exchange sells the new serial items by their serials', () => {
    const { shirt, jeans } = shop()
    cashier()
    const b = createBill(bill([{ variantId: jeans.id, qty: 1, disc: 0 }], 100_000))
    const line = getBillForReturn(b.id).lines[0]!
    const r = doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 1 }], newLines: [{ variantId: shirt.id, qty: 1, serials: ['0004'] }], settle: 'cash', payMode: 'cash' })
    expect(r.saleBill).not.toBeNull()
    expect(inStockSerials(shirt.id)).not.toContain('0004')
    expect(qtyOf(shirt.id)).toBe(5)
  })
  it('returning a tracked item sold before serials were switched on gives the pieces new serials', () => {
    const { jeans } = shop()
    cashier()
    const b = createBill(bill([{ variantId: jeans.id, qty: 2, disc: 0 }], 200_000))
    as('owner')
    const jp = (getDb().prepare('SELECT product_id AS p FROM variants WHERE id=?').get(jeans.id) as { p: string }).p
    setTrackSerials(jp, true) // 3 in stock get serials
    as('cashier')
    const line = getBillForReturn(b.id).lines[0]!
    expect(line.pieces).toEqual([])
    doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 2 }], newLines: [], settle: 'cash', payMode: 'cash' })
    expect(qtyOf(jeans.id)).toBe(5)
    expect(piecesIn(jeans.id)).toBe(5)
  })
})

describe('serials: stock out, adjust and count', () => {
  it('stock out takes the exact pieces and needs serials', () => {
    const { shirt } = shop()
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: shirt.id, qty: 2 }] })).toThrow('Scan the pieces')
    stockOut({ type: 'damage', supplierId: null, reason: 'torn', lines: [{ variantId: shirt.id, qty: 2, serials: ['0002', '0005'] }] })
    expect(inStockSerials(shirt.id)).toEqual(['0001', '0003', '0004', '0006'])
    expect(qtyOf(shirt.id)).toBe(4)
    expect(() => stockOut({ type: 'damage', supplierId: null, reason: '', lines: [{ variantId: shirt.id, qty: 1, serials: ['0002'] }] })).toThrow('not in stock')
    expect(pieceHistory(code(shirt.barcode, '0002')).status).toBe('damaged')
  })
  it('adjust: removing needs serials; adding makes new serials; found revives a lost piece', () => {
    const { shirt } = shop()
    expect(() => adjustStock({ variantId: shirt.id, change: -1, reason: 'lost' })).toThrow('Scan the pieces')
    adjustStock({ variantId: shirt.id, change: -1, reason: 'lost', serials: ['0006'] })
    expect(qtyOf(shirt.id)).toBe(5)
    expect(adjustStock({ variantId: shirt.id, change: 1, reason: 'found', serials: ['0006'] }).stock).toBe(6)
    expect(piecesIn(shirt.id)).toBe(6)
    expect(adjustStock({ variantId: shirt.id, change: 2, reason: 'correction' }).newSerials).toEqual(['0007', '0008'])
    expect(piecesIn(shirt.id)).toBe(qtyOf(shirt.id))
  })
  it('a stock count lists unscanned pieces as missing and marks them lost on approval', () => {
    const { shirt } = shop()
    startCount()
    for (const s of ['0001', '0002', '0003', '0004']) countScan(code(shirt.barcode, s))
    expect(() => countScan(code(shirt.barcode, '0001'))).toThrow('Already counted')
    expect(() => countScan(shirt.barcode)).toThrow('no serial number')
    expect(() => countSet(shirt.id, 3)).toThrow('scan each piece')
    const line = getOpenCount()!.lines.find((l) => l.variantId === shirt.id)!
    expect(line).toMatchObject({ counted: 4, system: 6, tracked: true, missing: ['0005', '0006'] })
    approveCount()
    expect(qtyOf(shirt.id)).toBe(4)
    expect(piecesIn(shirt.id)).toBe(4)
    expect(pieceHistory(code(shirt.barcode, '0005')).status).toBe('lost')
  })
})

describe('serials: history and stickers', () => {
  it('shows where a piece came from and what happened to it', () => {
    const { shirt } = shop()
    cashier()
    const b = createBill(bill([{ variantId: shirt.id, qty: 1, disc: 0, serials: ['0001'] }], 100_000))
    const h = pieceHistory(code(shirt.barcode, '0001'))
    expect(h.status).toBe('sold')
    expect(h.bill).toBe(b.no)
    expect(h.events.map((e) => e.event)).toEqual(['received', 'sold'])
    expect(() => pieceHistory(code(shirt.barcode, '0042'))).toThrow('not in the stock records')
  })
  it('prints one sticker per piece, each with its serial', () => {
    const { shirt } = shop()
    const job = prepareJob([{ variantId: shirt.id, qty: 3 }])[0]!
    expect(job.serials).toEqual(['0001', '0002', '0003'])
    expect(job.qty).toBe(3)
    expect(prepareJob([{ variantId: shirt.id, qty: 1, serials: ['0005'] }])[0]!.serials).toEqual(['0005'])
    expect(() => prepareJob([{ variantId: shirt.id, qty: 1, serials: ['0077'] }])).toThrow('not in the stock records')
  })
  it('billing context still works', () => {
    shop(); cashier()
    expect(billingContext().session).not.toBeNull()
  })
})
