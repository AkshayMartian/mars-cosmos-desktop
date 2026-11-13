/** EAN-13 check digit for a 12-digit body. */
export function ean13(body12: string): string {
  if (!/^\d{12}$/.test(body12)) throw new Error('EAN-13 body must be 12 digits')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 ? 3 : 1)
  return body12 + ((10 - (sum % 10)) % 10)
}

/** Prefix 20-29 is reserved for in-store codes, so ours never clash with brand barcodes. */
export const storeBarcode = (seq: number): string => ean13('2000' + String(seq).padStart(8, '0'))
