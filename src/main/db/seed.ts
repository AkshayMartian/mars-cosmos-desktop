import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { hashPin } from '../services/pin'

/**
 * TEMPORARY while developing: default PINs work as-is. Before go-live set this to true so
 * every staff member must choose their own PIN at first login (the flow is built and tested).
 */
const FORCE_PIN_CHANGE = false

/** First run only: default staff and categories. No demo bills. */
export function seedIfEmpty(db: Database.Database): void {
  const has = db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }
  if (has.n > 0) return

  const staff = db.prepare(
    `INSERT INTO staff (id,name,role,pin_hash,must_change_pin,max_discount_pct,commission_pct,can_cancel,can_change_price)
     VALUES (?,?,?,?,${FORCE_PIN_CHANGE ? 1 : 0},?,?,?,?)`
  )
  const cat = db.prepare('INSERT INTO categories (id,name,hsn,gst_mode,gst_rate,is_service) VALUES (?,?,?,?,?,?)')

  db.transaction(() => {
    staff.run(randomUUID(), 'Owner', 'owner', hashPin('1111'), 100, 0, 1, 1)
    staff.run(randomUUID(), 'Manager', 'manager', hashPin('2222'), 30, 1, 1, 1)
    staff.run(randomUUID(), 'Cashier', 'cashier', hashPin('3333'), 10, 1, 0, 0)
    staff.run(randomUUID(), 'Store staff', 'store', hashPin('4444'), 0, 1, 0, 0)

    for (const [name, hsn] of [['Shirts', '6205'], ['Trousers', '6203'], ['Jeans', '6203'], ['T-Shirts', '6109']])
      cat.run(randomUUID(), name, hsn, 'auto', 0, 0)
    for (const [name, hsn] of [['Belts', '4203'], ['Watches', '9102'], ['Goggles', '9004'], ['Wallets', '4202']])
      cat.run(randomUUID(), name, hsn, 'fixed', 18, 0)
    cat.run(randomUUID(), 'Alteration service', 'SAC (ask CA)', 'fixed', 18, 1)

    const set = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)')
    set.run('gst_scheme', JSON.stringify('regular'))
    set.run('coins', JSON.stringify({ on: false, per: 100, value: 1, expiryMonths: 6, maxPct: 20 }))
    set.run('receipt', JSON.stringify({ returnDays: 7, creditNoteDays: 90, width: '80 mm' }))
    set.run('security', JSON.stringify({ idleMinutes: 10 }))
  })()
}
