import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { MongoClient, type Db } from 'mongodb'
import { createTransport } from 'nodemailer'
import type { LicencePayload } from '@shared/licence'
import { hashPin, isWeakPin } from '../services/pin'
import { signLicence } from '../services/licenceSign'
import { pinChangedEmail, pinResetEmail, type Email } from './emailTemplates'
import { RESET_PAGE } from './page'

/**
 * DEVELOPMENT ONLY. Stands in for the MARS admin portal so the desktop app can be tried without starting it:
 * the same addresses (/v1/activate, /v1/refresh, /v1/pin-reset/*), the same MongoDB, the same emails. It reads its secrets (MongoDB link, SMTP login,
 * licence signing key) from `.local-server/` in this project, which is git-ignored and not part of the installer. An installed app never
 * loads this file (index.ts only imports it when the app is not packaged), so shop PCs never hold these secrets.
 * The reset link in the email opens a small page served from here (http://127.0.0.1:4150/reset-pin), so it works on this PC only.
 */

const PORT = Number(process.env['MARS_DEV_SERVER_PORT']) || 4150 // another port only to try a second copy beside a running app
const RESET_MINUTES = 15
const MAX_SENDS = 4
const MAX_EMAILS_PER_HOUR = 5
const HOUR = 3_600_000
const NOT_ACTIVATED = 'This PC is not activated with MARS. Contact MARS support.'
const BAD_KEY = 'The activation key or the mobile number is not valid. Check both and try again.'
const DEAD_LINK = 'This link has expired or was already used. Open Mars Cosmos on the shop PC and tap Forgot PIN again.'
const KEY_RE = /^MARS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
interface Local { mongoUri: string; mongoDb: string; smtpUrl: string; smtpFrom: string; secret: string; privatePem: string }

export function loadLocalConfig(root: string): Local | null {
  const dir = join(root, '.local-server')
  if (!existsSync(join(dir, '.env')) || !existsSync(join(dir, 'licence-private.pem'))) return null
  const env = Object.fromEntries(readFileSync(join(dir, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  if (!env['MONGODB_URI']) return null
  return {
    mongoUri: env['MONGODB_URI'], mongoDb: env['MONGODB_DB'] || 'mars_cosmos', smtpUrl: env['SMTP_URL'] ?? '', smtpFrom: env['SMTP_FROM'] || 'MARS Cosmos <no-reply@example.com>',
    secret: env['OTP_SECRET'] || randomBytes(32).toString('hex'), privatePem: readFileSync(join(dir, 'licence-private.pem'), 'utf8')
  }
}

const maskEmail = (email: string): string => {
  const [local = '', domain = ''] = email.split('@')
  return `${local.length > 2 ? local.slice(0, 2) : local.slice(0, 1)}•••@${domain}`
}
const hashToken = (secret: string, token: string): string => createHmac('sha256', secret).update('pin-reset\n' + token).digest('base64url')
const ymd = (d: Date): string => d.toISOString().slice(0, 10)
function licenceDates(days: number, now: Date): { issued: string; expires: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days - 1))
  return { issued: ymd(now), expires: ymd(end) }
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }

export async function startDevServer(root: string, log: (m: string) => void = console.log): Promise<{ url: string; close: () => Promise<void> } | null> {
  const cfg = loadLocalConfig(root)
  if (!cfg) return null
  const client = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 10_000 })
  let dbPromise: Promise<Db> | null = null
  const db = (): Promise<Db> => (dbPromise ??= client.connect().then(() => client.db(cfg.mongoDb)).catch((e) => { dbPromise = null; throw e }))
  const mail = cfg.smtpUrl ? createTransport(cfg.smtpUrl) : null
  const baseUrl = `http://127.0.0.1:${PORT}`

  const sendMail = async (to: string, m: Email): Promise<void> => {
    if (!mail) return log(`[dev server] email to ${maskEmail(to)}: ${m.subject}\n${m.text}`) // no SMTP login: print instead
    await mail.sendMail({ from: cfg.smtpFrom, to, subject: m.subject, text: m.text, html: m.html })
  }

  /** The shop and owner behind a licence key, only for the PC the key was activated on. */
  async function identify(d: Db, key: string, machine: string) {
    const k = await d.collection('activation_keys').findOne({ key })
    if (!k || k['status'] !== 'activated' || k['machineId'] !== machine) return null
    const tenantId = k['tenantId'] as string
    const shop = await d.collection('shops').findOne({ tenantId })
    const owner = await d.collection('owners').findOne({ tenantId })
    return shop && owner ? { tenantId, shop, owner } : null
  }
  const audit = (d: Db, tenantId: string, action: string, details: Doc = {}) => d.collection('audit_log').insertOne({ tenantId, action, at: new Date(), details })
  const identity = (src: Doc): { key: string; machine: string } => {
    const key = String(src['key'] ?? '').trim().toUpperCase()
    const machine = String(src['machine'] ?? '').trim()
    if (!KEY_RE.test(key) || machine.length < 8 || machine.length > 128) throw new HttpError(400, NOT_ACTIVATED)
    return { key, machine }
  }

  /* ---------- activation ---------- */
  async function activate(b: Doc): Promise<Doc> {
    const d = await db()
    const key = String(b['key'] ?? '').trim().toUpperCase().replace(/\s+/g, '')
    const mobile = String(b['mobile'] ?? '').replace(/\D/g, '').slice(-10)
    const machine = String(b['machine'] ?? '').trim()
    if (!KEY_RE.test(key) || !/^[6-9]\d{9}$/.test(mobile) || machine.length < 8) throw new HttpError(400, BAD_KEY)
    const keys = d.collection('activation_keys')
    const doc = await keys.findOne({ key })
    if (!doc) throw new HttpError(400, BAD_KEY)
    if (doc['status'] === 'revoked') throw new HttpError(403, 'This activation key has been cancelled. Contact MARS support.')
    if ((doc['failedAttempts'] ?? 0) >= 10) throw new HttpError(429, 'Too many wrong attempts with this key. Contact MARS support.')
    if (doc['mobile'] !== mobile) { await keys.updateOne({ key }, { $inc: { failedAttempts: 1 } }); throw new HttpError(400, BAD_KEY) }
    const now = new Date()
    if (doc['status'] === 'issued' && doc['expiresAt'] && doc['expiresAt'] <= now) throw new HttpError(410, 'This activation key has expired. Ask MARS support for a new one.')
    if (doc['status'] === 'activated' && doc['machineId'] !== machine) throw new HttpError(409, 'This key is already activated on another PC. Contact MARS support to move it.')
    const tenantId = doc['tenantId'] as string
    const shop = await d.collection('shops').findOne({ tenantId })
    const owner = await d.collection('owners').findOne({ tenantId })
    if (!shop || !owner) throw new HttpError(500, 'This shop record is incomplete. Contact MARS support.')
    if (shop['status'] === 'suspended') throw new HttpError(403, 'This shop is suspended. Contact MARS support.')

    let { licenceIssued, licenceExpires } = doc as { licenceIssued?: string; licenceExpires?: string }
    if (doc['status'] === 'issued') {
      const dates = licenceDates(doc['licenceDays'] ?? 365, now)
      const claimed = await keys.findOneAndUpdate({ key, status: 'issued' }, { $set: { status: 'activated', activatedAt: now, machineId: machine, licenceIssued: dates.issued, licenceExpires: dates.expires } })
      if (!claimed) throw new HttpError(409, 'This key was just activated on another PC. Contact MARS support.')
      licenceIssued = dates.issued; licenceExpires = dates.expires
      await d.collection('shops').updateOne({ tenantId }, { $set: { status: 'active', updatedAt: now } })
      await audit(d, tenantId, 'licence_activated', { key: key.slice(0, 9) + '••••-••••' })
    }
    await d.collection('devices').updateOne({ tenantId, machineId: machine }, { $set: { key, lastCheckAt: now }, $setOnInsert: { activatedAt: now } }, { upsert: true })
    const payload: LicencePayload = {
      v: 1, key, machine, shop: shop['name'], plan: shop['plan'], mode: shop['mode'], counters: shop['counters'] ?? 1, kind: 'full', expires: licenceExpires!, issued: licenceIssued!
    }
    return { licence: signLicence(payload, cfg!.privatePem) }
  }

  /* ---------- check-in: a fresh licence from what MongoDB holds now (renewals, plan changes) ---------- */
  async function refresh(b: Doc): Promise<Doc> {
    const d = await db()
    const { key, machine } = identity(b)
    const doc = await d.collection('activation_keys').findOne({ key })
    if (!doc) throw new HttpError(403, NOT_ACTIVATED)
    if (doc['status'] === 'revoked') throw new HttpError(403, 'This licence has been cancelled. Contact MARS support.')
    if (doc['status'] !== 'activated' || doc['machineId'] !== machine) throw new HttpError(403, 'This licence belongs to another PC. Contact MARS support.')
    if (!doc['licenceIssued'] || !doc['licenceExpires']) throw new HttpError(500, 'This licence record is incomplete. Contact MARS support.')
    const tenantId = doc['tenantId'] as string
    const shop = await d.collection('shops').findOne({ tenantId })
    if (!shop) throw new HttpError(500, 'This shop record is incomplete. Contact MARS support.')
    if (shop['status'] === 'suspended') throw new HttpError(403, 'This shop is suspended. Contact MARS support.')
    const now = new Date()
    await d.collection('devices').updateOne({ tenantId, machineId: machine }, { $set: { key, lastCheckAt: now }, $setOnInsert: { activatedAt: now } }, { upsert: true })
    const payload: LicencePayload = {
      v: 1, key, machine, shop: shop['name'], plan: shop['plan'], mode: shop['mode'], counters: shop['counters'] ?? 1, kind: 'full', expires: doc['licenceExpires'], issued: doc['licenceIssued']
    }
    return { licence: signLicence(payload, cfg!.privatePem), expires: doc['licenceExpires'] }
  }

  /* ---------- owner forgot PIN ---------- */
  async function pinRequest(b: Doc): Promise<Doc> {
    const d = await db()
    const { key, machine } = identity(b)
    const who = await identify(d, key, machine)
    if (!who) throw new HttpError(403, NOT_ACTIVATED)
    if (who.shop['status'] === 'suspended') throw new HttpError(403, 'This shop is suspended. Contact MARS support.')
    const { tenantId } = who
    const pins = d.collection('pin_resets')
    const now = new Date()
    const recent = await d.collection('audit_log').countDocuments({ tenantId, action: 'pin_reset_email_sent', at: { $gt: new Date(now.getTime() - HOUR) } })
    if (recent >= MAX_EMAILS_PER_HOUR) throw new HttpError(429, 'Too many reset emails for this shop. Try again in an hour.')

    const token = randomBytes(32).toString('base64url')
    const tokenHash = hashToken(cfg!.secret, token)
    const expiresAt = new Date(now.getTime() + RESET_MINUTES * 60_000)
    const resetId = String(b['resetId'] ?? '')
    let id: string
    if (b['resend'] && /^[0-9a-f]{24}$/.test(resetId)) {
      const cur = await pins.findOne({ resetId, tenantId, machineId: machine, status: 'pending', expiresAt: { $gt: now } })
      if (!cur) throw new HttpError(400, 'This reset is no longer open. Start the PIN reset again.')
      if ((cur['sendCount'] ?? 1) >= MAX_SENDS) throw new HttpError(429, 'The email was already sent three times. Check the inbox and the spam folder, or try again later.')
      await pins.updateOne({ resetId }, { $set: { tokenHash, expiresAt, lastSentAt: now }, $inc: { sendCount: 1 } })
      id = resetId
    } else {
      await pins.updateMany({ tenantId, status: 'pending' }, { $set: { status: 'expired' } }) // an older link stops working
      id = randomBytes(12).toString('hex')
      await pins.insertOne({ resetId: id, tenantId, tokenHash, machineId: machine, status: 'pending', sendCount: 1, expiresAt, lastSentAt: now, createdAt: now })
    }
    const email = String(who.owner['email'])
    try {
      await sendMail(email, pinResetEmail(String(who.shop['name']), `${baseUrl}/reset-pin?token=${token}`, RESET_MINUTES))
    } catch (e) {
      log(`[dev server] reset email failed: ${e instanceof Error ? e.message : e}`)
      await pins.updateOne({ resetId: id }, { $set: { status: 'expired' } })
      throw new HttpError(502, 'The email could not be sent. Try again in a moment.')
    }
    await audit(d, tenantId, 'pin_reset_email_sent', { resend: !!b['resend'] })
    return { resetId: id, emailHint: maskEmail(email), expiresInSec: RESET_MINUTES * 60 }
  }

  async function pinValidate(q: URLSearchParams): Promise<Doc> {
    const d = await db()
    const token = q.get('token') ?? ''
    const doc = token.length >= 20 ? await d.collection('pin_resets').findOne({ tokenHash: hashToken(cfg!.secret, token), status: 'pending', expiresAt: { $gt: new Date() } }) : null
    if (!doc) throw new HttpError(410, DEAD_LINK)
    const shop = await d.collection('shops').findOne({ tenantId: doc['tenantId'] })
    return { shop: shop?.['name'] ?? '', minutesLeft: Math.max(1, Math.ceil((doc['expiresAt'].getTime() - Date.now()) / 60_000)) }
  }

  async function pinComplete(b: Doc): Promise<Doc> {
    const d = await db()
    const token = String(b['token'] ?? '')
    const pin = String(b['pin'] ?? '')
    if (token.length < 20) throw new HttpError(410, DEAD_LINK)
    if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'Exactly 4 digits.')
    if (isWeakPin(pin) || ['4321', '0123', '1212'].includes(pin)) throw new HttpError(400, 'Not an easy PIN like 1111, 1234 or 0000.')
    const newPinHash = hashPin(pin)
    const now = new Date()
    // single use: the first request to flip pending -> ready wins
    const doc = await d.collection('pin_resets').findOneAndUpdate({ tokenHash: hashToken(cfg!.secret, token), status: 'pending', expiresAt: { $gt: now } }, { $set: { status: 'ready', usedAt: now, newPinHash } })
    if (!doc) throw new HttpError(410, DEAD_LINK)
    const tenantId = doc['tenantId'] as string
    await d.collection('owners').updateOne({ tenantId }, { $set: { pinHash: newPinHash, pinUpdatedAt: now, updatedAt: now } })
    await audit(d, tenantId, 'pin_reset_completed')
    const owner = await d.collection('owners').findOne({ tenantId })
    const shop = await d.collection('shops').findOne({ tenantId })
    if (owner) await sendMail(String(owner['email']), pinChangedEmail(String(shop?.['name'] ?? 'your shop'))).catch((e: unknown) => log(`[dev server] PIN changed email failed: ${e instanceof Error ? e.message : e}`))
    return { ok: true }
  }

  async function pinStatus(q: URLSearchParams): Promise<Doc> {
    const d = await db()
    const { key, machine } = identity(Object.fromEntries(q))
    const resetId = q.get('resetId') ?? ''
    if (!/^[0-9a-f]{24}$/.test(resetId)) throw new HttpError(400, NOT_ACTIVATED)
    const who = await identify(d, key, machine)
    if (!who) throw new HttpError(403, NOT_ACTIVATED)
    const doc = await d.collection('pin_resets').findOne({ resetId, tenantId: who.tenantId, machineId: machine })
    if (!doc) return { status: 'expired' }
    if (doc['status'] === 'ready') return { status: 'ready', pinHash: doc['newPinHash'] }
    return doc['status'] === 'pending' && doc['expiresAt'] > new Date() ? { status: 'waiting' } : { status: 'expired' }
  }

  async function pinApplied(b: Doc): Promise<Doc> {
    const d = await db()
    const { key, machine } = identity(b)
    const resetId = String(b['resetId'] ?? '')
    const who = await identify(d, key, machine)
    if (!who) throw new HttpError(403, NOT_ACTIVATED)
    const r = await d.collection('pin_resets').updateOne({ resetId, tenantId: who.tenantId, machineId: machine, status: 'ready' }, { $set: { status: 'applied', appliedAt: new Date() }, $unset: { newPinHash: '' } })
    if (r.matchedCount) await audit(d, who.tenantId, 'pin_reset_applied', { machineId: machine })
    return { ok: true }
  }

  /* ---------- HTTP ---------- */
  const readJson = (req: IncomingMessage): Promise<Doc> => new Promise((resolve) => {
    let raw = ''
    req.on('data', (c: Buffer) => { raw += c.toString(); if (raw.length > 100_000) req.destroy() })
    req.on('end', () => { try { resolve(raw ? (JSON.parse(raw) as Doc) : {}) } catch { resolve({}) } })
  })
  const send = (res: ServerResponse, code: number, body: unknown, type = 'application/json'): void => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', baseUrl)
      try {
        if (req.method === 'GET' && u.pathname === '/reset-pin') return send(res, 200, RESET_PAGE, 'text/html; charset=utf-8')
        if (req.method === 'POST' && u.pathname === '/v1/activate') return send(res, 200, await activate(await readJson(req)))
        if (req.method === 'POST' && u.pathname === '/v1/refresh') return send(res, 200, await refresh(await readJson(req)))
        if (req.method === 'POST' && u.pathname === '/v1/pin-reset/request') return send(res, 200, await pinRequest(await readJson(req)))
        if (req.method === 'GET' && u.pathname === '/v1/pin-reset/validate') return send(res, 200, await pinValidate(u.searchParams))
        if (req.method === 'POST' && u.pathname === '/v1/pin-reset/complete') return send(res, 200, await pinComplete(await readJson(req)))
        if (req.method === 'GET' && u.pathname === '/v1/pin-reset/status') return send(res, 200, await pinStatus(u.searchParams))
        if (req.method === 'POST' && u.pathname === '/v1/pin-reset/applied') return send(res, 200, await pinApplied(await readJson(req)))
        return send(res, 404, { error: 'This address is not available in the development server.' })
      } catch (e) {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message })
        log(`[dev server] ${u.pathname}: ${e instanceof Error ? e.message : e}`)
        return send(res, 503, { error: 'The MARS database could not be reached. Check the internet and try again.' })
      }
    })()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve) })
  log(`[dev server] standing in for the MARS portal on ${baseUrl} (MongoDB ${cfg.mongoDb})`)
  return { url: baseUrl, close: async () => { server.close(); await client.close().catch(() => undefined) } }
}
