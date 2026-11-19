import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { storeBarcode } from '@shared/barcode'
import type { CategoryDto, NewCategoryInput, NewProductInput, ProductDetail, ProductListRow, ProductPhotoDto, VariantDto } from '@shared/catalogue'
import { assertTemp, promoteAs, readDataUrl, removeFile, saveTemp, slug } from '../photoStore'
import { audit } from './auth'
import { requireRole, current } from './session'
import { addMove } from './stock'
import { receiveBunches, syncPieces } from './serials'

export function listCategories(): CategoryDto[] {
  return getDb()
    .prepare(
      `SELECT id,name,hsn,gst_mode AS mode,gst_rate AS rate FROM categories WHERE is_service=0 ORDER BY name`
    )
    .all() as CategoryDto[]
}

/** `archived` = show only archived products (hidden from the normal list, billing and stock). */
export function listProducts(q = '', categoryId = '', archived = false): ProductListRow[] {
  const like = `%${q.trim()}%`
  const rows = getDb()
    .prepare(
      `SELECT p.id,p.name,p.brand,p.category_id AS categoryId,c.name AS categoryName,
              v.size,v.colour,v.mrp,COALESCE(s.qty,0) AS stock
       FROM products p
       JOIN categories c ON c.id=p.category_id
       JOIN variants v ON v.product_id=p.id
       LEFT JOIN v_stock s ON s.variant_id=v.id
       WHERE p.active=@act AND c.is_service=0
         AND (@cat='' OR p.category_id=@cat)
         AND (@q='' OR p.name LIKE @like OR p.brand LIKE @like OR v.barcode=@q OR v.brand_barcode=@q)
       ORDER BY p.name, v.rowid`
    )
    .all({ cat: categoryId, q: q.trim(), like, act: archived ? 0 : 1 }) as {
    id: string; name: string; brand: string; categoryId: string; categoryName: string
    size: string; colour: string; mrp: number; stock: number
  }[]

  const out = new Map<string, ProductListRow>()
  for (const r of rows) {
    let p = out.get(r.id)
    if (!p) {
      p = { id: r.id, name: r.name, brand: r.brand, categoryId: r.categoryId, categoryName: r.categoryName, sizes: [], colours: [], stock: 0, mrp: r.mrp }
      out.set(r.id, p)
    }
    if (!p.sizes.includes(r.size)) p.sizes.push(r.size)
    if (!p.colours.includes(r.colour)) p.colours.push(r.colour)
    p.stock += r.stock
  }
  return [...out.values()]
}

export function getProduct(id: string): ProductDetail {
  const db = getDb()
  const row = db.prepare('SELECT id,name,brand,category_id AS categoryId,active,track_serials AS trackSerials FROM products WHERE id=?').get(id) as
    | (Omit<ProductDetail, 'variants' | 'active' | 'trackSerials'> & { active: number; trackSerials: number })
    | undefined
  if (!row) throw new Error('Product not found.')
  const p = { ...row, active: !!row.active, trackSerials: !!row.trackSerials }
  const variants = db
    .prepare(
      `SELECT v.id,v.product_id AS productId,v.size,v.colour,v.barcode,v.brand_barcode AS brandBarcode,
              v.mrp,v.sale_price AS salePrice,v.cost,v.min_stock AS minStock,COALESCE(s.qty,0) AS stock
       FROM variants v LEFT JOIN v_stock s ON s.variant_id=v.id WHERE v.product_id=? ORDER BY v.rowid`
    )
    .all(id) as VariantDto[]
  return { ...p, variants }
}

function nextBarcode(): string {
  const db = getDb()
  const r = db.prepare("SELECT value FROM settings WHERE key='barcode_seq'").get() as { value: string } | undefined
  const n = (r ? (JSON.parse(r.value) as number) : 0) + 1
  db.prepare("INSERT INTO settings (key,value) VALUES ('barcode_seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(n))
  return storeBarcode(n)
}

const clean = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]

export interface VariantSpec { size: string; colour: string; mrp: number; salePrice: number; cost: number; qty: number }

export const productNameTaken = (name: string): boolean =>
  !!getDb().prepare('SELECT 1 FROM products WHERE lower(name)=lower(?) AND active=1').get(name.trim())

/** One product + its variants + opening stock, all or nothing. Shared by the Add product form and Excel import. */
export function insertProduct(
  actorId: string,
  p: { name: string; brand: string; categoryId: string; trackSerials?: boolean; gstRate?: number | null; bunchSize?: number | null },
  variants: VariantSpec[],
  source: 'product' | 'import' = 'product'
): { id: string; variantIds: string[] } {
  const db = getDb()
  const at = new Date().toISOString()
  const pid = randomUUID()
  const variantIds: string[] = []
  db.transaction(() => {
    db.prepare('INSERT INTO products (id,name,brand,category_id,active,created_at,track_serials,gst_rate) VALUES (?,?,?,?,1,?,?,?)').run(pid, p.name.trim(), p.brand.trim(), p.categoryId, at, p.trackSerials ? 1 : 0, p.gstRate ?? null)
    const ins = db.prepare('INSERT INTO variants (id,product_id,size,colour,barcode,mrp,sale_price,cost) VALUES (?,?,?,?,?,?,?,?)')
    for (const v of variants) {
      const vid = randomUUID()
      ins.run(vid, pid, v.size, v.colour, nextBarcode(), v.mrp, v.salePrice || v.mrp, v.cost)
      variantIds.push(vid)
      if (v.qty > 0) {
        addMove({ variantId: vid, qty: v.qty, type: 'opening', ref: source, reason: source === 'import' ? 'Excel import' : 'Opening stock', staffId: actorId, at })
        receiveBunches(vid, v.qty, p.bunchSize, { staffId: actorId, ref: 'opening stock', at })
      }
    }
    audit(actorId, source === 'import' ? 'product_import' : 'product_create', { id: pid, variants: variantIds.length })
  })()
  return { id: pid, variantIds }
}

export function createProduct(input: NewProductInput): { id: string; variantIds: string[] } {
  const actor = requireRole('owner', 'manager')
  const db = getDb()
  const name = input.name.trim()
  const sizes = clean(input.sizes)
  const colours = clean(input.colours)

  if (!name) throw new Error('Enter a product name.')
  if (!sizes.length || !colours.length) throw new Error('Enter at least one size and one colour.')
  if (!(input.mrp > 0)) throw new Error('Enter the MRP.')
  if (input.salePrice < 0 || input.cost < 0) throw new Error('Prices cannot be negative.')
  if (!db.prepare('SELECT 1 FROM categories WHERE id=? AND is_service=0').get(input.categoryId)) throw new Error('Choose a category.')
  const bunchSize = input.bunchSize ?? null
  if (bunchSize !== null && (!Number.isInteger(bunchSize) || bunchSize < 2 || bunchSize > 500)) throw new Error('Pieces per bunch: a whole number from 2 to 500.')
  const gstRate = input.gstRate ?? null
  if (gstRate !== null && !(Number.isInteger(gstRate) && gstRate >= 0 && gstRate <= 28)) throw new Error('GST must be a whole number from 0 to 28.')
  if (productNameTaken(name)) throw new Error('A product with this name already exists. Use a different name.')
  // photos: one per colour, optional. Checked first so a bad photo never leaves a half-saved product.
  const photos = Object.entries(input.photos ?? {}).filter(([, file]) => file)
  for (const [colour, file] of photos) {
    if (!colours.includes(colour)) throw new Error('A photo refers to a colour that is not on this product.')
    assertTemp(file)
  }

  const variants: VariantSpec[] = []
  for (const colour of colours)
    for (const size of sizes)
      variants.push({ size, colour, mrp: input.mrp, salePrice: input.salePrice, cost: input.cost, qty: Math.max(0, Math.floor(Number(input.opening[`${colour}|${size}`] ?? 0))) })
  const made = insertProduct(actor.id, { name, brand: input.brand, categoryId: input.categoryId, trackSerials: !!input.trackSerials, gstRate, bunchSize }, variants)
  for (const [colour, file] of photos) attachPhoto(made.id, colour, file)
  return made
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024

/**
 * The screen decodes and shrinks the picture (so every common format works) and sends JPEG bytes.
 * Here we only check they really are a JPEG of sane size, then keep them as a temporary file.
 */
export function savePhotoBytes(bytes: Uint8Array): { file: string; dataUrl: string } {
  requireRole('owner', 'manager')
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('That file could not be read as a photo.')
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('That photo is too large.')
  const file = saveTemp(Buffer.from(bytes))
  return { file, dataUrl: readDataUrl(file)! }
}

/* ---------- photos: one per colour, shared by every size of that colour ---------- */

const fileStillUsed = (file: string): boolean => !!getDb().prepare('SELECT 1 FROM product_photos WHERE file_path=?').get(file)

/** Gives a chosen (temporary) photo to one colour of a product, replacing that colour's earlier photo. */
function attachPhoto(productId: string, colour: string, tmpName: string): void {
  const db = getDb()
  const old = db.prepare('SELECT id,file_path FROM product_photos WHERE product_id=? AND colour=?').get(productId, colour) as { id: string; file_path: string } | undefined

  // <productId>-<colour>.jpg; if another colour of this product already owns that name (e.g. "Dark Blue" and "dark-blue"), add -2, -3 …
  const base = `${productId}-${slug(colour)}`
  let file = `${base}.jpg`
  for (let n = 2; db.prepare('SELECT 1 FROM product_photos WHERE file_path=? AND NOT (product_id=? AND colour=?)').get(file, productId, colour); n++) file = `${base}-${n}.jpg`

  promoteAs(tmpName, file)
  const now = new Date().toISOString()
  if (old) db.prepare('UPDATE product_photos SET file_path=?, updated_at=? WHERE id=?').run(file, now, old.id)
  else {
    const order = (db.prepare('SELECT DISTINCT colour FROM variants WHERE product_id=? ORDER BY rowid').all(productId) as { colour: string }[]).findIndex((c) => c.colour === colour)
    db.prepare('INSERT INTO product_photos (id,product_id,colour,file_path,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), productId, colour, file, Math.max(0, order), now, now)
  }
  // the old file may be shared (photos carried over from before this feature): only delete it when nobody uses it any more
  if (old && old.file_path !== file && !fileStillUsed(old.file_path)) removeFile(old.file_path)
}

/** The photos a product has, one per colour that has one. Colours without a photo are simply absent. */
export function listProductPhotos(productId: string): ProductPhotoDto[] {
  current()
  const rows = getDb().prepare('SELECT colour,file_path AS file FROM product_photos WHERE product_id=? ORDER BY sort_order, colour').all(productId) as { colour: string; file: string }[]
  return rows.map((r) => ({ colour: r.colour, file: r.file, dataUrl: readDataUrl(r.file) }))
}

/** `tmpName` comes from the photo chooser. */
export function setColourPhoto(productId: string, colour: string, tmpName: string): void {
  const actor = requireRole('owner', 'manager')
  if (!getDb().prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new Error('Product not found.')
  if (!getDb().prepare('SELECT 1 FROM variants WHERE product_id=? AND colour=?').get(productId, colour)) throw new Error(`This product has no colour "${colour}".`)
  attachPhoto(productId, colour, tmpName)
  audit(actor.id, 'product_photo', { id: productId, colour })
}

export function removeColourPhoto(productId: string, colour: string): void {
  const actor = requireRole('owner', 'manager')
  const db = getDb()
  const old = db.prepare('SELECT id,file_path FROM product_photos WHERE product_id=? AND colour=?').get(productId, colour) as { id: string; file_path: string } | undefined
  if (!old) throw new Error(`There is no photo for "${colour}".`)
  db.prepare('DELETE FROM product_photos WHERE id=?').run(old.id)
  if (!fileStillUsed(old.file_path)) removeFile(old.file_path)
  audit(actor.id, 'product_photo_remove', { id: productId, colour })
}

/** The photo of the colour of one item (what Billing shows for a scanned item), or null. */
export function variantPhoto(variantId: string): string | null {
  current()
  const r = getDb()
    .prepare('SELECT pp.file_path AS file FROM variants v JOIN product_photos pp ON pp.product_id=v.product_id AND pp.colour=v.colour WHERE v.id=?')
    .get(variantId) as { file: string } | undefined
  return readDataUrl(r?.file ?? null)
}

export function createCategory(input: NewCategoryInput): CategoryDto {
  const actor = requireRole('owner', 'manager')
  const name = input.name.trim()
  if (!name) throw new Error('Enter the category name.')
  if (getDb().prepare('SELECT 1 FROM categories WHERE lower(name)=lower(?)').get(name)) throw new Error('A category with this name already exists.')
  const c: CategoryDto = {
    id: randomUUID(), name, hsn: input.hsn.trim(),
    mode: input.gst === 'auto' ? 'auto' : 'fixed', rate: input.gst === 'auto' ? 0 : input.gst
  }
  getDb().prepare('INSERT INTO categories (id,name,hsn,gst_mode,gst_rate,is_service) VALUES (?,?,?,?,?,0)').run(c.id, c.name, c.hsn, c.mode, c.rate)
  audit(actor.id, 'category_create', { id: c.id })
  return c
}

export function updateProduct(id: string, patch: { name: string; brand: string; categoryId: string }): void {
  const actor = requireRole('owner', 'manager')
  const name = patch.name.trim()
  if (!name) throw new Error('Enter a product name.')
  const dup = getDb().prepare('SELECT 1 FROM products WHERE lower(name)=lower(?) AND active=1 AND id<>?').get(name, id)
  if (dup) throw new Error('A product with this name already exists.')
  getDb().prepare('UPDATE products SET name=?,brand=?,category_id=? WHERE id=?').run(name, patch.brand.trim(), patch.categoryId, id)
  audit(actor.id, 'product_update', { id })
}

/** Changing a price needs the "can change price" permission (owner always has it). */
export function updatePrices(variantId: string, mrp: number, salePrice: number): void {
  const actor = current()
  if (!(actor.role === 'owner' || actor.role === 'manager' || actor.canChangePrice)) throw new Error('You are not allowed to change prices.')
  if (!(mrp > 0) || salePrice < 0) throw new Error('Enter valid prices.')
  const old = getDb().prepare('SELECT mrp,sale_price AS sale FROM variants WHERE id=?').get(variantId) as { mrp: number; sale: number } | undefined
  if (!old) throw new Error('Item not found.')
  getDb().prepare('UPDATE variants SET mrp=?,sale_price=? WHERE id=?').run(mrp, salePrice, variantId)
  audit(actor.id, 'price_change', { variantId, from: old, to: { mrp, sale: salePrice } })
}

export function setBrandBarcode(variantId: string, code: string): void {
  const actor = requireRole('owner', 'manager', 'store')
  const c = code.trim() || null
  if (c) {
    const clash = getDb().prepare('SELECT 1 FROM variants WHERE (barcode=? OR brand_barcode=?) AND id<>?').get(c, c, variantId)
    if (clash) throw new Error('That barcode is already used by another item.')
  }
  getDb().prepare('UPDATE variants SET brand_barcode=? WHERE id=?').run(c, variantId)
  audit(actor.id, 'brand_barcode', { variantId })
}

export function archiveProduct(id: string): void {
  const actor = requireRole('owner', 'manager')
  getDb().prepare('UPDATE products SET active=0 WHERE id=?').run(id)
  audit(actor.id, 'product_archive', { id })
}

export function restoreProduct(id: string): void {
  const actor = requireRole('owner', 'manager')
  const p = getDb().prepare('SELECT name FROM products WHERE id=?').get(id) as { name: string } | undefined
  if (!p) throw new Error('Product not found.')
  const clash = getDb().prepare('SELECT 1 FROM products WHERE lower(name)=lower(?) AND active=1 AND id<>?').get(p.name, id)
  if (clash) throw new Error('Another product with this name exists now. Rename that one first.')
  getDb().prepare('UPDATE products SET active=1 WHERE id=?').run(id)
  audit(actor.id, 'product_restore', { id })
}

/**
 * Switches serial numbers on or off for a product. Switching on gives every piece in stock its own serial (stock
 * numbers stay the same); those pieces need new stickers before they can be sold by scanning. Switching off keeps the
 * pieces on record, and switching on again brings them back in line with the stock.
 */
/**
 * Serial numbers are the rule for every product (the paper, section 8): any product still on quantity-only is switched on and
 * every piece in its stock gets a serial, so the stock numbers stay the same. Safe to run at every start: it does nothing
 * once all products are on. Returns how many products were switched on.
 */
export function enableSerialsEverywhere(): { products: number; newSerials: number } {
  const db = getDb()
  const staffId = (db.prepare("SELECT id FROM staff WHERE role='owner' ORDER BY rowid LIMIT 1").get() as { id: string } | undefined)?.id ?? null
  const off = db.prepare('SELECT id FROM products WHERE track_serials=0').all() as { id: string }[]
  let created = 0
  db.transaction(() => {
    for (const p of off) {
      db.prepare('UPDATE products SET track_serials=1 WHERE id=?').run(p.id)
      for (const v of db.prepare('SELECT id FROM variants WHERE product_id=?').all(p.id) as { id: string }[]) created += syncPieces(v.id, staffId as string).created
    }
    if (off.length) audit(staffId, 'serials_everywhere', { products: off.length, created })
  })()
  return { products: off.length, newSerials: created }
}

export function setTrackSerials(productId: string, on: boolean): { newSerials: number } {
  const actor = requireRole('owner', 'manager')
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new Error('Product not found.')
  let created = 0
  db.transaction(() => {
    db.prepare('UPDATE products SET track_serials=? WHERE id=?').run(on ? 1 : 0, productId)
    if (on) for (const v of db.prepare('SELECT id FROM variants WHERE product_id=?').all(productId) as { id: string }[]) created += syncPieces(v.id, actor.id).created
    audit(actor.id, 'serials_toggle', { id: productId, on, created })
  })()
  return { newSerials: created }
}
