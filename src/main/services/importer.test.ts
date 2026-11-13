import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, openDb } from '../db'
import { createCategory, createProduct, listCategories, listProducts } from './catalogue'
import { sampleRows } from '../../../scripts/sample-products'
import { buildTemplate } from './importTemplate'
import { commitImport, previewFile, templateBuffer } from './importer'
import { setCurrent } from './session'
import { stockLevels } from './stock'

const as = (role: string) => setCurrent((getDb().prepare('SELECT id FROM staff WHERE role=?').get(role) as { id: string }).id)
const dir = mkdtempSync(join(tmpdir(), 'mars-import-'))

async function xlsx(name: string, header: string[], rows: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Products')
  ws.addRow(header)
  rows.forEach((r) => ws.addRow(r))
  const p = join(dir, name)
  await wb.xlsx.writeFile(p)
  return p
}
const H = ['Product', 'Brand', 'Category', 'Size', 'Colour', 'MRP', 'Sale price', 'Cost', 'Qty']

beforeEach(() => { openDb(':memory:'); setCurrent(null) })

describe('categories', () => {
  it('adds categories with a fixed or automatic GST rule', () => {
    as('manager')
    const c = createCategory({ name: 'Socks', hsn: '6115', gst: 12 })
    expect(c).toMatchObject({ mode: 'fixed', rate: 12 })
    expect(createCategory({ name: 'Kurtas', hsn: '6104', gst: 'auto' }).mode).toBe('auto')
    expect(() => createCategory({ name: 'socks', hsn: '', gst: 5 })).toThrow('already exists')
    expect(() => createCategory({ name: ' ', hsn: '', gst: 5 })).toThrow('name')
    expect(listCategories().some((x) => x.name === 'Socks')).toBe(true)
    as('cashier')
    expect(() => createCategory({ name: 'Hats', hsn: '', gst: 5 })).toThrow('not allowed')
  })
})

describe('category persistence', () => {
  it('is saved in the database file and survives closing and reopening it', () => {
    const file = join(dir, 'persist.db')
    openDb(file)
    as('owner')
    const added = createCategory({ name: 'Ties', hsn: '6215', gst: 12 })
    expect(getDb().prepare('SELECT name,hsn,gst_mode,gst_rate,is_service FROM categories WHERE id=?').get(added.id))
      .toEqual({ name: 'Ties', hsn: '6215', gst_mode: 'fixed', gst_rate: 12, is_service: 0 })
    expect(getDb().prepare("SELECT action FROM audit_log WHERE action='category_create'").all()).toHaveLength(1)
    getDb().close()

    openDb(file) // a fresh start of the app on the same file
    expect(listCategories().find((c) => c.name === 'Ties')).toMatchObject({ id: added.id, hsn: '6215', mode: 'fixed', rate: 12 })
    expect(listCategories().filter((c) => c.name === 'Shirts')).toHaveLength(1) // seeding does not run twice
    getDb().close()
  })
})

describe('excel import', () => {
  it('previews good and bad rows, then imports only the good ones', async () => {
    as('owner')
    createProduct({ name: 'Old Shirt', brand: '', categoryId: listCategories()[0]!.id, mrp: 100_000, salePrice: 0, cost: 0, sizes: ['M'], colours: ['Red'], opening: {} })
    const file = await xlsx('a.xlsx', H, [
      ['Formal Shirt', 'Own', 'Shirts', '40', 'Sky', 1299, 1299, 650, 6],
      ['Formal Shirt', 'Own', 'shirts', '42', 'Sky', 1299, '', 650, 5],
      ['Cotton Kurta', 'Own', 'Shirts', '', 'White', 999, '', '', 4],
      ['Formal Shirt', 'Own', 'Shirts', '40', 'Sky', 1299, '', '', 1],
      ['Mystery', '', 'Nope', 'M', 'Red', 500, '', '', 1],
      ['Old Shirt', '', 'Shirts', 'L', 'Red', 500, '', '', 1],
      ['Bad Qty', '', 'Shirts', 'M', 'Red', 500, '', '', 1.5]
    ])
    const p = await previewFile(file)
    expect(p.rows.map((r) => r.error)).toEqual([
      null, null, 'Size missing', 'Same size and colour appears twice',
      'Unknown category "Nope"', 'Product already exists', 'Qty must be a whole number'
    ])
    expect(p.goodRows).toBe(2)
    expect(p.goodPieces).toBe(11)

    const r = commitImport(p.token)
    expect(r).toEqual({ products: 1, items: 2, pieces: 11 })
    const prod = listProducts('Formal')[0]!
    expect(prod).toMatchObject({ name: 'Formal Shirt', stock: 11, sizes: ['40', '42'] })
    expect(stockLevels('Formal').map((s) => s.qty)).toEqual([6, 5])
    expect(() => commitImport(p.token)).toThrow('expired') // cannot import the same preview twice
  })

  it('refuses a file without the required columns, and non-managers', async () => {
    as('owner')
    const bad = await xlsx('b.xlsx', ['Product', 'Size'], [['X', 'M']])
    await expect(previewFile(bad)).rejects.toThrow('no "Category" column')
    as('store')
    await expect(previewFile(bad)).rejects.toThrow('not allowed')
  })

  it('imports the whole sample file cleanly: every row valid, products and stock as listed', async () => {
    as('owner')
    createCategory({ name: 'Skirt', hsn: '6204', gst: 'auto' }) // the shop's own extra category
    const names = listCategories().map((c) => c.name)
    const rows = sampleRows(names)
    expect(rows.length).toBeGreaterThan(50)
    const f = join(dir, 'sample.xlsx')
    writeFileSync(f, await buildTemplate(names.map((n) => ({ name: n, hsn: '', gst: '' })), rows))

    const pv = await previewFile(f)
    expect(pv.rows.filter((r) => r.error)).toEqual([]) // no row is skipped
    const r = commitImport(pv.token)
    expect(r.products).toBe(11)
    expect(r.items).toBe(rows.length)
    expect(r.pieces).toBe(rows.reduce((a, x) => a + Number(x[8]), 0))
    expect(listProducts('Oxford')[0]).toMatchObject({ sizes: ['38', '40', '42', '44'], colours: ['White', 'Sky'] })
    expect(stockLevels('Watch').map((s) => s.qty).every((q) => q > 0)).toBe(true) // every item got opening stock
  })
  it('leaves out sample products whose category the shop does not have', () => {
    const rows = sampleRows(['Shirts'])
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set(['Oxford Formal Shirt', 'Linen Casual Shirt']))
    expect(sampleRows([])).toEqual([])
  })
  it('reads CSV files too', async () => {
    as('manager')
    const p = join(dir, 'c.csv')
    writeFileSync(p, 'Product,Category,Size,Colour,MRP,Qty\nPolo,T-Shirts,M,Black,899,3\n')
    const pv = await previewFile(p)
    expect(pv.goodRows).toBe(1)
    commitImport(pv.token)
    expect(stockLevels('Polo')[0]!.qty).toBe(3)
  })

  it('makes a template the importer accepts: blank Products sheet first, shop categories, working examples', async () => {
    as('owner')
    createCategory({ name: 'Socks', hsn: '6115', gst: 12 })
    const f = join(dir, 't.xlsx')
    writeFileSync(f, await templateBuffer())

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(f)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Products', 'How to fill', 'Categories', 'Examples']) // importer reads the first sheet
    const products = wb.getWorksheet('Products')!
    expect(products.getRow(1).values).toEqual([undefined, 'Product', 'Brand', 'Category', 'Size', 'Colour', 'MRP', 'Sale price', 'Cost', 'Qty'])
    expect(products.rowCount).toBeGreaterThan(1000) // validation rows exist, but they hold no data
    expect(products.getCell('A2').value).toBeNull()
    expect(products.getCell('C2').dataValidation).toMatchObject({ type: 'list' }) // Category dropdown
    expect(products.getCell('I2').dataValidation).toMatchObject({ type: 'whole' })
    const cats = (wb.getWorksheet('Categories')!.getColumn(1).values as unknown[]).slice(2)
    expect(cats).toContain('Socks') // the shop's own categories, not a fixed list
    expect(cats).toContain('Shirts')
    await expect(previewFile(f)).rejects.toThrow('no rows') // nothing is imported from an unfilled template

    // Copy the example rows into Products: every one must import cleanly.
    const examples = wb.getWorksheet('Examples')!
    const filled = [...Array(4)].map((_, i) => (examples.getRow(i + 2).values as (string | number)[]).slice(1))
    const g = await xlsx('from-examples.xlsx', ['Product', 'Brand', 'Category', 'Size', 'Colour', 'MRP', 'Sale price', 'Cost', 'Qty'], filled)
    const pv = await previewFile(g)
    expect(pv.rows.map((r) => r.error)).toEqual([null, null, null, null])
    expect(commitImport(pv.token)).toEqual({ products: 2, items: 4, pieces: 18 })
  })
})
