import { getDb } from '../db'
import { getSetting } from './settings'

/**
 * The shop logo. Its web address ships inside the app (see brand.ts). The picture is downloaded once, while the PC is
 * online, and kept in the database as a base64 data URI, so the app never needs the internet to show it again.
 * To change the logo later, publish the new picture, change the address in brand.ts and ship an update: the next
 * time the app starts with internet it sees a different address and downloads the new picture.
 */
export interface StoredLogo { url: string; data: string; at: string }

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']
const MAX_BYTES = 1024 * 1024

export function storedLogo(): StoredLogo | null {
  const l = getSetting<StoredLogo | null>('logo', null)
  return l && l.data ? l : null
}

/** The logo as a data URI, or null if none has been downloaded yet. */
export function logoDataUri(): string | null { return storedLogo()?.data ?? null }

/** PNG / JPEG bytes of the stored logo (what the window and taskbar icon need), or null for SVG / none. */
export function logoRaster(): Buffer | null {
  const d = logoDataUri()
  const m = d && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(d)
  return m ? Buffer.from(m[2]!, 'base64') : null
}

export type SyncResult = 'unchanged' | 'downloaded' | 'no-url' | 'failed'

/**
 * Downloads the logo when the address is new (first start, or after an update changed it). Never throws: with no
 * internet, or a bad file, the logo already stored stays in use and the next start tries again.
 */
export async function syncLogo(url: string, fetcher: typeof fetch = fetch): Promise<SyncResult> {
  url = url.trim()
  if (!url) return 'no-url'
  if (storedLogo()?.url === url) return 'unchanged'
  try {
    if (!/^https:\/\//i.test(url)) throw new Error('The logo address must start with https://')
    const res = await fetcher(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!TYPES.includes(type)) throw new Error(`Not a picture (${type || 'unknown type'})`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('The logo file is empty or larger than 1 MB')
    const value: StoredLogo = { url, data: `data:${type};base64,${bytes.toString('base64')}`, at: new Date().toISOString() }
    getDb().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('logo', JSON.stringify(value))
    return 'downloaded'
  } catch (e) {
    console.warn(`[mars-pos] logo not downloaded: ${e instanceof Error ? e.message : e}`)
    return 'failed'
  }
}
