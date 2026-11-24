import { safeStorage } from 'electron'
import { runWhatsAppJob } from './services/wasend'
import { setCodec } from './services/waSecret'

/** Starts the daily WhatsApp wishes job. Errors are logged, never shown: billing must not be affected. */
export function startWhatsAppJob(): void {
  setCodec({
    encrypt: (t) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('This PC cannot protect the access token (Windows encryption is not available).')
      return `enc:${safeStorage.encryptString(t).toString('base64')}`
    },
    decrypt: (t) => (t.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(t.slice(4), 'base64')) : t.replace(/^plain:/, ''))
  })
  const tick = (): void => { void runWhatsAppJob().catch((e) => console.warn('[mars-pos] whatsapp job:', e instanceof Error ? e.message : e)) }
  setTimeout(tick, 30_000) // shortly after start-up
  setInterval(tick, 30 * 60_000)
}
