import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatKey, responseCodeProblem, type LicencePayload } from '@shared/licence'
import { getDb, openDb } from '../db'
import { setCurrent } from './session'
import {
  activateWithCode, assertActivated, assertCanSell, licenceStatus, machineId, parseRequestCode, requestCode,
  setMachineIdForTests, setPublicKeyForTests, verifyToken
} from './licence'
import { signLicence } from './licenceSign'

const pair = generateKeyPairSync('ed25519')
const PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const PUB = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const KEY = 'MARS-7K2Q-9XFD-4LPA'
const ymd = (offsetDays: number): string => {
  const d = new Date(Date.now() + offsetDays * 864e5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const licence = (over: Partial<LicencePayload> = {}): string => signLicence({
  v: 1, key: KEY, machine: machineId(), shop: 'Test Store', plan: 'Starter', mode: 'cloud', counters: 1, kind: 'full', expires: ymd(365), issued: new Date().toISOString(), ...over
}, PEM)

beforeEach(() => { openDb(':memory:'); setCurrent(null); setMachineIdForTests('AAAABBBBCCCCDDDDEEEEFFFF00001111'); setPublicKeyForTests(PUB); delete process.env['MARS_SKIP_LICENCE'] })
afterEach(() => { setMachineIdForTests(null); setPublicKeyForTests(null) })

describe('activation', () => {
  it('starts not activated, and the login is closed until it is', () => {
    expect(licenceStatus().state).toBe('none')
    expect(() => assertActivated()).toThrow('Activate this PC first')
  })
  it('the request code carries the key, this PC and the mobile; the response code activates', () => {
    const req = requestCode(' mars-7k2q-9xfd-4lpa ', '+91 98765 43210')
    expect(parseRequestCode(req)).toEqual({ key: KEY, machine: machineId(), mobile: '9876543210' })
    const st = activateWithCode(licence({ shop: 'Mars Cosmos' }))
    expect(st).toMatchObject({ state: 'active', shopName: 'Mars Cosmos', plan: 'Starter', mode: 'cloud', kind: 'full' })
    expect(() => assertActivated()).not.toThrow()
    expect(() => assertCanSell()).not.toThrow()
  })
  it('rejects a bad key, a bad mobile, a forged code and a code for another PC', () => {
    expect(() => requestCode('NOPE', '9876543210')).toThrow('MARS-XXXX')
    expect(() => requestCode(KEY, '123')).toThrow('valid Indian mobile')
    expect(() => requestCode(KEY, '5555555555')).toThrow('starting with 6, 7, 8 or 9')
    expect(() => activateWithCode('hello')).toThrow('starts with MARSL1')
    const [h, body, sig] = licence().split('.') as [string, string, string]
    const mid = sig.length >> 1 // the last base64 char can carry unused bits, so change one in the middle
    const forged = [h, body, sig.slice(0, mid) + (sig[mid] === 'A' ? 'B' : 'A') + sig.slice(mid + 1)].join('.')
    expect(() => activateWithCode(forged)).toThrow('not valid')
    expect(() => activateWithCode(licence({ machine: 'SOMEOTHERPC' }))).toThrow('different PC')
    expect(licenceStatus().state).toBe('none')
  })
  it('a code signed by another key is refused', () => {
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const bad = signLicence({ v: 1, key: KEY, machine: machineId(), shop: 'X', plan: 'S', mode: 'cloud', counters: 1, kind: 'full', expires: ymd(30), issued: '' }, other)
    expect(() => verifyToken(bad)).toThrow('not valid')
  })
  it('the developer bypass opens the app without a licence', () => {
    process.env['MARS_SKIP_LICENCE'] = '1'
    expect(() => assertActivated()).not.toThrow()
  })
})

describe('response code shape', () => {
  it('explains a request code, a wrong prefix and a code with no signature', () => {
    expect(responseCodeProblem('')).toBe('')
    expect(responseCodeProblem(requestCode(KEY, '9876543210'))).toContain('request code')
    expect(responseCodeProblem('hello')).toContain('starts with MARSL1')
    expect(responseCodeProblem('MARSL1.abc')).toContain('incomplete')
    expect(responseCodeProblem('MARSL1.abc.')).toContain('incomplete')
    expect(responseCodeProblem(licence())).toBe('')
    expect(() => activateWithCode(requestCode(KEY, '9876543210'))).toThrow('request code that this PC made')
    expect(() => activateWithCode('MARSL1.abc')).toThrow('incomplete')
  })
})

describe('key typing', () => {
  it('adds the dashes, uppercases and never runs past a key', () => {
    expect(formatKey('mars7k2q9xfd4lpa')).toBe(KEY)
    expect(formatKey('MARS-7K2Q-9XFD-4LPA-EXTRA')).toBe(KEY)
    expect(formatKey('55555555555555')).toBe('MARS-5555-5555-5555')
    expect(formatKey('7k2q')).toBe('MARS-7K2Q')
    expect(formatKey('MARS-')).toBe('')
    expect(formatKey('')).toBe('')
  })
})

describe('licence life', () => {
  it('a fresh 14-day trial is not "expiring"; it warns only in its last 5 days', () => {
    activateWithCode(licence({ kind: 'trial', expires: ymd(14) }))
    expect(licenceStatus()).toMatchObject({ state: 'active', kind: 'trial' })
    activateWithCode(licence({ kind: 'trial', expires: ymd(5) }))
    expect(licenceStatus().state).toBe('expiring')
  })
  it('warns in the last 14 days, still works', () => {
    activateWithCode(licence({ expires: ymd(10) }))
    expect(licenceStatus()).toMatchObject({ state: 'expiring', daysLeft: 10 })
    expect(() => assertCanSell()).not.toThrow()
  })
  it('an expired licence blocks the whole application until a renewal code is entered', () => {
    activateWithCode(licence({ expires: ymd(-1) }))
    expect(licenceStatus().state).toBe('expired')
    expect(() => assertActivated()).toThrow('licence has expired') // the gate every screen and call goes through
    expect(() => assertCanSell()).toThrow('expired')
    activateWithCode(licence({ expires: ymd(365) })) // the renewal screen can still accept a code
    expect(licenceStatus().state).toBe('active')
    expect(() => assertActivated()).not.toThrow()
    expect(() => assertCanSell()).not.toThrow()
  })
  it('the last day itself is still valid', () => {
    activateWithCode(licence({ expires: ymd(0) }))
    expect(licenceStatus().state).toBe('expiring')
  })
  it('a licence copied to another PC is invalid there; a renewal for a different key is refused', () => {
    activateWithCode(licence())
    setMachineIdForTests('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(licenceStatus()).toMatchObject({ state: 'invalid' })
    expect(() => assertActivated()).toThrow('Activate this PC first')
    setMachineIdForTests('AAAABBBBCCCCDDDDEEEEFFFF00001111')
    expect(() => activateWithCode(licence({ key: 'MARS-AAAA-BBBB-CCCC' }))).toThrow('different activation key')
  })
  it('a code-activated licence has no weekly check to go stale', () => {
    activateWithCode(licence())
    expect(licenceStatus()).toMatchObject({ checkedDaysAgo: null, staleCheck: false })
    expect((getDb().prepare("SELECT value FROM settings WHERE key='licence'").get() as { value: string }).value).toContain('"via":"code"')
  })
})
