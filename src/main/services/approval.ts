import { getDb } from '../db'
import type { ApprovalInput, ApproverDto } from '@shared/stockops'
import { audit } from './auth'
import { verifyPin } from './pin'
import { current, type Actor } from './session'

/** Owner and manager are trusted to act alone; everyone else needs one of them to approve. */
export const isManager = (a: Actor): boolean => a.role === 'owner' || a.role === 'manager'

export function listApprovers(): ApproverDto[] {
  current()
  return getDb().prepare("SELECT id,name,role FROM staff WHERE active=1 AND role IN ('owner','manager') ORDER BY rowid").all() as ApproverDto[]
}

/** 5 wrong PINs lock approvals by that person for 1 minute; each further lock doubles (1, 2, 4, 8, then 15 minutes at most). */
export const MAX_APPROVAL_FAILS = 5
export const BASE_LOCK_MS = 60_000
export const MAX_LOCK_MS = 15 * 60_000

const WRONG = 'That PIN is not correct for the chosen manager or owner'
const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000))

interface Attempts { fails: number; locks: number; locked_until: number }

/**
 * The approver is named (not guessed from the PIN) so the audit log says exactly who approved.
 * Returns that person's id, or throws a message the screen can show.
 *
 * Guessing is limited: wrong PINs are counted **per approver** (table `approval_attempts`, separate from login
 * so it never locks the manager out of their own account). While locked even the right PIN is refused.
 * Call this *before* the caller's own transaction so the counter survives the error.
 */
export function checkApprover(a: ApprovalInput | undefined): string {
  if (!a) throw new Error('A manager or owner must approve this.')
  const db = getDb()
  const s = db
    .prepare("SELECT id,pin_hash FROM staff WHERE id=? AND active=1 AND role IN ('owner','manager')")
    .get(a.staffId) as { id: string; pin_hash: string } | undefined
  // Not a real approver: nothing to guess, so nothing to count (same wording, no hint about who exists).
  if (!s) throw new Error(`${WRONG}.`)

  const now = Date.now()
  const row = db.prepare('SELECT fails,locks,locked_until FROM approval_attempts WHERE staff_id=?').get(s.id) as Attempts | undefined
  if (row && row.locked_until > now) {
    throw new Error(`Too many wrong approval PINs. Try again in ${seconds(row.locked_until - now)} seconds.`)
  }

  if (verifyPin(String(a.pin ?? ''), s.pin_hash)) {
    if (row) db.prepare('DELETE FROM approval_attempts WHERE staff_id=?').run(s.id) // a right PIN clears the count
    return s.id
  }

  const actor = current()
  const fails = (row?.fails ?? 0) + 1
  if (fails < MAX_APPROVAL_FAILS) {
    db.prepare('INSERT INTO approval_attempts (staff_id,fails,locks,locked_until) VALUES (?,?,?,0) ON CONFLICT(staff_id) DO UPDATE SET fails=excluded.fails')
      .run(s.id, fails, row?.locks ?? 0)
    audit(actor.id, 'approval_failed', { approver: s.id, triesLeft: MAX_APPROVAL_FAILS - fails })
    throw new Error(`${WRONG} (${MAX_APPROVAL_FAILS - fails} ${MAX_APPROVAL_FAILS - fails === 1 ? 'try' : 'tries'} left).`)
  }

  const locks = (row?.locks ?? 0) + 1
  const lockMs = Math.min(BASE_LOCK_MS * 2 ** (locks - 1), MAX_LOCK_MS)
  db.prepare('INSERT INTO approval_attempts (staff_id,fails,locks,locked_until) VALUES (?,0,?,?) ON CONFLICT(staff_id) DO UPDATE SET fails=0,locks=excluded.locks,locked_until=excluded.locked_until')
    .run(s.id, locks, now + lockMs)
  audit(actor.id, 'approval_failed', { approver: s.id, triesLeft: 0 })
  audit(actor.id, 'approval_locked', { approver: s.id, seconds: seconds(lockMs), lockNumber: locks })
  throw new Error(`Too many wrong approval PINs. Approvals by this person are locked for ${seconds(lockMs)} seconds.`)
}
