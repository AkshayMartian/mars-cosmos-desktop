import { beforeEach, describe, expect, it } from 'vitest'
import type { BillAlteration } from '@shared/alterations'
import { readyMessage, slipText, tagLines } from '@shared/alterations'
import { receiptText } from '@shared/receipt'
import { getDb, openDb } from '../db'
import {
  advanceAlteration, alterationContext, createAlteration, customerGarments, deliverAlteration, findAltCustomer, searchAltCustomers, jobsByBill, listAlterations, listTailors, saveAlterationConfig, saveTailor
} from './alterations'
import { billingContext, createBill, getBill, openDay } from './billing'
import { cancelBill } from './bills'
import { createProduct, getProduct, listCategories } from './catalogue'
import { createCustomer } from './customers'
import { daySummary } from './dayend'
import { doReturn, getBillForReturn } from './returns'
import { setCurrent } from './session'
import { stockOf } from './stock'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
const due = () => new Date(Date.now() + 2 * 864e5).toISOString()

function setup() {
  as('owner')
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const p = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 10 } })
  const shirt = getProduct(p.id).variants[0]!
  as('manager')
  const tailor = saveTailor({ name: 'Imran', mobile: '9898011223', kind: 'In-house', ratePerJob: 6000, active: true })[0]!
  as('cashier'); openDay(0)
  const cust = createCustomer({ mobile: '9876500045', name: 'Rahul Shah', waConsent: false, offersConsent: false })
  const alt = (over: Partial<BillAlteration> = {}): BillAlteration => ({ variantId: shirt.id, work: ['Length'], notes: 'Shorten 1.5 inch', tailorId: tailor.id, dueAt: due(), charge: 0, mode: 'bill', ...over })
  const sale = (alterations: BillAlteration[], payments = [{ mode: 'cash' as const, amount: 149_900 }], customerId: string | null = cust.id) =>
    createBill({ lines: [{ variantId: shirt.id, qty: 1, disc: 0 }], customerId, billDisc: 0, salesBy: null, payments, alterations })
  return { shirt, tailor, cust, alt, sale }
}

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('jobs made with a bill', () => {
  it('a free job is numbered, linked to the bill and printed on the receipt', () => {
    const { alt, sale } = setup()
    const b = sale([alt()])
    expect(b.alterations).toHaveLength(1)
    expect(b.alterations![0]!.no).toBe('ALT-0001')
    const j = jobsByBill(b.id)[0]!
    expect(j).toMatchObject({ status: 'received', chargeMode: 'free', charge: 0, paid: true, work: ['Length'], billNo: b.no, customerName: 'Rahul Shah', item: 'Slim Shirt · Blue · M' })
    expect(receiptText(getBill(b.id), { name: 'S', address: '', phone: '', gstin: '', policy: '', footer: '' }, 'regular')).toContain('ALT-0001')
  })

  it('a charge added to the bill becomes a GST line, takes no stock and the job is paid', () => {
    const { alt, sale, shirt } = setup()
    const b = sale([alt({ charge: 15_000, mode: 'bill' })], [{ mode: 'cash', amount: 164_900 }])
    expect(b.grand).toBe(164_900)
    expect(b.lines.map((l) => l.name)).toEqual(['Slim Shirt', 'Alteration charge'])
    expect(b.lines[1]).toMatchObject({ rate: 18, total: 15_000 })
    expect(b.taxable + b.cgst + b.sgst).toBe(164_900)
    expect(stockOf(shirt.id)).toBe(9) // the service line moved nothing
    expect(jobsByBill(b.id)[0]).toMatchObject({ chargeMode: 'bill', paid: true, gstRate: 18 })
  })

  it('a pickup charge stays off the bill and the job is unpaid', () => {
    const { alt, sale } = setup()
    const b = sale([alt({ charge: 15_000, mode: 'pickup' })])
    expect(b.grand).toBe(149_900)
    expect(jobsByBill(b.id)[0]).toMatchObject({ chargeMode: 'pickup', paid: false, charge: 15_000 })
  })

  it('needs the customer, a type of work, a real tailor and a bill item', () => {
    const { alt, sale } = setup()
    expect(() => sale([alt()], undefined, null)).toThrow('customer first')
    expect(() => sale([alt({ work: [] })])).toThrow('at least one type')
    expect(() => sale([alt({ tailorId: 'nobody' })])).toThrow('Choose a tailor')
    expect(() => sale([alt({ variantId: 'x' })])).toThrow('not on this bill')
    expect(() => sale([alt({ charge: 12_345 })])).toThrow('whole rupees')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM bills').get()).toEqual({ n: 0 }) // nothing half-saved
  })

  it('keeps the GST rate on the job when the rule changes later', () => {
    const { alt, sale } = setup()
    const b = sale([alt({ charge: 10_000, mode: 'pickup' })])
    as('owner')
    saveAlterationConfig({ dueDays: 3, rate: 12, tagPrinter: 'receipt' })
    expect(jobsByBill(b.id)[0]!.gstRate).toBe(18)
    as('cashier')
    const b2 = sale([alt({ charge: 10_000, mode: 'pickup' })]) // new job uses the new rate
    expect(jobsByBill(b2.id)[0]!.gstRate).toBe(12)
  })
})

describe('the job flow', () => {
  it('goes received → with tailor → ready → delivered, with history', () => {
    const { alt, sale } = setup()
    const j = jobsByBill(sale([alt()]).id)[0]!
    as('store')
    expect(advanceAlteration(j.id).status).toBe('with_tailor')
    expect(advanceAlteration(j.id).status).toBe('ready')
    expect(advanceAlteration(j.id).status).toBe('delivered')
    expect(() => advanceAlteration(j.id)).toThrow('already delivered')
    expect(getDb().prepare('SELECT status FROM alteration_history WHERE alteration_id=? ORDER BY id').all(j.id).map((r) => (r as { status: string }).status))
      .toEqual(['received', 'with_tailor', 'ready', 'delivered'])
  })

  it('will not hand over a job with a charge due until it is collected (a bill is made, Day end sees it)', () => {
    const { alt, sale } = setup()
    const j = jobsByBill(sale([alt({ charge: 15_000, mode: 'pickup' })]).id)[0]!
    advanceAlteration(j.id); advanceAlteration(j.id)
    expect(() => advanceAlteration(j.id)).toThrow('Collect')
    const before = daySummary().expected
    const r = deliverAlteration({ id: j.id, payMode: 'cash' })
    expect(r.job).toMatchObject({ status: 'delivered', paid: true })
    const bill = getBill(r.billId!)
    expect(bill).toMatchObject({ grand: 15_000, customer: { name: 'Rahul Shah' } })
    expect(bill.lines[0]).toMatchObject({ name: 'Alteration charge', rate: 18 })
    expect(daySummary().expected).toBe(before + 15_000)
  })

  it('deliver refuses a job that is not ready, and works for a free job without a bill', () => {
    const { alt, sale } = setup()
    const j = jobsByBill(sale([alt()]).id)[0]!
    expect(() => deliverAlteration({ id: j.id, payMode: 'cash' })).toThrow('not ready')
    advanceAlteration(j.id); advanceAlteration(j.id)
    expect(deliverAlteration({ id: j.id, payMode: 'cash' })).toMatchObject({ billId: null, job: { status: 'delivered' } })
  })

  it('needs a started day to collect a charge', () => {
    const { alt, sale } = setup()
    const j = jobsByBill(sale([alt({ charge: 15_000, mode: 'pickup' })]).id)[0]!
    advanceAlteration(j.id); advanceAlteration(j.id)
    getDb().prepare("UPDATE day_sessions SET status='closed'").run()
    expect(() => deliverAlteration({ id: j.id, payMode: 'upi' })).toThrow('Start the day')
    expect(listAlterations().jobs[0]!.status).toBe('ready') // nothing changed
  })

  it('flags late jobs and counts the tiles', () => {
    const { alt, sale } = setup()
    const a = jobsByBill(sale([alt()]).id)[0]!
    const b = jobsByBill(sale([alt()], [{ mode: 'cash', amount: 149_900 }]).id)[0]!
    getDb().prepare('UPDATE alterations SET due_at=? WHERE id=?').run(new Date(Date.now() - 3600_000).toISOString(), a.id)
    advanceAlteration(b.id); advanceAlteration(b.id)
    const l = listAlterations()
    expect(l.kpis).toMatchObject({ open: 2, late: 1, waiting: 1 })
    expect(l.jobs.find((j) => j.id === a.id)!.late).toBe(true)
    expect(l.jobs.find((j) => j.id === b.id)!.late).toBe(false) // ready is never late
  })

  it('searches by number, name, mobile and item', () => {
    const { alt, sale } = setup()
    sale([alt()])
    for (const q of ['ALT-0001', 'rahul', '9876500045', 'slim shirt']) expect(listAlterations(q).jobs).toHaveLength(1)
    expect(listAlterations('zzz').jobs).toHaveLength(0)
  })
})

describe('jobs made from the Alterations screen', () => {
  it('own garment, free', () => {
    const { cust, tailor } = setup()
    const j = createAlteration({ customerId: cust.id, billId: null, variantId: null, ownItem: 'Grey formal trouser', work: ['Waist'], notes: '+1 inch', tailorId: tailor.id, dueAt: due(), charge: 0 })
    expect(j).toMatchObject({ item: 'Grey formal trouser (own garment)', billNo: null, chargeMode: 'free', paid: true })
  })

  it('an item from an old bill, with a charge collected at pickup', () => {
    const { cust, tailor, sale } = setup()
    const b = sale([])
    const [g] = customerGarments(cust.id)
    expect(g).toMatchObject({ billId: b.id, label: 'Slim Shirt · Blue · M (bill ' + b.no + ')' })
    const j = createAlteration({ customerId: cust.id, billId: g!.billId, variantId: g!.variantId, ownItem: '', work: ['Sleeves', 'Fitting'], notes: '', tailorId: tailor.id, dueAt: due(), charge: 12_000 })
    expect(j).toMatchObject({ chargeMode: 'pickup', paid: false, billNo: b.no, work: ['Sleeves', 'Fitting'] })
  })

  it('finds customers by name words or part of a mobile, for store staff too', () => {
    const { cust } = setup()
    createCustomer({ mobile: '9876500046', name: 'Rahul Mehta', waConsent: false, offersConsent: false })
    as('store')
    expect(searchAltCustomers('rahul').map((c) => c.name)).toEqual(['Rahul Mehta', 'Rahul Shah'])
    expect(searchAltCustomers('rahul sh').map((c) => c.id)).toEqual([cust.id])
    expect(searchAltCustomers('00046').map((c) => c.name)).toEqual(['Rahul Mehta'])
    expect(searchAltCustomers('%')).toHaveLength(0)
    expect(searchAltCustomers('zzz')).toEqual([])
  })

  it('checks what is typed', () => {
    const { cust, tailor } = setup()
    const ok = { customerId: cust.id, billId: null, variantId: null, ownItem: 'Kurta', work: ['Hem'], notes: '', tailorId: tailor.id, dueAt: due(), charge: 0 }
    expect(() => createAlteration({ ...ok, ownItem: ' ' })).toThrow('what the garment is')
    expect(() => createAlteration({ ...ok, work: [] })).toThrow('at least one type')
    expect(() => createAlteration({ ...ok, customerId: 'nobody' })).toThrow('Find the customer')
    expect(() => createAlteration({ ...ok, dueAt: 'soon' })).toThrow('ready-by')
    expect(() => createAlteration({ ...ok, charge: -100 })).toThrow('negative')
  })

  it('store staff can work jobs and find a customer, but cannot take money or manage tailors', () => {
    const { alt, sale, tailor } = setup()
    const j = jobsByBill(sale([alt({ charge: 15_000, mode: 'pickup' })]).id)[0]!
    as('store')
    expect(findAltCustomer('9876500045')).toMatchObject({ name: 'Rahul Shah' })
    expect(alterationContext()).toMatchObject({ canManage: false, canCollect: false })
    advanceAlteration(j.id); advanceAlteration(j.id)
    expect(() => deliverAlteration({ id: j.id, payMode: 'cash' })).toThrow('not allowed')
    expect(() => saveTailor({ name: 'X', mobile: '', kind: 'Outside', ratePerJob: 0, active: true })).toThrow('not allowed')
    expect(() => billingContext()).toThrow('not allowed')
    expect(tailor.id).toBeTruthy()
  })
})

describe('tailors and rules', () => {
  it('adds, deactivates and protects tailors with open jobs', () => {
    const { alt, sale, tailor } = setup()
    as('manager')
    expect(saveTailor({ name: 'Kiran Tailors', mobile: '9725044556', kind: 'Outside', ratePerJob: 8000, active: true })).toHaveLength(2)
    sale([alt()])
    expect(() => saveTailor({ id: tailor.id, name: 'Imran', mobile: '', kind: 'In-house', ratePerJob: 6000, active: false })).toThrow('open jobs')
    const k = listTailors().find((t) => t.name === 'Kiran Tailors')!
    expect(saveTailor({ id: k.id, name: k.name, mobile: k.mobile, kind: k.kind, ratePerJob: k.ratePerJob, active: false }).find((t) => t.id === k.id)!.active).toBe(false)
    expect(() => sale([alt({ tailorId: k.id })])).toThrow('Choose a tailor') // inactive tailors cannot be chosen
    expect(listTailors().find((t) => t.id === tailor.id)!.openJobs).toBe(1)
  })

  it('validates the rules and only owner and manager may change them', () => {
    setup()
    as('owner')
    expect(() => saveAlterationConfig({ dueDays: -1, rate: 18, tagPrinter: 'sticker' })).toThrow('between 0 and 60')
    expect(() => saveAlterationConfig({ dueDays: 2, rate: 40, tagPrinter: 'sticker' })).toThrow('GST')
    expect(saveAlterationConfig({ dueDays: 5, rate: 18, tagPrinter: 'receipt' })).toMatchObject({ dueDays: 5 })
    as('cashier')
    expect(() => saveAlterationConfig({ dueDays: 2, rate: 18, tagPrinter: 'sticker' })).toThrow('not allowed')
  })
})

describe('cancelling and returning bills that have alterations', () => {
  it('cancelling the bill cancels jobs not yet with the tailor and leaves stock right', () => {
    const { alt, sale, shirt } = setup()
    const b = sale([alt({ charge: 15_000, mode: 'bill' })], [{ mode: 'cash', amount: 164_900 }])
    as('owner')
    cancelBill({ billId: b.id, reason: 'mistake' })
    expect(jobsByBill(b.id)[0]!.status).toBe('cancelled')
    expect(stockOf(shirt.id)).toBe(10) // shirt back; the service line added nothing
    expect(getDb().prepare("SELECT COALESCE(SUM(qty),0) AS q FROM stock_moves WHERE variant_id IN (SELECT id FROM variants WHERE barcode='ALT')").get()).toEqual({ q: 0 })
  })

  it('refuses to cancel once a job is with the tailor', () => {
    const { alt, sale } = setup()
    const b = sale([alt()])
    advanceAlteration(jobsByBill(b.id)[0]!.id)
    as('owner')
    expect(() => cancelBill({ billId: b.id, reason: 'x' })).toThrow('ALT-0001')
  })

  it('does not let the alteration charge be returned', () => {
    const { alt, sale } = setup()
    const b = sale([alt({ charge: 15_000, mode: 'bill' })], [{ mode: 'cash', amount: 164_900 }])
    const lines = getBillForReturn(b.id).lines
    expect(lines.map((l) => [l.service, l.returnable])).toEqual([[false, 0], [true, 0]]) // the shirt was altered too
    expect(() => doReturn({ billId: b.id, lines: [{ lineId: lines[1]!.id, qty: 1 }], newLines: [], settle: 'cash', payMode: 'cash' })).toThrow('alteration charge')
  })

  it('an altered item cannot be returned; an item with no job, or a cancelled job, can', () => {
    const { alt, sale, cust, shirt } = setup()
    const plain = sale([])
    expect(getBillForReturn(plain.id).lines[0]).toMatchObject({ altered: false, returnable: 1 })
    const b = sale([alt()])
    const line = getBillForReturn(b.id).lines[0]!
    expect(line).toMatchObject({ altered: true, returnable: 0, pieces: [] })
    expect(() => doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 1 }], newLines: [], settle: 'cash', payMode: 'cash' })).toThrow('has been altered')
    // a job made later for an old bill's item blocks it too
    const j = createAlteration({ customerId: cust.id, billId: plain.id, variantId: shirt.id, ownItem: '', work: ['Hem'], notes: '', tailorId: (getDb().prepare('SELECT id FROM tailors').get() as { id: string }).id, dueAt: due(), charge: 0 })
    expect(getBillForReturn(plain.id).lines[0]).toMatchObject({ altered: true, returnable: 0 })
    getDb().prepare("UPDATE alterations SET status='cancelled' WHERE id=?").run(j.id)
    expect(getBillForReturn(plain.id).lines[0]).toMatchObject({ altered: false, returnable: 1 })
  })
})

describe('tag, slip and message text', () => {
  it('includes the job, customer, work and ready-by', () => {
    const { alt, sale } = setup()
    const j = jobsByBill(sale([alt({ charge: 15_000, mode: 'pickup' })]).id)[0]!
    const shop = { name: 'Raj Fashion', phone: '98250 00010' }
    expect(tagLines(j, shop).join('\n')).toMatch(/ALT-0001[\s\S]*Rahul Shah · ••0045[\s\S]*Work: Length[\s\S]*Tailor: Imran[\s\S]*READY BY/)
    expect(slipText(j, shop)).toContain('₹150 at pickup')
    expect(readyMessage({ ...j, status: 'ready' }, shop)).toContain('Alteration charge: ₹150')
    expect(readyMessage({ ...j, paid: true }, shop)).not.toContain('Alteration charge')
  })
})
