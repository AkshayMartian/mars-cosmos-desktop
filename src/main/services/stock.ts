import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import {
  DUPLICATE_PURCHASE, variantLabel,
  type MoveRow, type PurchaseRow, type StockInInput, type StockRow, type SupplierDto, type VariantSearchRow
} from '@shared/catalogue'
import type {
  AdjustInput, AdjustReason, ApprovalInput, CountDto, CountLineDto, MoveFullRow, OutType, StockOutInput
} from '@shared/stockops'
import { checkApprover, isManager } from './approval'
import { audit } from './auth'
import { requireRole } from './session'

export type MoveType =
  | 'opening' | 'purchase' | 'sale' | 'sale_return' | 'cancel' | 'supplier_return'
  | 'damage' | 'dispatch' | 'other_out' | 'adjust' | 'count'

/** The only way stock changes. Call inside the caller's transaction. */
export function addMove(m: { variantId: string; qty: number; type: MoveType; ref?: string; reason?: string; staffId: string; at?: string }): void {
  getDb()
    .prepare('INSERT INTO stock_moves (variant_id,qty,type,ref,reason,staff_id,at) VALUES (?,?,?,?,?,?,?)')
    .run(m.variantId, m.qty, m.type, m.ref ?? null, m.reason ?? null, m.staffId, m.at ?? new Date().toISOString())
}

export const stockOf = (variantId: string): number =>
  ((getDb().prepare('SELECT COALESCE(SUM(qty),0) AS q FROM stock_moves WHERE variant_id=?').get(variantId) as { q: number }).q)

const SEARCH_SELECT = `SELECT v.id,p.name,v.colour,v.size,v.barcode,v.sale_price AS salePrice,v.cost,COALESCE(s.qty,0) AS stock
  FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
  LEFT JOIN v_stock s ON s.variant_id=v.id WHERE p.active=1 AND c.is_service=0`

type SearchRaw = Omit<VariantSearchRow, 'label'> & { name: string; colour: string; size: string }
const toSearchRow = ({ name, colour, size, ...r }: SearchRaw): VariantSearchRow => ({ ...r, label: variantLabel(name, colour, size) })

/** Scanner input (exact barcode or brand barcode) wins; otherwise a name/brand/colour/size search. */
export function searchVariants(q: string): VariantSearchRow[] {
  q = q.trim()
  if (!q) return []
  const db = getDb()
  const exact = db.prepare(`${SEARCH_SELECT} AND (v.barcode=? OR v.brand_barcode=?)`).all(q, q) as SearchRaw[]
  if (exact.length) return exact.map(toSearchRow)
  const like = `%${q}%`
  return (db
    .prepare(`${SEARCH_SELECT} AND (p.name LIKE ? OR p.brand LIKE ? OR v.colour LIKE ? OR v.size LIKE ? OR v.barcode LIKE ?) ORDER BY p.name LIMIT 12`)
    .all(like, like, like, like, like) as SearchRaw[]).map(toSearchRow)
}

export function stockLevels(q = '', lowOnly = false): StockRow[] {
  const like = `%${q.trim()}%`
  const rows = getDb()
    .prepare(
      `SELECT v.id AS variantId,p.name,v.colour,v.size,v.barcode,COALESCE(s.qty,0) AS qty,v.min_stock AS minStock,v.cost
       FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
       LEFT JOIN v_stock s ON s.variant_id=v.id
       WHERE p.active=1 AND c.is_service=0
         AND (@q='' OR p.name LIKE @like OR p.brand LIKE @like OR v.colour LIKE @like OR v.size LIKE @like OR v.barcode LIKE @like)
         AND (@low=0 OR COALESCE(s.qty,0)<=v.min_stock)
       ORDER BY p.name, v.rowid`
    )
    .all({ q: q.trim(), like, low: lowOnly ? 1 : 0 }) as { variantId: string; name: string; colour: string; size: string; barcode: string; qty: number; minStock: number; cost: number }[]
  return rows.map((r) => ({
    variantId: r.variantId, label: variantLabel(r.name, r.colour, r.size), barcode: r.barcode,
    qty: r.qty, minStock: r.minStock, costValue: Math.max(0, r.qty) * r.cost
  }))
}

export function stockHistory(variantId: string, limit = 100): MoveRow[] {
  return getDb()
    .prepare(
      `SELECT m.at,m.type,m.qty,m.ref,m.reason,s.name AS staff FROM stock_moves m
       LEFT JOIN staff s ON s.id=m.staff_id WHERE m.variant_id=? ORDER BY m.id DESC LIMIT ?`
    )
    .all(variantId, limit) as MoveRow[]
}

/* ---------- suppliers & stock in ---------- */

export function listSuppliers(): SupplierDto[] {
  return getDb().prepare('SELECT id,name,mobile,gstin FROM suppliers ORDER BY name').all() as SupplierDto[]
}

export function createSupplier(input: { name: string; mobile?: string; gstin?: string }): SupplierDto {
  const actor = requireRole('owner', 'manager', 'store')
  const name = input.name.trim()
  if (!name) throw new Error('Enter the supplier name.')
  const gstin = (input.gstin ?? '').trim().toUpperCase()
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new Error('GSTIN must be 15 letters and numbers.')
  const s = { id: randomUUID(), name, mobile: (input.mobile ?? '').trim() || null, gstin: gstin || null }
  getDb().prepare('INSERT INTO suppliers (id,name,mobile,gstin) VALUES (?,?,?,?)').run(s.id, s.name, s.mobile, s.gstin)
  audit(actor.id, 'supplier_create', { id: s.id })
  return s
}

export function stockIn(input: StockInInput): { purchaseId: string; qty: number } {
  const actor = requireRole('owner', 'manager', 'store')
  const db = getDb()
  if (!input.lines.length) throw new Error('Add at least one item.')
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('Quantities must be whole numbers above zero.')
    if (!(l.cost >= 0)) throw new Error('Cost cannot be negative.')
    if (!db.prepare('SELECT 1 FROM variants WHERE id=?').get(l.variantId)) throw new Error('An item on this list no longer exists.')
  }
  if (input.supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(input.supplierId)) throw new Error('Supplier not found.')

  const billNo = input.billNo.trim()
  if (billNo && !input.allowDuplicate && db.prepare("SELECT 1 FROM purchases WHERE bill_no=? AND COALESCE(supplier_id,'')=COALESCE(?,'')").get(billNo, input.supplierId))
    throw new Error(`${DUPLICATE_PURCHASE} supplier bill ${billNo} was already entered for this supplier.`)

  const id = randomUUID()
  const at = new Date().toISOString()
  const qty = input.lines.reduce((a, l) => a + l.qty, 0)
  const total = input.lines.reduce((a, l) => a + l.qty * l.cost, 0)
  const ref = input.billNo.trim() || 'purchase'

  db.transaction(() => {
    db.prepare('INSERT INTO purchases (id,supplier_id,bill_no,bill_date,total,staff_id,at) VALUES (?,?,?,?,?,?,?)').run(
      id, input.supplierId, input.billNo.trim() || null, input.billDate || null, total, actor.id, at
    )
    const line = db.prepare('INSERT INTO purchase_lines (purchase_id,variant_id,qty,cost) VALUES (?,?,?,?)')
    const cost = db.prepare('UPDATE variants SET cost=? WHERE id=?')
    for (const l of input.lines) {
      line.run(id, l.variantId, l.qty, l.cost)
      cost.run(l.cost, l.variantId)
      addMove({ variantId: l.variantId, qty: l.qty, type: 'purchase', ref, staffId: actor.id, at })
    }
    audit(actor.id, 'stock_in', { id, qty, total })
  })()
  return { purchaseId: id, qty }
}

export function recentPurchases(limit = 5): PurchaseRow[] {
  return getDb()
    .prepare(
      `SELECT p.id,s.name AS supplier,p.bill_no AS billNo,p.at,p.total,
              (SELECT COALESCE(SUM(qty),0) FROM purchase_lines WHERE purchase_id=p.id) AS qty
       FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.at DESC, p.rowid DESC LIMIT ?`
    )
    .all(limit) as PurchaseRow[]
}

/* ---------- stock out ---------- */

const OUT_MOVE: Record<OutType, MoveType> = { supplier_return: 'supplier_return', damage: 'damage', dispatch: 'dispatch', other: 'other_out' }
const OUTS: OutType[] = ['supplier_return', 'damage', 'dispatch', 'other']

/** Stock leaves without a bill: returned to a supplier, damaged, dispatched or otherwise. Going below zero needs approval. */
export function stockOut(input: StockOutInput): { id: string; qty: number } {
  const actor = requireRole('owner', 'manager', 'store')
  const db = getDb()
  if (!OUTS.includes(input.type)) throw new Error('Choose why the stock is going out.')
  const reason = input.reason.trim()
  if (input.type === 'other' && !reason) throw new Error('Type a note for "Other".')
  if (input.type === 'supplier_return' && !input.supplierId) throw new Error('Choose the supplier.')
  if (input.supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(input.supplierId)) throw new Error('Supplier not found.')
  if (!input.lines.length) throw new Error('Add at least one item.')

  const want = new Map<string, number>()
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('Quantities must be whole numbers above zero.')
    if (!db.prepare('SELECT 1 FROM variants WHERE id=?').get(l.variantId)) throw new Error('An item on this list no longer exists.')
    want.set(l.variantId, (want.get(l.variantId) ?? 0) + l.qty)
  }
  const below = [...want].some(([v, q]) => stockOf(v) - q < 0)
  const approvedBy = below && !isManager(actor) ? checkApprover(input.approval) : null

  const id = randomUUID()
  const at = new Date().toISOString()
  const qty = [...want.values()].reduce((a, b) => a + b, 0)
  db.transaction(() => {
    db.prepare('INSERT INTO stock_outs (id,type,supplier_id,reason,staff_id,approved_by,at) VALUES (?,?,?,?,?,?,?)')
      .run(id, input.type, input.type === 'supplier_return' ? input.supplierId : null, reason || null, actor.id, approvedBy, at)
    const line = db.prepare('INSERT INTO stock_out_lines (stock_out_id,variant_id,qty) VALUES (?,?,?)')
    for (const [variantId, q] of want) {
      line.run(id, variantId, q)
      addMove({ variantId, qty: -q, type: OUT_MOVE[input.type], ref: 'stock out', reason: reason || undefined, staffId: actor.id, at })
    }
    audit(actor.id, 'stock_out', { id, type: input.type, qty, approvedBy })
  })()
  return { id, qty }
}

/* ---------- adjust one item ---------- */

const REASONS: AdjustReason[] = ['damaged', 'lost', 'found', 'correction']

/** Fix one item's stock (damaged, lost, found, correction). Store staff need a manager or owner to approve. */
export function adjustStock(input: AdjustInput): { stock: number } {
  const actor = requireRole('owner', 'manager', 'store')
  if (!Number.isInteger(input.change) || input.change === 0) throw new Error('Enter a change other than 0.')
  if (!REASONS.includes(input.reason)) throw new Error('Choose a reason.')
  if (!getDb().prepare('SELECT 1 FROM variants WHERE id=?').get(input.variantId)) throw new Error('Item not found.')
  const now = stockOf(input.variantId)
  if (now + input.change < 0) throw new Error(`Stock cannot go below zero (now ${now}).`)
  const approvedBy = isManager(actor) ? null : checkApprover(input.approval)
  getDb().transaction(() => {
    addMove({ variantId: input.variantId, qty: input.change, type: 'adjust', ref: 'adjust', reason: input.reason, staffId: actor.id })
    audit(actor.id, 'stock_adjust', { variantId: input.variantId, change: input.change, reason: input.reason, approvedBy })
  })()
  return { stock: now + input.change }
}

/* ---------- stock count ---------- */

function countLines(countId: string): CountLineDto[] {
  return getDb()
    .prepare(
      `SELECT l.variant_id AS variantId,p.name,v.colour,v.size,v.barcode,l.system_qty AS system,l.counted_qty AS counted
       FROM stock_count_lines l JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id
       WHERE l.count_id=? ORDER BY p.name, v.rowid`
    )
    .all(countId)
    .map((r) => {
      const x = r as { variantId: string; name: string; colour: string; size: string; barcode: string; system: number; counted: number }
      return { variantId: x.variantId, label: variantLabel(x.name, x.colour, x.size), barcode: x.barcode, system: x.system, counted: x.counted }
    })
}

const openCountRow = () => getDb().prepare("SELECT id,at FROM stock_counts WHERE status='open'").get() as { id: string; at: string } | undefined

export function getOpenCount(): CountDto | null {
  requireRole('owner', 'manager', 'store')
  const c = openCountRow()
  return c ? { id: c.id, at: c.at, lines: countLines(c.id) } : null
}

/** Snapshots what the system says for every item. Count when the shop is closed. */
export function startCount(): CountDto {
  const actor = requireRole('owner', 'manager', 'store')
  const db = getDb()
  if (openCountRow()) throw new Error('A stock count is already open.')
  const id = randomUUID()
  db.transaction(() => {
    db.prepare("INSERT INTO stock_counts (id,status,by_staff,at) VALUES (?,'open',?,?)").run(id, actor.id, new Date().toISOString())
    db.prepare(
      `INSERT INTO stock_count_lines (count_id,variant_id,system_qty,counted_qty)
       SELECT ?,v.id,COALESCE(s.qty,0),0 FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
       LEFT JOIN v_stock s ON s.variant_id=v.id WHERE p.active=1 AND c.is_service=0`
    ).run(id)
    audit(actor.id, 'count_start', { id })
  })()
  return getOpenCount()!
}

/** One piece scanned: counted +1. */
export function countScan(code: string): { variantId: string; label: string; counted: number } {
  requireRole('owner', 'manager', 'store')
  const c = openCountRow()
  if (!c) throw new Error('Start a stock count first.')
  const q = code.trim()
  const v = getDb()
    .prepare(
      `SELECT l.variant_id AS variantId FROM stock_count_lines l JOIN variants v ON v.id=l.variant_id
       WHERE l.count_id=? AND (v.barcode=? OR v.brand_barcode=?)`
    )
    .get(c.id, q, q) as { variantId: string } | undefined
  if (!v) throw new Error(`No item with barcode ${q} in this count.`)
  getDb().prepare('UPDATE stock_count_lines SET counted_qty=counted_qty+1 WHERE count_id=? AND variant_id=?').run(c.id, v.variantId)
  const line = countLines(c.id).find((l) => l.variantId === v.variantId)!
  return { variantId: line.variantId, label: line.label, counted: line.counted }
}

export function countSet(variantId: string, counted: number): void {
  requireRole('owner', 'manager', 'store')
  const c = openCountRow()
  if (!c) throw new Error('Start a stock count first.')
  if (!Number.isInteger(counted) || counted < 0) throw new Error('Enter a whole number, 0 or more.')
  getDb().prepare('UPDATE stock_count_lines SET counted_qty=? WHERE count_id=? AND variant_id=?').run(counted, c.id, variantId)
}

export function discardCount(): void {
  const actor = requireRole('owner', 'manager', 'store')
  const c = openCountRow()
  if (!c) throw new Error('There is no open count.')
  getDb().prepare("UPDATE stock_counts SET status='discarded' WHERE id=?").run(c.id)
  audit(actor.id, 'count_discard', { id: c.id })
}

/** Posts the differences (counted minus what the system said) as stock moves. Needs a manager or owner. */
export function approveCount(approval?: ApprovalInput): { adjusted: number } {
  const actor = requireRole('owner', 'manager', 'store')
  const c = openCountRow()
  if (!c) throw new Error('There is no open count.')
  const approvedBy = isManager(actor) ? actor.id : checkApprover(approval)
  const diffs = countLines(c.id).filter((l) => l.counted !== l.system)
  const at = new Date().toISOString()
  getDb().transaction(() => {
    for (const l of diffs) addMove({ variantId: l.variantId, qty: l.counted - l.system, type: 'count', ref: 'stock count', staffId: actor.id, at })
    getDb().prepare("UPDATE stock_counts SET status='approved',approved_by=? WHERE id=?").run(approvedBy, c.id)
    audit(actor.id, 'count_approve', { id: c.id, adjusted: diffs.length, approvedBy })
  })()
  return { adjusted: diffs.length }
}

/* ---------- recent moves (all items) ---------- */

export function recentMoves(limit = 60): MoveFullRow[] {
  requireRole('owner', 'manager', 'store')
  return (getDb()
    .prepare(
      `SELECT m.at,p.name,v.colour,v.size,m.type,m.qty,m.ref,m.reason,s.name AS staff
       FROM stock_moves m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id LEFT JOIN staff s ON s.id=m.staff_id
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(limit) as { at: string; name: string; colour: string; size: string; type: string; qty: number; ref: string | null; reason: string | null; staff: string | null }[])
    .map((r) => ({ at: r.at, label: variantLabel(r.name, r.colour, r.size), type: r.type, qty: r.qty, ref: r.ref, reason: r.reason, staff: r.staff }))
}
