import { beforeEach, describe, expect, it } from 'vitest'
import type { NewBillInput } from '@shared/billing'
import { coinsEarned, maxCoinsFor } from '@shared/coins'
import { receiptText } from '@shared/receipt'
import { getDb, openDb } from '../db'
import { saveCoins } from './admin'
import { cancelBill } from './bills'
import { billingContext, createBill, getBill, openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { coinBalance, expireCoins, liveBalance } from './coins'
import { createCustomer, findCustomerByMobile, getCustomer } from './customers'
import { doReturn, getBillForReturn } from './returns'
import { setCurrent } from './session'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))
const RULES = { on: true, per: 100, value: 1, expiryMonths: 6, maxPct: 20 }

function shop(on = true) {
  as('owner')
  if (on) saveCoins(RULES)
  const cat = listCategories().find((c) => c.name === 'Shirts')!.id
  const a = createProduct({ name: 'Slim Shirt', brand: 'Own', categoryId: cat, mrp: 149_900, salePrice: 149_900, cost: 78_000, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 20 } })
  as('cashier'); openDay(0)
  const c = createCustomer({ mobile: '9876500045', name: 'Rahul', waConsent: false, offersConsent: false })
  return { shirt: getProduct(a.id).variants[0]!, c }
}
const sell = (variantId: string, customerId: string | null, qty = 1, coinsUsed = 0): NewBillInput => ({
  lines: [{ variantId, qty, disc: 0 }], customerId, billDisc: 0, coinsUsed, salesBy: null, payments: []
})
const pay = (grand: number): NewBillInput['payments'] => [{ mode: 'cash', amount: grand }]
const make = (variantId: string, customerId: string | null, qty = 1, coinsUsed = 0) => {
  const grand = 149_900 * qty - coinsUsed * 100
  return createBill({ ...sell(variantId, customerId, qty, coinsUsed), payments: pay(grand) })
}

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('coin rules', () => {
  it('earns 1 coin per Rs 100 and limits use to a share of the bill', () => {
    expect(coinsEarned(299_800, RULES)).toBe(29)
    expect(coinsEarned(9_999, RULES)).toBe(0)
    expect(coinsEarned(299_800, { ...RULES, on: false })).toBe(0)
    expect(maxCoinsFor(149_900, 500, RULES)).toBe(299) // 20% of Rs 1,499
    expect(maxCoinsFor(149_900, 5, RULES)).toBe(5) // balance is the limit
    expect(maxCoinsFor(149_900, 5, { ...RULES, on: false })).toBe(0)
  })
})

describe('earning and spending', () => {
  it('earns nothing while coins are switched off', () => {
    const { shirt, c } = shop(false)
    make(shirt.id, c.id)
    expect(coinBalance(c.id)).toBe(0)
    expect(billingContext().coins.on).toBe(false)
  })
  it('earns coins on a sale and shows them on the customer', () => {
    const { shirt, c } = shop()
    const b = make(shirt.id, c.id, 2)
    expect(b.coinsEarned).toBe(29)
    expect(coinBalance(c.id)).toBe(29)
    expect(findCustomerByMobile('9876500045')!.coins).toBe(29)
    expect(getCustomer(c.id).coins).toBe(29)
    expect(billingContext().coins).toMatchObject({ on: true, maxPct: 20 })
  })
  it('earns nothing without a customer', () => {
    const { shirt } = shop()
    expect(make(shirt.id, null).coinsEarned ?? 0).toBe(0)
  })
  it('spends coins as a discount before GST and keeps the books right', () => {
    const { shirt, c } = shop()
    make(shirt.id, c.id, 2) // earns 29
    const b = make(shirt.id, c.id, 1, 20)
    expect(b).toMatchObject({ grand: 147_900, coinsUsed: 20, coinValue: 2_000, coinsEarned: 14 })
    expect(b.taxable + b.cgst + b.sgst).toBe(147_900)
    expect(coinBalance(c.id)).toBe(29 - 20 + 14)
    const text = receiptText(b, billingContext().shop, 'regular')
    expect(text).toContain('Coins used (20)')
    expect(text).toContain('Coin balance')
  })
  it('refuses more coins than the customer has, or than the bill allows', () => {
    const { shirt, c } = shop()
    make(shirt.id, c.id, 2)
    expect(() => createBill({ ...sell(shirt.id, c.id, 1, 30), payments: pay(146_900) })).toThrow('at most 29 coins')
    expect(() => createBill({ ...sell(shirt.id, null, 1, 5), payments: pay(149_400) })).toThrow('customer is on the bill')
    expect(() => createBill({ ...sell(shirt.id, c.id, 1, -1), payments: pay(149_900) })).toThrow('whole number')
    expect(coinBalance(c.id)).toBe(29)
  })
  it('refuses coins while switched off', () => {
    const { shirt, c } = shop(false)
    expect(() => createBill({ ...sell(shirt.id, c.id, 1, 1), payments: pay(149_800) })).toThrow('switched off')
  })
  it('limits coins to the max share of the bill', () => {
    const { shirt, c } = shop()
    as('owner'); saveCoins({ ...RULES, maxPct: 1 }); as('cashier')
    getDb().prepare("INSERT INTO coin_ledger (customer_id,type,coins,at) VALUES (?, 'earn', 500, ?)").run(c.id, new Date().toISOString())
    expect(() => createBill({ ...sell(shirt.id, c.id, 1, 15), payments: pay(148_400) })).toThrow('at most 14 coins') // 1% of Rs 1,499
  })
})

describe('taking coins back', () => {
  it('a return takes back the coins earned on what came back', () => {
    const { shirt, c } = shop()
    const b = make(shirt.id, c.id, 2)
    const line = getBillForReturn(b.id).lines[0]!
    doReturn({ billId: b.id, lines: [{ lineId: line.id, qty: 1 }], newLines: [], settle: 'credit_note', payMode: 'cash' })
    expect(coinBalance(c.id)).toBe(29 - 14)
  })
  it('a cancelled bill gives back the coins it used and takes back those it earned', () => {
    const { shirt, c } = shop()
    make(shirt.id, c.id, 2) // 29
    const b = make(shirt.id, c.id, 1, 20) // 29 - 20 + 14 = 23
    expect(coinBalance(c.id)).toBe(23)
    as('owner')
    cancelBill({ billId: b.id, reason: 'wrong item' })
    expect(coinBalance(c.id)).toBe(29)
    expect(getBill(b.id).status).toBe('cancelled')
  })
})

describe('expiry', () => {
  const at = (monthsAgo: number) => { const d = new Date(); d.setMonth(d.getMonth() - monthsAgo); return d.toISOString() }
  const row = (cid: string, type: string, coins: number, when: string) =>
    getDb().prepare('INSERT INTO coin_ledger (customer_id,type,coins,at) VALUES (?,?,?,?)').run(cid, type, coins, when)
  it('writes off coins older than the expiry, oldest first', () => {
    const { c } = shop()
    row(c.id, 'earn', 50, at(8)) // expired
    row(c.id, 'earn', 30, at(7)) // expired
    row(c.id, 'use', -60, at(7)) // took the oldest 50 and 10 of the second
    row(c.id, 'earn', 40, at(1)) // alive
    expect(expireCoins(c.id)).toBe(20)
    expect(coinBalance(c.id)).toBe(40)
    expect(expireCoins(c.id)).toBe(0) // running again changes nothing
    expect(liveBalance(c.id)).toBe(40)
  })
  it('keeps coins that are still inside the expiry', () => {
    const { c } = shop()
    row(c.id, 'earn', 25, at(5))
    expect(liveBalance(c.id)).toBe(25)
  })
  it('does not let an expired balance be spent', () => {
    const { shirt, c } = shop()
    row(c.id, 'earn', 50, at(8))
    expect(() => createBill({ ...sell(shirt.id, c.id, 1, 10), payments: pay(148_900) })).toThrow('no coins')
  })
})
