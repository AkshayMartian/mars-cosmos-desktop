import type { GstScheme, Role } from './types'

export interface ShopSettings { name: string; phone: string; address: string; gstin: string; state: string }
export interface ReceiptSettings { footer: string; policy: string; review: string; returnDays: number; creditNoteDays: number; width: '80 mm' | '58 mm' }
export interface PrinterSettings { receipt: string; drawer: boolean }
export interface CoinSettings { on: boolean; per: number; value: number; expiryMonths: number; maxPct: number }

export interface AllSettings {
  shop: ShopSettings
  gst: GstScheme
  receipt: ReceiptSettings
  printers: PrinterSettings
  coins: CoinSettings
}

export interface StaffAdminRow {
  id: string; name: string; role: Role; maxDiscountPct: number; commissionPct: number
  canCancel: boolean; canChangePrice: boolean; active: boolean
}
export interface StaffSaveInput {
  id?: string; name: string; role: Role; maxDiscountPct: number; commissionPct: number
  canCancel: boolean; canChangePrice: boolean; active: boolean
  /** required for a new person: 4 digits */
  pin?: string
}

export interface BackupRow { file: string; at: string; sizeBytes: number }
export interface BackupInfo { folder: string; isDefault: boolean; copies: number; keep: number; list: BackupRow[] }

export const GST_SCHEMES: { id: GstScheme; name: string; text: string }[] = [
  { id: 'regular', name: 'Regular GST', text: 'Tax invoice with CGST and SGST on every bill' },
  { id: 'composition', name: 'Composition', text: 'Bill of supply, no GST shown' },
  { id: 'unregistered', name: 'Not registered', text: 'Plain bill, no GSTIN' }
]
export const ROLE_NAMES: Record<Role, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', store: 'Store staff' }
