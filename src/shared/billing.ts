import type { CustomerSizes } from './customers'
import type { Paise } from './money'
import type { GstRule, GstScheme, Role } from './types'

/** Data shapes for billing that cross the IPC boundary. Money is always paise. */

export interface SellableVariant {
  id: string
  name: string
  colour: string
  size: string
  label: string
  barcode: string
  mrp: Paise
  /** selling price, GST inclusive */
  price: Paise
  stock: number
  gst: GstRule
}

export interface ShopInfo {
  name: string
  address: string
  phone: string
  gstin: string
  policy: string
  footer: string
}

export interface BillingContext {
  gstScheme: GstScheme
  /** null = the day has not been started yet (opening cash) */
  session: { id: string; opening: Paise; openedAt: string } | null
  salespeople: { id: string; name: string }[]
  /** owners and managers who can approve a big discount or an out-of-stock sale */
  approvers: { id: string; name: string; role: Role }[]
  /** this user's own discount limit; owner and manager are not limited */
  maxDiscountPct: number
  actorRole: Role
  shop: ShopInfo
}

export interface CustomerDto {
  id: string
  name: string
  mobile: string
  gstin: string | null
  /** the customer's usual sizes, shown on the Billing customer card */
  sizes: CustomerSizes
  waConsent: boolean
  offersConsent: boolean
}

export interface NewCustomerInput {
  mobile: string
  name: string
  waConsent: boolean
  offersConsent: boolean
}

export type PayMode = 'cash' | 'upi' | 'card'

export interface NewBillInput {
  lines: { variantId: string; qty: number; /** line discount, paise */ disc: Paise }[]
  customerId: string | null
  billDisc: Paise
  /** who gets the commission; defaults to the person billing */
  salesBy: string | null
  payments: { mode: PayMode; amount: Paise }[]
  /** needed when the discount is above the user's limit or an item is out of stock */
  approval?: { staffId: string; pin: string }
}

export interface BillDto {
  id: string
  no: string
  type: 'sale' | 'return'
  status: 'completed' | 'cancelled'
  at: string
  staffName: string
  customer: { name: string; mobile: string | null; gstin: string | null } | null
  lines: { name: string; colour: string; size: string; qty: number; price: Paise; rate: number; total: Paise; hsn: string }[]
  subtotal: Paise
  discount: Paise
  taxable: Paise
  cgst: Paise
  sgst: Paise
  roundOff: Paise
  grand: Paise
  payments: { mode: string; amount: Paise }[]
}

export interface HeldBillDto {
  id: string
  at: string
  staffName: string
  items: number
}

export interface HeldPayload {
  lines: { variantId: string; qty: number; disc: Paise }[]
  customerId: string | null
}
