import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { getDb } from '../db'
import type {
  AllSettings, BackupInfo, CoinSettings, PrinterSettings, ReceiptSettings, ShopSettings, StaffAdminRow, StaffSaveInput
} from '@shared/settings'
import type { GstScheme, Role } from '@shared/types'
import { checkMobile } from '@shared/mobile'
import { shopErrors } from '@shared/shopValidation'
import { audit } from './auth'
import { backupFolder, runBackup } from './backup'
import { hashPin, isWeakPin } from './pin'
import { requireRole } from './session'
import { getSetting } from './settings'

/** The Settings screen: owner only, every change audited as `settings_change`. */

const put = (key: string, value: unknown): void => {
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value))
}
const text = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max)
const owner = () => requireRole('owner')

const SHOP_DEFAULT = { name: '', phone: '', address: '', gstin: '', state: '', policy: 'Exchange within 7 days with this bill. No cash refund on sale items.', footer: 'Thank you! Visit again.' }
const RECEIPT_DEFAULT = { returnDays: 7, creditNoteDays: 90, width: '80 mm', review: '', footer: SHOP_DEFAULT.footer, policy: SHOP_DEFAULT.policy }
const COINS_DEFAULT: CoinSettings = { on: false, per: 100, value: 1, expiryMonths: 6, maxPct: 20 }

export function getAllSettings(): AllSettings {
  owner()
  const shop = { ...SHOP_DEFAULT, ...getSetting<Record<string, string>>('shop', {}) }
  // footer and policy live in the receipt setting; an older shop setting is the fallback
  const receipt = { ...RECEIPT_DEFAULT, footer: shop.footer, policy: shop.policy, ...getSetting<Partial<ReceiptSettings>>('receipt', {}) }
  const printers = { receipt: '', drawer: false, ...getSetting<Partial<PrinterSettings>>('printers', {}) }
  return {
    shop: { name: shop.name, phone: shop.phone, address: shop.address, gstin: shop.gstin, state: shop.state },
    gst: getSetting<GstScheme>('gst_scheme', 'regular'),
    receipt: { footer: receipt.footer, policy: receipt.policy, review: receipt.review, returnDays: receipt.returnDays, creditNoteDays: receipt.creditNoteDays, width: receipt.width === '58 mm' ? '58 mm' : '80 mm' },
    printers,
    coins: { ...COINS_DEFAULT, ...getSetting<Partial<CoinSettings>>('coins', {}) }
  }
}

export function saveShop(s: ShopSettings): ShopSettings {
  const a = owner()
  const clean = { name: text(s.name, 80), phone: text(s.phone, 20), address: text(s.address, 200), gstin: text(s.gstin, 15).toUpperCase(), state: text(s.state, 40) }
  const bad = Object.values(shopErrors({ ...clean, name: String(s.name ?? ''), phone: String(s.phone ?? ''), address: String(s.address ?? ''), gstin: String(s.gstin ?? ''), state: String(s.state ?? '') }))[0]
  if (bad) throw new Error(bad)
  const { name, gstin } = clean
  const phone = checkMobile(clean.phone, true) // stored as the plain 10 digits
  const next = { ...getSetting<Record<string, unknown>>('shop', {}), name, phone, address: clean.address, gstin, state: clean.state }
  put('shop', next)
  audit(a.id, 'settings_change', { key: 'shop' })
  return getAllSettings().shop
}

export function saveGst(scheme: GstScheme): GstScheme {
  const a = owner()
  if (!['regular', 'composition', 'unregistered'].includes(scheme)) throw new Error('Choose a GST type.')
  put('gst_scheme', scheme)
  audit(a.id, 'settings_change', { key: 'gst_scheme', scheme })
  return scheme
}

export function saveReceipt(r: ReceiptSettings): ReceiptSettings {
  const a = owner()
  if (!Number.isInteger(r.returnDays) || r.returnDays < 0 || r.returnDays > 365) throw new Error('Return window must be 0 to 365 days.')
  if (!Number.isInteger(r.creditNoteDays) || r.creditNoteDays < 1 || r.creditNoteDays > 730) throw new Error('Credit note validity must be 1 to 730 days.')
  if (!['80 mm', '58 mm'].includes(r.width)) throw new Error('Choose the paper width.')
  const review = text(r.review, 300)
  if (review && !/^https?:\/\//i.test(review)) throw new Error('The review link must start with http:// or https://')
  put('receipt', { ...getSetting<Record<string, unknown>>('receipt', {}), footer: text(r.footer, 120), policy: text(r.policy, 300), returnDays: r.returnDays, creditNoteDays: r.creditNoteDays, width: r.width, review })
  audit(a.id, 'settings_change', { key: 'receipt' })
  return getAllSettings().receipt
}

export function savePrinters(p: PrinterSettings): PrinterSettings {
  const a = owner()
  put('printers', { receipt: text(p.receipt, 120), drawer: !!p.drawer })
  audit(a.id, 'settings_change', { key: 'printers' })
  return getAllSettings().printers
}

export function saveCoins(c: CoinSettings): CoinSettings {
  const a = owner()
  if (!Number.isInteger(c.per) || c.per < 1) throw new Error('"1 coin for every ₹" must be a whole number, 1 or more.')
  if (!Number.isFinite(c.value) || c.value <= 0) throw new Error('A coin must be worth more than ₹0.')
  if (!Number.isInteger(c.expiryMonths) || c.expiryMonths < 1 || c.expiryMonths > 60) throw new Error('Coins expire after 1 to 60 months.')
  if (!Number.isInteger(c.maxPct) || c.maxPct < 0 || c.maxPct > 100) throw new Error('Max use per bill must be 0 to 100%.')
  put('coins', { on: !!c.on, per: c.per, value: c.value, expiryMonths: c.expiryMonths, maxPct: c.maxPct })
  audit(a.id, 'settings_change', { key: 'coins', on: !!c.on })
  return getAllSettings().coins
}

/* ---------- staff ---------- */

const ROLES: Role[] = ['owner', 'manager', 'cashier', 'store']
type Raw = { id: string; name: string; role: Role; max_discount_pct: number; commission_pct: number; can_cancel: number; can_change_price: number; active: number }
const toRow = (r: Raw): StaffAdminRow => ({
  id: r.id, name: r.name, role: r.role, maxDiscountPct: r.max_discount_pct, commissionPct: r.commission_pct,
  canCancel: !!r.can_cancel, canChangePrice: !!r.can_change_price, active: !!r.active
})

export function listStaffAdmin(): StaffAdminRow[] {
  owner()
  return (getDb().prepare('SELECT id,name,role,max_discount_pct,commission_pct,can_cancel,can_change_price,active FROM staff ORDER BY rowid').all() as Raw[]).map(toRow)
}

export function saveStaff(i: StaffSaveInput): StaffAdminRow[] {
  const a = owner()
  const db = getDb()
  const name = text(i.name, 60)
  if (!name) throw new Error('Name is required.')
  if (!ROLES.includes(i.role)) throw new Error('Choose a role.')
  if (!Number.isFinite(i.maxDiscountPct) || i.maxDiscountPct < 0 || i.maxDiscountPct > 100) throw new Error('Max discount must be 0 to 100%.')
  if (!Number.isFinite(i.commissionPct) || i.commissionPct < 0 || i.commissionPct > 100) throw new Error('Commission must be 0 to 100%.')
  if (i.id) {
    const cur = db.prepare('SELECT role FROM staff WHERE id=?').get(i.id) as { role: Role } | undefined
    if (!cur) throw new Error('Staff member not found.')
    const role = cur.role === 'owner' ? 'owner' : i.role === 'owner' ? cur.role : i.role // the owner role is never given or taken here
    const active = cur.role === 'owner' ? true : i.active
    if (i.id === a.id && !i.active) throw new Error('You cannot make yourself inactive.')
    db.prepare('UPDATE staff SET name=?,role=?,max_discount_pct=?,commission_pct=?,can_cancel=?,can_change_price=?,active=? WHERE id=?')
      .run(name, role, i.maxDiscountPct, i.commissionPct, i.canCancel ? 1 : 0, i.canChangePrice ? 1 : 0, active ? 1 : 0, i.id)
    audit(a.id, 'staff_save', { id: i.id, name })
  } else {
    if (i.role === 'owner') throw new Error('There is one owner. Choose Manager, Cashier or Store staff.')
    const pin = i.pin ?? ''
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits.')
    if (isWeakPin(pin)) throw new Error('Choose a PIN that is harder to guess.')
    const id = randomUUID()
    db.prepare('INSERT INTO staff (id,name,role,pin_hash,must_change_pin,max_discount_pct,commission_pct,can_cancel,can_change_price,active) VALUES (?,?,?,?,1,?,?,?,?,?)')
      .run(id, name, i.role, hashPin(pin), i.maxDiscountPct, i.commissionPct, i.canCancel ? 1 : 0, i.canChangePrice ? 1 : 0, i.active ? 1 : 0)
    audit(a.id, 'staff_save', { id, name, new: true })
  }
  return listStaffAdmin()
}

/** The owner sets a new PIN for someone; that person must change it at the next login (every PIN is exactly 4 digits). */
export function setStaffPin(staffId: string, pin: string): void {
  const a = owner()
  const s = getDb().prepare('SELECT role,name FROM staff WHERE id=?').get(staffId) as { role: Role; name: string } | undefined
  if (!s) throw new Error('Staff member not found.')
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits.')
  if (isWeakPin(pin)) throw new Error('Choose a PIN that is harder to guess.')
  getDb().prepare('UPDATE staff SET pin_hash=?,must_change_pin=?,failed_attempts=0,locked_until=0 WHERE id=?').run(hashPin(pin), staffId === a.id ? 0 : 1, staffId)
  audit(a.id, 'pin_change', { id: staffId, by: 'owner' })
}

/** The first-run wizard is finished (or skipped): the owner is not asked again. */
export function finishSetup(): true {
  const a = owner()
  put('setup_done', true)
  audit(a.id, 'settings_change', { key: 'setup_done' })
  return true
}

/* ---------- backup ---------- */

export function backupInfo(): BackupInfo {
  owner()
  const rows = getDb().prepare('SELECT file,at,size_bytes AS sizeBytes FROM backups ORDER BY id DESC').all() as BackupInfo['list']
  return { folder: backupFolder(), isDefault: !getSetting<string>('backup_folder', ''), copies: rows.length, keep: 30, list: rows }
}

export function saveBackupFolder(folder: string): BackupInfo {
  const a = owner()
  put('backup_folder', text(folder, 400))
  audit(a.id, 'settings_change', { key: 'backup_folder' })
  return backupInfo()
}

export function backupNow(): BackupInfo {
  const a = owner()
  const r = runBackup()
  audit(a.id, 'backup', { file: r.file })
  return backupInfo()
}

/** Deletes one backup from the list: the file (if it is still there) and its row. Only files this app made can be deleted. */
export function deleteBackup(file: string): BackupInfo {
  const a = owner()
  const d = getDb()
  const row = d.prepare('SELECT id FROM backups WHERE file=?').get(String(file ?? '')) as { id: number } | undefined
  if (!row) throw new Error('That backup is not in the list.')
  try { rmSync(file, { force: true }) } catch {
    throw new Error('Could not delete the file. Close any program that has it open, or check the drive is connected, and try again.')
  }
  d.prepare('DELETE FROM backups WHERE id=?').run(row.id)
  audit(a.id, 'backup_delete', { file })
  return backupInfo()
}
