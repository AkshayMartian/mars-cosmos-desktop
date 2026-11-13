import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { AltConfig, ChargeMode } from '@shared/alterations'
import { ALT_WORKS } from '@shared/alterations'
import { getSetting } from './settings'

/**
 * Leaf helpers for alterations, used by both Billing (jobs made with a bill) and Alterations.
 * Nothing here imports another service, so there is no import cycle.
 */

const DEFAULTS: AltConfig = { dueDays: 2, rate: 18, tagPrinter: 'sticker' }

export const alterationConfig = (): AltConfig => ({ ...DEFAULTS, ...getSetting<Partial<AltConfig>>('alterations', {}) })

/** The service "item" that alteration charges sit on a bill under. Made the first time it is needed; never sold or stocked. */
export function ensureServiceVariant(): { variantId: string; hsn: string } {
  const db = getDb()
  const cat = db.prepare('SELECT id,hsn FROM categories WHERE is_service=1 ORDER BY rowid LIMIT 1').get() as { id: string; hsn: string } | undefined
  if (!cat) throw new Error('The "Alteration service" category is missing.')
  const v = db.prepare("SELECT id FROM variants WHERE barcode='ALT'").get() as { id: string } | undefined
  if (v) return { variantId: v.id, hsn: cat.hsn }
  const pid = randomUUID()
  const vid = randomUUID()
  db.prepare("INSERT INTO products (id,name,brand,category_id,active,created_at) VALUES (?,?,?,?,1,?)").run(pid, 'Alteration charge', '', cat.id, new Date().toISOString())
  db.prepare("INSERT INTO variants (id,product_id,size,colour,barcode,mrp,sale_price,cost,min_stock) VALUES (?,?,?,?,?,0,0,0,0)").run(vid, pid, '—', 'Service', 'ALT')
  return { variantId: vid, hsn: cat.hsn }
}

export const nextJobNo = (): string => {
  const r = getDb().prepare("SELECT COALESCE(MAX(CAST(substr(no,5) AS INTEGER)),0)+1 AS n FROM alterations").get() as { n: number }
  return 'ALT-' + String(r.n).padStart(4, '0')
}

export interface JobFields {
  billId: string | null
  customerId: string
  variantId: string | null
  item: string
  work: string[]
  notes: string
  tailorId: string
  dueAt: string
  charge: number
  chargeMode: ChargeMode
  paid: boolean
  gstRate: number
  staffId: string
}

/** Checks the parts a person types (work, tailor, ready-by, charge). Throws a readable message. */
export function checkJobInput(x: { work: string[]; tailorId: string; dueAt: string; charge: number }): void {
  if (!x.work.length) throw new Error('Tick at least one type of work.')
  if (x.work.some((w) => !(ALT_WORKS as readonly string[]).includes(w))) throw new Error('Unknown type of work.')
  if (!getDb().prepare('SELECT 1 FROM tailors WHERE id=? AND active=1').get(x.tailorId)) throw new Error('Choose a tailor.')
  if (Number.isNaN(new Date(x.dueAt).getTime())) throw new Error('Choose the ready-by date and time.')
  if (!Number.isInteger(x.charge) || x.charge < 0) throw new Error('The charge cannot be negative.')
  if (x.charge % 100 !== 0) throw new Error('Enter the charge in whole rupees.')
}

/** Inserts the job and its first history line; returns its id. Call inside the caller's transaction. */
export function insertJob(f: JobFields): { id: string; no: string } {
  const db = getDb()
  const id = randomUUID()
  const no = nextJobNo()
  const at = new Date().toISOString()
  db.prepare(
    `INSERT INTO alterations (id,no,bill_id,customer_id,variant_id,item,work,notes,tailor_id,due_at,charge,charge_mode,paid,status,created_at,gst_rate)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'received',?,?)`
  ).run(id, no, f.billId, f.customerId, f.variantId, f.item, f.work.join(', '), f.notes, f.tailorId, new Date(f.dueAt).toISOString(), f.charge, f.chargeMode, f.paid ? 1 : 0, at, f.gstRate)
  db.prepare("INSERT INTO alteration_history (alteration_id,status,staff_id,at) VALUES (?,'received',?,?)").run(id, f.staffId, at)
  return { id, no }
}
