import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import ExcelJS from 'exceljs'
import { getDb } from '../db'
import { toPaise } from '@shared/money'
import type { ImportPreview, ImportResult, ImportRowDto } from '@shared/catalogue'
import { insertProduct, productNameTaken, type VariantSpec } from './catalogue'
import { buildTemplate, COLUMNS } from './importTemplate'
import { requireRole } from './session'

/** Excel/CSV import of products with opening stock. No electron imports here so it can be tested. */

const REQUIRED = ['Product', 'Category', 'Size', 'Colour', 'MRP'] as const

const gstText = (mode: string, rate: number): string => (mode === 'auto' ? 'Clothing auto (5% / 18%)' : mode === 'fixed' ? `${rate}% fixed` : 'Exempt')

/** The blank import file, with this shop's real categories in the dropdown. */
export async function templateBuffer(): Promise<Buffer> {
  const cats = getDb().prepare('SELECT name,hsn,gst_mode AS mode,gst_rate AS rate FROM categories WHERE is_service=0 ORDER BY name').all() as { name: string; hsn: string; mode: string; rate: number }[]
  return buildTemplate(cats.map((c) => ({ name: c.name, hsn: c.hsn, gst: gstText(c.mode, c.rate) })))
}

interface GoodRow { product: string; brand: string; categoryId: string; spec: VariantSpec }
const pending = new Map<string, GoodRow[]>()

const num = (s: string): number => Number(s.replace(/[₹,\s]/g, ''))

async function readRows(path: string): Promise<{ row: number; cells: Record<string, string> }[]> {
  const wb = new ExcelJS.Workbook()
  if (/\.csv$/i.test(path)) await wb.csv.readFile(path)
  else await wb.xlsx.readFile(path)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('The file has no sheet.')

  const header = new Map<string, number>() // lower-case column name -> column number
  ws.getRow(1).eachCell((c, n) => header.set(c.text.trim().toLowerCase(), n))
  for (const r of REQUIRED) if (!header.has(r.toLowerCase())) throw new Error(`The file has no "${r}" column. Use the template.`)

  const out: { row: number; cells: Record<string, string> }[] = []
  ws.eachRow((r, rowNumber) => {
    if (rowNumber === 1) return
    const cells: Record<string, string> = {}
    for (const col of COLUMNS) {
      const n = header.get(col.toLowerCase())
      cells[col] = n ? r.getCell(n).text.trim() : ''
    }
    if (Object.values(cells).some(Boolean)) out.push({ row: rowNumber, cells })
  })
  return out
}

export async function previewFile(path: string): Promise<ImportPreview> {
  requireRole('owner', 'manager')
  const raw = await readRows(path)
  if (!raw.length) throw new Error('The file has no rows to import.')
  const db = getDb()
  const cats = new Map((db.prepare('SELECT id,lower(name) AS n FROM categories WHERE is_service=0').all() as { id: string; n: string }[]).map((c) => [c.n, c.id]))

  const rows: ImportRowDto[] = []
  const good: GoodRow[] = []
  const seen = new Set<string>() // product|size|colour
  const firstCategory = new Map<string, string>() // product -> category id of its first row
  const existing = new Map<string, boolean>()

  for (const { row, cells } of raw) {
    const name = cells['Product']!
    const key = name.toLowerCase()
    const qtyText = cells['Qty']!
    const qty = qtyText === '' ? 0 : num(qtyText)
    const mrp = num(cells['MRP']!)
    const sale = cells['Sale price'] ? num(cells['Sale price']) : 0
    const cost = cells['Cost'] ? num(cells['Cost']) : 0
    const catId = cats.get(cells['Category']!.toLowerCase())
    const dupKey = `${key}|${cells['Size']!.toLowerCase()}|${cells['Colour']!.toLowerCase()}`

    let error: string | null = null
    if (!name) error = 'Product name missing'
    else if (!cells['Size']) error = 'Size missing'
    else if (!cells['Colour']) error = 'Colour missing'
    else if (!cells['Category']) error = 'Category missing'
    else if (!catId) error = `Unknown category "${cells['Category']}"`
    else if (!(mrp > 0)) error = 'MRP must be a number above 0'
    else if (cells['Sale price'] && !(sale >= 0)) error = 'Sale price is not a number'
    else if (cells['Cost'] && !(cost >= 0)) error = 'Cost is not a number'
    else if (!Number.isInteger(qty) || qty < 0) error = 'Qty must be a whole number'
    else if (seen.has(dupKey)) error = 'Same size and colour appears twice'
    else {
      if (!existing.has(key)) existing.set(key, productNameTaken(name))
      if (existing.get(key)) error = 'Product already exists'
      else if (firstCategory.has(key) && firstCategory.get(key) !== catId) error = 'Different category from the first row of this product'
    }

    rows.push({ row, product: name, size: cells['Size']!, colour: cells['Colour']!, qty: Number.isFinite(qty) ? qty : 0, error })
    if (!error && catId) {
      seen.add(dupKey)
      if (!firstCategory.has(key)) firstCategory.set(key, catId)
      good.push({ product: name, brand: cells['Brand']!, categoryId: catId, spec: { size: cells['Size']!, colour: cells['Colour']!, mrp: toPaise(mrp), salePrice: toPaise(sale), cost: toPaise(cost), qty } })
    }
  }

  const token = randomUUID()
  pending.clear() // only the latest preview can be imported
  pending.set(token, good)
  return { token, fileName: basename(path), rows, goodRows: good.length, goodPieces: good.reduce((a, g) => a + g.spec.qty, 0) }
}

export function commitImport(token: string): ImportResult {
  const actor = requireRole('owner', 'manager')
  const good = pending.get(token)
  if (!good) throw new Error('This preview has expired. Choose the file again.')

  const byProduct = new Map<string, GoodRow[]>()
  for (const g of good) byProduct.set(g.product.toLowerCase(), [...(byProduct.get(g.product.toLowerCase()) ?? []), g])

  let items = 0
  const variantIds: string[] = []
  getDb().transaction(() => {
    for (const group of byProduct.values()) {
      const first = group[0]!
      variantIds.push(...insertProduct(actor.id, { name: first.product, brand: first.brand, categoryId: first.categoryId }, group.map((g) => g.spec), 'import').variantIds)
      items += group.length
    }
  })()
  pending.delete(token)
  return { products: byProduct.size, items, pieces: good.reduce((a, g) => a + g.spec.qty, 0), variantIds }
}
