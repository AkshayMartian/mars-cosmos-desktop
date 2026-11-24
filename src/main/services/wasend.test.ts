import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { createCustomer } from './customers'
import { getWaSettings, processOutbox, queueTodaysWishes, retryFailedWishes, runWhatsAppJob, saveWaSettings, sendWaTest, waOutbox } from './wasend'
import { setCurrent } from './session'
import { todayMonthDay } from '@shared/dates'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const base = { on: true, phoneNumberId: '1234567890', accessToken: 'EAAB-secret', birthday: { name: 'birthday_wish', language: 'en' }, anniversary: { name: 'anniversary_wish', language: 'en' }, sendHour: 9 }

/** A customer whose birthday (and optionally anniversary) is today. */
function customer(mobile: string, name: string, opts: { offers?: boolean; anniversary?: boolean } = {}) {
  setCurrent(id('owner'))
  const c = createCustomer({ mobile, name, waConsent: true, offersConsent: opts.offers ?? true })
  const [mm, dd] = todayMonthDay().split('-') as [string, string]
  getDb().prepare('UPDATE customers SET birthday=?, anniversary=? WHERE id=?').run(`1990-${mm}-${dd}`, opts.anniversary ? `2015-${mm}-${dd}` : null, c.id)
  return c
}

const ok = (): typeof fetch => (async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 })) as unknown as typeof fetch
const status = (code: number, message: string): typeof fetch => (async () => new Response(JSON.stringify({ error: { message } }), { status: code })) as unknown as typeof fetch
const offline: typeof fetch = (async () => { throw new Error('fetch failed') }) as unknown as typeof fetch

beforeEach(() => { openDb(':memory:'); setCurrent(id('owner')); saveWaSettings(base) })

describe('whatsapp settings', () => {
  it('owner only, and the token is never handed back or stored readable', () => {
    expect(getWaSettings()).toMatchObject({ on: true, phoneNumberId: '1234567890', hasToken: true })
    expect(JSON.stringify(getWaSettings())).not.toContain('EAAB')
    setCurrent(id('cashier'))
    expect(() => getWaSettings()).toThrow(/not allowed/i)
    expect(() => saveWaSettings(base)).toThrow(/not allowed/i)
  })

  it('an empty token keeps the saved one; bad input is refused', () => {
    saveWaSettings({ ...base, accessToken: '', sendHour: 10 })
    expect(getWaSettings()).toMatchObject({ hasToken: true, sendHour: 10 })
    expect(() => saveWaSettings({ ...base, birthday: { name: 'Birthday Wish', language: 'en' } })).toThrow(/template name/i)
    expect(() => saveWaSettings({ ...base, sendHour: 30 })).toThrow(/hour/i)
    expect(() => saveWaSettings({ ...base, phoneNumberId: 'abc' })).toThrow(/digits/i)
  })

  it('cannot be turned on without credentials', () => {
    openDb(':memory:'); setCurrent(id('owner'))
    expect(() => saveWaSettings({ ...base, accessToken: '' })).toThrow(/token/i)
  })
})

describe('daily wishes', () => {
  it('queues only customers who agreed to offers, once per year', () => {
    customer('9876543210', 'Asha')
    customer('9876543211', 'Ben', { offers: false })
    expect(queueTodaysWishes()).toBe(1)
    expect(queueTodaysWishes()).toBe(0) // never twice
    expect(waOutbox()).toHaveLength(1)
  })

  it('a birthday and an anniversary on the same day are two wishes', () => {
    customer('9876543210', 'Asha', { anniversary: true })
    expect(queueTodaysWishes()).toBe(2)
  })

  it('sends the approved template with the name and the shop', async () => {
    customer('9876543210', 'Asha')
    const calls: { url: string; body: any; auth: string }[] = []
    const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }) }) as unknown as typeof fetch
    const r = await runWhatsAppJob(f, new Date(2026, 5, 1, 10, 0))
    expect(r).toMatchObject({ sent: 1, failed: 0, waiting: 0 })
    expect(calls[0]!.url).toContain('/1234567890/messages')
    expect(calls[0]!.auth).toBe('Bearer EAAB-secret')
    expect(calls[0]!.body).toMatchObject({ to: '919876543210', type: 'template', template: { name: 'birthday_wish', language: { code: 'en' } } })
    expect(calls[0]!.body.template.components[0].parameters.map((p: any) => p.text)[0]).toBe('Asha')
    expect(waOutbox()[0]).toMatchObject({ status: 'sent' })
  })

  it('waits for the send hour, and does nothing when switched off', async () => {
    customer('9876543210', 'Asha')
    expect(await runWhatsAppJob(ok(), new Date(2026, 5, 1, 8, 0))).toMatchObject({ queued: 0, sent: 0 })
    saveWaSettings({ ...base, on: false })
    expect(await runWhatsAppJob(ok(), new Date(2026, 5, 1, 12, 0))).toEqual({ queued: 0, sent: 0, failed: 0, waiting: 0 })
  })

  it('no internet: stays queued, retried later, and sent when back online', async () => {
    customer('9876543210', 'Asha')
    queueTodaysWishes()
    const t0 = Date.now()
    expect(await processOutbox(offline, t0)).toMatchObject({ sent: 0, failed: 0, waiting: 1 })
    expect(await processOutbox(ok(), t0 + 1000)).toMatchObject({ sent: 0, waiting: 1 }) // too soon to retry
    expect(await processOutbox(ok(), t0 + 3 * 3_600_000)).toMatchObject({ sent: 1, waiting: 0 })
  })

  it('a permanent error fails the wish with Meta\'s reason, and Retry puts it back', async () => {
    customer('9876543210', 'Asha')
    queueTodaysWishes()
    expect(await processOutbox(status(400, 'Template name does not exist'))).toMatchObject({ failed: 1, waiting: 0 })
    expect(waOutbox()[0]).toMatchObject({ status: 'failed', error: 'Template name does not exist' })
    expect(retryFailedWishes()).toBe(1)
    expect(await processOutbox(ok())).toMatchObject({ sent: 1 })
  })

  it('gives up after 5 temporary failures', async () => {
    customer('9876543210', 'Asha')
    queueTodaysWishes()
    let t = Date.now()
    for (let i = 0; i < 5; i++) { await processOutbox(status(503, 'busy'), t); t += 24 * 3_600_000 }
    expect(waOutbox()[0]).toMatchObject({ status: 'failed', tries: 5 })
  })
})

describe('test message', () => {
  it('reports why WhatsApp refused it', async () => {
    await expect(sendWaTest('9876543210', 'birthday', status(401, 'Invalid OAuth access token'))).rejects.toThrow(/Invalid OAuth/)
    await expect(sendWaTest('123', 'birthday', ok())).rejects.toThrow(/valid Indian mobile/)
    expect(await sendWaTest('9876543210', 'anniversary', ok())).toBe(true)
  })
})
