import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { hostname, networkInterfaces, platform } from 'node:os'
import { getDb } from '../db'
import { checkMobile } from '@shared/mobile'
import {
  EXPIRY_WARN_DAYS, KEY_MSG, KEY_RE, STALE_CHECK_DAYS, TRIAL_WARN_DAYS, responseCodeProblem, normaliseKey, type LicenceInfo, type LicencePayload
} from '@shared/licence'
import { audit } from './auth'
import { LICENCE_PUBLIC_KEYS } from './licenceKey'
import { getSetting } from './settings'

/**
 * Activation and licence. A licence is a token signed by MARS: `MARSL1.<payload>.<signature>`. It reaches the PC in one
 * of two ways, and both end in `saveToken`, so there is one verifier:
 *   - online: the licence server returns it after the key + mobile are checked;
 *   - offline: the PC shows a request code, support signs a response code, the owner types it in.
 * The licence is bound to this PC (`machineId`). An expired licence blocks the whole application until it is renewed; nothing is ever deleted.
 */

const DAY = 864e5
const CHECK_EVERY = 60_000 // only a check made in the last minute is skipped, so every restart picks up changes made by MARS
let machineOverride: string | null = null
let serverUrl = ''
let publicKeys: readonly string[] = LICENCE_PUBLIC_KEYS
export const setMachineIdForTests = (m: string | null): void => { machineOverride = m }
export const setPublicKeyForTests = (k: string | null): void => { publicKeys = k ? [k] : LICENCE_PUBLIC_KEYS }
export const setLicenceServer = (url: string): void => { serverUrl = url.trim().replace(/\/+$/, '') }

const put = (key: string, value: unknown): void => {
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))
}

/** Stable for this PC: hostname + OS + first real network adapter. Not secret; it only ties a licence to one machine. */
/**
 * This PC's id. On Windows it comes from the Windows installation id (MachineGuid), which stays the same through restarts,
 * network changes, VPNs and renaming the PC; it changes only when Windows is reinstalled.
 * (It used to come from the first network adapter, but a virtual adapter such as Hyper-V's "Default Switch" can come first and
 * change its address on a restart, so the PC "became another PC" and the licence stopped working.)
 */
let cachedId: string | null = null
export function machineId(): string {
  if (machineOverride) return machineOverride
  return (cachedId ??= computeMachineId())
}
function computeMachineId(): string {
  const guid = windowsMachineGuid()
  if (guid) return createHash('sha256').update(`win-guid|${guid.toLowerCase()}`).digest('hex').slice(0, 32).toUpperCase()
  // other systems (development only): the physical adapters' addresses, sorted, so their order does not matter
  const macs = [...new Set(Object.values(networkInterfaces()).flat().filter((n) => n && !n.internal && n.mac !== '00:00:00:00:00:00').map((n) => n!.mac))].sort()
  return createHash('sha256').update(`${hostname()}|${platform()}|${macs.join(',')}`).digest('hex').slice(0, 32).toUpperCase()
}
function windowsMachineGuid(): string | null {
  if (platform() !== 'win32') return null
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    return /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(out)?.[1] ?? null
  } catch { return null }
}
const shortId = (m: string): string => m.slice(0, 4) + '-' + m.slice(4, 8) + '-' + m.slice(8, 12)

const b64u = (s: string | Buffer): string => Buffer.from(s).toString('base64url')
const mobile10 = (mobile: string): string => checkMobile(mobile)
const validKey = (key: string): string => {
  const k = normaliseKey(key)
  if (!KEY_RE.test(k)) throw new Error(KEY_MSG)
  return k
}

/** Checks the signature and the shape. Throws a readable message; never trusts the payload before the signature passes. */
export function verifyToken(token: string): LicencePayload {
  const parts = String(token ?? '').trim().replace(/\s+/g, '').split('.')
  const shape = responseCodeProblem(parts.join('.'))
  if (shape) throw new Error(shape)
  if (parts.length !== 3 || parts[0] !== 'MARSL1') throw new Error('This is not a MARS licence code. Check that you copied all of it.')
  let ok = false
  try {
    ok = publicKeys.some((k) => verify(null, Buffer.from(parts[1]!, 'base64url'), createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), Buffer.from(parts[2]!, 'base64url')))
  } catch { ok = false }
  if (!ok) throw new Error('This code is not valid. Check that you copied all of it, or ask MARS support for a new one.')
  let p: LicencePayload
  try { p = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as LicencePayload } catch { throw new Error('This code is damaged. Ask MARS support for a new one.') }
  if (p.v !== 1 || !KEY_RE.test(p.key) || !/^\d{4}-\d{2}-\d{2}$/.test(p.expires) || !p.machine) throw new Error('This code is damaged. Ask MARS support for a new one.')
  return p
}

interface Saved { token: string; via: 'online' | 'code'; at: string; checkedAt: string | null }
const saved = (): Saved | null => getSetting<Saved | null>('licence', null)

function expiryEnd(expires: string): number {
  const [y, m, d] = expires.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
}

const EMPTY = (machine: string): Omit<LicenceInfo, 'skip'> => ({
  state: 'none', kind: null, shopName: '', plan: '', mode: null, counters: 0, expires: null, daysLeft: null, checkedDaysAgo: null, staleCheck: false, machine
})

export const licenceStatus = (now = Date.now()): LicenceInfo => ({ ...compute(now), skip: skipped() })

function compute(now: number): Omit<LicenceInfo, 'skip'> {
  const machine = shortId(machineId())
  const s = saved()
  if (!s) return EMPTY(machine)
  let p: LicencePayload
  try { p = verifyToken(s.token) } catch (e) {
    return { ...EMPTY(machine), state: 'invalid', problem: e instanceof Error ? e.message : 'The licence is not valid.' }
  }
  const base = { kind: p.kind, shopName: p.shop, plan: p.plan, mode: p.mode, counters: p.counters, expires: p.expires, machine }
  if (p.machine !== machineId()) return { ...EMPTY(machine), ...base, state: 'invalid', problem: 'This licence belongs to another PC. Ask MARS support to release it, then activate again.' }
  const end = expiryEnd(p.expires)
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const daysLeft = Math.max(0, Math.round((new Date(end).setHours(0, 0, 0, 0) - startOfToday) / DAY)) // calendar days; 0 = last day
  const checkedDaysAgo = s.via === 'online' && s.checkedAt ? Math.floor((now - new Date(s.checkedAt).getTime()) / DAY) : null
  const info = { ...base, daysLeft, checkedDaysAgo, staleCheck: checkedDaysAgo !== null && checkedDaysAgo >= STALE_CHECK_DAYS }
  if (now > end) return { ...info, state: 'expired', daysLeft: 0 }
  return { ...info, state: daysLeft <= (p.kind === 'trial' ? TRIAL_WARN_DAYS : EXPIRY_WARN_DAYS) ? 'expiring' : 'active' }
}

/** Developers can skip activation: MARS_SKIP_LICENCE=1. Never set on a shop PC. */
const skipped = (): boolean => process.env['MARS_SKIP_LICENCE'] === '1'

/** The application only works on an activated PC with a licence that has not expired. Everything but the licence screens asks this first (ipc.ts). */
export function assertActivated(): void {
  if (skipped()) return
  const st = licenceStatus().state
  if (st === 'none' || st === 'invalid') throw new Error('Activate this PC first.')
  if (st === 'expired') throw new Error('The licence has expired. Enter a renewal code or call MARS support. Your data is safe.')
}

/** Second lock for new bills, in case a call reaches billing without the gate above. Only an expired licence stops it here; activation is the gate's job. */
export function assertCanSell(): void {
  if (skipped()) return
  if (licenceStatus().state === 'expired') throw new Error('The licence has expired. Enter a renewal code or call MARS support. Your data is safe.')
}

function saveToken(token: string, via: Saved['via']): LicenceInfo {
  const p = verifyToken(token)
  if (p.machine !== machineId()) throw new Error('This code was made for a different PC. Send MARS support the request code shown on this PC and use the code they send back.')
  const prev = saved()
  if (prev) {
    let prevKey: string | null = null
    try { prevKey = verifyToken(prev.token).key } catch { /* an invalid old licence can be replaced by anything valid */ }
    if (prevKey && prevKey !== p.key) throw new Error('This code is for a different activation key.')
  }
  const now = new Date().toISOString()
  put('licence', { token: token.trim().replace(/\s+/g, ''), via, at: prev?.at ?? now, checkedAt: via === 'online' ? now : null } satisfies Saved)
  audit(null, 'licence_activated', { key: p.key, expires: p.expires, via, kind: p.kind })
  return licenceStatus()
}

/* ---------- offline: request code -> response code ---------- */

/** Step 1 with no internet: the code the owner sends to support. */
export function requestCode(key: string, mobile: string): string {
  return 'MARSR1.' + b64u(JSON.stringify({ key: validKey(key), machine: machineId(), mobile: mobile10(mobile) }))
}

/** Reads a request code (support side: the admin portal and scripts/licence.ts). */
export function parseRequestCode(code: string): { key: string; machine: string; mobile: string } {
  const [tag, body] = String(code ?? '').trim().replace(/\s+/g, '').split('.')
  if (tag !== 'MARSR1' || !body) throw new Error('This is not a request code.')
  let r: { key: string; machine: string; mobile: string }
  try { r = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof r } catch { throw new Error('This request code is damaged.') }
  if (!KEY_RE.test(r.key) || !r.machine) throw new Error('This request code is damaged.')
  return r
}

/** Step 3 with no internet: the owner types the response code. Also used to renew. */
export function activateWithCode(code: string): LicenceInfo {
  return saveToken(code, 'code')
}

/* ---------- online ---------- */

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!serverUrl) throw new Error('This PC is not set up to reach the MARS licence server. Use "No internet? Activate with a code" instead.')
  let res: Response
  try {
    res = await fetch(serverUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  } catch {
    // a development run talks to the local test server: say that, instead of blaming the internet
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(serverUrl + '/')) throw new Error(`Could not reach the MARS server. The local MARS server (${serverUrl}) is not running: start the admin portal ("npm run dev" in mars-admin-portal).`)
    throw new Error('Could not reach the MARS server. Check the internet, or use "No internet? Activate with a code".')
  }
  const j = (await res.json().catch(() => ({}))) as { licence?: string; error?: string } & T
  if (!res.ok) throw new Error(j.error || 'The MARS server did not accept this. Check the key and mobile number.')
  return j
}

export const NO_INTERNET = 'No internet connection. Connect to the internet to reset your PIN, then try again.'

/**
 * A call to the MARS server for the signed-in-by-licence features (PIN reset). Identity is the licence key + this PC's id, which the caller adds.
 * Unlike `post`, a failure to connect is reported as "no internet" and nothing is retried here.
 */
export async function serverRequest<T>(method: 'GET' | 'POST', path: string, payload: Record<string, unknown>): Promise<T> {
  if (!serverUrl) throw new Error('This PC is not set up to reach the MARS server. Contact MARS support.')
  const qs = method === 'GET' ? '?' + new URLSearchParams(Object.entries(payload).map(([k, v]) => [k, String(v)])).toString() : ''
  let res: Response
  try {
    res = await fetch(serverUrl + path + qs, {
      method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(15_000)
    })
  } catch {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(serverUrl + '/')) throw new Error(`The local MARS server (${serverUrl}) is not running: start the admin portal ("npm run dev" in mars-admin-portal).`)
    throw new Error(NO_INTERNET)
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(j.error || 'The MARS server could not do this. Try again in a moment.')
  return j
}

/** The licence key and PC id that identify this shop to the server. Needs an activated licence. */
export function licenceIdentity(notActivated = 'This PC is not activated, so the PIN cannot be reset online.'): { key: string; machine: string } {
  const s = saved()
  if (!s) throw new Error(notActivated)
  return { key: verifyToken(s.token).key, machine: machineId() }
}

export async function activateOnline(key: string, mobile: string): Promise<LicenceInfo> {
  const r = await post<{ licence: string }>('/v1/activate', { key: validKey(key), mobile: mobile10(mobile), machine: machineId() })
  return saveToken(r.licence ?? '', 'online')
}

/** Free trial: the server texts a one-time code to the mobile (this is also how MARS gets the sales lead). */
export async function trialSendOtp(mobile: string): Promise<true> {
  await post('/v1/trial/otp', { mobile: mobile10(mobile), machine: machineId() })
  return true
}
export async function trialVerify(mobile: string, otp: string, shop: string): Promise<LicenceInfo> {
  const m = mobile10(mobile)
  if (!/^\d{4,8}$/.test(String(otp ?? '').trim())) throw new Error('Type the code that was sent to the mobile.')
  const r = await post<{ licence: string }>('/v1/trial/verify', { mobile: m, otp: String(otp).trim(), shop: String(shop ?? '').trim().slice(0, 80), machine: machineId() })
  return saveToken(r.licence ?? '', 'online')
}

/** At every start and every 6 hours while online: pick up renewals and changes made by MARS (plan, online / offline mode), and tell the server we are alive. Never blocks billing. */
export async function refreshLicence(force = false): Promise<LicenceInfo> {
  const s = saved()
  if (!s || !serverUrl) return licenceStatus()
  if (!force && s.checkedAt && Date.now() - new Date(s.checkedAt).getTime() < CHECK_EVERY) return licenceStatus()
  try {
    const key = verifyToken(s.token).key
    const r = await post<{ licence?: string }>('/v1/refresh', { key, machine: machineId() })
    if (r.licence) return saveToken(r.licence, 'online')
    put('licence', { ...s, checkedAt: new Date().toISOString() })
  } catch (e) { if (force) throw e }
  return licenceStatus()
}
