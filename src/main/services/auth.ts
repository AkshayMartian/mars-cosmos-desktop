import { getDb } from '../db'
import type { LoginResult, StaffPublic } from '@shared/types'
import { hashPin, isWeakPin, verifyPin } from './pin'
import { pending, setCurrent, setPending } from './session'

interface StaffRow {
  id: string; name: string; role: StaffPublic['role']; pin_hash: string
  must_change_pin: number; failed_attempts: number; locked_until: number
}

const MAX_FAILS = 5
const LOCK_MS = 60_000

export function listActiveStaff(): StaffPublic[] {
  return getDb().prepare('SELECT id,name,role FROM staff WHERE active=1 ORDER BY rowid').all() as StaffPublic[]
}

export function login(staffId: string, pin: string): LoginResult {
  const db = getDb()
  const s = db.prepare('SELECT * FROM staff WHERE id=? AND active=1').get(staffId) as StaffRow | undefined
  if (!s) return { ok: false, error: 'Unknown staff member.' }

  const now = Date.now()
  if (s.locked_until > now) return { ok: false, error: 'Too many wrong PINs.', lockedFor: Math.ceil((s.locked_until - now) / 1000) }

  if (!verifyPin(pin, s.pin_hash)) {
    const fails = s.failed_attempts + 1
    const lock = fails >= MAX_FAILS
    db.prepare('UPDATE staff SET failed_attempts=?, locked_until=? WHERE id=?').run(lock ? 0 : fails, lock ? now + LOCK_MS : 0, s.id)
    audit(s.id, 'login_failed')
    return lock
      ? { ok: false, error: '5 wrong PINs. Locked for 1 minute.', lockedFor: 60 }
      : { ok: false, error: `Wrong PIN (${MAX_FAILS - fails} tries left).` }
  }

  db.prepare('UPDATE staff SET failed_attempts=0, locked_until=0 WHERE id=?').run(s.id)
  audit(s.id, 'login')
  // A default PIN gets no working session until it has been changed.
  if (s.must_change_pin) setPending(s.id)
  else setCurrent(s.id)
  return { ok: true, staff: { id: s.id, name: s.name, role: s.role }, mustChangePin: !!s.must_change_pin }
}

export function changePin(pin: string): { ok: boolean; error?: string; staff?: StaffPublic } {
  const id = pending()
  if (!id) return { ok: false, error: 'Log in again first.' }
  const s = getDb().prepare('SELECT id,name,role FROM staff WHERE id=?').get(id) as StaffPublic
  const len = s.role === 'owner' ? 6 : 4
  if (!new RegExp(`^\\d{${len}}$`).test(pin)) return { ok: false, error: `PIN must be ${len} digits.` }
  if (isWeakPin(pin)) return { ok: false, error: 'Choose a PIN that is harder to guess.' }
  getDb().prepare('UPDATE staff SET pin_hash=?, must_change_pin=0 WHERE id=?').run(hashPin(pin), id)
  audit(id, 'pin_change')
  setCurrent(id)
  return { ok: true, staff: s }
}

export function logout(): void {
  setCurrent(null)
}

export function audit(staffId: string | null, action: string, details?: unknown): void {
  getDb()
    .prepare('INSERT INTO audit_log (at,staff_id,action,details) VALUES (?,?,?,?)')
    .run(new Date().toISOString(), staffId, action, details === undefined ? null : JSON.stringify(details))
}
