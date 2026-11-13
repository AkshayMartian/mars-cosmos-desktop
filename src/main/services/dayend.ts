import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { CloseDayResult, DayEndSummary } from '@shared/dayend'
import { audit } from './auth'
import { runBackup } from './backup'
import { openSessionRow } from './billing'
import { requireRole } from './session'

const WHO = ['owner', 'manager', 'cashier'] as const

/** Cash in the drawer should be: opening + cash sales - cash refunds - expenses. One formula, used for the screen and when closing. */
function totals(sessionId: string, opening: number) {
  const db = getDb()
  const cash = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount END),0) AS cin, COALESCE(-SUM(CASE WHEN p.amount<0 THEN p.amount END),0) AS cout
       FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.session_id=? AND b.status='completed' AND p.mode='cash'`
    )
    .get(sessionId) as { cin: number; cout: number }
  const count = db.prepare("SELECT COUNT(*) AS n FROM bills WHERE session_id=? AND type='sale' AND status='completed'").get(sessionId) as { n: number }
  const expenses = db
    .prepare('SELECT e.id,e.note,e.amount,e.at,s.name AS staff FROM expenses e LEFT JOIN staff s ON s.id=e.staff_id WHERE e.session_id=? ORDER BY e.at, e.rowid')
    .all(sessionId) as DayEndSummary['expenses']
  const expensesTotal = expenses.reduce((a, e) => a + e.amount, 0)
  return { cashIn: cash.cin, cashOut: cash.cout, salesCount: count.n, expenses, expensesTotal, expected: opening + cash.cin - cash.cout - expensesTotal }
}

export function daySummary(): DayEndSummary {
  requireRole(...WHO)
  const s = openSessionRow()
  if (!s) return { session: null, opening: 0, cashIn: 0, cashOut: 0, salesCount: 0, expenses: [], expensesTotal: 0, expected: 0 }
  const row = getDb()
    .prepare('SELECT d.id,d.date,d.counter,d.opened_at AS openedAt,COALESCE(u.name,\'\') AS openedBy FROM day_sessions d LEFT JOIN staff u ON u.id=d.opened_by WHERE d.id=?')
    .get(s.id) as NonNullable<DayEndSummary['session']>
  return { session: row, opening: s.opening, ...totals(s.id, s.opening) }
}

export function addExpense(amount: number, note: string): void {
  const actor = requireRole(...WHO)
  const s = openSessionRow()
  if (!s) throw new Error('There is no open day. Start the day first.')
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter the amount spent.')
  const text = note.trim()
  if (!text) throw new Error('Enter what it was for.')
  const id = randomUUID()
  getDb().prepare('INSERT INTO expenses (id,session_id,amount,note,staff_id,at) VALUES (?,?,?,?,?,?)').run(id, s.id, amount, text, actor.id, new Date().toISOString())
  audit(actor.id, 'expense_add', { id, amount, note: text })
}

/**
 * Closes the day. The expected cash is worked out again here (never taken from the screen), the day is locked,
 * then the database is backed up. If the backup fails the day is still closed and the result says so.
 */
export function closeDay(countedCash: number): CloseDayResult {
  const actor = requireRole(...WHO)
  const s = openSessionRow()
  if (!s) throw new Error('There is no open day to close.')
  if (!Number.isInteger(countedCash) || countedCash < 0) throw new Error('Enter the cash you counted (0 or more).')

  const expected = totals(s.id, s.opening).expected
  const diff = countedCash - expected
  getDb()
    .prepare("UPDATE day_sessions SET status='closed',expected_cash=?,counted_cash=?,diff=?,closed_by=?,closed_at=? WHERE id=? AND status='open'")
    .run(expected, countedCash, diff, actor.id, new Date().toISOString(), s.id)
  audit(actor.id, 'day_close', { id: s.id, expected, counted: countedCash, diff })

  let backup: CloseDayResult['backup']
  try {
    backup = { ok: true, file: runBackup().file }
  } catch (e) {
    backup = { ok: false, error: e instanceof Error ? e.message : 'The backup failed.' }
    audit(actor.id, 'backup_failed', { error: backup.error })
  }
  return { expected, counted: countedCash, diff, backup }
}
