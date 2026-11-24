/** Licence / activation, shared by the main process and the screens. */

export type LicenceState =
  | 'none'      // not activated yet: only the activation screen is shown
  | 'active'
  | 'expiring'  // active, but fewer than EXPIRY_WARN_DAYS left
  | 'expired'   // the application is blocked until it is renewed (data is kept)
  | 'invalid'   // a licence is saved but is not valid on this PC (copied from another PC, tampered)

export const EXPIRY_WARN_DAYS = 14
/** A trial is only 14 days long, so it warns later (otherwise it would be "expiring" from the first minute). */
export const TRIAL_WARN_DAYS = 5
/** An online-activated licence that has not reached the server for this long shows a warning (the app keeps working). */
export const STALE_CHECK_DAYS = 30
export const TRIAL_DAYS = 14

export interface LicenceInfo {
  state: LicenceState
  kind: 'full' | 'trial' | null
  shopName: string
  plan: string
  /** Cloud backup or Local-only */
  mode: 'cloud' | 'local' | null
  counters: number
  /** YYYY-MM-DD, inclusive */
  expires: string | null
  daysLeft: number | null
  /** days since the server last confirmed the licence; null for a licence activated with a code */
  checkedDaysAgo: number | null
  staleCheck: boolean
  /** short id of this PC, shown so support can match it in the admin portal */
  machine: string
  /** developer bypass (MARS_SKIP_LICENCE=1): the app opens although there is no licence */
  skip: boolean
  /** what is wrong, when state is 'invalid' */
  problem?: string
}

/** The licence as signed by MARS (the admin portal or scripts/licence.ts). */
export interface LicencePayload {
  v: 1
  key: string
  /** full id of the PC it is bound to */
  machine: string
  shop: string
  plan: string
  mode: 'cloud' | 'local'
  counters: number
  kind: 'full' | 'trial'
  /** YYYY-MM-DD, inclusive */
  expires: string
  issued: string
}

export const KEY_RE = /^MARS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
export const normaliseKey = (k: string): string => k.trim().toUpperCase().replace(/\s+/g, '')

export const KEY_MSG = 'The activation key looks like MARS-XXXX-XXXX-XXXX (letters and numbers).'

/** Types the dashes for the owner: "mars7k2q9xfd4lpa" or a pasted key becomes MARS-7K2Q-9XFD-4LPA. Never longer than a key. */
export function formatKey(raw: string): string {
  let t = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (t.startsWith('MARS')) t = t.slice(4)
  t = t.slice(0, 12)
  if (!t) return ''
  return 'MARS-' + (t.match(/.{1,4}/g) ?? []).join('-')
}

/**
 * What is wrong with text pasted as the response code, or '' when it looks right. Shape only; the signature is checked in the main process.
 * A full code is `MARSL1.<details>.<signature>`; the request code the PC shows itself starts with MARSR1 and has no signature.
 */
export function responseCodeProblem(text: string): string {
  const t = String(text ?? '').trim().replace(/\s+/g, '')
  if (!t) return ''
  if (t.startsWith('MARSR1')) return 'This is the request code that this PC made. Send it to MARS support, then paste the response code they send back.'
  if (!t.startsWith('MARSL1.')) return 'The response code starts with MARSL1. Check that you pasted the code MARS support sent.'
  if (t.split('.').length !== 3 || !t.split('.')[2]) return 'This code is incomplete. A response code has three parts separated by dots; copy all of it.'
  return ''
}
