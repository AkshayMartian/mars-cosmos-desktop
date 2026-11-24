import { generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LicencePayload } from '@shared/licence'
import { getDb, openDb } from '../db'
import { getAllSettings, finishSetup, listStaffAdmin, saveGst, savePrinters, saveShop, saveStaff, setStaffPin } from './admin'
import { login } from './auth'
import { openDay, createBill } from './billing'
import { createCategory, createProduct, getProduct, listCategories } from './catalogue'
import {
  activateOnline, activateWithCode, assertActivated, licenceStatus, machineId, refreshLicence, requestCode, parseRequestCode,
  setLicenceServer, setMachineIdForTests, setPublicKeyForTests, trialSendOtp, trialVerify
} from './licence'
import { signLicence } from './licenceSign'
import { setCurrent } from './session'
import { appInfo, markTourDone } from './settings'
import { setBackupDir, runBackup } from './backup'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The whole onboarding journey of a new shop, against a real HTTP licence server (a stand-in that signs like the real one):
 * activate -> log in -> setup wizard -> tour flag -> first sale -> expiry (application blocked) -> renewal -> trial.
 */
const pair = generateKeyPairSync('ed25519')
const PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const PUB = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const KEY = 'MARS-7K2Q-9XFD-4LPA'
const MACHINE = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'
const MOBILE = '9876543210'
const ymd = (days: number): string => {
  const d = new Date(Date.now() + days * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const token = (over: Partial<LicencePayload> = {}): string => signLicence({
  v: 1, key: KEY, machine: MACHINE, shop: 'Flow Test Shop', plan: 'Starter', mode: 'cloud', counters: 1, kind: 'full', expires: ymd(365), issued: new Date().toISOString(), ...over
}, PEM)

/** What the stand-in server answers; tests change it per case. */
let nextRefresh = ymd(365)
const hits: string[] = []
let server: Server
let url = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => { raw += c.toString() })
    req.on('end', () => {
      const b = JSON.parse(raw || '{}') as Record<string, string>
      hits.push(req.url ?? '')
      const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (req.url === '/v1/activate') return b['key'] === 'MARS-DEAD-DEAD-DEAD' ? send(400, { error: 'This activation key is not valid.' }) : send(200, { licence: token({ key: b['key']!, machine: b['machine']! }) })
      if (req.url === '/v1/refresh') return send(200, { licence: token({ key: b['key']!, machine: b['machine']!, expires: nextRefresh }) })
      if (req.url === '/v1/trial/otp') return send(200, {})
      if (req.url === '/v1/trial/verify') return b['otp'] === '123456' ? send(200, { licence: token({ key: 'MARS-TRYX-0000-0000', machine: b['machine']!, kind: 'trial', plan: 'Trial', expires: ymd(14), shop: b['shop']! }) }) : send(400, { error: 'That code is not right.' })
      return send(404, { error: 'Not found.' })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })

let dir = ''
beforeEach(() => {
  openDb(':memory:'); setCurrent(null)
  setMachineIdForTests(MACHINE); setPublicKeyForTests(PUB); setLicenceServer(url); hits.length = 0; nextRefresh = ymd(365)
  delete process.env['MARS_SKIP_LICENCE']
  dir = mkdtempSync(join(tmpdir(), 'mars-flow-')); setBackupDir(dir)
})
const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

describe('1. a brand-new PC', () => {
  it('is not activated: login is closed, setup and tour are pending', () => {
    expect(licenceStatus()).toMatchObject({ state: 'none', kind: null })
    expect(() => assertActivated()).toThrow('Activate this PC first')
    expect(appInfo()).toMatchObject({ setupDone: false, tourDone: false })
  })
  it('bad input is stopped before any network call', async () => {
    await expect(activateOnline('NOPE', MOBILE)).rejects.toThrow('MARS-XXXX')
    await expect(activateOnline(KEY, '5555555555')).rejects.toThrow('Indian mobile')
    await expect(activateOnline(KEY, '98765')).rejects.toThrow('Indian mobile')
    expect(hits).toEqual([])
  })
})

describe('2. activation failures are readable and leave the PC unactivated', () => {
  it('server says the key is wrong', async () => {
    await expect(activateOnline('MARS-DEAD-DEAD-DEAD', MOBILE)).rejects.toThrow('not valid')
    expect(licenceStatus().state).toBe('none')
  })
  it('no server address / server unreachable', async () => {
    setLicenceServer('')
    await expect(activateOnline(KEY, MOBILE)).rejects.toThrow('not set up to reach')
    setLicenceServer('http://127.0.0.1:1') // nothing listens there
    await expect(activateOnline(KEY, MOBILE)).rejects.toThrow('Could not reach')
    expect(licenceStatus().state).toBe('none')
  })
})

describe('3. online activation, then the whole first-run', () => {
  it('activate -> login -> wizard steps -> tour -> first sale', async () => {
    // activate (key typed in any case, mobile with +91)
    const st = await activateOnline(' mars-7k2q-9xfd-4lpa ', '+91 98765 43210')
    expect(st).toMatchObject({ state: 'active', shopName: 'Flow Test Shop', kind: 'full' })
    expect(hits).toEqual(['/v1/activate'])
    expect(getDb().prepare("SELECT details FROM audit_log WHERE action='licence_activated'").get()).toBeTruthy()
    expect(() => assertActivated()).not.toThrow()

    // owner logs in with the default PIN
    const r = login(id('owner'), '1111')
    expect(r.ok).toBe(true)
    expect(appInfo().setupDone).toBe(false)

    // wizard 1: Shop details (validated)
    expect(() => saveShop({ name: '', phone: '', address: '', gstin: '', state: '' })).toThrow('shop name')
    expect(() => saveShop({ name: 'Nikk', phone: '67876678996996969699', address: '', gstin: '', state: '' })).toThrow('mobile')
    expect(() => saveShop({ name: 'Nikk', phone: MOBILE, address: '', gstin: '24AAAAA1111A1Z', state: '' })).toThrow('GSTIN')
    expect(() => saveShop({ name: 'Nikk', phone: MOBILE, address: '', gstin: '24AAAAA1111A1Z5', state: '27 Maharashtra' })).toThrow('GSTIN starts with 24')
    expect(() => saveShop({ name: 'Nikk', phone: MOBILE, address: '', gstin: '', state: 'guj' })).toThrow('list')
    const shop = saveShop({ name: 'Nikk', phone: '+91 98765 43210', address: 'Titanium City Center', gstin: '24aaaaa1111a1z5', state: '24 Gujarat' })
    expect(shop).toEqual({ name: 'Nikk', phone: MOBILE, address: 'Titanium City Center', gstin: '24AAAAA1111A1Z5', state: '24 Gujarat' })
    expect(appInfo().shopName).toBe('Nikk')

    // wizard 2: GST type, 3: categories, 4: printers
    expect(saveGst('regular')).toBe('regular')
    expect(() => saveGst('nonsense' as never)).toThrow('GST type')
    const cat = createCategory({ name: 'Kurtas', hsn: '6204', gst: 'auto' })
    expect(listCategories().some((c) => c.id === cat.id)).toBe(true)
    expect(savePrinters({ receipt: 'POS-80', drawer: true })).toEqual({ receipt: 'POS-80', drawer: true })

    // wizard 5: the owner's own PIN (the default and weak PINs are refused), 6: staff
    expect(() => setStaffPin(id('owner'), '1111')).toThrow('harder')
    expect(() => setStaffPin(id('owner'), '12')).toThrow('4 digits')
    setStaffPin(id('owner'), '4826')
    expect(login(id('owner'), '1111').ok).toBe(false)
    expect(login(id('owner'), '4826').ok).toBe(true)
    as('owner')
    const staff = saveStaff({ name: 'Priya', role: 'cashier', maxDiscountPct: 10, commissionPct: 1, canCancel: false, canChangePrice: false, active: true, pin: '7391' })
    expect(staff.some((s) => s.name === 'Priya')).toBe(true)
    expect(() => saveStaff({ name: 'Bad', role: 'cashier', maxDiscountPct: 0, commissionPct: 0, canCancel: false, canChangePrice: false, active: true, pin: '1111' })).toThrow('harder')
    expect(listStaffAdmin().find((s) => s.name === 'Priya')!.role).toBe('cashier')

    // finish (or skip) the wizard, then the tour is marked once
    expect(finishSetup()).toBe(true)
    expect(appInfo()).toMatchObject({ setupDone: true, tourDone: false })
    expect(markTourDone()).toBe(true)
    expect(markTourDone()).toBe(true) // replaying and closing again is harmless
    expect(appInfo().tourDone).toBe(true)
    expect(getAllSettings().shop.name).toBe('Nikk')

    // first sale works while the licence is active
    const p = createProduct({ name: 'Cotton Kurta', brand: 'Own', categoryId: cat.id, mrp: 99_900, salePrice: 99_900, cost: 50_000, sizes: ['M'], colours: ['Red'], opening: { 'Red|M': 3 } })
    const v = getProduct(p.id).variants[0]!
    setCurrent(null); as('cashier'); openDay(0)
    const b = createBill({ lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 99_900 }] })
    expect(b.status).toBe('completed')
  })
  it('the tour and wizard flags are owner/login safe', () => {
    expect(() => markTourDone()).toThrow('Not logged in')
    as('cashier')
    expect(() => finishSetup()).toThrow('not allowed')
  })
})

describe('4. expiry blocks the application, renewal brings it back', () => {
  async function shopWithStock() {
    await activateOnline(KEY, MOBILE)
    as('owner')
    const cat = listCategories().find((c) => c.name === 'Shirts')!.id
    const p = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 5 } })
    return getProduct(p.id).variants[0]!
  }
  const sale = (variantId: string) => createBill({ lines: [{ variantId, qty: 1, disc: 0 }], customerId: null, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 149_900 }] })

  it('warns near the end, blocks everything after it, then a renewal unblocks', async () => {
    const v = await shopWithStock()
    setCurrent(null); as('cashier'); openDay(0)
    expect(sale(v.id).status).toBe('completed')

    // 5 days left: a warning, still selling
    activateWithCode(token({ expires: ymd(5) }))
    expect(licenceStatus()).toMatchObject({ state: 'expiring', daysLeft: 5 })
    expect(sale(v.id).status).toBe('completed')

    // expired yesterday: the application is blocked (the screens and every call go through assertActivated)
    activateWithCode(token({ expires: ymd(-1) }))
    expect(licenceStatus().state).toBe('expired')
    expect(() => assertActivated()).toThrow('licence has expired')
    as('cashier')
    expect(() => sale(v.id)).toThrow('licence has expired')
    as('owner')
    expect(getDb().prepare('SELECT COUNT(*) n FROM bills').get()).toMatchObject({ n: 2 }) // the data is still there, nothing deleted
    expect(() => runBackup()).not.toThrow()

    // renewal over the internet (the weekly check, forced)
    nextRefresh = ymd(365)
    const renewed = await refreshLicence(true)
    expect(renewed.state).toBe('active')
    expect(() => assertActivated()).not.toThrow()
    as('cashier')
    expect(sale(v.id).status).toBe('completed')
    expect(hits).toContain('/v1/refresh')
  })

  it('a renewal code typed by hand also works (no internet)', async () => {
    const v = await shopWithStock()
    activateWithCode(token({ expires: ymd(-3) }))
    setCurrent(null); as('cashier'); openDay(0)
    expect(() => sale(v.id)).toThrow('expired')
    activateWithCode(token({ expires: ymd(365) }))
    expect(sale(v.id).status).toBe('completed')
  })

  it('the weekly check never throws or blocks when the server is down', async () => {
    await shopWithStock()
    setLicenceServer('http://127.0.0.1:1')
    await expect(refreshLicence()).resolves.toMatchObject({ state: 'active' }) // not due yet: no call
    await expect(refreshLicence(true)).rejects.toThrow('Could not reach') // only the "Check now" button reports it
    expect(licenceStatus().state).toBe('active')
  })
})

describe('5. offline activation (request code -> response code)', () => {
  it('the whole round trip', () => {
    const req = requestCode(KEY, MOBILE)
    const parsed = parseRequestCode(req)
    expect(parsed).toEqual({ key: KEY, machine: machineId(), mobile: MOBILE })
    // support signs for exactly this PC
    const response = token({ key: parsed.key, machine: parsed.machine, shop: 'Offline Shop', expires: ymd(30) })
    expect(activateWithCode(response)).toMatchObject({ state: 'active', shopName: 'Offline Shop', checkedDaysAgo: null })
    expect(() => assertActivated()).not.toThrow()
    expect(() => activateWithCode(token({ machine: 'ANOTHERPC' }))).toThrow('different PC')
    expect(() => activateWithCode('MARSL1.garbage.garbage')).toThrow()
  })
})

describe('6. free trial with a mobile code', () => {
  it('wrong code is refused, right code starts a 14-day trial', async () => {
    await expect(trialSendOtp('123')).rejects.toThrow('Indian mobile')
    await expect(trialSendOtp(MOBILE)).resolves.toBe(true)
    await expect(trialVerify(MOBILE, 'abc', 'Trial Shop')).rejects.toThrow('code that was sent')
    await expect(trialVerify(MOBILE, '000000', 'Trial Shop')).rejects.toThrow('not right')
    expect(licenceStatus().state).toBe('none')
    const st = await trialVerify(MOBILE, '123456', 'Trial Shop')
    expect(st).toMatchObject({ state: 'active', kind: 'trial', plan: 'Trial', shopName: 'Trial Shop' })
    expect(st.daysLeft).toBe(14)
  })
})

describe('7. a licence on the wrong PC', () => {
  it('is invalid there and login is closed again', async () => {
    await activateOnline(KEY, MOBILE)
    setMachineIdForTests('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(licenceStatus().state).toBe('invalid')
    expect(() => assertActivated()).toThrow('Activate this PC first')
  })
})

afterAll(() => { rmSync(dir, { recursive: true, force: true }) })
