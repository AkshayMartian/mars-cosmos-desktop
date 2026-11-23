import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { variantLabel } from '@shared/catalogue'
import { checkMobile } from '@shared/mobile'
import type {
  AltConfig, AltContext, AltJobDto, AltKpis, AltList, AltStatus, DeliverInput, DeliverResult, GarmentChoice, NewAlterationInput, TailorDto, TailorInput
} from '@shared/alterations'
import { audit } from './auth'
import { createBill } from './billing'
import { alterationConfig, checkJobInput, insertJob } from './altcore'
import { isManager } from './approval'
import { requireRole } from './session'
import { getSetting } from './settings'
import { likeAll } from './search'

const ALL4 = ['owner', 'manager', 'cashier', 'store'] as const
const SELLERS = ['owner', 'manager', 'cashier'] as const

/* ---------- reading ---------- */

const JOB = `SELECT a.id,a.no,a.bill_id AS billId,b.no AS billNo,a.customer_id AS customerId,c.name AS customerName,COALESCE(c.mobile,'') AS customerMobile,
    a.item,a.work,COALESCE(a.notes,'') AS notes,a.tailor_id AS tailorId,t.name AS tailorName,a.due_at AS dueAt,a.charge,a.charge_mode AS chargeMode,
    a.paid,a.gst_rate AS gstRate,a.status,a.created_at AS createdAt
  FROM alterations a JOIN customers c ON c.id=a.customer_id JOIN tailors t ON t.id=a.tailor_id LEFT JOIN bills b ON b.id=a.bill_id`

interface JobRow extends Omit<AltJobDto, 'work' | 'paid' | 'late'> { work: string; paid: number }

const isLate = (status: AltStatus, dueAt: string): boolean => !['ready', 'delivered', 'cancelled'].includes(status) && new Date(dueAt).getTime() < Date.now()
const toJob = (r: JobRow): AltJobDto => ({ ...r, work: r.work.split(', '), paid: !!r.paid, late: isLate(r.status, r.dueAt) })

function loadJob(id: string): AltJobDto {
  const r = getDb().prepare(`${JOB} WHERE a.id=?`).get(id) as JobRow | undefined
  if (!r) throw new Error('Alteration job not found.')
  return toJob(r)
}

export function getAltJob(id: string): AltJobDto {
  requireRole(...ALL4)
  return loadJob(id)
}

const sameDay = (iso: string): boolean => new Date(iso).toDateString() === new Date().toDateString()

function kpisOf(jobs: AltJobDto[]): AltKpis {
  const open = jobs.filter((j) => !['delivered', 'cancelled'].includes(j.status))
  return { open: open.length, dueToday: open.filter((j) => sameDay(j.dueAt)).length, late: jobs.filter((j) => j.late).length, waiting: jobs.filter((j) => j.status === 'ready').length }
}

/** Every job, earliest ready-by first. `q` matches job number, customer name or mobile, or the item. */
export function listAlterations(q = ''): AltList {
  requireRole(...ALL4)
  const all = (getDb().prepare(`${JOB} ORDER BY a.due_at, a.rowid LIMIT 500`).all() as JobRow[]).map(toJob)
  const t = q.trim().toLowerCase()
  const jobs = t ? all.filter((j) => [j.no, j.customerName, j.customerMobile, j.item].some((x) => x.toLowerCase().includes(t))) : all
  return { jobs, kpis: kpisOf(all) }
}

export function jobsByBill(billId: string): AltJobDto[] {
  requireRole(...ALL4)
  return (getDb().prepare(`${JOB} WHERE a.bill_id=? ORDER BY a.rowid`).all(billId) as JobRow[]).map(toJob)
}

export function alterationContext(): AltContext {
  const actor = requireRole(...ALL4)
  const shop = getSetting<{ name?: string; phone?: string }>('shop', {})
  return {
    tailors: listTailors(), cfg: alterationConfig(), canManage: isManager(actor), canCollect: (SELLERS as readonly string[]).includes(actor.role),
    shop: { name: shop.name || 'Your Shop', phone: shop.phone ?? '' }
  }
}

/** Store staff cannot open the customer list, so the Alterations screen finds a customer here (name and mobile only). */
export function findAltCustomer(mobile: string): { id: string; name: string; mobile: string } | null {
  requireRole(...ALL4)
  const m = checkMobile(mobile)
  return (getDb().prepare('SELECT id,name,mobile FROM customers WHERE mobile=? AND deleted_at IS NULL').get(m) as { id: string; name: string; mobile: string } | undefined) ?? null
}

/** Customers by name or part of a mobile, for the box on the New alteration dialog (name and mobile only; store staff may use it). */
export function searchAltCustomers(q: string): { id: string; name: string; mobile: string }[] {
  requireRole(...ALL4)
  const m = likeAll(q, ['name', 'mobile'])
  return getDb().prepare(`SELECT id,name,mobile FROM customers WHERE deleted_at IS NULL AND mobile IS NOT NULL AND ${m.sql} ORDER BY name LIMIT 100`).all(...m.args) as { id: string; name: string; mobile: string }[]
}

/** The garments of this customer's recent bills, for "which item is the job for". */
export function customerGarments(customerId: string): GarmentChoice[] {
  requireRole(...ALL4)
  const rows = getDb()
    .prepare(
      `SELECT b.id AS billId,b.no,l.variant_id AS variantId,l.name,l.colour,l.size FROM bills b JOIN bill_lines l ON l.bill_id=b.id
       JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
       WHERE b.customer_id=? AND b.type='sale' AND b.status='completed' AND c.is_service=0 ORDER BY b.at DESC, b.rowid DESC, l.id LIMIT 12`
    )
    .all(customerId) as { billId: string; no: string; variantId: string; name: string; colour: string; size: string }[]
  return rows.map((r) => ({ key: `${r.billId}|${r.variantId}`, billId: r.billId, variantId: r.variantId, label: `${variantLabel(r.name, r.colour, r.size)} (bill ${r.no})` }))
}

/* ---------- making and moving jobs ---------- */

/** A job from the Alterations screen: the customer's own garment, or an item from one of their bills. A charge is collected at pickup. */
export function createAlteration(input: NewAlterationInput): AltJobDto {
  const actor = requireRole(...ALL4)
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM customers WHERE id=? AND deleted_at IS NULL').get(input.customerId)) throw new Error('Find the customer first. The tag and the ready message need their mobile.')
  checkJobInput(input)
  let item = ''
  if (input.variantId) {
    const v = db
      .prepare('SELECT p.name,v.colour,v.size FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?')
      .get(input.variantId) as { name: string; colour: string; size: string } | undefined
    if (!v) throw new Error('That item no longer exists.')
    item = variantLabel(v.name, v.colour, v.size)
    if (input.billId && !db.prepare('SELECT 1 FROM bills WHERE id=? AND customer_id=?').get(input.billId, input.customerId)) throw new Error('That bill is not this customer\'s.')
  } else {
    item = input.ownItem.trim()
    if (!item) throw new Error('Type what the garment is.')
    item += ' (own garment)'
  }
  const cfg = alterationConfig()
  let id = ''
  db.transaction(() => {
    const j = insertJob({
      billId: input.variantId ? input.billId : null, customerId: input.customerId, variantId: input.variantId, item, work: input.work, notes: input.notes.trim(), tailorId: input.tailorId,
      dueAt: input.dueAt, charge: input.charge, chargeMode: input.charge > 0 ? 'pickup' : 'free', paid: input.charge === 0, gstRate: cfg.rate, staffId: actor.id
    })
    id = j.id
    audit(actor.id, 'alteration_new', { no: j.no })
  })()
  return loadJob(id)
}

const FLOW: Partial<Record<AltStatus, AltStatus>> = { received: 'with_tailor', with_tailor: 'ready', ready: 'delivered' }

function setStatus(id: string, status: AltStatus, staffId: string): void {
  const db = getDb()
  db.prepare('UPDATE alterations SET status=? WHERE id=?').run(status, id)
  db.prepare('INSERT INTO alteration_history (alteration_id,status,staff_id,at) VALUES (?,?,?,?)').run(id, status, staffId, new Date().toISOString())
}

/** received → with tailor → ready → delivered. Handing over a job whose charge is still due goes through `deliverAlteration` (takes the money). */
export function advanceAlteration(id: string): AltJobDto {
  const actor = requireRole(...ALL4)
  const j = loadJob(id)
  const next = FLOW[j.status]
  if (!next) throw new Error(`${j.no} is ${j.status === 'delivered' ? 'already delivered' : 'cancelled'}.`)
  if (next === 'delivered' && j.charge > 0 && !j.paid) throw new Error(`Collect the ${j.no} charge first.`)
  getDb().transaction(() => {
    setStatus(id, next, actor.id)
    audit(actor.id, 'alteration_status', { no: j.no, from: j.status, to: next })
  })()
  return loadJob(id)
}

/**
 * Hand over a ready job whose charge is collected at pickup: makes its own bill (the charge line carries the GST rate kept
 * on the job) and marks the job paid and delivered, in one transaction. Needs an open day, like any bill.
 */
export function deliverAlteration(input: DeliverInput): DeliverResult {
  const actor = requireRole(...SELLERS)
  const j = loadJob(input.id)
  if (j.status !== 'ready') throw new Error(`${j.no} is not ready for pickup yet.`)
  if (!(j.charge > 0 && !j.paid)) {
    return { job: advanceAlteration(input.id), billId: null }
  }
  let billId = ''
  getDb().transaction(() => {
    const bill = createBill(
      { lines: [], customerId: j.customerId, billDisc: 0, salesBy: null, payments: [] },
      { services: [{ price: j.charge, rate: j.gstRate }], settle: (grand) => ({ credit: 0, payments: [{ mode: input.payMode, amount: grand }] }) }
    )
    billId = bill.id
    getDb().prepare('UPDATE alterations SET paid=1,pay_bill_id=? WHERE id=?').run(bill.id, j.id)
    setStatus(j.id, 'delivered', actor.id)
    audit(actor.id, 'alteration_status', { no: j.no, from: 'ready', to: 'delivered', bill: bill.no, charge: j.charge })
  })()
  return { job: loadJob(j.id), billId }
}

/* ---------- tailors and rules ---------- */

export function listTailors(): TailorDto[] {
  requireRole(...ALL4)
  return (getDb()
    .prepare(
      `SELECT t.id,t.name,COALESCE(t.mobile,'') AS mobile,t.kind,t.rate_per_job AS ratePerJob,t.active,
              (SELECT COUNT(*) FROM alterations a WHERE a.tailor_id=t.id AND a.status NOT IN ('delivered','cancelled')) AS openJobs
       FROM tailors t ORDER BY t.active DESC, t.rowid`
    )
    .all() as (Omit<TailorDto, 'active'> & { active: number })[]).map((t) => ({ ...t, active: !!t.active }))
}

export function saveTailor(input: TailorInput): TailorDto[] {
  const actor = requireRole('owner', 'manager')
  const db = getDb()
  const name = input.name.trim()
  if (!name) throw new Error('Type the tailor name.')
  if (!['In-house', 'Outside'].includes(input.kind)) throw new Error('Choose In-house or Outside.')
  if (!Number.isInteger(input.ratePerJob) || input.ratePerJob < 0) throw new Error('The rate per job cannot be negative.')
  const tailorMobile = checkMobile(input.mobile, true)
  if (input.id) {
    if (!db.prepare('SELECT 1 FROM tailors WHERE id=?').get(input.id)) throw new Error('Tailor not found.')
    if (!input.active && db.prepare("SELECT 1 FROM alterations WHERE tailor_id=? AND status NOT IN ('delivered','cancelled')").get(input.id))
      throw new Error('This tailor still has open jobs. Finish or move them before making the tailor inactive.')
    db.prepare('UPDATE tailors SET name=?,mobile=?,kind=?,rate_per_job=?,active=? WHERE id=?').run(name, tailorMobile, input.kind, input.ratePerJob, input.active ? 1 : 0, input.id)
  } else {
    db.prepare('INSERT INTO tailors (id,name,mobile,kind,rate_per_job,active) VALUES (?,?,?,?,?,1)').run(randomUUID(), name, tailorMobile, input.kind, input.ratePerJob)
  }
  audit(actor.id, 'tailor_save', { name, id: input.id ?? null })
  return listTailors()
}

export function saveAlterationConfig(cfg: AltConfig): AltConfig {
  const actor = requireRole('owner', 'manager')
  if (!Number.isInteger(cfg.dueDays) || cfg.dueDays < 0 || cfg.dueDays > 60) throw new Error('Ready in (days) must be between 0 and 60.')
  if (!Number.isInteger(cfg.rate) || cfg.rate < 0 || cfg.rate > 28) throw new Error('GST % must be between 0 and 28.')
  if (!['sticker', 'receipt'].includes(cfg.tagPrinter)) throw new Error('Choose where the tag prints.')
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('alterations', JSON.stringify(cfg))
  audit(actor.id, 'settings_change', { key: 'alterations', cfg })
  return alterationConfig()
}
