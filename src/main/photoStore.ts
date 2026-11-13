import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Product photos live as small JPEG files on this PC (not inside the database); the table `product_photos` says which
 * colour of which product each file belongs to. A chosen photo is first saved as tmp-<uuid>.jpg and gets its permanent
 * name (<productId>-<colour>.jpg) when it is attached to a product colour. No electron import, so it can be tested.
 */
let dir = ''

export function setPhotoDir(d: string): void {
  dir = d
  mkdirSync(dir, { recursive: true })
}

const SAFE = /^[A-Za-z0-9-]+\.jpg$/ // file names only, never paths

/** "Dark Blue" → "dark-blue"; always safe in a file name. */
export function slug(text: string): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'colour'
}

export function saveTemp(jpeg: Buffer): string {
  const name = `tmp-${randomUUID()}.jpg`
  writeFileSync(join(dir, name), jpeg)
  return name
}

/** Throws unless this is a photo the chooser really made (checked before anything is saved, so nothing is half-done). */
export function assertTemp(tmpName: string): void {
  if (!SAFE.test(tmpName) || !tmpName.startsWith('tmp-')) throw new Error('That photo is not valid. Choose it again.')
  if (!existsSync(join(dir, tmpName))) throw new Error('The chosen photo was not found. Choose it again.')
}

/** Give a chosen (temporary) photo its permanent name, replacing any file already called that. */
export function promoteAs(tmpName: string, finalName: string): string {
  if (!SAFE.test(finalName) || finalName.startsWith('tmp-')) throw new Error('That photo is not valid. Choose it again.')
  assertTemp(tmpName)
  renameSync(join(dir, tmpName), join(dir, finalName))
  return finalName
}

export function removeFile(name: string): void {
  if (SAFE.test(name)) rmSync(join(dir, name), { force: true })
}

/** Temporary picks that were never saved (the user chose a photo, then left) are cleaned up. */
export function purgeTemp(olderThanMs: number): number {
  let n = 0
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('tmp-') || !SAFE.test(f)) continue
    try {
      if (Date.now() - statSync(join(dir, f)).mtimeMs > olderThanMs) { rmSync(join(dir, f), { force: true }); n++ }
    } catch { /* ignore a file that vanished */ }
  }
  return n
}

export function readDataUrl(name: string | null): string | null {
  if (!name || !SAFE.test(name)) return null
  try {
    return `data:image/jpeg;base64,${readFileSync(join(dir, name)).toString('base64')}`
  } catch {
    return null
  }
}
