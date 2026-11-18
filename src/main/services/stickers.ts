import { getDb } from '../db'
import { audit } from './auth'
import { requireRole } from './session'
import { getSetting } from './settings'
import { LABEL_SIZES, MAX_PER_ITEM, type StickerContext, type StickerItem } from '@shared/stickers'
import { SERIAL_MSG } from '@shared/serials'
import { findPiece, inStockSerials, isTracked, resolveSticker } from './serials'

const shopName = (): string => getSetting<{ name?: string }>('shop', {}).name || 'Your Shop'
const prefs = (): { size: string; printer: string } => ({ size: '50x25', printer: '', ...getSetting<{ size?: string; printer?: string }>('stickers', {}) })

export function stickerContext(): StickerContext {
  const a = requireRole('owner', 'manager', 'store')
  const p = prefs()
  return { shop: shopName(), sizeId: LABEL_SIZES.some((s) => s.id === p.size) ? p.size : '50x25', printer: p.printer, canManage: a.role === 'owner' || a.role === 'manager' }
}

/** Remembers the label size and printer name (owner/manager). An empty printer means "ask in the print dialog". */
export function saveStickerPrefs(input: { size: string; printer: string }): StickerContext {
  const a = requireRole('owner', 'manager')
  if (!LABEL_SIZES.some((s) => s.id === input.size)) throw new Error('Choose a label size.')
  const printer = input.printer.trim()
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('stickers', JSON.stringify({ size: input.size, printer }))
  audit(a.id, 'settings_change', { key: 'stickers', size: input.size, printer })
  return stickerContext()
}

interface Row { variantId: string; name: string; colour: string; size: string; barcode: string; mrp: number; qty: number }
const BASE = 'SELECT v.id AS variantId,p.name,v.colour,v.size,v.barcode,v.mrp'
const toItem = (r: Row, shop: string): StickerItem => ({ ...r, shop, qty: Math.max(1, r.qty) })
/** An item with serial numbers prints one sticker per piece: these serials. */
const withSerials = (it: StickerItem, serials: string[]): StickerItem => ({ ...it, serials, qty: serials.length })

/** Items by id with their label data (price from the database, never from the screen). */
export function stickerItems(ids: string[]): StickerItem[] {
  requireRole('owner', 'manager', 'store')
  if (!ids.length) return []
  const rows = getDb().prepare(`${BASE},1 AS qty FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[]
  const shop = shopName()
  return ids.map((id) => rows.find((r) => r.variantId === id)).filter((r): r is Row => !!r).map((r) => toItem(r, shop))
}

/** Items by id with the quantity on the shelf (at least 1): "print a label for every piece I have". */
export function stockItems(ids: string[]): StickerItem[] {
  requireRole('owner', 'manager', 'store')
  if (!ids.length) return []
  const rows = getDb().prepare(`${BASE},COALESCE(s.qty,0) AS qty FROM variants v JOIN products p ON p.id=v.product_id LEFT JOIN v_stock s ON s.variant_id=v.id WHERE v.id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name,v.rowid`).all(...ids) as Row[]
  const shop = shopName()
  return rows.flatMap((r) => {
    if (!isTracked(r.variantId)) return [toItem(r, shop)]
    const s = inStockSerials(r.variantId)
    return s.length ? [withSerials(toItem(r, shop), s)] : []
  })
}

/** The pieces of a purchase (the latest when no id) with the quantity received: "print what just arrived". */
export function lastPurchaseItems(purchaseId?: string): StickerItem[] {
  requireRole('owner', 'manager', 'store')
  const db = getDb()
  const last = (purchaseId
    ? db.prepare('SELECT id FROM purchases WHERE id=?').get(purchaseId)
    : db.prepare('SELECT id FROM purchases ORDER BY at DESC, rowid DESC LIMIT 1').get()) as { id: string } | undefined
  if (!last) return []
  const rows = db.prepare(`${BASE},pl.qty AS qty FROM purchase_lines pl JOIN variants v ON v.id=pl.variant_id JOIN products p ON p.id=v.product_id WHERE pl.purchase_id=? ORDER BY p.name,v.rowid`).all(last.id) as Row[]
  const shop = shopName()
  return rows.map((r) => {
    const s = (db.prepare('SELECT serial FROM pieces WHERE purchase_id=? AND variant_id=? ORDER BY id').all(last.id, r.variantId) as { serial: string }[]).map((p) => p.serial)
    return s.length ? withSerials(toItem(r, shop), s) : toItem(r, shop)
  })
}

/** Checks a print request and rebuilds each label from the database (the screen's prices are never trusted). */
export function prepareJob(lines: { variantId: string; qty: number; serials?: string[] }[]): StickerItem[] {
  requireRole('owner', 'manager', 'store')
  if (!lines.length) throw new Error('Add at least one item to print.')
  const items = stickerItems(lines.map((l) => l.variantId))
  return lines.map((l) => {
    const it = items.find((i) => i.variantId === l.variantId)
    if (!it) throw new Error('An item on the list no longer exists.')
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new Error(`Enter how many stickers for ${it.name}.`)
    if (l.qty > MAX_PER_ITEM) throw new Error(`At most ${MAX_PER_ITEM} stickers per item at a time.`)
    if (!isTracked(l.variantId)) return { ...it, qty: l.qty }
    // serial numbers: the label of each piece carries its serial. No serials given = the pieces in stock, lowest serial first.
    const serials = l.serials?.length ? l.serials : inStockSerials(l.variantId).slice(0, l.qty)
    if (!serials.length) throw new Error(`${it.name} has no pieces in stock to print stickers for.`)
    if (new Set(serials).size !== serials.length || serials.length > MAX_PER_ITEM) throw new Error(`Check the serial numbers for ${it.name}.`)
    for (const s of serials) if (!findPiece(l.variantId, s)) throw new Error(`${SERIAL_MSG.unknown} (${s}).`)
    return withSerials(it, serials)
  })
}

/** The sticker of one piece (a scanned or typed sticker code): to print its label again. */
export function pieceSticker(code: string): StickerItem {
  requireRole('owner', 'manager', 'store')
  const s = resolveSticker(code)
  const it = s && stickerItems([s.variantId])[0]
  if (!s || !it || !findPiece(s.variantId, s.serial)) throw new Error(SERIAL_MSG.unknown)
  return withSerials(it, [s.serial])
}

export function logPrint(stickers: number, items: number): void {
  audit(requireRole('owner', 'manager', 'store').id, 'stickers_print', { stickers, items })
}
