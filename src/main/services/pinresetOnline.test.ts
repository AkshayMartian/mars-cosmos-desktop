import { generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { login } from './auth'
import { activateWithCode, NO_INTERNET, setLicenceServer, setMachineIdForTests, setPublicKeyForTests } from './licence'
import { signLicence } from './licenceSign'
import { hashPin } from './pin'
import { checkOwnerReset, forgetOwnerReset, resendOwnerReset, startOwnerReset } from './pinresetOnline'
import { setCurrent } from './session'

/** Owner "Forgot PIN" over the internet, against a stand-in for the MARS server. */
const pair = generateKeyPairSync('ed25519')
const PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const PUB = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const KEY = 'MARS-7K2Q-9XFD-4LPA'
const MACHINE = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'

let server: Server
let url = ''
const seen: Array<{ method: string; path: string; body: Record<string, string> }> = []
let status: { status: string; pinHash?: string } = { status: 'waiting' }
let requestFails = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => { raw += c.toString() })
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x')
      const body = req.method === 'GET' ? Object.fromEntries(u.searchParams) : (JSON.parse(raw || '{}') as Record<string, string>)
      seen.push({ method: req.method ?? '', path: u.pathname, body })
      const send = (code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)) }
      if (u.pathname === '/v1/pin-reset/request') return requestFails ? send(429, { error: requestFails }) : send(200, { resetId: 'R-1', emailHint: 'ni•••@gmail.com', expiresInSec: 900 })
      if (u.pathname === '/v1/pin-reset/status') return send(200, status)
      if (u.pathname === '/v1/pin-reset/applied') return send(200, { ok: true })
      return send(404, { error: 'Not found.' })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })

const owner = () => getDb().prepare("SELECT id,pin_hash FROM staff WHERE role='owner'").get() as { id: string; pin_hash: string }
const activate = () => activateWithCode(signLicence({ v: 1, key: KEY, machine: MACHINE, shop: 'Test', plan: 'Starter', mode: 'cloud', counters: 1, kind: 'full', expires: '2099-01-01', issued: new Date().toISOString() }, PEM))

beforeEach(() => {
  openDb(':memory:'); setCurrent(null); forgetOwnerReset()
  setMachineIdForTests(MACHINE); setPublicKeyForTests(PUB); setLicenceServer(url)
  seen.length = 0; status = { status: 'waiting' }; requestFails = ''
  delete process.env['MARS_SKIP_LICENCE']
  activate()
})

describe('owner forgot PIN, online', () => {
  it('asks the server with the licence key and PC id, and shows only a masked email', async () => {
    const r = await startOwnerReset()
    expect(r).toEqual({ emailHint: 'ni•••@gmail.com', resendsLeft: 3, expiresInSeconds: 900 })
    expect(seen).toEqual([{ method: 'POST', path: '/v1/pin-reset/request', body: { key: KEY, machine: MACHINE } }])
  })

  it('no internet: one clear message, nothing changes', async () => {
    const before = owner().pin_hash
    setLicenceServer('http://127.0.0.1:1') // nothing listens there... but a localhost address gets the developer message
    await expect(startOwnerReset()).rejects.toThrow()
    // a real (non-local) address that cannot be reached gives the shop-owner message
    setLicenceServer('https://mars-server.invalid')
    await expect(startOwnerReset()).rejects.toThrow(NO_INTERNET)
    expect(NO_INTERNET).toBe('No internet connection. Connect to the internet to reset your PIN, then try again.')
    expect(owner().pin_hash).toBe(before)
    expect(getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'pin_reset%'").get()).toEqual({ n: 0 })
  })

  it('waits while the owner has not chosen the PIN yet', async () => {
    await startOwnerReset()
    expect(await checkOwnerReset()).toEqual({ status: 'waiting' })
    expect(seen.at(-1)).toMatchObject({ method: 'GET', path: '/v1/pin-reset/status', body: { key: KEY, machine: MACHINE, resetId: 'R-1' } })
  })

  it('stores the new PIN when the server hands it over, then tells the server it was applied', async () => {
    await startOwnerReset()
    status = { status: 'ready', pinHash: hashPin('4826') }
    expect(await checkOwnerReset()).toEqual({ status: 'applied' })
    expect(seen.at(-1)).toMatchObject({ method: 'POST', path: '/v1/pin-reset/applied', body: { resetId: 'R-1' } })
    expect(login(owner().id, '4826')).toMatchObject({ ok: true, mustChangePin: false })
    expect(getDb().prepare("SELECT details FROM audit_log WHERE action='pin_reset'").get()).toEqual({ details: JSON.stringify({ id: owner().id, by: 'email_link' }) })
    await expect(checkOwnerReset()).rejects.toThrow('Start the PIN reset again') // the reset is over
  })

  it('refuses a PIN hash in the wrong format and leaves the owner PIN alone', async () => {
    const before = owner().pin_hash
    await startOwnerReset()
    status = { status: 'ready', pinHash: 'plain-text-4826' }
    await expect(checkOwnerReset()).rejects.toThrow('cannot use')
    expect(owner().pin_hash).toBe(before)
  })

  it('an expired link is reported', async () => {
    await startOwnerReset()
    status = { status: 'expired' }
    expect(await checkOwnerReset()).toEqual({ status: 'expired' })
  })

  it('resend is limited to three', async () => {
    await startOwnerReset()
    expect((await resendOwnerReset()).resendsLeft).toBe(2)
    expect((await resendOwnerReset()).resendsLeft).toBe(1)
    expect((await resendOwnerReset()).resendsLeft).toBe(0)
    await expect(resendOwnerReset()).rejects.toThrow('three times')
    expect(seen.filter((s) => s.path === '/v1/pin-reset/request')).toHaveLength(4)
  })

  it("the server's own refusal (too many requests) is shown as it is", async () => {
    requestFails = 'Too many reset requests. Try again in an hour.'
    await expect(startOwnerReset()).rejects.toThrow('Too many reset requests')
  })

  it('a PC that is not activated cannot ask', async () => {
    openDb(':memory:')
    await expect(startOwnerReset()).rejects.toThrow('not activated')
    expect(seen).toEqual([])
  })
})
