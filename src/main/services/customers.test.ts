import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CustomerSaveInput } from '@shared/customers'
import { parseSizes, sizesText } from '@shared/customers'
import { parseDayMonth, todayMonthDay, toDayMonth } from '@shared/dates'
import { getDb, openDb } from '../db'
import { MIGRATIONS } from '../db/schema'
import { createBill, getBill, openDay } from './billing'
import { createProduct, getProduct, listCategories } from './catalogue'
import { celebrationsToday, createCustomer, deleteCustomer, findCustomerByMobile, getCustomer, listCustomers, saveCustomer } from './customers'
import { setCurrent } from './session'

const id = (role: string) => (getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id
const as = (role: string) => setCurrent(id(role))

const input = (over: Partial<CustomerSaveInput> = {}): CustomerSaveInput => ({
  mobile: '9876500045', name: 'Rahul Shah', birthday: '21-08', anniversary: '04-12', sizes: { shirt: '', trouser: '', shoe: '' },
  notes: 'Likes slim fit', gstin: '', waConsent: true, offersConsent: false, ...over
})

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('day-month dates', () => {
  it('turns typed DD-MM into stored MM-DD and back', () => {
    expect(parseDayMonth('21-08')).toBe('08-21')
    expect(parseDayMonth(' 4/12 ')).toBe('12-04')
    expect(parseDayMonth('')).toBe('')
    expect(parseDayMonth('29-02')).toBe('02-29') // a birthday has no year
    expect(toDayMonth('08-21')).toBe('21-08')
    expect(toDayMonth(null)).toBe('')
  })
  it('refuses dates that do not exist', () => {
    for (const bad of ['31-02', '32-01', '00-05', '10-13', 'aug 21', '2108', '21-8-1990']) expect(parseDayMonth(bad), bad).toBeNull()
    expect(parseDayMonth('31-04')).toBeNull()
  })
})

describe('adding and editing a customer', () => {
  it('saves every detail and shows it back', () => {
    as('cashier')
    const c = saveCustomer(input({ gstin: '24aaaaa1111a1z5', sizes: { shirt: '40', trouser: '32', shoe: '9' } }))
    expect(c).toMatchObject({
      name: 'Rahul Shah', mobile: '9876500045', birthday: '08-21', anniversary: '12-04',
      sizes: { shirt: '40', trouser: '32', shoe: '9' },
      notes: 'Likes slim fit', gstin: '24AAAAA1111A1Z5', waConsent: true, offersConsent: false, consentBy: 'Cashier', visits: 0, spent: 0
    })
    expect(c.consentAt).toEqual(expect.any(String))
    expect(listCustomers('rahul')).toMatchObject([{ name: 'Rahul Shah', mobile: '9876500045' }])
    expect(findCustomerByMobile('9876500045')?.id).toBe(c.id) // billing finds the same customer
  })
  it('checks the form: mobile, name, dates, GSTIN, duplicates', () => {
    as('cashier')
    expect(() => saveCustomer(input({ mobile: '12345' }))).toThrow('10 digits')
    expect(() => saveCustomer(input({ name: '  ' }))).toThrow('Name is required')
    expect(() => saveCustomer(input({ birthday: '31-02' }))).toThrow('Birthday')
    expect(() => saveCustomer(input({ anniversary: 'soon' }))).toThrow('Anniversary')
    expect(() => saveCustomer(input({ gstin: '123' }))).toThrow('GSTIN')
    expect(() => saveCustomer(input({ gstin: '99AAAAA1111A1Z5' }))).toThrow('GSTIN') // no such state code
    saveCustomer(input())
    expect(() => saveCustomer(input({ name: 'Other' }))).toThrow('already exists')
    expect(listCustomers()).toHaveLength(1)
  })
  it('keeps the first consent record on an edit, and renews it only when consent changes', () => {
    as('cashier')
    const c = saveCustomer(input())
    const first = c.consentAt
    as('manager')
    const same = saveCustomer({ ...input({ name: 'Rahul S. Shah' }), id: c.id })
    expect(same).toMatchObject({ name: 'Rahul S. Shah', consentBy: 'Cashier', consentAt: first }) // untouched
    const changed = saveCustomer({ ...input({ offersConsent: true }), id: c.id })
    expect(changed).toMatchObject({ offersConsent: true, consentBy: 'Manager' })
    expect(changed.consentAt).not.toBeNull()
  })
  it('records no consent when none is given, and lets the mobile change if it is not taken', () => {
    as('cashier')
    const c = saveCustomer(input({ waConsent: false, offersConsent: false }))
    expect(c).toMatchObject({ consentAt: null, consentBy: null })
    const other = saveCustomer(input({ mobile: '9712300031', name: 'Neha Patel' }))
    expect(() => saveCustomer({ ...input({ mobile: '9712300031' }), id: c.id })).toThrow('already exists')
    expect(saveCustomer({ ...input({ mobile: '9712300099', name: 'Neha Patel' }), id: other.id }).mobile).toBe('9712300099')
  })
  it('is for owner, manager and cashier, not store staff', () => {
    as('store')
    expect(() => saveCustomer(input())).toThrow('not allowed')
    expect(() => listCustomers()).toThrow('not allowed')
  })
})

describe('the customer\'s usual sizes (shirt, trouser, shoe)', () => {
  const raw = (id: string) => (getDb().prepare('SELECT sizes FROM customers WHERE id=?').get(id) as { sizes: string | null }).sizes

  it('keeps the three sizes as JSON in customers.sizes and shows them back', () => {
    as('cashier')
    const c = saveCustomer(input({ sizes: { shirt: '40', trouser: '32', shoe: '9' } }))
    expect(c.sizes).toEqual({ shirt: '40', trouser: '32', shoe: '9' })
    expect(JSON.parse(raw(c.id)!)).toEqual({ shirt: '40', trouser: '32', shoe: '9' })
    expect(sizesText(c.sizes)).toBe('Shirt 40 · Trouser 32 · Shoe 9')
  })
  it('takes plain text, trims it, and lets any box stay empty', () => {
    as('cashier')
    const c = saveCustomer(input({ sizes: { shirt: ' L ', trouser: '', shoe: 'UK 9' } }))
    expect(c.sizes).toEqual({ shirt: 'L', trouser: '', shoe: 'UK 9' })
    expect(sizesText(c.sizes)).toBe('Shirt L · Shoe UK 9') // only what is filled in
    const none = saveCustomer(input({ mobile: '9712300031', name: 'Neha Patel', sizes: { shirt: '', trouser: '', shoe: '' } }))
    expect(JSON.parse(raw(none.id)!)).toEqual({ shirt: '', trouser: '', shoe: '' }) // always all three keys
    expect(sizesText(none.sizes)).toBe('')
  })
  it('changes and clears sizes when the customer is edited', () => {
    as('cashier')
    const c = saveCustomer(input({ sizes: { shirt: '40', trouser: '32', shoe: '9' } }))
    expect(saveCustomer({ ...input({ sizes: { shirt: '42', trouser: '32', shoe: '' } }), id: c.id }).sizes).toEqual({ shirt: '42', trouser: '32', shoe: '' })
    expect(getCustomer(c.id).sizes.shirt).toBe('42')
  })
  it('refuses a size that is far too long, and saves nothing', () => {
    as('cashier')
    expect(() => saveCustomer(input({ sizes: { shirt: 'x'.repeat(21), trouser: '', shoe: '' } }))).toThrow('too long')
    expect(listCustomers()).toHaveLength(0)
    saveCustomer(input({ sizes: { shirt: 'x'.repeat(20), trouser: '', shoe: '' } })) // 20 is the limit
  })
  it('reads stored sizes safely: empty, broken or wrong-typed JSON becomes blank boxes', () => {
    expect(parseSizes(null)).toEqual({ shirt: '', trouser: '', shoe: '' })
    expect(parseSizes('')).toEqual({ shirt: '', trouser: '', shoe: '' })
    expect(parseSizes('{ not json')).toEqual({ shirt: '', trouser: '', shoe: '' })
    expect(parseSizes('{"shirt":40,"trouser":" 32 ","extra":"x"}')).toEqual({ shirt: '', trouser: '32', shoe: '' })
  })
  it('gives Billing the sizes when it finds the customer by mobile, and blank sizes for a quick-added one', () => {
    as('cashier')
    saveCustomer(input({ sizes: { shirt: '40', trouser: '32', shoe: '9' } }))
    expect(findCustomerByMobile('9876500045')?.sizes).toEqual({ shirt: '40', trouser: '32', shoe: '9' })
    expect(createCustomer({ mobile: '9712300031', name: 'Neha Patel', waConsent: false, offersConsent: false }).sizes).toEqual({ shirt: '', trouser: '', shoe: '' })
    expect(findCustomerByMobile('9712300031')?.sizes).toEqual({ shirt: '', trouser: '', shoe: '' })
  })
  it('forgets the sizes when the customer is deleted', () => {
    as('owner')
    const c = saveCustomer(input({ sizes: { shirt: '40', trouser: '32', shoe: '9' } }))
    deleteCustomer(c.id)
    expect(raw(c.id)).toBeNull()
  })
})

describe('upgrading an existing database to the version with usual sizes and colour photos', () => {
  const oldDb = (version: number) => {
    const file = join(mkdtempSync(join(tmpdir(), 'mars-mig-')), 'old.db')
    const d = new Database(file)
    for (const m of MIGRATIONS.filter((x) => x.version <= version)) d.exec(m.sql)
    d.pragma(`user_version = ${version}`)
    d.prepare("INSERT INTO staff (id,name,role,pin_hash) VALUES ('s','Owner','owner','x')").run() // so the app does not seed over it
    d.prepare("INSERT INTO categories (id,name,hsn,gst_mode) VALUES ('c-shirts','Shirts','6205','auto'),('c-tr','Trousers','6203','auto'),('c-shoes','Shoes','6403','auto')").run()
    return { file, d }
  }

  it('moves the old fixed columns (version 1 database) into the JSON sizes', () => {
    const { file, d } = oldDb(1)
    d.prepare("INSERT INTO customers (id,mobile,name,size_shirt,size_trouser,size_shoe) VALUES ('k1','9876500045','Rahul','40','32','9'),('k2','9712300031','Neha',NULL,'',NULL)").run()
    d.close()
    openDb(file)
    expect(JSON.parse(raw('k1')!)).toEqual({ shirt: '40', trouser: '32', shoe: '9' }) // the shoe size is kept now too
    expect(JSON.parse(raw('k2')!)).toEqual({ shirt: '', trouser: '', shoe: '' })
    getDb().close()
  })
  it('moves the per-category sizes of a version 3 database into the JSON sizes', () => {
    const { file, d } = oldDb(3)
    d.prepare("INSERT INTO customers (id,mobile,name) VALUES ('k1','9876500045','Rahul'),('k2','9712300031','Neha')").run()
    d.prepare("INSERT INTO customer_sizes (customer_id,category_id,size) VALUES ('k1','c-shirts','L'),('k1','c-tr','34'),('k1','c-shoes','10')").run()
    d.close()
    openDb(file)
    expect(JSON.parse(raw('k1')!)).toEqual({ shirt: 'L', trouser: '34', shoe: '10' })
    expect(JSON.parse(raw('k2')!)).toEqual({ shirt: '', trouser: '', shoe: '' })
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM customer_sizes').get()).toEqual({ n: 3 }) // the old table is left as it was
    getDb().close()
  })
  function raw(id: string): string | null {
    return (getDb().prepare('SELECT sizes FROM customers WHERE id=?').get(id) as { sizes: string | null }).sizes
  }
})

describe('visits and spend', () => {
  it('counts completed bills and adds up what the customer spent', () => {
    as('owner')
    const cat = listCategories().find((c) => c.name === 'Shirts')!.id
    const v = getProduct(createProduct({ name: 'Slim Shirt', brand: '', categoryId: cat, mrp: 149_900, salePrice: 0, cost: 0, sizes: ['M'], colours: ['Blue'], opening: { 'Blue|M': 5 } }).id).variants[0]!
    as('cashier'); openDay(0)
    const c = saveCustomer(input())
    for (let i = 0; i < 2; i++) createBill({ lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: c.id, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 149_900 }] })
    const p = getCustomer(c.id)
    expect(p).toMatchObject({ visits: 2, spent: 299_800 })
    expect(p.recentBills).toHaveLength(2)
    expect(p.recentBills[0]!.no).toMatch(/\/0002$/) // newest first
    expect(listCustomers()[0]).toMatchObject({ visits: 2, spent: 299_800 })
  })
})

describe('deleting a customer', () => {
  it('removes the person but keeps their old bills, and only for owner or manager', () => {
    as('owner')
    const cat = listCategories()[0]!.id
    const v = getProduct(createProduct({ name: 'Shirt', brand: '', categoryId: cat, mrp: 100_000, salePrice: 0, cost: 0, sizes: ['M'], colours: ['Red'], opening: { 'Red|M': 3 } }).id).variants[0]!
    as('cashier'); openDay(0)
    const c = saveCustomer(input())
    const bill = createBill({ lines: [{ variantId: v.id, qty: 1, disc: 0 }], customerId: c.id, billDisc: 0, salesBy: null, payments: [{ mode: 'cash', amount: 100_000 }] })
    expect(() => deleteCustomer(c.id)).toThrow('not allowed')
    as('manager')
    deleteCustomer(c.id)
    expect(listCustomers()).toEqual([])
    expect(() => getCustomer(c.id)).toThrow('not found')
    expect(findCustomerByMobile('9876500045')).toBeNull()
    expect(getBill(bill.id).customer?.name).toBe('Deleted customer') // the bill is still there
    expect(() => deleteCustomer(c.id)).toThrow('not found')
    expect(saveCustomer(input()).name).toBe('Rahul Shah') // the number can be used again
  })
})

describe('birthdays and anniversaries today', () => {
  it('lists today\'s celebrations and who agreed to wishes', () => {
    as('cashier')
    const today = toDayMonth(todayMonthDay())
    saveCustomer(input({ birthday: today, anniversary: '', offersConsent: true }))
    saveCustomer(input({ mobile: '9712300031', name: 'Neha Patel', birthday: '', anniversary: today, offersConsent: false }))
    saveCustomer(input({ mobile: '9824012345', name: 'Amit Desai', birthday: '01-01' === today ? '02-02' : '01-01', anniversary: '' }))
    const c = celebrationsToday()
    expect(c.map((x) => [x.name, x.kind, x.offersConsent])).toEqual([['Neha Patel', 'anniversary', false], ['Rahul Shah', 'birthday', true]])
  })
})
