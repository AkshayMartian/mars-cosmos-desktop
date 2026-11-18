import type { BillDto } from './billing'
import type { ApprovalInput } from './stockops'
import type { Paise } from './money'
import type { PayMode } from './billing'

/** Data shapes for Return / exchange and credit notes that cross the IPC boundary. Money is paise. */

export interface ReturnBillRow {
  id: string
  no: string
  at: string
  customerName: string | null
  grand: Paise
}

export interface ReturnLine {
  id: number
  variantId: string
  name: string
  colour: string
  size: string
  /** pieces sold, pieces already brought back, pieces that can still come back */
  qty: number
  returned: number
  returnable: number
  /** the alteration charge: a service, never returned (use Alterations to cancel the job) */
  service: boolean
  /** what the customer paid for the whole line (after discounts, GST included) */
  total: Paise
  /** serial numbers of the pieces on this bill line that can still come back (empty = the line is not tracked by serial) */
  pieces: string[]
}

export interface BillForReturn {
  id: string
  no: string
  at: string
  ageDays: number
  windowDays: number
  overWindow: boolean
  /** true when the person using the screen needs a manager's PIN for this return (bill older than the window) */
  needsApproval: boolean
  customerId: string | null
  customerName: string | null
  grand: Paise
  lines: ReturnLine[]
}

export interface ReturnInput {
  billId: string
  /** a line with serial numbers returns exactly the pieces in `serials` (qty = how many) */
  lines: { lineId: number; qty: number; serials?: string[] }[]
  /** exchange: new items taken instead (priced and checked for stock again in the main process); serial items list their pieces */
  newLines: { variantId: string; qty: number; serials?: string[] }[]
  /** when the customer is owed money: a credit note (needs a customer on the bill) or cash from the drawer */
  settle: 'credit_note' | 'cash'
  /** when the customer owes the difference */
  payMode: PayMode
  approval?: ApprovalInput
}

export interface ReturnResult {
  returnBill: BillDto
  saleBill: BillDto | null
  /** credit note issued for the money owed to the customer, if any */
  creditNote: { amount: Paise; expiresAt: string } | null
  cashRefund: Paise
  customerPaid: Paise
}

export interface CreditNoteDto {
  id: string
  balance: Paise
  expiresAt: string
}

/**
 * Share of a bill line that comes back. Cumulative rounding: the pieces returned over several visits always add up
 * to exactly the line's amount, so the last piece never gets more or less than its fair share.
 * `already` = pieces returned before, `q` = pieces returned now.
 */
export function returnPart(amount: Paise, qty: number, already: number, q: number): Paise {
  return Math.round((amount * (already + q)) / qty) - Math.round((amount * already) / qty)
}
