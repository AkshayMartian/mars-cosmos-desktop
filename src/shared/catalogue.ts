import type { Paise } from './money'
import type { GstRule } from './types'

/** Data shapes that cross the IPC boundary. Money is always paise. */
export interface CategoryDto extends GstRule {
  id: string
  name: string
  hsn: string
}

export interface ProductListRow {
  id: string
  name: string
  brand: string
  categoryId: string
  categoryName: string
  sizes: string[]
  colours: string[]
  stock: number
  mrp: Paise
}

export interface VariantDto {
  id: string
  productId: string
  size: string
  colour: string
  barcode: string
  brandBarcode: string | null
  mrp: Paise
  salePrice: Paise
  cost: Paise
  minStock: number
  stock: number
}

export interface ProductDetail {
  id: string
  name: string
  brand: string
  categoryId: string
  active: boolean
  /** every piece has its own serial number (Billing then scans pieces, not just barcodes) */
  trackSerials: boolean
  variants: VariantDto[]
}

export interface NewProductInput {
  name: string
  brand: string
  categoryId: string
  mrp: Paise
  salePrice: Paise
  cost: Paise
  sizes: string[]
  colours: string[]
  /** give every piece its own serial number */
  trackSerials?: boolean
  /** GST % for this product (0 to 28). Left out / null = follow the category's rule */
  gstRate?: number | null
  /** opening stock keyed "colour|size" */
  opening: Record<string, number>
  /** photo per colour: { colour: file name returned by the photo chooser }. Optional; every colour may have its own */
  photos?: Record<string, string>
}

export interface VariantSearchRow {
  id: string
  label: string
  barcode: string
  salePrice: Paise
  cost: Paise
  stock: number
  /** serial numbers are on: pieces are chosen by scanning their stickers */
  tracked: boolean
}

/** A piece found by scanning its sticker in Stock out / Adjust. */
export interface PieceScan { variant: VariantSearchRow; serial: string }

export interface StockRow {
  variantId: string
  label: string
  /** serial numbers are on for this item */
  tracked: boolean
  barcode: string
  qty: number
  minStock: number
  costValue: Paise
}

export interface MoveRow {
  at: string
  type: string
  qty: number
  ref: string | null
  reason: string | null
  staff: string | null
}

export interface SupplierDto {
  id: string
  name: string
  mobile: string | null
  gstin: string | null
}

export interface StockInInput {
  supplierId: string | null
  billNo: string
  billDate: string
  lines: { variantId: string; qty: number; cost: Paise }[]
  /** the same supplier bill number was already entered: save anyway (the owner confirmed) */
  allowDuplicate?: boolean
}

/** Start of the refusal when a supplier bill number was entered before; the screen asks "save anyway?" */
export const DUPLICATE_PURCHASE = 'Duplicate purchase:'

export interface PurchaseRow {
  id: string
  supplier: string | null
  billNo: string | null
  at: string
  qty: number
  total: Paise
}

/** The photo of one colour of a product (all sizes of that colour share it). */
export interface ProductPhotoDto {
  colour: string
  /** stored file name, e.g. 0123…-blue.jpg */
  file: string
  dataUrl: string | null
}

export interface NewCategoryInput {
  name: string
  hsn: string
  /** 'auto' = clothing (5% up to Rs 2,500 per piece, else 18%); otherwise a fixed rate */
  gst: 'auto' | 5 | 12 | 18
}

export interface ImportRowDto {
  row: number
  product: string
  size: string
  colour: string
  qty: number
  /** null = good row; otherwise why the row is skipped */
  error: string | null
}

export interface ImportPreview {
  token: string
  fileName: string
  rows: ImportRowDto[]
  goodRows: number
  goodPieces: number
}

export interface ImportResult {
  products: number
  items: number
  pieces: number
  /** the items just created, so labels can be printed for them */
  variantIds: string[]
}

export const variantLabel = (name: string, colour: string, size: string): string =>
  `${name} · ${colour}${size && size !== 'Free' ? ' · ' + size : ''}`
