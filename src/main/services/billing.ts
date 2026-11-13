import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { calc, type CalcLineInput } from '@shared/calc'
import { fyOf, localDate } from '@shared/dates'
import { variantLabel } from '@shared/catalogue'
import type { BillDto, BillingContext, HeldBillDto, HeldPayload, NewBillInput, SellableVariant, ShopInfo } from '@shared/billing'
import type { GstScheme } from '@shared/types'
import type { Paise } from '@shared/money'
import type { PayMode } from '@shared/billing'
import { audit } from './auth'
import { alterationConfig, checkJobInput, ensureServiceVariant, insertJob } from './altcore'
import { checkApprover } from './approval'
import { requireRole, type Actor } from './session'
import { getSetting } from './settings'
import { addMove, stockOf } from './stock'

const SELLERS = ['owner', 'manager', 'cashier'] as const

/* ---------- items ---------- */

const SELL = `SELECT v.id,p.name,v.colour,v.size,v.barcode,v.mrp,v.sale_price AS price,COALESCE(s.qty,0) AS stock,
              c.gst_mode AS mode,c.gst_rate AS rate,c.hsn
  FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
  LEFT JOIN v_stock s ON s.variant_id=v.id WHERE p.active=1 AND c.is_service=0`

interface SellRow { id: string; name: string; colour: string; size: string; barcode: string; mrp: number; price: number; stock: number; mode: 'auto' | 'fixed' | 'exempt'; rate: number; hsn: string }
const toSellable = (r: SellRow): SellableVariant => ({
  id: r.id, name: r.name, colour: r.colour, size: r.size, label: variantLabel(r.name, r.colour, r.size), barcode: r.barcode,
  mrp: r.mrp, price: r.price, stock: r.stock, gst: { mode: r.mode, rate: r.rate }
})

/** A scanned barcode (ours or the brand's) wins; otherwise a name/brand/colour/size search. */
export function sellableSearch(q: string): SellableVariant[] {
  requireRole(...SELLERS)
  q = q.trim()
  if (!q) return []
  const db = getDb()
  const exact = db.prepare(`${SELL} AND (v.barcode=? OR v.brand_barcode=?)`).all(q, q) as SellRow[]
  if (exact.length) return exact.map(toSellable)
  const like = `%${q}%`
  return (db.prepare(`${SELL} AND (p.name LIKE ? OR p.brand LIKE ? OR v.colour LIKE ? OR v.size LIKE ? OR v.barcode LIKE ?) ORDER BY p.name, v.rowid LIMIT 8`)
    .all(like, like, like, like, like) as SellRow[]).map(toSellable)
}

/** Names of archived products that match what was typed, so the screen can say "it is archived" instead of "not found". */
export function archivedMatches(q: string): string[] {
  requireRole(...SELLERS)
  q = q.trim()
  if (!q) return []
  const like = `%${q}%`
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT p.name FROM products p JOIN variants v ON v.product_id=p.id
       WHERE p.active=0 AND (p.name LIKE ? OR p.brand LIKE ? OR v.barcode=? OR v.brand_barcode=?) ORDER BY p.name LIMIT 3`
    )
    .all(like, like, q, q) as { name: string }[]
  return rows.map((r) => r.name)
}

export function sellableByIds(ids: string[]): SellableVariant[] {
  requireRole(...SELLERS)
  if (!ids.length) return []
  const rows = getDb().prepare(`${SELL} AND v.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as SellRow[]
  return rows.map(toSellable)
}

/* ---------- context and the working day ---------- */

const SHOP_DEFAULTS: ShopInfo = { name: 'Your Shop', address: '', phone: '', gstin: '', policy: 'Exchange within 7 days with this bill. No cash refund on sale items.', footer: 'Thank you! Visit again.' }

const shopInfo = (): ShopInfo => ({ ...SHOP_DEFAULTS, ...getSetting<Partial<ShopInfo>>('shop', {}) })
const counterCode = (): string => getSetting('counter', 'C1')

export function openSessionRow(): { id: string; opening: number; openedAt: string } | undefined {
  return getDb()
    .prepare("SELECT id,opening_cash AS opening,opened_at AS openedAt FROM day_sessions WHERE status='open' AND counter=? ORDER BY opened_at DESC LIMIT 1")
    .get(counterCode()) as { id: string; opening: number; openedAt: string } | undefined
}

export function billingContext(): BillingContext {
  const actor = requireRole(...SELLERS)
  const db = getDb()
  const me = db.prepare('SELECT max_discount_pct AS m FROM staff WHERE id=?').get(actor.id) as { m: number }
  return {
    gstScheme: getSetting<GstScheme>('gst_scheme', 'regular'),
    session: openSessionRow() ?? null,
    salespeople: db.prepare('SELECT id,name FROM staff WHERE active=1 ORDER BY rowid').all() as { id: string; name: string }[],
    approvers: db.prepare("SELECT id,name,role FROM staff WHERE active=1 AND role IN ('owner','manager') ORDER BY rowid").all() as BillingContext['approvers'],
    maxDiscountPct: me.m,
    actorRole: actor.role,
    shop: shopInfo()
  }
}

export function openDay(openingCash: number): { id: string } {
  const actor = requireRole(...SELLERS)
  if (!Number.isInteger(openingCash) || openingCash < 0) throw new Error('Enter the cash in the drawer (0 or more).')
  if (openSessionRow()) throw new Error('The day is already started.')
  const id = randomUUID()
  getDb()
    .prepare("INSERT INTO day_sessions (id,counter,date,status,opening_cash,opened_by,opened_at) VALUES (?,?,?, 'open',?,?,?)")
    .run(id, counterCode(), localDate(), openingCash, actor.id, new Date().toISOString())
  audit(actor.id, 'day_open', { id, openingCash })
  return { id }
}

/* ---------- approvals ---------- */

/** Only discounts need approval. Owner and manager are not limited; others need one of them to approve. */
function approvalReasons(actor: Actor, maxPct: number, discountPct: number): string[] {
  if (actor.role === 'owner' || actor.role === 'manager') return []
  return discountPct > maxPct ? [`Discount ${discountPct}% is more than your limit of ${maxPct}%.`] : []
}

/* ---------- the bill ---------- */

export function nextBillNo(): string {
  const fy = fyOf()
  const r = getDb()
    .prepare('INSERT INTO bill_counters (counter,fy,next) VALUES (?,?,2) ON CONFLICT(counter,fy) DO UPDATE SET next=next+1 RETURNING next')
    .get(counterCode(), fy) as { next: number }
  return `${counterCode()}/${fy}/${String(r.next - 1).padStart(4, '0')}`
}

/**
 * Everything below is recomputed here from the database (prices, GST, stock): the screen only says
 * what was scanned, how much discount, and how it was paid. One transaction: bill, lines, payments, stock.
 */
export interface BillInternals {
  /**
   * Exchange: given the bill total, says how much of it is covered by the returned goods (a credit_note payment
   * with no note behind it) and how the rest is paid. Replaces `input.payments`.
   */
  settle?: (grand: Paise) => { credit: Paise; payments: { mode: PayMode; amount: Paise }[] }
  /** extra service lines (an alteration charge collected at pickup): GST-inclusive price and the GST % kept on the job */
  services?: { price: Paise; rate: number }[]
}

const SERVICE = '__service'

export function createBill(input: NewBillInput, internals: BillInternals = {}): BillDto {
  const actor = requireRole(...SELLERS)
  const db = getDb()
  const session = openSessionRow()
  if (!session) throw new Error('Start the day first: enter the opening cash.')
  const cfg = alterationConfig()
  const alts = input.alterations ?? []
  const services = [...alts.filter((a) => a.mode === 'bill' && a.charge > 0).map((a) => ({ price: a.charge, rate: cfg.rate })), ...(internals.services ?? [])]
  if (!input.lines.length && !services.length) throw new Error('Add at least one item.')

  const want = new Map<string, { qty: number; disc: number }>()
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('Quantities must be whole numbers above zero.')
    if (!Number.isInteger(l.disc) || l.disc < 0) throw new Error('Discount cannot be negative.')
    const w = want.get(l.variantId) ?? { qty: 0, disc: 0 }
    want.set(l.variantId, { qty: w.qty + l.qty, disc: w.disc + l.disc })
  }
  if (!Number.isInteger(input.billDisc) || input.billDisc < 0) throw new Error('Discount cannot be negative.')
  if (alts.length) {
    if (!input.customerId) throw new Error('Add the customer first: the tailor tag and the ready message need their mobile.')
    if (new Set(alts.map((a) => a.variantId)).size !== alts.length) throw new Error('Only one alteration per item on a bill.')
    for (const a of alts) {
      if (!want.has(a.variantId)) throw new Error('An alteration is for an item that is not on this bill.')
      if (!['bill', 'pickup'].includes(a.mode)) throw new Error('Choose how the alteration charge is paid.')
      checkJobInput(a)
    }
  }

  const items = new Map(sellableByIds([...want.keys()]).map((v) => [v.id, v]))
  const scheme = getSetting<GstScheme>('gst_scheme', 'regular')
  const calcLines: CalcLineInput[] = []
  for (const [id, w] of want) {
    const v = items.get(id)
    if (!v) throw new Error('An item on this bill is no longer available.')
    if (w.disc > v.price * w.qty) throw new Error(`Discount on ${v.label} is more than its price.`)
    // Nothing can be sold without stock. Not even with an approval: fix the stock first (Stock in / Adjust).
    const have = stockOf(id)
    if (have <= 0) throw new Error(`${v.label} is out of stock.`)
    if (have < w.qty) throw new Error(`Only ${have} of ${v.label} in stock.`)
    calcLines.push({ variantId: id, qty: w.qty, price: v.price, disc: w.disc, gst: v.gst })
  }
  for (const sv of services) calcLines.push({ variantId: SERVICE, qty: 1, price: sv.price, gst: { mode: 'fixed', rate: sv.rate } })
  const c = calc(scheme, calcLines, input.billDisc)

  if (input.customerId && !db.prepare('SELECT 1 FROM customers WHERE id=? AND deleted_at IS NULL').get(input.customerId)) throw new Error('Customer not found.')
  const salesBy = input.salesBy && db.prepare('SELECT 1 FROM staff WHERE id=? AND active=1').get(input.salesBy) ? input.salesBy : actor.id

  const maxPct = (db.prepare('SELECT max_discount_pct AS m FROM staff WHERE id=?').get(actor.id) as { m: number }).m
  const discountPct = c.subtotal ? Math.round((c.discount / c.subtotal) * 100) : 0
  const reasons = approvalReasons(actor, maxPct, discountPct)
  const approvedBy = reasons.length ? checkApprover(input.approval) : null

  const at = new Date().toISOString()
  let payments = input.payments
  let exchangeCredit = 0
  if (internals.settle) {
    const s = internals.settle(c.grand)
    payments = s.payments
    exchangeCredit = s.credit
  }
  let paid = exchangeCredit
  for (const p of payments) {
    if (!['cash', 'upi', 'card'].includes(p.mode) || !Number.isInteger(p.amount) || p.amount <= 0) throw new Error('Check the payment amounts.')
    paid += p.amount
  }
  // Credit notes: owner, balance and expiry are checked here (a note stops working after its expiry date).
  const notes = (input.creditNotes ?? []).filter((n) => n.amount > 0)
  if (notes.length) {
    if (!input.customerId) throw new Error('A credit note can only be used when the customer is on the bill.')
    if (new Set(notes.map((n) => n.id)).size !== notes.length) throw new Error('Check the credit note amounts.')
    for (const n of notes) {
      const cn = db.prepare('SELECT customer_id AS cust,balance,expires_at AS exp FROM credit_notes WHERE id=?').get(n.id) as { cust: string | null; balance: number; exp: string } | undefined
      if (!cn || cn.cust !== input.customerId) throw new Error('That credit note does not belong to this customer.')
      if (cn.exp < at) throw new Error(`This credit note expired on ${new Date(cn.exp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.`)
      if (!Number.isInteger(n.amount) || n.amount > cn.balance) throw new Error('The credit note amount is more than its balance.')
      paid += n.amount
    }
  }
  if (paid !== c.grand) throw new Error('The payments must add up to the bill total.')

  const id = randomUUID()
  let no = ''
  db.transaction(() => {
    no = nextBillNo()
    db.prepare(
      `INSERT INTO bills (id,no,type,status,customer_id,staff_id,sales_by,session_id,at,subtotal,discount,taxable,cgst,sgst,round_off,grand)
       VALUES (?,?,'sale','completed',?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, no, input.customerId, actor.id, salesBy, session.id, at, c.subtotal, c.discount, c.taxable, c.cgst, c.sgst, c.roundOff, c.grand)

    const insLine = db.prepare(
      `INSERT INTO bill_lines (bill_id,variant_id,name,size,colour,hsn,qty,mrp,price,discount,taxable,gst_rate,cgst,sgst,total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    for (const l of c.lines) {
      if (l.variantId === SERVICE) {
        const sv = ensureServiceVariant()
        insLine.run(id, sv.variantId, 'Alteration charge', '—', 'Service', sv.hsn, 1, l.price, l.price, (l.disc ?? 0) + l.share, l.taxable, l.rate, l.cgst, l.sgst, l.net)
        continue // a service: no stock
      }
      const v = items.get(l.variantId)!
      const hsn = (db.prepare('SELECT c.hsn FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id WHERE v.id=?').get(l.variantId) as { hsn: string }).hsn
      insLine.run(id, l.variantId, v.name, v.size, v.colour, hsn, l.qty, v.mrp, v.price, (l.disc ?? 0) + l.share, l.taxable, l.rate, l.cgst, l.sgst, l.net)
      addMove({ variantId: l.variantId, qty: -l.qty, type: 'sale', ref: no, staffId: actor.id, at })
    }
    const insPay = db.prepare('INSERT INTO payments (bill_id,mode,amount) VALUES (?,?,?)')
    for (const p of payments) insPay.run(id, p.mode, p.amount)
    if (exchangeCredit > 0) db.prepare("INSERT INTO payments (bill_id,mode,amount) VALUES (?,'credit_note',?)").run(id, exchangeCredit)
    for (const n of notes) {
      db.prepare("INSERT INTO payments (bill_id,mode,amount,credit_note_id) VALUES (?,'credit_note',?,?)").run(id, n.amount, n.id)
      db.prepare('UPDATE credit_notes SET balance=balance-? WHERE id=?').run(n.amount, n.id)
    }
    for (const a of alts) {
      const job = insertJob({
        billId: id, customerId: input.customerId!, variantId: a.variantId, item: items.get(a.variantId)!.label, work: a.work, notes: a.notes.trim(), tailorId: a.tailorId,
        dueAt: a.dueAt, charge: a.charge, chargeMode: a.charge > 0 ? a.mode : 'free', paid: a.charge === 0 || a.mode === 'bill', gstRate: cfg.rate, staffId: actor.id
      })
      audit(actor.id, 'alteration_new', { no: job.no, bill: no })
    }
    if (approvedBy) audit(actor.id, 'approve', { bill: no, approvedBy, reasons })
  })()
  return getBill(id)
}

export function getBill(id: string): BillDto {
  requireRole(...SELLERS)
  const db = getDb()
  const b = db
    .prepare(
      `SELECT b.id,b.no,b.type,b.status,b.at,b.subtotal,b.discount,b.taxable,b.cgst,b.sgst,b.round_off AS roundOff,b.grand,
              s.name AS staffName,c.name AS cName,c.mobile AS cMobile,c.gstin AS cGstin
       FROM bills b JOIN staff s ON s.id=b.staff_id LEFT JOIN customers c ON c.id=b.customer_id WHERE b.id=?`
    )
    .get(id) as (Omit<BillDto, 'customer' | 'lines' | 'payments' | 'alterations'> & { cName: string | null; cMobile: string | null; cGstin: string | null }) | undefined
  if (!b) throw new Error('Bill not found.')
  const { cName, cMobile, cGstin, ...rest } = b
  return {
    ...rest,
    customer: cName ? { name: cName, mobile: cMobile, gstin: cGstin } : null,
    lines: db.prepare('SELECT name,colour,size,qty,price,gst_rate AS rate,total,hsn FROM bill_lines WHERE bill_id=? ORDER BY id').all(id) as BillDto['lines'],
    payments: db.prepare('SELECT mode,amount FROM payments WHERE bill_id=? ORDER BY id').all(id) as BillDto['payments'],
    alterations: (db.prepare('SELECT id,no,work,due_at AS dueAt FROM alterations WHERE bill_id=? ORDER BY rowid').all(id) as { id: string; no: string; work: string; dueAt: string }[]).map((a) => ({ ...a, work: a.work.split(', ') }))
  }
}

/* ---------- held bills ---------- */

export function holdBill(payload: HeldPayload): void {
  const actor = requireRole(...SELLERS)
  if (!payload.lines.length) throw new Error('Nothing to hold.')
  getDb().prepare('INSERT INTO held_bills (id,staff_id,payload,at) VALUES (?,?,?,?)').run(randomUUID(), actor.id, JSON.stringify(payload), new Date().toISOString())
}

export function listHeld(): HeldBillDto[] {
  requireRole(...SELLERS)
  const rows = getDb()
    .prepare('SELECT h.id,h.at,h.payload,COALESCE(s.name,\'\') AS staffName FROM held_bills h LEFT JOIN staff s ON s.id=h.staff_id ORDER BY h.at DESC, h.rowid DESC')
    .all() as { id: string; at: string; payload: string; staffName: string }[]
  return rows.map((r) => ({ id: r.id, at: r.at, staffName: r.staffName, items: (JSON.parse(r.payload) as HeldPayload).lines.length }))
}

/** Takes the bill back out of the held list. */
export function resumeHeld(id: string): HeldPayload {
  requireRole(...SELLERS)
  const r = getDb().prepare('SELECT payload FROM held_bills WHERE id=?').get(id) as { payload: string } | undefined
  if (!r) throw new Error('That held bill is no longer there.')
  getDb().prepare('DELETE FROM held_bills WHERE id=?').run(id)
  return JSON.parse(r.payload) as HeldPayload
}
