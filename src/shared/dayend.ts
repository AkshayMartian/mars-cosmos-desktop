import type { Paise } from './money'

/** Day end: data shapes that cross the IPC boundary. Money is always paise. */

export interface DayEndSummary {
  /** null = no day is open on this counter */
  session: { id: string; date: string; counter: string; openedAt: string; openedBy: string } | null
  opening: Paise
  /** cash taken on completed bills today */
  cashIn: Paise
  /** cash given back (refunds), as a positive number */
  cashOut: Paise
  /** number of completed sale bills today */
  salesCount: number
  expenses: { id: string; note: string; amount: Paise; at: string; staff: string | null }[]
  expensesTotal: Paise
  /** opening + cash in - cash out - expenses */
  expected: Paise
}

export interface CloseDayResult {
  expected: Paise
  counted: Paise
  /** counted minus expected: negative = cash is short */
  diff: Paise
  backup: { ok: true; file: string } | { ok: false; error: string }
}
