import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import type { CustomerDto, NewCustomerInput } from '@shared/billing'
import type { CelebrationDto, CustomerListRow, CustomerProfile, CustomerSaveInput, CustomerSizes } from '@shared/customers'
import { NO_SIZES, parseSizes } from '@shared/customers'
import { parseDayMonth, todayMonthDay } from '@shared/dates'
import { audit } from './auth'
import { requireRole } from './session'
import { liveBalance } from './coins'

interface Row { id: string; name: string; mobile: string; gstin: string | null; sizes: string | null; wa: number; offers: number }
const toDto = (r: Row, coins = 0): CustomerDto => ({ id: r.id, name: r.name, mobile: r.mobile, gstin: r.gstin, sizes: parseSizes(r.sizes), waConsent: !!r.wa, offersConsent: !!r.offers, coins })

const SELECT = 'SELECT id,name,mobile,gstin,sizes,wa_consent AS wa,offers_consent AS offers FROM customers'

const MAX_SIZE_LENGTH = 20

/** The three "usual size" boxes, trimmed and checked, ready to store as JSON. */
function cleanSizes(input: Partial<CustomerSizes> | undefined): CustomerSizes {
  const out = { ...NO_SIZES }
  for (const k of ['shirt', 'trouser', 'shoe'] as const) {
    const v = String(input?.[k] ?? '').trim()
    if (v.length > MAX_SIZE_LENGTH) throw new Error(`A size is too long (${MAX_SIZE_LENGTH} characters at most).`)
    out[k] = v
  }
  return out
}

export function findCustomerByMobile(mobile: string): CustomerDto | null {
  requireRole('owner', 'manager', 'cashier')
  const m = mobile.replace(/\D/g, '')
  if (m.length !== 10) throw new Error('Enter a 10-digit mobile number.')
  const r = getDb().prepare(`${SELECT} WHERE mobile=? AND deleted_at IS NULL`).get(m) as Row | undefined
  return r ? toDto(r, liveBalance(r.id)) : null
}

/* ---------- the Customers screen ---------- */

const GSTIN = /^(0[1-9]|[12]\d|3[0-8])[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/ // state code, PAN, entity, Z, check character
const SELLERS = ['owner', 'manager', 'cashier'] as const

const STATS = `(SELECT COUNT(*) FROM bills b WHERE b.customer_id=c.id AND b.type='sale' AND b.status='completed') AS visits,
               (SELECT COALESCE(SUM(b.grand),0) FROM bills b WHERE b.customer_id=c.id AND b.status='completed') AS spent`

export function listCustomers(q = ''): CustomerListRow[] {
  requireRole(...SELLERS)
  const like = `%${q.trim()}%`
  return getDb()
    .prepare(
      `SELECT c.id,c.name,c.mobile,${STATS} FROM customers c
       WHERE c.deleted_at IS NULL AND c.mobile IS NOT NULL AND (@q='' OR c.name LIKE @like OR c.mobile LIKE @like) ORDER BY c.name`
    )
    .all({ q: q.trim(), like }) as CustomerListRow[]
}

export function getCustomer(id: string): CustomerProfile {
  requireRole(...SELLERS)
  const db = getDb()
  const r = db
    .prepare(
      `SELECT c.id,c.name,c.mobile,COALESCE(c.birthday,'') AS birthday,COALESCE(c.anniversary,'') AS anniversary,
              COALESCE(c.notes,'') AS notes,COALESCE(c.gstin,'') AS gstin,c.sizes AS sizesJson,c.wa_consent AS wa,c.offers_consent AS offers,
              c.consent_at AS consentAt,s.name AS consentBy,${STATS}
       FROM customers c LEFT JOIN staff s ON s.id=c.consent_by WHERE c.id=? AND c.deleted_at IS NULL`
    )
    .get(id) as (Omit<CustomerProfile, 'waConsent' | 'offersConsent' | 'recentBills' | 'sizes' | 'coins' | 'creditNotes'> & { wa: number; offers: number; sizesJson: string | null }) | undefined
  if (!r) throw new Error('Customer not found.')
  const { wa, offers, sizesJson, ...rest } = r
  return {
    ...rest,
    waConsent: !!wa,
    offersConsent: !!offers,
    sizes: parseSizes(sizesJson),
    coins: liveBalance(id),
    creditNotes: (db.prepare('SELECT COALESCE(SUM(balance),0) AS n FROM credit_notes WHERE customer_id=? AND balance>0 AND expires_at>?').get(id, new Date().toISOString()) as { n: number }).n,
    recentBills: db.prepare("SELECT no,at,grand FROM bills WHERE customer_id=? AND status='completed' ORDER BY at DESC, rowid DESC LIMIT 6").all(id) as CustomerProfile['recentBills']
  }
}

/**
 * Add or edit. Consent is stamped with today's date and the staff member who asked, whenever it is given
 * for the first time or changed; an edit that leaves it alone keeps the original record.
 */
export function saveCustomer(input: CustomerSaveInput): CustomerProfile {
  const actor = requireRole(...SELLERS)
  const db = getDb()
  const mobile = input.mobile.replace(/\D/g, '')
  const name = input.name.trim()
  if (mobile.length !== 10) throw new Error('Mobile must be 10 digits.')
  if (!name) throw new Error('Name is required.')
  const birthday = parseDayMonth(input.birthday)
  if (birthday === null) throw new Error('Birthday must be a real date like 21-08 (day-month).')
  const anniversary = parseDayMonth(input.anniversary)
  if (anniversary === null) throw new Error('Anniversary must be a real date like 04-12 (day-month).')
  const gstin = input.gstin.trim().toUpperCase()
  if (gstin && !GSTIN.test(gstin)) throw new Error('GSTIN is not valid. It has 15 characters, like 24ABCDE1234F1Z5.')
  const clash = db.prepare('SELECT id FROM customers WHERE mobile=? AND (? IS NULL OR id<>?)').get(mobile, input.id ?? null, input.id ?? null)
  if (clash) throw new Error('A customer with this mobile already exists.')

  const wa = input.waConsent ? 1 : 0
  const offers = input.offersConsent ? 1 : 0
  // The customer's usual sizes (what they wear): three plain-text boxes, kept as JSON. Not products: no prices, no stock.
  const sizes = JSON.stringify(cleanSizes(input.sizes))
  const fields = [mobile, name, birthday || null, anniversary || null, input.notes.trim() || null, gstin || null, sizes, wa, offers] as const

  let id = input.id
  db.transaction(() => {
    if (id) {
      const old = db.prepare('SELECT wa_consent AS wa,offers_consent AS offers FROM customers WHERE id=? AND deleted_at IS NULL').get(id) as { wa: number; offers: number } | undefined
      if (!old) throw new Error('Customer not found.')
      db.prepare('UPDATE customers SET mobile=?,name=?,birthday=?,anniversary=?,notes=?,gstin=?,sizes=?,wa_consent=?,offers_consent=? WHERE id=?').run(...fields, id)
      if (old.wa !== wa || old.offers !== offers) db.prepare('UPDATE customers SET consent_at=?,consent_by=? WHERE id=?').run(new Date().toISOString(), actor.id, id)
      audit(actor.id, 'customer_edit', { id })
    } else {
      id = randomUUID()
      const consented = wa || offers
      db.prepare('INSERT INTO customers (mobile,name,birthday,anniversary,notes,gstin,sizes,wa_consent,offers_consent,id,consent_at,consent_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(...fields, id, consented ? new Date().toISOString() : null, consented ? actor.id : null)
      audit(actor.id, 'customer_create', { id })
    }
  })()
  return getCustomer(id!)
}

/** The person's details are removed; their old bills stay (shown as "Deleted customer"). */
export function deleteCustomer(id: string): void {
  const actor = requireRole('owner', 'manager')
  const db = getDb()
  db.transaction(() => {
    const r = db
      .prepare(
        `UPDATE customers SET mobile=NULL,name='Deleted customer',birthday=NULL,anniversary=NULL,size_shirt=NULL,size_trouser=NULL,size_shoe=NULL,sizes=NULL,
                notes=NULL,gstin=NULL,wa_consent=0,offers_consent=0,consent_at=NULL,consent_by=NULL,deleted_at=? WHERE id=? AND deleted_at IS NULL`
      )
      .run(new Date().toISOString(), id)
    if (!r.changes) throw new Error('Customer not found.')
    db.prepare('DELETE FROM customer_sizes WHERE customer_id=?').run(id) // old per-category sizes (kept table, no longer used): never leave personal data behind
    audit(actor.id, 'customer_delete', { id })
  })()
}

/** Birthdays and anniversaries today. Only customers who agreed to offers and wishes should be messaged. */
export function celebrationsToday(): CelebrationDto[] {
  requireRole(...SELLERS)
  const md = todayMonthDay()
  const rows = getDb()
    .prepare('SELECT id,name,mobile,birthday,anniversary,offers_consent AS offers FROM customers WHERE deleted_at IS NULL AND mobile IS NOT NULL AND (birthday=? OR anniversary=?) ORDER BY name')
    .all(md, md) as { id: string; name: string; mobile: string; birthday: string | null; anniversary: string | null; offers: number }[]
  return rows.flatMap((r) => {
    const out: CelebrationDto[] = []
    if (r.birthday === md) out.push({ id: r.id, name: r.name, mobile: r.mobile, kind: 'birthday', offersConsent: !!r.offers })
    if (r.anniversary === md) out.push({ id: r.id, name: r.name, mobile: r.mobile, kind: 'anniversary', offersConsent: !!r.offers })
    return out
  })
}

/** Consent is recorded with today's date and the staff member who asked, as the design requires. */
export function createCustomer(input: NewCustomerInput): CustomerDto {
  const actor = requireRole('owner', 'manager', 'cashier')
  const mobile = input.mobile.replace(/\D/g, '')
  const name = input.name.trim()
  if (mobile.length !== 10) throw new Error('Mobile must be 10 digits.')
  if (!name) throw new Error('Name is required.')
  if (getDb().prepare('SELECT 1 FROM customers WHERE mobile=?').get(mobile)) throw new Error('A customer with this mobile already exists.')

  const id = randomUUID()
  const consented = input.waConsent || input.offersConsent
  getDb()
    .prepare('INSERT INTO customers (id,mobile,name,sizes,wa_consent,offers_consent,consent_at,consent_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, mobile, name, JSON.stringify(NO_SIZES), input.waConsent ? 1 : 0, input.offersConsent ? 1 : 0, consented ? new Date().toISOString() : null, consented ? actor.id : null)
  audit(actor.id, 'customer_create', { id })
  return { id, name, mobile, gstin: null, sizes: { ...NO_SIZES }, waConsent: input.waConsent, offersConsent: input.offersConsent, coins: 0 }
}
