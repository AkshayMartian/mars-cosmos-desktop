import { getDb } from '../db'
import { ean13 } from '@shared/barcode'
import { variantLabel } from '@shared/catalogue'
import { formatSerial, parseStickerCode, SERIAL_MSG, type PieceHistoryDto, type PieceStatus } from '@shared/serials'
import { requireRole } from './session'

/**
 * Serial numbers. Stock is still the sum of stock_moves; for a tracked product the pieces that are 'in_stock' always
 * equal that sum. Every flow that moves stock of a tracked product also moves its pieces, in the same transaction.
 */

export interface PieceRow { id: number; variantId: string; serial: string; status: PieceStatus; billId: string | null }

const PIECE = 'SELECT id,variant_id AS variantId,serial,status,bill_id AS billId FROM pieces'

export const isTracked = (variantId: string): boolean =>
  !!getDb().prepare('SELECT 1 FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.track_serials=1').get(variantId)

export function pieceEvent(pieceId: number, event: string, ref: string | null, staffId: string | null, at: string): void {
  getDb().prepare('INSERT INTO piece_events (piece_id,event,ref,staff_id,at) VALUES (?,?,?,?,?)').run(pieceId, event, ref, staffId, at)
}

/** Makes `n` new pieces of a variant with the next running serials. Call inside the caller's transaction. */
export function createPieces(variantId: string, n: number, o: { staffId: string | null; ref: string; event?: string; purchaseId?: string | null; at?: string }): string[] {
  const db = getDb()
  const at = o.at ?? new Date().toISOString()
  let next = (db.prepare('SELECT COALESCE(MAX(CAST(serial AS INTEGER)),0) AS m FROM pieces WHERE variant_id=?').get(variantId) as { m: number }).m
  const ins = db.prepare('INSERT INTO pieces (variant_id,serial,status,purchase_id,created_at) VALUES (?,?,?,?,?)')
  const serials: string[] = []
  for (let i = 0; i < n; i++) {
    const serial = formatSerial(++next)
    const id = Number(ins.run(variantId, serial, 'in_stock', o.purchaseId ?? null, at).lastInsertRowid)
    pieceEvent(id, o.event ?? 'received', o.ref, o.staffId, at)
    serials.push(serial)
  }
  return serials
}

/** Opening stock / stock in for a tracked variant creates its pieces; an untracked variant gets none. */
export function receivePieces(variantId: string, qty: number, o: { staffId: string; ref: string; purchaseId?: string | null; at?: string; event?: string }): string[] {
  return qty > 0 && isTracked(variantId) ? createPieces(variantId, qty, o) : []
}

/**
 * Makes the pieces of a variant agree with its stock: missing pieces are created (existing stock gets serials the
 * first time a product is switched to serial tracking), extra pieces are marked lost.
 */
export function syncPieces(variantId: string, staffId: string): { created: number; lost: number } {
  const db = getDb()
  const stock = (db.prepare('SELECT COALESCE(SUM(qty),0) AS q FROM stock_moves WHERE variant_id=?').get(variantId) as { q: number }).q
  const have = (db.prepare("SELECT COUNT(*) AS n FROM pieces WHERE variant_id=? AND status='in_stock'").get(variantId) as { n: number }).n
  const at = new Date().toISOString()
  const want = Math.max(0, stock)
  if (want > have) { createPieces(variantId, want - have, { staffId, ref: 'serial numbers started', at }); return { created: want - have, lost: 0 } }
  if (have > want) {
    const extra = db.prepare("SELECT id FROM pieces WHERE variant_id=? AND status='in_stock' ORDER BY id DESC LIMIT ?").all(variantId, have - want) as { id: number }[]
    for (const e of extra) { db.prepare("UPDATE pieces SET status='lost' WHERE id=?").run(e.id); pieceEvent(e.id, 'lost', 'stock correction', staffId, at) }
    return { created: 0, lost: extra.length }
  }
  return { created: 0, lost: 0 }
}

/** variantId → serials that sit in a held bill (reserved: they cannot go on another bill). */
export function heldSerials(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const rows = getDb().prepare('SELECT payload FROM held_bills').all() as { payload: string }[]
  for (const r of rows) {
    const p = JSON.parse(r.payload) as { lines?: { variantId: string; serials?: string[] }[] }
    for (const l of p.lines ?? []) {
      if (!l.serials?.length) continue
      const s = out.get(l.variantId) ?? new Set<string>()
      for (const x of l.serials) s.add(x)
      out.set(l.variantId, s)
    }
  }
  return out
}

export const findPiece = (variantId: string, serial: string): PieceRow | undefined =>
  getDb().prepare(`${PIECE} WHERE variant_id=? AND serial=?`).get(variantId, serial) as PieceRow | undefined

/** Why this piece cannot go on a bill or out of stock, or null when it is free. */
export function pieceProblem(p: PieceRow | undefined, held = heldSerials()): string | null {
  if (!p) return SERIAL_MSG.unknown
  if (p.status !== 'in_stock') return SERIAL_MSG.notInStock
  if (held.get(p.variantId)?.has(p.serial)) return SERIAL_MSG.onHold
  return null
}

/** The pieces for these serials of one variant, each checked free. Throws the cashier's message for the first bad one. */
export function takeFree(variantId: string, serials: string[]): PieceRow[] {
  if (new Set(serials).size !== serials.length) throw new Error(SERIAL_MSG.already)
  const held = heldSerials()
  return serials.map((s) => {
    const p = findPiece(variantId, s)
    const bad = pieceProblem(p, held)
    if (bad) throw new Error(`${bad} (serial ${s}).`)
    return p!
  })
}

/** Moves pieces to a new status and records it in their history. Call inside the caller's transaction. */
export function movePieces(ids: number[], status: PieceStatus, event: string, o: { ref: string | null; staffId: string | null; at?: string; billId?: string | null; bunchId?: number | null }): void {
  const db = getDb()
  const at = o.at ?? new Date().toISOString()
  const up = db.prepare('UPDATE pieces SET status=?,bill_id=?,bunch_id=? WHERE id=?')
  for (const id of ids) {
    up.run(status, status === 'sold' ? o.billId ?? null : null, status === 'sold' ? o.bunchId ?? null : null, id)
    pieceEvent(id, event, o.ref, o.staffId, at)
  }
}

/** Free pieces of a variant (lowest serial first), leaving out serials already on the bill. `first` goes first. */
export function freeSerials(variantId: string, exclude: string[], first?: string): string[] {
  const skip = new Set(exclude)
  const held = heldSerials().get(variantId)
  const rows = getDb().prepare("SELECT serial FROM pieces WHERE variant_id=? AND status='in_stock' ORDER BY id").all(variantId) as { serial: string }[]
  const free = rows.map((r) => r.serial).filter((s) => !skip.has(s) && !held?.has(s))
  if (first && free.includes(first)) return [first, ...free.filter((s) => s !== first)]
  return free
}

/** A new code for a bunch line (in-store range, so it never clashes with a brand barcode). */
export function newBunchCode(): string {
  const db = getDb()
  const r = db.prepare("SELECT value FROM settings WHERE key='bunch_seq'").get() as { value: string } | undefined
  const n = (r ? (JSON.parse(r.value) as number) : 0) + 1
  db.prepare("INSERT INTO settings (key,value) VALUES ('bunch_seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(n))
  return ean13('2100' + String(n).padStart(8, '0'))
}

/** The pieces of a variant that are in stock now (for printing stickers and for picking pieces). */
export function inStockSerials(variantId: string): string[] {
  return (getDb().prepare("SELECT serial FROM pieces WHERE variant_id=? AND status='in_stock' ORDER BY id").all(variantId) as { serial: string }[]).map((r) => r.serial)
}

/** A scanned sticker (barcode + serial) → its variant and serial, or null when the code is not a sticker code. */
export function resolveSticker(code: string): { variantId: string; serial: string } | null {
  const p = parseStickerCode(code)
  if (!p) return null
  const v = (getDb().prepare('SELECT id FROM variants WHERE barcode=?').get(p.barcode) as { id: string } | undefined)?.id
  return v ? { variantId: v, serial: p.serial } : null
}

/** Piece history: where a piece came from and what happened to it. Typed or scanned sticker code. */
export function pieceHistory(code: string): PieceHistoryDto {
  requireRole('owner', 'manager', 'store', 'cashier')
  const s = resolveSticker(code)
  const piece = s && findPiece(s.variantId, s.serial)
  if (!s || !piece) throw new Error(SERIAL_MSG.unknown)
  const db = getDb()
  const v = db.prepare('SELECT p.name,v.colour,v.size,v.barcode FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(s.variantId) as { name: string; colour: string; size: string; barcode: string }
  const bill = piece.billId ? (db.prepare('SELECT no FROM bills WHERE id=?').get(piece.billId) as { no: string }).no : null
  const events = db
    .prepare('SELECT e.at,e.event,e.ref,st.name AS staff FROM piece_events e LEFT JOIN staff st ON st.id=e.staff_id WHERE e.piece_id=? ORDER BY e.id')
    .all(piece.id) as PieceHistoryDto['events']
  return { label: variantLabel(v.name, v.colour, v.size), barcode: v.barcode, serial: piece.serial, status: piece.status, bill, events }
}
