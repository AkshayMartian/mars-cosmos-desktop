import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { monthDayOf } from '@shared/birthdate'
import { todayMonthDay } from '@shared/dates'
import { WA_DEFAULTS, type WaOutboxRow, type WaRunResult, type WaSaveInput, type WaSettings, type WaTemplate, type WishKind } from '@shared/whatsapp'
import { audit } from './auth'
import { requireRole } from './session'
import { getSetting } from './settings'
import { decryptSecret, encryptSecret } from './waSecret'

/**
 * Birthday and anniversary wishes sent by themselves through the official WhatsApp Business (Cloud) API.
 * Flow: each day, once the PC clock passes the send hour, every customer whose birthday / anniversary is today and who
 * agreed to offers and wishes is put in `wa_outbox` (one row per customer, kind and year, so never twice). The outbox is
 * then sent. With no internet or a temporary error the row stays queued and is tried again later (up to 5 tries over a
 * day or so); a permanent error (bad number, template not approved) marks it failed with Meta's reason.
 * The app is offline-first, so nothing here may stop billing: every network problem is caught and recorded.
 */

const API = 'https://graph.facebook.com/v21.0'
const MAX_TRIES = 5
const RETRY_MS = 30 * 60_000

interface Stored { on: boolean; phoneNumberId: string; token: string; birthday: WaTemplate; anniversary: WaTemplate; sendHour: number }
const DEFAULT: Stored = { on: false, phoneNumberId: '', token: '', ...WA_DEFAULTS }

const load = (): Stored => ({ ...DEFAULT, ...getSetting<Partial<Stored>>('whatsapp', {}) })
const put = (v: Stored): void => {
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('whatsapp', JSON.stringify(v))
}
const clean = (v: unknown, max = 80): string => String(v ?? '').trim().slice(0, max)

export function getWaSettings(): WaSettings {
  requireRole('owner')
  const s = load()
  return { on: s.on, phoneNumberId: s.phoneNumberId, hasToken: !!s.token, birthday: s.birthday, anniversary: s.anniversary, sendHour: s.sendHour }
}

export function saveWaSettings(i: WaSaveInput): WaSettings {
  const a = requireRole('owner')
  const old = load()
  const tpl = (t: WaTemplate, what: string): WaTemplate => {
    const name = clean(t?.name, 100)
    const language = clean(t?.language, 12) || 'en'
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`The ${what} template name can only have small letters, digits and underscores, as approved in Meta.`)
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) throw new Error(`The ${what} template language looks wrong (examples: en, en_US, hi).`)
    return { name, language }
  }
  const sendHour = Math.trunc(Number(i.sendHour))
  if (!Number.isFinite(sendHour) || sendHour < 0 || sendHour > 23) throw new Error('Send hour must be between 0 and 23.')
  const phoneNumberId = clean(i.phoneNumberId, 40)
  if (phoneNumberId && !/^\d{6,25}$/.test(phoneNumberId)) throw new Error('Phone number ID is digits only (copy it from Meta WhatsApp Manager).')
  const typed = clean(i.accessToken, 1000)
  const token = typed ? encryptSecret(typed) : old.token
  if (i.on && (!phoneNumberId || !token)) throw new Error('Enter the phone number ID and the access token before turning this on.')
  put({ on: !!i.on, phoneNumberId, token, birthday: tpl(i.birthday, 'birthday'), anniversary: tpl(i.anniversary, 'anniversary'), sendHour })
  audit(a.id, 'settings_change', { key: 'whatsapp' })
  return getWaSettings()
}

/* ---------- sending one template message ---------- */

class Permanent extends Error {}

async function sendTemplate(f: typeof fetch, s: Stored, tpl: WaTemplate, mobile: string, params: string[]): Promise<string> {
  let res: Response
  try {
    res = await f(`${API}/${s.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${decryptSecret(s.token)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: `91${mobile}`, type: 'template',
        template: { name: tpl.name, language: { code: tpl.language }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] }
      }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'No internet') // temporary: retried later
  }
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } }
  if (res.ok) return body.messages?.[0]?.id ?? ''
  const why = body.error?.message ?? `HTTP ${res.status}`
  if (res.status === 429 || res.status >= 500) throw new Error(why) // Meta busy: retried later
  throw new Permanent(why) // wrong number, template not approved, token no longer valid...
}

const shopName = (): string => getSetting<{ name?: string }>('shop', {}).name || 'our shop'

/** Owner sends one test wish to a number, to check the credentials and the approved template before going live. */
export async function sendWaTest(mobile: string, kind: WishKind, f: typeof fetch = fetch): Promise<true> {
  requireRole('owner')
  const s = load()
  if (!s.phoneNumberId || !s.token) throw new Error('Save the phone number ID and access token first.')
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new Error('Enter a valid Indian mobile number: 10 digits starting with 6, 7, 8 or 9.')
  try {
    await sendTemplate(f, s, s[kind], mobile, ['Test', shopName()])
  } catch (e) {
    throw new Error(`WhatsApp did not accept it: ${e instanceof Error ? e.message : 'unknown error'}`)
  }
  return true
}

/* ---------- the daily job ---------- */

/** Customers with a birthday / anniversary today who agreed to offers and wishes. Queued once per year. */
export function queueTodaysWishes(now = new Date()): number {
  const db = getDb()
  const md = todayMonthDay()
  const rows = db
    .prepare('SELECT id,name,mobile,birthday,anniversary FROM customers WHERE deleted_at IS NULL AND mobile IS NOT NULL AND offers_consent=1 AND (substr(birthday,-5)=? OR substr(anniversary,-5)=?)')
    .all(md, md) as { id: string; name: string; mobile: string; birthday: string | null; anniversary: string | null }[]
  const ins = db.prepare("INSERT OR IGNORE INTO wa_outbox (id,kind,customer_id,name,mobile,year,status,at) VALUES (?,?,?,?,?,?,'queued',?)")
  let n = 0
  db.transaction(() => {
    for (const r of rows) {
      if (monthDayOf(r.birthday) === md) n += ins.run(randomUUID(), 'birthday', r.id, r.name, r.mobile, now.getFullYear(), now.toISOString()).changes
      if (monthDayOf(r.anniversary) === md) n += ins.run(randomUUID(), 'anniversary', r.id, r.name, r.mobile, now.getFullYear(), now.toISOString()).changes
    }
  })()
  return n
}

interface Row { id: string; kind: WishKind; name: string; mobile: string; tries: number }

export async function processOutbox(f: typeof fetch = fetch, now = Date.now()): Promise<{ sent: number; failed: number; waiting: number }> {
  const db = getDb()
  const s = load()
  const todo = db.prepare("SELECT id,kind,name,mobile,tries FROM wa_outbox WHERE status='queued' AND next_try<=? ORDER BY at").all(now) as Row[]
  let sent = 0
  let failed = 0
  for (const r of todo) {
    try {
      const id = await sendTemplate(f, s, s[r.kind], r.mobile, [r.name, shopName()])
      db.prepare("UPDATE wa_outbox SET status='sent',wa_message_id=?,sent_at=?,tries=tries+1,error=NULL WHERE id=?").run(id, new Date().toISOString(), r.id)
      audit(null, 'whatsapp_wish', { kind: r.kind })
      sent++
    } catch (e) {
      const why = e instanceof Error ? e.message : 'Unknown error'
      const tries = r.tries + 1
      if (e instanceof Permanent || tries >= MAX_TRIES) {
        db.prepare("UPDATE wa_outbox SET status='failed',tries=?,error=? WHERE id=?").run(tries, why, r.id)
        failed++
      } else {
        db.prepare('UPDATE wa_outbox SET tries=?,error=?,next_try=? WHERE id=?').run(tries, why, now + RETRY_MS * tries, r.id)
      }
    }
  }
  const waiting = (db.prepare("SELECT COUNT(*) AS n FROM wa_outbox WHERE status='queued'").get() as { n: number }).n
  return { sent, failed, waiting }
}

/** Called at start-up and every half hour. Does nothing unless the owner turned it on and the send hour has passed. */
export async function runWhatsAppJob(f: typeof fetch = fetch, now = new Date()): Promise<WaRunResult> {
  const s = load()
  if (!s.on || !s.phoneNumberId || !s.token) return { queued: 0, sent: 0, failed: 0, waiting: 0 }
  const queued = now.getHours() >= s.sendHour ? queueTodaysWishes(now) : 0
  return { queued, ...(await processOutbox(f, now.getTime())) }
}

export function waOutbox(limit = 40): WaOutboxRow[] {
  requireRole('owner')
  return getDb()
    .prepare('SELECT id,kind,name,mobile,year,status,tries,error,at,sent_at AS sentAt FROM wa_outbox ORDER BY at DESC LIMIT ?')
    .all(limit) as WaOutboxRow[]
}

/** Owner pressed "Send now": runs the job straight away, even before the usual send hour. */
export async function runWaNow(f: typeof fetch = fetch): Promise<WaRunResult> {
  requireRole('owner')
  const s = load()
  if (!s.on) throw new Error('Turn automatic wishes on and save first.')
  return runWhatsAppJob(f, new Date(Math.max(Date.now(), new Date().setHours(s.sendHour, 0, 0, 0))))
}

/** Failed rows can be tried again after the owner fixes the cause (for example the template got approved). */
export function retryFailedWishes(): number {
  requireRole('owner')
  return getDb().prepare("UPDATE wa_outbox SET status='queued',tries=0,error=NULL,next_try=0 WHERE status='failed'").run().changes
}
