import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { createBill, openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { saveTailor, createAlteration } from './alterations'
import { createCustomer } from './customers'
import { doReturn } from './returns'
import { setCurrent } from './session'
import { getReport } from './reports'
import { reportHtml } from '@shared/reports'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

function setup() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const p = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['S', 'M'], colours: ['Blue'], opening: { 'Blue|S': 10, 'Blue|M': 10 } })
  const [s, m] = getProduct(p.id).variants
  const old = createProduct({ name: 'Old Kurta', brand: 'Own', categoryId: cat, mrp: 99_900, salePrice: 99_900, cost: 50_000, sizes: ['L'], colours: ['Red'], opening: { 'Red|L': 4 } })
  const kurta = getProduct(old.id).variants[0]!
  as('cashier'); openDay(0)
  const sell = (variantId: string, qty = 1, pay: 'cash' | 'upi' = 'cash', over: object = {}) =>
    createBill({ lines: [{ variantId, qty, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: pay, amount: 149_900 * qty }], ...over })
  return { s: s!, m: m!, kurta, sell }
}

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('who can see reports', () => {
  it('owner and manager only', () => {
    setup()
    as('owner'); expect(() => getReport('sales', '30')).not.toThrow()
    as('manager'); expect(() => getReport('sales', '30')).not.toThrow()
    for (const r of ['cashier', 'store']) { as(r); expect(() => getReport('sales', '30')).toThrow() }
  })
  it('refuses an unknown report, period or dead-stock window', () => {
    setup(); as('owner')
    expect(() => getReport('nope' as never, '30')).toThrow('Unknown report')
    expect(() => getReport('sales', 'year' as never)).toThrow('Unknown period')
    expect(() => getReport('dead', '30', 45)).toThrow('30, 60 or 90')
  })
})

describe('Sales', () => {
  it('shows net sales, bills, average, returns, payment modes and days', () => {
    const { s, sell } = setup()
    sell(s.id, 1, 'cash')
    sell(s.id, 1, 'upi')
    as('owner')
    const r = getReport('sales', 'today')
    expect(r.kpis.map((k) => k.value)).toEqual([299_800, 2, 149_900, 0])
    const modes = Object.fromEntries(r.tables[0]!.rows.map((x) => [x.mode, x.amount]))
    expect(modes).toEqual({ cash: 149_900, upi: 149_900 })
    expect(r.tables[1]!.rows[0]).toMatchObject({ bills: 2, sales: 299_800 })
  })
  it('subtracts returns and counts them', () => {
    const { s, sell } = setup()
    const b = sell(s.id, 2)
    const line = getDb().prepare('SELECT id FROM bill_lines WHERE bill_id=?').get(b.id) as { id: number }
    doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 1 }], newLines: [], settle: 'cash', payMode: 'cash' })
    as('owner')
    const r = getReport('sales', 'today')
    expect(r.kpis[0]!.value).toBe(149_900) // 299,800 - 149,900
    expect(r.kpis[1]!.value).toBe(1)
    expect(r.kpis[3]!.value).toBe(149_900)
    expect(Object.fromEntries(r.tables[0]!.rows.map((x) => [x.mode, x.amount])).cash).toBe(149_900) // refund out of the drawer
  })
  it('ignores cancelled bills and bills outside the period', () => {
    const { s, sell } = setup()
    const a = sell(s.id)
    const b = sell(s.id)
    getDb().prepare("UPDATE bills SET status='cancelled' WHERE id=?").run(a.id)
    getDb().prepare('UPDATE bills SET at=? WHERE id=?').run(new Date(Date.now() - 20 * 864e5).toISOString(), b.id)
    as('owner')
    expect(getReport('sales', 'today').kpis[1]!.value).toBe(0)
    expect(getReport('sales', '7').kpis[1]!.value).toBe(0)
    expect(getReport('sales', '30').kpis[1]!.value).toBe(1)
    expect(getReport('sales', '30').kpis[2]!.value).toBe(149_900)
  })
})

describe('Best sellers and sizes', () => {
  it('ranks products and sizes by pieces', () => {
    const { s, m, kurta, sell } = setup()
    sell(s.id, 3); sell(m.id, 1)
    createBill({ lines: [{ variantId: kurta.id, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 99_900 }] })
    as('owner')
    const r = getReport('best', '30')
    expect(r.tables[0]!.rows.map((x) => [x.name, x.pieces])).toEqual([['Slim Shirt', 4], ['Old Kurta', 1]])
    expect(r.tables[1]!.rows.map((x) => [x.size, x.pieces])).toEqual([['S', 3], ['M', 1], ['L', 1]])
  })
})

describe('Size sell-through', () => {
  it('compares pieces received with sold and suggests what to buy', () => {
    const { s, m, sell } = setup()
    sell(s.id, 7); sell(m.id, 1)
    as('owner')
    const rows = getReport('size', '30').tables[0]!.rows
    expect(rows.find((x) => x.size === 'S')).toMatchObject({ received: 10, sold: 7, pct: 70, next: 'Buy more' })
    expect(rows.find((x) => x.size === 'M')).toMatchObject({ received: 10, sold: 1, pct: 10, next: 'Buy less' })
    expect(rows.find((x) => x.size === 'L')).toMatchObject({ received: 4, sold: 0, next: 'Buy less' })
  })
  it('a cancelled bill puts the piece back', () => {
    const { s, sell } = setup()
    const b = sell(s.id, 2)
    as('owner')
    expect(getReport('size', '30').tables[0]!.rows.find((x) => x.size === 'S')!.sold).toBe(2)
    as('cashier')
    getDb().prepare("INSERT INTO stock_moves (variant_id,qty,type,at,staff_id) VALUES (?,?,?,?,?)").run(s.id, 2, 'cancel', new Date().toISOString(), id('cashier'))
    as('owner')
    expect(getReport('size', '30').tables[0]!.rows.find((x) => x.size === 'S')!.sold).toBe(0)
    expect(b.id).toBeTruthy()
  })
})

describe('Dead stock and stock value', () => {
  it('lists items in stock not sold in the window, with money stuck', () => {
    const { s, kurta, sell } = setup()
    sell(s.id)
    as('owner')
    const r = getReport('dead', '30', 30)
    const names = r.tables[0]!.rows.map((x) => x.item)
    expect(names.some((n) => String(n).startsWith('Old Kurta'))).toBe(true) // never sold
    expect(names.some((n) => String(n).includes('Slim Shirt · Blue · S'))).toBe(false) // sold today
    expect(r.tables[0]!.rows.find((x) => String(x.item).startsWith('Old Kurta'))).toMatchObject({ stock: 4, last: 'Never', value: 4 * 50_000 })
    expect(r.kpis[1]!.value).toBe(r.tables[0]!.rows.reduce((a, x) => a + Number(x.value), 0))
    // an old sale makes it dead again
    getDb().prepare("UPDATE stock_moves SET at=? WHERE type='sale' AND variant_id=?").run(new Date(Date.now() - 40 * 864e5).toISOString(), s.id)
    expect(getReport('dead', '30', 30).tables[0]!.rows.some((x) => String(x.item).includes('Slim Shirt · Blue · S'))).toBe(true)
    expect(getReport('dead', '30', 60).tables[0]!.rows.some((x) => String(x.item).includes('Slim Shirt · Blue · S'))).toBe(false)
    expect(kurta.id).toBeTruthy()
  })
  it('adds up stock at cost and MRP and lists low stock', () => {
    setup(); as('owner')
    const r = getReport('stock', '30')
    expect(r.kpis.map((k) => k.value)).toEqual([24, 20 * 78_000 + 4 * 50_000, 20 * 149_900 + 4 * 99_900, 0])
    getDb().prepare("UPDATE variants SET min_stock=15 WHERE size='M'").run()
    const low = getReport('stock', '30')
    expect(low.kpis[3]!.value).toBe(1)
    expect(low.tables[0]!.rows.map((x) => x.item)).toContain('Slim Shirt · Blue · M')
  })
  it('never counts the alteration service as stock', () => {
    const { s } = setup()
    as('owner')
    const cust = createCustomer({ mobile: '9876500001', name: 'A', waConsent: false, offersConsent: false })
    const t = saveTailor({ name: 'Imran', mobile: '', kind: 'In-house', ratePerJob: 6000, active: true })[0]!
    as('cashier')
    createBill({ lines: [{ variantId: s.id, qty: 1, disc: 0 }], customerId: cust.id, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 149_900 + 10_000 }],
      alterations: [{ variantId: s.id, work: ['Length'], notes: '', tailorId: t.id, dueAt: new Date(Date.now() + 864e5).toISOString(), charge: 10_000, mode: 'bill' }] })
    as('owner')
    expect(getReport('stock', '30').kpis[0]!.value).toBe(23)
    expect(getReport('best', '30').tables[0]!.rows.map((x) => x.name)).not.toContain('Alteration charge')
  })
})

describe('Staff and commission', () => {
  it('works out commission on sales where the person is the salesperson', () => {
    const { s, sell } = setup()
    const mgr = id('manager')
    sell(s.id, 2, 'cash', { salesBy: mgr })
    sell(s.id, 1)
    as('owner')
    const rows = getReport('staff', '30').tables[0]!.rows
    const m = rows.find((x) => x.name === 'Manager')!
    expect(m).toMatchObject({ made: 0, sp: 299_800, comm: 1, amount: 2998 })
    const c = rows.find((x) => x.name === 'Cashier')!
    expect(c).toMatchObject({ made: 2, sp: 149_900, comm: 1, amount: 1499 })
  })
})

describe('Alterations', () => {
  it('counts jobs per tailor and what to pay them', () => {
    const { s } = setup()
    as('owner')
    const t = saveTailor({ name: 'Kiran', mobile: '', kind: 'Outside', ratePerJob: 8000, active: true }).find((x) => x.name === 'Kiran')!
    const cust = createCustomer({ mobile: '9876500002', name: 'B', waConsent: false, offersConsent: false })
    createAlteration({ customerId: cust.id, billId: null, variantId: null, ownItem: 'Own trouser', work: ['Hem'], notes: '', tailorId: t.id, dueAt: new Date(Date.now() + 864e5).toISOString(), charge: 0 })
    const job = createAlteration({ customerId: cust.id, billId: null, variantId: null, ownItem: 'Own shirt', work: ['Length'], notes: '', tailorId: t.id, dueAt: new Date(Date.now() - 864e5).toISOString(), charge: 0 })
    const row = getReport('alter', '30').tables[0]!.rows.find((x) => x.tailor === 'Kiran')!
    expect(row).toMatchObject({ jobs: 2, open: 2, late: 1, delivered: 0, pay: 0 })
    getDb().prepare("UPDATE alterations SET status='delivered' WHERE id=?").run(job.id)
    const after = getReport('alter', '30').tables[0]!.rows.find((x) => x.tailor === 'Kiran')!
    expect(after).toMatchObject({ jobs: 2, open: 1, delivered: 1, pay: 8000 })
    expect(s.id).toBeTruthy()
  })
})

describe('GST summary', () => {
  it('groups by rate and HSN, net of returns, with a total', () => {
    const { s, sell } = setup()
    const b = sell(s.id, 2)
    as('owner')
    const first = getReport('gst', '30').tables[0]!
    const t0 = Number(first.total!.taxable)
    expect(first.rows[0]).toMatchObject({ rate: 5, hsn: '6205' })
    expect(Number(first.rows[0]!.cgst)).toBe(Number(first.rows[0]!.sgst))
    expect(t0 + Number(first.total!.cgst) + Number(first.total!.sgst)).toBe(299_800) // taxable + tax = what was billed
    const line = getDb().prepare('SELECT id FROM bill_lines WHERE bill_id=?').get(b.id) as { id: number }
    as('cashier')
    doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 1 }], newLines: [], settle: 'cash', payMode: 'cash' })
    as('owner')
    const t = getReport('gst', '30').tables[0]!
    expect(Number(t.total!.taxable) + Number(t.total!.cgst) + Number(t.total!.sgst)).toBe(149_900)
  })
})

describe('Printable report', () => {
  it('builds a page with the shop, period, figures and escapes text', () => {
    const { s, sell } = setup()
    sell(s.id)
    as('owner')
    const html = reportHtml(getReport('sales', '30'), 'Raj <Fashion>')
    expect(html).toContain('Raj &lt;Fashion&gt; · Sales')
    expect(html).toContain('Last 30 days')
    expect(html).toContain('₹1,499')
    const g = reportHtml(getReport('gst', '30'), 'S')
    expect(g).toContain('Total')
    expect(g).not.toContain('Total%')
  })
})
