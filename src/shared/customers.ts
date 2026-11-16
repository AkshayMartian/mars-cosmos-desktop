import type { Paise } from './money'

/** Customer data shapes that cross the IPC boundary. Birthdays/anniversaries are stored MM-DD, typed DD-MM. */

/**
 * The sizes the customer *wears* (not products): plain text, all optional.
 * Stored as JSON in `customers.sizes`: {"shirt":"40","trouser":"32","shoe":"9"}.
 */
export interface CustomerSizes {
  shirt: string
  trouser: string
  shoe: string
}

export const NO_SIZES: CustomerSizes = { shirt: '', trouser: '', shoe: '' }

/** Reads the stored JSON safely: anything missing or broken becomes blank boxes. */
export function parseSizes(json: string | null | undefined): CustomerSizes {
  try {
    const o = JSON.parse(json ?? '') as Partial<Record<keyof CustomerSizes, unknown>>
    const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    return { shirt: s(o.shirt), trouser: s(o.trouser), shoe: s(o.shoe) }
  } catch {
    return { ...NO_SIZES }
  }
}

/** "Shirt 40 · Trouser 32 · Shoe 9" (only the sizes that are filled in; '' when none). */
export function sizesText(s: CustomerSizes): string {
  return [s.shirt && `Shirt ${s.shirt}`, s.trouser && `Trouser ${s.trouser}`, s.shoe && `Shoe ${s.shoe}`].filter(Boolean).join(' · ')
}

export interface CustomerListRow {
  id: string
  name: string
  mobile: string
  visits: number
  spent: Paise
}

export interface CustomerProfile {
  id: string
  name: string
  mobile: string
  /** MM-DD or '' */
  birthday: string
  anniversary: string
  sizes: CustomerSizes
  notes: string
  gstin: string
  waConsent: boolean
  offersConsent: boolean
  consentAt: string | null
  consentBy: string | null
  visits: number
  spent: Paise
  /** coins the customer can spend now, and the unused credit note balance */
  coins: number
  creditNotes: Paise
  recentBills: { no: string; at: string; grand: Paise }[]
}

export interface CustomerSaveInput {
  /** present when editing */
  id?: string
  mobile: string
  name: string
  /** DD-MM as typed */
  birthday: string
  anniversary: string
  sizes: CustomerSizes
  notes: string
  gstin: string
  waConsent: boolean
  offersConsent: boolean
}

export interface CelebrationDto {
  id: string
  name: string
  mobile: string
  kind: 'birthday' | 'anniversary'
  /** customer agreed to offers and wishes: only then is a wish sent */
  offersConsent: boolean
}
