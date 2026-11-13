import ExcelJS from 'exceljs'

/**
 * The Excel file shop owners fill in to import products with opening stock.
 * Pure (no database, no electron) so the app's "Download template" button and a command-line script
 * produce exactly the same file. The importer reads the FIRST sheet, so "Products" must stay first.
 */

export const COLUMNS = ['Product', 'Brand', 'Category', 'Size', 'Colour', 'MRP', 'Sale price', 'Cost', 'Qty'] as const

export interface TemplateCategory {
  name: string
  hsn: string
  /** e.g. "Clothing auto (5% / 18%)" or "18% fixed" */
  gst: string
}

const MAX_ROWS = 2000 // rows that get the dropdown and number checks

/** `rows` pre-fills the Products sheet (used for the sample file); leave it out for the blank template. */
export async function buildTemplate(categories: TemplateCategory[], rows: (string | number)[][] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MARS POS'

  /* 1 · Products: the sheet that gets imported (header only) */
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] })
  const head = ws.addRow([...COLUMNS])
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4441F' } }; c.alignment = { vertical: 'middle' } })
  head.height = 22
  const widths = [28, 16, 20, 10, 14, 11, 12, 11, 8]
  ws.columns = widths.map((width, i) => ({ key: COLUMNS[i]!, width }))

  for (const r of rows) ws.addRow(r)

  // Category dropdown (from the Categories sheet) and number checks, so mistakes are caught while typing.
  const catRange = categories.length ? `Categories!$A$2:$A$${categories.length + 1}` : null
  for (let r = 2; r <= MAX_ROWS; r++) {
    if (catRange) ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [catRange], showErrorMessage: true, errorTitle: 'Category', error: 'Pick a category from the list (see the Categories sheet).' }
    for (const col of ['F', 'G', 'H']) {
      ws.getCell(`${col}${r}`).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Amount', error: 'Enter an amount in rupees, 0 or more. No ₹ sign or commas needed.' }
      ws.getCell(`${col}${r}`).numFmt = '0.00'
    }
    ws.getCell(`I${r}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Qty', error: 'Enter a whole number of pieces, 0 or more.' }
  }

  /* 2 · How to fill */
  const help = wb.addWorksheet('How to fill')
  help.getColumn(1).width = 16
  help.getColumn(2).width = 100
  help.addRow(['MARS POS · product import']).font = { bold: true, size: 14 }
  help.addRow([])
  const helpRows: [string, string][] = [
    ['How it works', 'Fill the "Products" sheet: one row for each size and colour of a product. Save the file. In MARS POS go to Products > Import from Excel > Choose file.'],
    ['Check first', 'The app shows every row before importing. Rows with mistakes are skipped and tell you why; good rows are imported.'],
    ['Product *', 'Product name. Repeat the same name on every row of that product (one row per size and colour). Names that already exist in the app are skipped.'],
    ['Brand', 'Optional.'],
    ['Category *', 'Pick from the dropdown. It must match a category in the app (see the Categories sheet). Add new ones in the app: Products > Categories.'],
    ['Size *', 'For example S, M, L, XL or 30, 32. Use "Free" when there is no size.'],
    ['Colour *', 'For example Blue, Black. Use the same spelling every time.'],
    ['MRP *', 'Maximum retail price in rupees, including GST. Numbers only.'],
    ['Sale price', 'Optional. The price you actually sell at, including GST. Leave blank to use the MRP.'],
    ['Cost', 'Optional. What you paid for one piece. Used for stock value reports.'],
    ['Qty', 'Optional. Pieces you have in the shop today (opening stock). Leave blank for 0. A whole number.'],
    ['Barcodes', 'MARS POS makes a barcode for every row. Print stickers after importing. Brand barcodes can be added later on the product screen.'],
    ['Rules', 'Do not change the column names in row 1. Do not add or reorder columns. A product cannot have the same size and colour twice, and all rows of one product need the same category.'],
    ['* required', '']
  ]
  for (const r of helpRows) {
    const row = help.addRow(r)
    row.getCell(1).font = { bold: true }
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(1).alignment = { vertical: 'top' }
  }

  /* 3 · Categories (reference, also feeds the dropdown) */
  const cs = wb.addWorksheet('Categories')
  cs.addRow(['Category', 'HSN', 'GST']).font = { bold: true }
  cs.columns = [{ width: 24 }, { width: 14 }, { width: 28 }]
  for (const c of categories) cs.addRow([c.name, c.hsn, c.gst])

  /* 4 · Examples: not imported, copy rows into "Products" if useful */
  const ex = wb.addWorksheet('Examples')
  ex.addRow([...COLUMNS]).font = { bold: true }
  ex.columns = widths.map((width) => ({ width }))
  // Sensible categories for the examples when the shop has them; otherwise whatever the shop has.
  const pick = (name: string): string => categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name ?? categories[0]?.name ?? name
  const c1 = pick('Shirts')
  const c2 = pick('Trousers')
  ex.addRow(['Formal Shirt', 'Own', c1, '40', 'Sky', 1299, 1299, 650, 6])
  ex.addRow(['Formal Shirt', 'Own', c1, '42', 'Sky', 1299, 1299, 650, 5])
  ex.addRow(['Formal Shirt', 'Own', c1, '40', 'White', 1299, 1199, 650, 4])
  ex.addRow(['Chino Trouser', 'Denimo', c2, '32', 'Khaki', 1799, '', 950, 3])
  ex.addRow([])
  ex.addRow(['These rows are only examples. They are not imported: the app reads the "Products" sheet.'])

  return Buffer.from(await wb.xlsx.writeBuffer())
}
