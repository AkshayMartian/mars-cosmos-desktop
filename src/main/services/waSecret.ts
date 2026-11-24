/**
 * The WhatsApp access token must not sit readable in the database (backups go to USB drives). The main process installs
 * a codec that uses Windows' own protection (Electron safeStorage, tied to the Windows user); tests use a plain one.
 */
export interface Codec { encrypt(text: string): string; decrypt(text: string): string }

let codec: Codec = { encrypt: (t) => `plain:${t}`, decrypt: (t) => t.replace(/^plain:/, '') }
export const setCodec = (c: Codec): void => { codec = c }
export const encryptSecret = (t: string): string => codec.encrypt(t)
export const decryptSecret = (t: string): string => codec.decrypt(t)
