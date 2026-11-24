import { createPrivateKey, sign } from 'node:crypto'
import type { LicencePayload } from '@shared/licence'

/**
 * MARS side only (the admin portal and scripts/licence.ts): turns a licence into the signed `MARSL1.…` code.
 * The app itself never signs; it only verifies (licence.ts). Keep the private key off shop PCs and out of git.
 */
export function signLicence(p: LicencePayload, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(p), 'utf8')
  const sig = sign(null, body, createPrivateKey(privateKeyPem))
  return `MARSL1.${body.toString('base64url')}.${sig.toString('base64url')}`
}
