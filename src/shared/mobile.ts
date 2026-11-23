/** Indian mobile numbers: 10 digits, the first one 6, 7, 8 or 9. Used by every mobile field, on screen and in the main process. */

export const MOBILE_MSG = 'Enter a valid Indian mobile number: 10 digits starting with 6, 7, 8 or 9.'

/** Digits only. A pasted +91 / 91 / 0 in front of the 10 digits is dropped. Never longer than 10 digits. */
export function cleanMobile(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}

export const isIndianMobile = (digits: string): boolean => /^[6-9]\d{9}$/.test(digits)

/**
 * The cleaned number, or throws MOBILE_MSG. With `optional`, an empty field is fine and gives ''.
 * Letters-only or too-long input is refused rather than quietly cut.
 */
export function checkMobile(raw: string | undefined, optional = false): string {
  const text = (raw ?? '').trim()
  if (!text && optional) return ''
  const all = text.replace(/\D/g, '')
  const m = cleanMobile(text)
  if (!isIndianMobile(m) || (all.length > 10 && all !== '91' + m && all !== '0' + m)) throw new Error(MOBILE_MSG)
  return m
}
