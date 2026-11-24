import { randomInt } from 'node:crypto'
import { getDb } from '../db'
import type { Role } from '@shared/types'
import { audit } from './auth'
import { checkApprover } from './approval'
import { hashPin, isWeakPin, verifyPin } from './pin'
import { requireRole } from './session'
import { getSetting } from './settings'

/**
 * Forgotten PINs, with no internet and no outside help.
 *  - Cashier / store staff: a manager or the owner approves with their own PIN and types a temporary PIN; the person
 *    must choose their own at the next login.
 *  - Manager: the owner approves the same way.
 *  - Owner: the recovery code (made in Settings, shown once, kept only as a hash). Using it sets a new PIN and
 *    uses the code up, so the owner is asked to make a fresh one.
 */

const put = (key: string, value: unknown): void => {
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))
}
const del = (key: string): void => { getDb().prepare('DELETE FROM settings WHERE key=?').run(key) }

function checkNewPin(pin: string): void {
  if (!/^\d{4}$/.test(String(pin ?? ''))) throw new Error('The new PIN must be 4 digits.')
  if (isWeakPin(pin)) throw new Error('Choose a PIN that is harder to guess.')
}

/** Who may reset whom: the owner resets managers, cashiers and store staff; a manager only cashiers and store staff. */
const MAY_RESET: Record<Role, Role[]> = { owner: ['manager', 'cashier', 'store'], manager: ['cashier', 'store'], cashier: [], store: [] }

export function resetPinByApprover(input: { staffId: string; approverId: string; approverPin: string; newPin: string }): true {
  const db = getDb()
  const target = db.prepare('SELECT id,name,role FROM staff WHERE id=? AND active=1').get(input.staffId) as { id: string; name: string; role: Role } | undefined
  if (!target) throw new Error('Unknown staff member.')
  if (target.role === 'owner') throw new Error('The owner PIN can only be reset with the recovery code.')
  checkNewPin(input.newPin)
  const approver = db.prepare("SELECT id,role FROM staff WHERE id=? AND active=1 AND role IN ('owner','manager')").get(input.approverId) as { id: string; role: Role } | undefined
  if (approver && approver.id === target.id) throw new Error('Someone else must approve your PIN reset.')
  if (approver && !MAY_RESET[approver.role].includes(target.role)) throw new Error('Only the owner can reset a manager PIN.')
  const by = checkApprover({ staffId: input.approverId, pin: input.approverPin }) // same wrong-PIN counting and lock as every approval
  db.prepare('UPDATE staff SET pin_hash=?,must_change_pin=1,failed_attempts=0,locked_until=0 WHERE id=?').run(hashPin(input.newPin), target.id)
  audit(by, 'pin_reset', { id: target.id, by: 'approver' })
  return true
}

/* ---------- owner recovery code ---------- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
const normalise = (code: string): string => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

interface Recovery { hash: string; at: string }
interface Tries { fails: number; locks: number; until: number }

export const hasRecoveryCode = (): boolean => !!getSetting<Recovery | null>('recovery', null)

/** Owner, signed in: makes a new code (replacing any old one) and returns it once, as XXXX-XXXX-XXXX. */
export function createRecoveryCode(): string {
  const a = requireRole('owner')
  const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  put('recovery', { hash: hashPin(raw), at: new Date().toISOString() } satisfies Recovery)
  audit(a.id, 'settings_change', { key: 'recovery_code' })
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`
}

const MAX_FAILS = 5
const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000))

/** Not signed in: the recovery code plus a new owner PIN. Wrong codes are limited (5, then 1, 2, 4 ... 15 minutes). */
export function resetOwnerPin(code: string, newPin: string): true {
  const db = getDb()
  const stored = getSetting<Recovery | null>('recovery', null)
  if (!stored) throw new Error('No recovery code has been made yet. Ask the owner to make one in Settings → Staff.')
  const now = Date.now()
  const t = getSetting<Tries>('recovery_tries', { fails: 0, locks: 0, until: 0 })
  if (t.until > now) throw new Error(`Too many wrong codes. Try again in ${seconds(t.until - now)} seconds.`)
  checkNewPin(newPin)
  const o = db.prepare("SELECT id FROM staff WHERE role='owner' AND active=1 ORDER BY rowid LIMIT 1").get() as { id: string } | undefined
  if (!o) throw new Error('No owner account found.')

  if (!verifyPin(normalise(code), stored.hash)) {
    const fails = t.fails + 1
    if (fails < MAX_FAILS) {
      put('recovery_tries', { ...t, fails })
      audit(null, 'recovery_failed', { triesLeft: MAX_FAILS - fails })
      throw new Error(`That recovery code is not correct (${MAX_FAILS - fails} ${MAX_FAILS - fails === 1 ? 'try' : 'tries'} left).`)
    }
    const locks = t.locks + 1
    const ms = Math.min(60_000 * 2 ** (locks - 1), 15 * 60_000)
    put('recovery_tries', { fails: 0, locks, until: now + ms })
    audit(null, 'recovery_failed', { triesLeft: 0, lockedSeconds: seconds(ms) })
    throw new Error(`Too many wrong codes. Locked for ${seconds(ms)} seconds.`)
  }

  db.prepare('UPDATE staff SET pin_hash=?,must_change_pin=0,failed_attempts=0,locked_until=0 WHERE id=?').run(hashPin(newPin), o.id)
  del('recovery') // the code is used up
  del('recovery_tries')
  audit(o.id, 'pin_reset', { id: o.id, by: 'recovery_code' })
  return true
}
