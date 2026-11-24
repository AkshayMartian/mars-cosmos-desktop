import { checkMobile } from './mobile'
import type { ShopSettings } from './settings'
import { STATE_OPTIONS, stateForCode } from './states'

/** Shop details rules, used by the Settings / setup screen (as you type) and by the main process (on save). */
export type ShopErrors = Partial<Record<keyof ShopSettings, string>>

export const GSTIN_RE = /^(0[1-9]|[1-2]\d|3[0-8])[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/

export const SHOP_PHONE_MSG = 'The phone number must be a mobile number: 10 digits starting with 6, 7, 8 or 9.'

/** Mobile numbers only: 10 digits starting 6-9. A pasted +91 or 0 in front is fine; too-long input is refused, not cut. */
export function isShopPhone(raw: string): boolean {
  try { checkMobile(raw); return true } catch { return false }
}

export function shopErrors(s: ShopSettings): ShopErrors {
  const e: ShopErrors = {}
  const name = s.name.trim()
  if (!name) e.name = 'Type the shop name.'
  else if (name.length < 2) e.name = 'The shop name is too short.'
  else if (name.length > 80) e.name = 'The shop name can be 80 characters at most.'
  else if (!/[A-Za-z0-9]/.test(name)) e.name = 'The shop name needs letters or numbers.'
  const phone = s.phone.trim()
  if (phone && !isShopPhone(phone)) e.phone = SHOP_PHONE_MSG
  if (s.address.trim().length > 200) e.address = 'The address can be 200 characters at most.'
  const g = s.gstin.trim().toUpperCase()
  if (g && !GSTIN_RE.test(g)) e.gstin = 'The GSTIN is not valid. It has 15 characters, like 24AAAAA1111A1Z5 (starts with the 2-digit state code).'
  const st = s.state.trim()
  if (st && !STATE_OPTIONS.includes(st)) e.state = 'Choose the state from the list.'
  else if (st && !e.gstin && g && !g.startsWith(st.slice(0, 2))) e.state = `The GSTIN starts with ${g.slice(0, 2)} (${stateForCode(g.slice(0, 2)).slice(3)}), so the state should match.`
  return e
}
