import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** PINs are never stored in plain text. Format: scrypt$<salt hex>$<hash hex>. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

const WEAK = new Set(['0000', '1111', '2222', '3333', '4444', '1234', '123456', '111111', '000000'])
export const isWeakPin = (pin: string): boolean => WEAK.has(pin) || /^(\d)\1+$/.test(pin)
