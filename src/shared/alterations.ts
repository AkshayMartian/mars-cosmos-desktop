import type { Paise } from './money'
import type { PayMode } from './billing'

/** Data shapes and text for Alterations that cross the IPC boundary. Money is paise. */

export const ALT_WORKS = ['Length', 'Waist', 'Sleeves', 'Fitting', 'Hem', 'Buttons', 'Other'] as const

export type AltStatus = 'received' | 'with_tailor' | 'ready' | 'delivered' | 'cancelled'
export type ChargeMode = 'free' | 'bill' | 'pickup'

export const ALT_STATUS: Record<AltStatus, { label: string; tone: 'muted' | 'warn' | 'good' | 'bad' }> = {
  received: { label: 'Received', tone: 'muted' },
  with_tailor: { label: 'With tailor', tone: 'warn' },
  ready: { label: 'Ready for pickup', tone: 'good' },
  delivered: { label: 'Delivered', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'bad' }
}

/** What the next button does for a job in this status. */
export const ALT_NEXT: Partial<Record<AltStatus, string>> = { received: 'Send to tailor', with_tailor: 'Mark ready', ready: 'Hand over' }

export interface TailorDto {
  id: string
  name: string
  mobile: string
  kind: 'In-house' | 'Outside'
  /** what the shop pays this tailor per finished job */
  ratePerJob: Paise
  active: boolean
  openJobs: number
}

export interface AltConfig {
  /** default "ready by" = today + this many days at 6 pm */
  dueDays: number
  /** GST % on alteration charges (confirm with the CA: Q-1) */
  rate: number
  tagPrinter: 'sticker' | 'receipt'
}

export interface AltContext {
  tailors: TailorDto[]
  cfg: AltConfig
  /** owner and manager may add tailors and change the rules */
  canManage: boolean
  /** who may take money (hand over a job with a charge due) */
  canCollect: boolean
  shop: { name: string; phone: string }
}

export interface AltJobDto {
  id: string
  no: string
  billId: string | null
  billNo: string | null
  customerId: string
  customerName: string
  customerMobile: string
  item: string
  work: string[]
  notes: string
  tailorId: string
  tailorName: string
  dueAt: string
  charge: Paise
  chargeMode: ChargeMode
  paid: boolean
  gstRate: number
  status: AltStatus
  createdAt: string
  /** past the ready-by time and not ready / delivered / cancelled */
  late: boolean
}

export interface AltKpis { open: number; dueToday: number; late: number; waiting: number }

export interface AltList { jobs: AltJobDto[]; kpis: AltKpis }

/** One alteration on a bill (the cart line's scissors button). */
export interface BillAlteration {
  /** the garment on the bill this job is for */
  variantId: string
  work: string[]
  notes: string
  tailorId: string
  /** ISO date-time */
  dueAt: string
  charge: Paise
  /** 'bill' = the charge is added to this bill; 'pickup' = paid when the customer collects */
  mode: 'bill' | 'pickup'
}

/** A new job made from the Alterations screen (customer's own garment, or an item from an old bill). */
export interface NewAlterationInput {
  customerId: string
  billId: string | null
  variantId: string | null
  /** typed description when it is the customer's own garment */
  ownItem: string
  work: string[]
  notes: string
  tailorId: string
  dueAt: string
  /** charge is collected at pickup when above 0 */
  charge: Paise
}

export interface GarmentChoice { key: string; billId: string; variantId: string; label: string }

export interface TailorInput { id?: string; name: string; mobile: string; kind: 'In-house' | 'Outside'; ratePerJob: Paise; active: boolean }

export interface DeliverResult { job: AltJobDto; billId: string | null }

export interface DeliverInput { id: string; payMode: PayMode }

/** "Fri, 14 Nov, 6:00 pm" */
export const altDue = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const W = 34
const center = (s: string): string => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
const rupees = (p: Paise): string => '₹' + (p / 100).toLocaleString('en-IN')

/** The slip the customer keeps. */
export function slipText(a: AltJobDto, shop: { name: string; phone: string }): string {
  return [
    center(shop.name.toUpperCase()), center('ALTERATION SLIP'), '-'.repeat(W),
    'Job      ' + a.no, 'Bill     ' + (a.billNo ?? '—'), 'Customer ' + a.customerName, 'Item     ' + a.item, 'Work     ' + a.work.join(', '),
    'Ready by ' + altDue(a.dueAt),
    'Charge   ' + (!a.charge ? 'Free' : rupees(a.charge) + (a.paid ? ' paid' : ' at pickup')),
    '-'.repeat(W), 'Show this slip or your mobile', 'number to collect.', shop.phone ? 'Ph ' + shop.phone : ''
  ].filter((l, i, all) => l !== '' || i < all.length - 1).join('\n')
}

/** The tag that goes on the garment. */
export function tagLines(a: AltJobDto, shop: { name: string }): string[] {
  return [
    `${shop.name} · TAILOR TAG`, a.no, `${a.customerName} · ••${a.customerMobile.slice(-4)}`, a.item, `Work: ${a.work.join(', ')}`,
    ...(a.notes ? [a.notes] : []), `Tailor: ${a.tailorName}`, `READY BY ${altDue(a.dueAt)}`
  ]
}

/** WhatsApp message when the garment is ready. The shop presses Send; nothing goes out by itself. */
export const readyMessage = (a: AltJobDto, shop: { name: string; phone: string }): string =>
  `Hi ${a.customerName}, your ${a.item} (${a.no}) is ready at ${shop.name}. Please collect it any time today.` +
  `${a.charge && !a.paid ? ` Alteration charge: ${rupees(a.charge)}.` : ''}${shop.phone ? ` Ph ${shop.phone}` : ''}`
