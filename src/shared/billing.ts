import type { CustomerSizes } from './customers'
import type { Paise } from './money'
import type { BillAlteration } from './alterations'
import type { GstRule, GstScheme, Role } from './types'
import type { CoinSettings } from './settings'

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
  /** serial numbers are on for this product: every piece is scanned by its own sticker */
  tracked: boolean
}

/** A piece found by scanning its sticker. */
export interface ScannedPiece { variant: SellableVariant; serial: string }

/** A bunch: many pieces of one variant sold together as one line with its own barcode. */
export interface BunchDto { code: string; serials: string[] }

/** One line of a bill as the screen sends it. Tracked items carry the serials of their pieces (qty = how many). */
export interface BillLineInput {
  variantId: string
  qty: number
  /** line discount, paise */
  disc: Paise
  serials?: string[]
  /** the bunch barcode, when the line is a bunch */
  bunch?: string
}

export interface ShopInfo {
  name: string
  address: string
  phone: string
  gstin: string
  policy: string
  footer: string
  /** paper width and review link from Settings → Receipt */
  width?: '80 mm' | '58 mm'
  review?: string
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
  /** the person logged in: the default salesperson */
  meId: string
  shop: ShopInfo
  /** coin rules from Settings → Coins */
  coins: CoinSettings
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
  /** coins the customer can spend now (expired ones already dropped) */
  coins: number
}

export interface NewCustomerInput {
  mobile: string
  name: string
  waConsent: boolean
  offersConsent: boolean
}

export type PayMode = 'cash' | 'upi' | 'card'

export interface NewBillInput {
  lines: BillLineInput[]
  customerId: string | null
  billDisc: Paise
  /** coins the customer spends on this bill (needs a customer; checked against balance and the max % of the bill) */
  coinsUsed?: number
  /** who gets the commission; defaults to the person billing */
  salesBy: string | null
  payments: { mode: PayMode; amount: Paise }[]
  /** credit notes of this customer used as part payment; each is checked for owner, balance and expiry */
  creditNotes?: { id: string; amount: Paise }[]
  /** tailoring jobs for garments on this bill (needs a customer); a charge marked 'bill' becomes a line on the bill */
  alterations?: BillAlteration[]
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
  customer: { name: string; mobile: string | null; gstin: string | null; /** agreed to get the bill on WhatsApp */ waConsent?: boolean } | null
  lines: { name: string; colour: string; size: string; qty: number; price: Paise; rate: number; total: Paise; hsn: string }[]
  subtotal: Paise
  discount: Paise
  taxable: Paise
  cgst: Paise
  sgst: Paise
  roundOff: Paise
  grand: Paise
  /** coins spent on this bill, their value, coins earned and the customer's balance now */
  coinsUsed?: number
  coinValue?: Paise
  coinsEarned?: number
  coinBalance?: number
  payments: { mode: string; amount: Paise }[]
  /** alteration jobs made with this bill (printed on the receipt) */
  alterations?: { id: string; no: string; work: string[]; dueAt: string }[]
}

export interface HeldBillDto {
  id: string
  at: string
  staffName: string
  items: number
}

export interface HeldPayload {
  lines: BillLineInput[]
  customerId: string | null
  /** kept so a resumed bill comes back exactly as it was left (older held bills do not have these) */
  customerMobile?: string | null
  billDisc?: Paise
  salesBy?: string | null
}
