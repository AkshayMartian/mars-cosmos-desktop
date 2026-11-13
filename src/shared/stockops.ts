import type { Role } from './types'

/** Stock out, adjustments and stock count: data shapes that cross the IPC boundary. */

/** A manager or owner approving something a normal user may not do alone. */
export interface ApprovalInput {
  staffId: string
  pin: string
}

export interface ApproverDto {
  id: string
  name: string
  role: Role
}

export type OutType = 'supplier_return' | 'damage' | 'dispatch' | 'other'

export const OUT_TYPES: { value: OutType; label: string }[] = [
  { value: 'supplier_return', label: 'Return to supplier' },
  { value: 'damage', label: 'Damaged' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'other', label: 'Other' }
]

export interface StockOutInput {
  type: OutType
  supplierId: string | null
  reason: string
  lines: { variantId: string; qty: number }[]
  /** needed when an item would go below zero stock */
  approval?: ApprovalInput
}

export type AdjustReason = 'damaged' | 'lost' | 'found' | 'correction'

export const ADJUST_REASONS: { value: AdjustReason; label: string }[] = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'found', label: 'Found' },
  { value: 'correction', label: 'Correction' }
]

export interface AdjustInput {
  variantId: string
  /** + adds stock, - removes it */
  change: number
  reason: AdjustReason
  approval?: ApprovalInput
}

export interface CountLineDto {
  variantId: string
  label: string
  barcode: string
  /** what the system said when the count was started */
  system: number
  counted: number
}

export interface CountDto {
  id: string
  at: string
  lines: CountLineDto[]
}

export interface MoveFullRow {
  at: string
  label: string
  type: string
  qty: number
  ref: string | null
  reason: string | null
  staff: string | null
}
