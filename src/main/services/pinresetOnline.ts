import { getDb } from '../db'
import { audit } from './auth'
import { licenceIdentity, serverRequest } from './licence'

/**
 * Owner "Forgot PIN" over the internet. The owner never types a PIN on this PC:
 *   1. `startOwnerReset`: the app asks the server (licence key + PC id) to email a one-time link to the owner's email on file.
 *      The answer carries only a masked hint of the address (ni•••@gmail.com); the app never learns the full email.
 *   2. The owner opens the link, on any device, and chooses the new PIN on a web page. The server hashes it (the same scrypt format as here).
 *   3. `checkOwnerReset`: the app asks the server every few seconds. When the hash is ready it is stored as the owner's PIN, and the
 *      server is told ("applied") so it deletes its copy of the hand-off.
 * No internet: every call stops with one message and changes nothing. Resend is limited.
 */

export interface ResetStart { emailHint: string; resendsLeft: number; expiresInSeconds: number }
export type ResetStatus = { status: 'waiting' } | { status: 'expired' } | { status: 'applied' }

const MAX_RESENDS = 3
const HASH_RE = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/

interface Current { resetId: string; emailHint: string; resends: number; expiresInSeconds: number }
let current: Current | null = null
export const forgetOwnerReset = (): void => { current = null }

interface Requested { resetId?: string; emailHint?: string; expiresInSec?: number }

async function ask(resend: boolean): Promise<ResetStart> {
  const id = licenceIdentity()
  const r = await serverRequest<Requested>('POST', '/v1/pin-reset/request', resend && current ? { ...id, resetId: current.resetId, resend: true } : id)
  if (!r.resetId || !r.emailHint) throw new Error('The MARS server gave an unexpected answer. Try again in a moment.')
  current = { resetId: r.resetId, emailHint: String(r.emailHint), resends: resend && current ? current.resends + 1 : 0, expiresInSeconds: Number(r.expiresInSec) || 900 }
  audit(null, resend ? 'pin_reset_resent' : 'pin_reset_requested', { via: 'email' })
  return { emailHint: current.emailHint, resendsLeft: MAX_RESENDS - current.resends, expiresInSeconds: current.expiresInSeconds }
}

/** The owner pressed "Forgot PIN". Throws the no-internet message when the server cannot be reached. */
export const startOwnerReset = (): Promise<ResetStart> => ask(false)

/** "Resend email": same request again, at most three times. */
export async function resendOwnerReset(): Promise<ResetStart> {
  if (!current) throw new Error('Start the PIN reset again.')
  if (current.resends >= MAX_RESENDS) throw new Error('The email was already sent three times. Check the inbox and the spam folder, or try again later.')
  return ask(true)
}

/** Polled every few seconds while the screen waits. When the new PIN is ready it is saved and the reset is over. */
export async function checkOwnerReset(): Promise<ResetStatus> {
  if (!current) throw new Error('Start the PIN reset again.')
  const id = licenceIdentity()
  const r = await serverRequest<{ status?: string; pinHash?: string }>('GET', '/v1/pin-reset/status', { ...id, resetId: current.resetId })
  if (r.status === 'expired') { current = null; return { status: 'expired' } }
  if (r.status !== 'ready') return { status: 'waiting' }
  if (!r.pinHash || !HASH_RE.test(r.pinHash)) throw new Error('The MARS server sent a PIN that this app cannot use. Start the reset again.')

  const db = getDb()
  const owner = db.prepare("SELECT id FROM staff WHERE role='owner' AND active=1 ORDER BY rowid LIMIT 1").get() as { id: string } | undefined
  if (!owner) throw new Error('No owner account found.')
  db.prepare('UPDATE staff SET pin_hash=?,must_change_pin=0,failed_attempts=0,locked_until=0 WHERE id=?').run(r.pinHash, owner.id)
  audit(owner.id, 'pin_reset', { id: owner.id, by: 'email_link' })
  const resetId = current.resetId
  current = null
  // tell the server the PC has the PIN so it can delete the hand-off; if this call fails the server's copy simply expires
  await serverRequest('POST', '/v1/pin-reset/applied', { ...id, resetId }).catch(() => undefined)
  return { status: 'applied' }
}
