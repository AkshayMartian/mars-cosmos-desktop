import { getDb } from '../db'
import type { BillDetail, BillListRow, BillPeriod, CancelInput } from '@shared/bills'
import { audit } from './auth'
import { checkApprover, isManager } from './approval'
import { getBill, openSessionRow } from './billing'
import { requireRole } from './session'
import { addMove } from './stock'
import { movePieces } from './serials'
import { reverseForCancel } from './coins'

const WHO = ['owner', 'manager', 'cashier'] as const

/** Bills for the list, newest first. `q` matches bill number, customer mobile or name. */
export function listBills(period: BillPeriod, q: string): BillListRow[] {
  requireRole(...WHO)
  const where: string[] = []
  const args: string[] = []
  if (period === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    where.push('b.at>=?')
    args.push(d.toISOString())
  } else if (period === '7') {
    where.push('b.at>=?')
    args.push(new Date(Date.now() - 7 * 864e5).toISOString())
  } else if (period !== 'all') throw new Error('Unknown period.')
  const t = (q ?? '').trim()
  if (t) {
    const like = `%${t.replace(/[%_]/g, '')}%`
    where.push('(b.no LIKE ? OR c.mobile LIKE ? OR c.name LIKE ?)')
    args.push(like, like, like)
  }
  const rows = getDb()
    .prepare(
      `SELECT b.id,b.no,b.type,b.status,b.at,c.name AS customerName,b.grand,
              (SELECT group_concat(DISTINCT mode) FROM payments WHERE bill_id=b.id) AS modes
       FROM bills b LEFT JOIN customers c ON c.id=b.customer_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.at DESC, b.rowid DESC LIMIT 80`
    )
    .all(...args) as (Omit<BillListRow, 'modes'> & { modes: string | null })[]
  return rows.map((r) => ({ ...r, modes: r.modes ? r.modes.split(',') : [] }))
}

/** Why a bill cannot be cancelled, or null when it can. Old bills go through Return / exchange instead. */
function cancelRefusal(id: string): string | null {
  const db = getDb()
  const b = db.prepare('SELECT type,status,session_id FROM bills WHERE id=?').get(id) as { type: string; status: string; session_id: string | null } | undefined
  if (!b) return 'Bill not found.'
  if (b.type !== 'sale') return 'A return bill cannot be cancelled.'
  if (b.status !== 'completed') return 'This bill is already cancelled.'
  const open = openSessionRow()
  if (!open || b.session_id !== open.id) return "Only bills of today's open day can be cancelled. Use Return / exchange for older bills."
  if ((db.prepare('SELECT COUNT(*) AS n FROM bill_lines WHERE bill_id=? AND returned_qty>0').get(id) as { n: number }).n)
    return 'Some items of this bill were already returned, so it cannot be cancelled.'
  const busy = db.prepare("SELECT no FROM alterations WHERE bill_id=? AND status NOT IN ('received','cancelled') ORDER BY rowid LIMIT 1").get(id) as { no: string } | undefined
  if (busy) return `Alteration ${busy.no} from this bill is already with the tailor or finished, so the bill cannot be cancelled.`
  if ((db.prepare("SELECT COUNT(*) AS n FROM payments WHERE bill_id=? AND mode='credit_note' AND credit_note_id IS NULL").get(id) as { n: number }).n)
    return 'This bill is the new-items side of an exchange. Use Return / exchange for it.'
  return null
}

export function billDetail(id: string): BillDetail {
  const actor = requireRole(...WHO)
  const bill = getBill(id)
  const x = getDb()
    .prepare('SELECT b.cancel_reason AS reason,s.name AS by FROM bills b LEFT JOIN staff s ON s.id=b.cancelled_by WHERE b.id=?')
    .get(id) as { reason: string | null; by: string | null }
  const hint = cancelRefusal(id)
  return { bill, cancelReason: x.reason, cancelledBy: x.by, cancellable: hint === null, cancelHint: hint, needsApproval: !isManager(actor) }
}

/**
 * Cancels a sale bill of today's open day. The bill stays in the list as Cancelled (never deleted or edited otherwise):
 * stock goes back (`cancel` moves), a credit note used as payment gets its balance back, and the bill drops out of the
 * day's cash and sales totals (they only count completed bills).
 */
export function cancelBill(input: CancelInput): BillDetail {
  const actor = requireRole(...WHO)
  const db = getDb()
  const reason = (input.reason ?? '').trim()
  if (!reason) throw new Error('Type a reason for cancelling.')
  const refusal = cancelRefusal(input.billId)
  if (refusal) throw new Error(refusal)
  // Checked before the transaction so a wrong PIN is still counted.
  // Only an owner or manager cancels alone. A cashier always needs a manager or owner to type their PIN.
  const approvedBy = isManager(actor) ? actor.id : checkApprover(input.approval)

  const at = new Date().toISOString()
  db.transaction(() => {
    const b = db.prepare('SELECT no FROM bills WHERE id=?').get(input.billId) as { no: string }
    db.prepare("UPDATE bills SET status='cancelled',cancel_reason=?,cancelled_by=? WHERE id=? AND status='completed'").run(reason, approvedBy, input.billId)
    // the alteration charge line is a service: nothing to put back on the shelf
    const lines = db
      .prepare('SELECT l.variant_id AS v,l.qty FROM bill_lines l JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id WHERE l.bill_id=? AND c.is_service=0')
      .all(input.billId) as { v: string; qty: number }[]
    // jobs not yet sent to the tailor are cancelled with the bill
    const jobs = db.prepare("SELECT id,no FROM alterations WHERE bill_id=? AND status='received'").all(input.billId) as { id: string; no: string }[]
    for (const j of jobs) {
      db.prepare("UPDATE alterations SET status='cancelled' WHERE id=?").run(j.id)
      db.prepare("INSERT INTO alteration_history (alteration_id,status,staff_id,at) VALUES (?,'cancelled',?,?)").run(j.id, actor.id, at)
    }
    for (const l of lines) addMove({ variantId: l.v, qty: l.qty, type: 'cancel', ref: b.no, reason, staffId: actor.id, at })
    // serial numbers: every piece of the bill goes back to stock at once
    const sold = db.prepare("SELECT id FROM pieces WHERE bill_id=? AND status='sold'").all(input.billId) as { id: number }[]
    movePieces(sold.map((p) => p.id), 'in_stock', 'bill cancelled', { ref: b.no, staffId: actor.id, at })
    const cn = db.prepare("SELECT credit_note_id AS id,amount FROM payments WHERE bill_id=? AND mode='credit_note' AND credit_note_id IS NOT NULL").all(input.billId) as { id: string; amount: number }[]
    for (const p of cn) db.prepare('UPDATE credit_notes SET balance=balance+? WHERE id=?').run(p.amount, p.id)
    const coins = reverseForCancel(input.billId, at)
    audit(actor.id, 'bill_cancel', { bill: b.no, reason, approvedBy, creditNoteRestored: cn.reduce((a, p) => a + p.amount, 0), coinsGivenBack: coins.back, coinsTakenBack: coins.taken })
  })()
  return billDetail(input.billId)
}
