import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { login } from './auth'
import { createRecoveryCode, hasRecoveryCode, resetOwnerPin, resetPinByApprover } from './pinreset'
import { setCurrent } from './session'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const reset = (staff: string, approver: string, approverPin: string, newPin = '5821') => resetPinByApprover({ staffId: id(staff), approverId: id(approver), approverPin, newPin })

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('forgot PIN: approved by a manager or the owner', () => {
  it('a manager resets a cashier, who must then choose their own PIN', () => {
    reset('cashier', 'manager', '2222')
    const r = login(id('cashier'), '5821')
    expect(r.ok).toBe(true)
    expect(r.mustChangePin).toBe(true)
    expect(login(id('cashier'), '3333').ok).toBe(false) // the old PIN no longer works
  })

  it('the owner resets a manager', () => {
    reset('manager', 'owner', '1111')
    expect(login(id('manager'), '5821').ok).toBe(true)
  })

  it('a manager cannot reset another manager or the owner', () => {
    expect(() => reset('manager', 'manager', '2222')).toThrow(/someone else/i)
    expect(() => reset('owner', 'manager', '2222')).toThrow(/recovery code/i)
  })

  it('a cashier cannot approve', () => {
    expect(() => reset('store', 'cashier', '3333')).toThrow(/not correct/i)
    expect(login(id('store'), '4444').ok).toBe(true) // nothing changed
  })

  it('a wrong approver PIN changes nothing and is counted, then locked', () => {
    for (let i = 0; i < 4; i++) expect(() => reset('cashier', 'manager', '9999')).toThrow(/not correct/i)
    expect(() => reset('cashier', 'manager', '9999')).toThrow(/locked/i)
    expect(() => reset('cashier', 'manager', '2222')).toThrow(/try again/i) // even the right PIN, while locked
    expect(login(id('cashier'), '3333').ok).toBe(true)
  })

  it('refuses a weak or non-4-digit new PIN', () => {
    expect(() => reset('cashier', 'manager', '2222', '1234')).toThrow(/harder/i)
    expect(() => reset('cashier', 'manager', '2222', '12')).toThrow(/4 digits/i)
  })
})

describe('forgot PIN: owner recovery code', () => {
  const makeCode = () => { setCurrent(id('owner')); const c = createRecoveryCode(); setCurrent(null); return c }

  it('only a signed-in owner can make the code, and only its hash is stored', () => {
    expect(() => createRecoveryCode()).toThrow()
    setCurrent(id('manager'))
    expect(() => createRecoveryCode()).toThrow(/not allowed/i)
    setCurrent(null)
    const code = makeCode()
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(hasRecoveryCode()).toBe(true)
    expect(JSON.stringify(getDb().prepare('SELECT value FROM settings WHERE key=?').get('recovery'))).not.toContain(code.replace(/-/g, ''))
  })

  it('the code sets a new owner PIN once, then is used up', () => {
    const code = makeCode()
    resetOwnerPin(code.toLowerCase().replace(/-/g, ' '), '5821') // forgiving about case and spacing
    expect(login(id('owner'), '5821')).toMatchObject({ ok: true, mustChangePin: false })
    expect(login(id('owner'), '1111').ok).toBe(false)
    expect(hasRecoveryCode()).toBe(false)
    expect(() => resetOwnerPin(code, '6192')).toThrow(/no recovery code/i)
  })

  it('without a code made, the owner cannot be reset', () => {
    expect(() => resetOwnerPin('AAAA-BBBB-CCCC', '5821')).toThrow(/no recovery code/i)
  })

  it('wrong codes are limited', () => {
    makeCode()
    for (let i = 0; i < 4; i++) expect(() => resetOwnerPin('AAAA-BBBB-CCCC', '5821')).toThrow(/not correct/i)
    expect(() => resetOwnerPin('AAAA-BBBB-CCCC', '5821')).toThrow(/locked/i)
    expect(() => resetOwnerPin('AAAA-BBBB-CCCC', '5821')).toThrow(/try again/i)
    expect(login(id('owner'), '1111').ok).toBe(true)
  })

  it('a new code replaces the old one', () => {
    const a = makeCode()
    const b = makeCode()
    expect(() => resetOwnerPin(a, '5821')).toThrow(/not correct/i)
    resetOwnerPin(b, '5821')
  })
})
