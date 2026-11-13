import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { roundToRupee } from '@shared/money'
import { returnPart, type BillForReturn, type CreditNoteDto, type ReturnBillRow, type ReturnInput, type ReturnLine, type ReturnResult } from '@shared/returns'
import { audit } from './auth'
import { checkApprover, isManager } from './approval'
import { createBill, getBill, nextBillNo, openSessionRow } from './billing'
import { requireRole } from './session'
import { getSetting } from './settings'
import { addMove } from './stock'

const WHO = ['owner', 'manager', 'cashier'] as const

/** SQL: this bill line is the alteration service charge (never returned, never stocked). */
const SVC = "EXISTS (SELECT 1 FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id WHERE v.id=bill_lines.variant_id AND c.is_service=1)"

const receiptSettings = () => getSetting<{ returnDays?: number; creditNoteDays?: number }>('receipt', {})
const windowDays = (): number => receiptSettings().returnDays ?? 7
const creditNoteDays = (): number => receiptSettings().creditNoteDays ?? 90

/** Bills that can be returned against: a bill number (whole or the last digits) or the customer's mobile. */
export function findBillsForReturn(q: string): ReturnBillRow[] {
  requireRole(...WHO)
  const t = q.trim()
  const digits = t.replace(/\D/g, '')
  if (!t) {
    // nothing typed: the latest bills, so the shop can just pick one
    return getDb()
      .prepare("SELECT b.id,b.no,b.at,c.name AS customerName,b.grand FROM bills b LEFT JOIN customers c ON c.id=b.customer_id WHERE b.type='sale' AND b.status='completed' ORDER BY b.at DESC, b.rowid DESC LIMIT 10")
      .all() as ReturnBillRow[]
  }
  const seq = /^\d{1,9}$/.test(t) ? Number(t) : -1 // the running number at the end of the bill number: 1, 12 or 0012
  return getDb()
    .prepare(
      `SELECT b.id,b.no,b.at,c.name AS customerName,b.grand
       FROM bills b LEFT JOIN customers c ON c.id=b.customer_id
       WHERE b.type='sale' AND b.status='completed'
         AND (lower(b.no)=lower(?) OR b.no LIKE ? OR CAST(replace(b.no, rtrim(b.no, '0123456789'), '') AS INTEGER)=? OR (? <> '' AND length(?)=10 AND c.mobile=?))
       ORDER BY b.at DESC, b.rowid DESC LIMIT 10`
    )
    .all(t, `%/${t.replace(/[%_]/g, '')}`, seq, digits, digits, digits) as ReturnBillRow[]
}

interface BillHead { id: string; no: string; at: string; type: string; status: string; customer_id: string | null; sales_by: string | null; grand: number }

function loadBill(id: string): BillHead {
  const b = getDb().prepare('SELECT id,no,at,type,status,customer_id,sales_by,grand FROM bills WHERE id=?').get(id) as BillHead | undefined
  if (!b) throw new Error('Bill not found.')
  if (b.type !== 'sale' || b.status !== 'completed') throw new Error('Only a completed sale bill can be returned.')
  return b
}

const ageDays = (iso: string): number => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)

export function getBillForReturn(billId: string): BillForReturn {
  const actor = requireRole(...WHO)
  const b = loadBill(billId)
  const c = b.customer_id ? (getDb().prepare('SELECT id,name FROM customers WHERE id=?').get(b.customer_id) as { id: string; name: string } | undefined) : undefined
  const lines = getDb()
    .prepare('SELECT id,variant_id AS variantId,name,colour,size,qty,returned_qty AS returned,total,' + SVC + ' AS service FROM bill_lines WHERE bill_id=? ORDER BY id')
    .all(billId) as (Omit<ReturnLine, 'returnable' | 'service'> & { service: number })[]
  const age = ageDays(b.at)
  const win = windowDays()
  return {
    id: b.id, no: b.no, at: b.at, ageDays: age, windowDays: win, overWindow: age > win, needsApproval: age > win && !isManager(actor),
    customerId: c?.id ?? null, customerName: c?.name ?? null, grand: b.grand,
    lines: lines.map((l) => ({ ...l, service: !!l.service, returnable: l.service ? 0 : l.qty - l.returned }))
  }
}

/** Credit notes this customer can still use today, oldest expiry first. */
export function usableCreditNotes(customerId: string): CreditNoteDto[] {
  requireRole(...WHO)
  return getDb()
    .prepare('SELECT id,balance,expires_at AS expiresAt FROM credit_notes WHERE customer_id=? AND balance>0 AND expires_at>=? ORDER BY expires_at, rowid')
    .all(customerId, new Date().toISOString()) as CreditNoteDto[]
}

/**
 * Return (and optionally exchange) in one transaction: a new bill of type 'return' with negative money, stock back in,
 * `returned_qty` raised on the original lines (so nothing can be returned twice), and the money settled as an exchange
 * difference, a credit note or cash out of the open drawer. The original bill is never edited otherwise.
 */
export function doReturn(input: ReturnInput): ReturnResult {
  const actor = requireRole(...WHO)
  const db = getDb()
  const session = openSessionRow()
  if (!session) throw new Error('Start the day first: enter the opening cash.')
  const orig = loadBill(input.billId)

  const picked = new Map<number, number>()
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 0) throw new Error('Return quantities must be whole numbers.')
    if (l.qty > 0) picked.set(l.lineId, (picked.get(l.lineId) ?? 0) + l.qty)
  }
  if (!picked.size) throw new Error('Choose at least one item to return.')
  const lines = db
    .prepare('SELECT id,variant_id AS variantId,name,colour,size,hsn,qty,mrp,gst_rate AS rate,taxable,cgst,sgst,total,returned_qty AS returned FROM bill_lines WHERE bill_id=? ORDER BY id')
    .all(orig.id) as { id: number; variantId: string; name: string; colour: string; size: string; hsn: string; qty: number; mrp: number; rate: number; taxable: number; cgst: number; sgst: number; total: number; returned: number }[]
  const byId = new Map(lines.map((l) => [l.id, l]))
  for (const [id, q] of picked) {
    const l = byId.get(id)
    if (!l) throw new Error('That item is not on this bill.')
    if ((db.prepare('SELECT ' + SVC + ' AS s FROM bill_lines WHERE id=?').get(id) as { s: number }).s)
      throw new Error('An alteration charge cannot be returned.')
    if (q > l.qty - l.returned) throw new Error(`Only ${l.qty - l.returned} of ${l.name} ${l.colour} ${l.size} can still be returned.`)
  }
  if (!['cash', 'upi', 'card'].includes(input.payMode)) throw new Error('Choose how the customer pays.')
  if (!['credit_note', 'cash'].includes(input.settle)) throw new Error('Choose how to give the money back.')

  // A bill older than the return window needs a manager. Checked before the transaction so a wrong PIN is still counted.
  const age = ageDays(orig.at)
  const outside = age > windowDays()
  const approvedBy = outside && !isManager(actor) ? checkApprover(input.approval) : null

  const parts = [...picked].map(([id, q]) => {
    const l = byId.get(id)!
    const total = returnPart(l.total, l.qty, l.returned, q)
    const taxable = returnPart(l.taxable, l.qty, l.returned, q)
    const cgst = returnPart(l.cgst, l.qty, l.returned, q)
    return { l, q, total, taxable, cgst, sgst: total - taxable - cgst }
  })
  const value = parts.reduce((a, p) => a + p.total, 0) // exact (paise) value of what comes back
  const refund = roundToRupee(value) // the bill is in whole rupees, like every bill
  const at = new Date().toISOString()
  const id = randomUUID()
  let result!: ReturnResult

  db.transaction(() => {
    const no = nextBillNo()
    db.prepare(
      `INSERT INTO bills (id,no,type,orig_bill_id,status,customer_id,staff_id,sales_by,session_id,at,subtotal,discount,taxable,cgst,sgst,round_off,grand)
       VALUES (?,?,'return',?,'completed',?,?,?,?,?,?,0,?,?,?,?,?)`
    ).run(id, no, orig.id, orig.customer_id, actor.id, orig.sales_by, session.id, at,
      -value, -parts.reduce((a, p) => a + p.taxable, 0), -parts.reduce((a, p) => a + p.cgst, 0), -parts.reduce((a, p) => a + p.sgst, 0), value - refund, -refund)

    const insLine = db.prepare(
      `INSERT INTO bill_lines (bill_id,variant_id,name,size,colour,hsn,qty,mrp,price,discount,taxable,gst_rate,cgst,sgst,total)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)`
    )
    for (const p of parts) {
      insLine.run(id, p.l.variantId, p.l.name, p.l.size, p.l.colour, p.l.hsn, p.q, p.l.mrp, -Math.round(p.total / p.q), -p.taxable, p.l.rate, -p.cgst, -p.sgst, -p.total)
      db.prepare('UPDATE bill_lines SET returned_qty=returned_qty+? WHERE id=?').run(p.q, p.l.id)
      addMove({ variantId: p.l.variantId, qty: p.q, type: 'sale_return', ref: no, staffId: actor.id, at })
    }

    // Exchange: new items go on a normal sale bill; the returned value pays for them first.
    let sale: ReturnResult['saleBill'] = null
    let applied = 0
    let customerPaid = 0
    if (input.newLines.length) {
      sale = createBill(
        { lines: input.newLines.map((l) => ({ variantId: l.variantId, qty: l.qty, disc: 0 })), customerId: orig.customer_id, billDisc: 0, salesBy: null, payments: [] },
        {
          settle: (grand) => {
            applied = Math.min(refund, grand)
            customerPaid = grand - applied
            return { credit: applied, payments: customerPaid > 0 ? [{ mode: input.payMode, amount: customerPaid }] : [] }
          }
        }
      )
    }

    const left = refund - applied // owed to the customer
    const pay = db.prepare('INSERT INTO payments (bill_id,mode,amount,credit_note_id) VALUES (?,?,?,?)')
    if (applied > 0) pay.run(id, 'credit_note', -applied, null)
    let creditNote: ReturnResult['creditNote'] = null
    let cashRefund = 0
    if (left > 0) {
      if (input.settle === 'credit_note') {
        if (!orig.customer_id) throw new Error('A credit note needs a customer on the bill. Refund in cash, or add the customer to the bill first.')
        const cnId = randomUUID()
        const expiresAt = new Date(Date.now() + creditNoteDays() * 864e5).toISOString()
        db.prepare('INSERT INTO credit_notes (id,customer_id,from_bill_id,amount,balance,at,expires_at) VALUES (?,?,?,?,?,?,?)').run(cnId, orig.customer_id, id, left, left, at, expiresAt)
        pay.run(id, 'credit_note', -left, cnId)
        creditNote = { amount: left, expiresAt }
      } else {
        pay.run(id, 'cash', -left, null) // out of today's drawer: Day end subtracts negative cash payments
        cashRefund = left
      }
    }
    audit(actor.id, 'return', { bill: orig.no, returnBill: no, value: refund, exchange: sale?.no ?? null, creditNote: creditNote?.amount ?? 0, cashRefund, ...(approvedBy ? { approvedBy, ageDays: age } : {}) })
    result = { returnBill: getBill(id), saleBill: sale, creditNote, cashRefund, customerPaid }
  })()
  return result
}
