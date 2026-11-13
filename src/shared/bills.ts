import type { BillDto } from './billing'
import type { Paise } from './money'
import type { ApprovalInput } from './stockops'

/** Data shapes for the Bills screen. Money is paise. */

export type BillPeriod = 'today' | '7' | 'all'

export interface BillListRow {
  id: string
  no: string
  type: 'sale' | 'return'
  status: 'completed' | 'cancelled'
  at: string
  customerName: string | null
  grand: Paise
  /** payment modes used, e.g. ['cash','upi'] */
  modes: string[]
}

export interface BillDetail {
  bill: BillDto
  cancelReason: string | null
  cancelledBy: string | null
  /** true when this bill can be cancelled right now */
  cancellable: boolean
  /** why it cannot be cancelled (shown as a hint); null when it can */
  cancelHint: string | null
  /** true when the person using the screen needs a manager's PIN to cancel */
  needsApproval: boolean
}

export interface CancelInput {
  billId: string
  reason: string
  approval?: ApprovalInput
}
