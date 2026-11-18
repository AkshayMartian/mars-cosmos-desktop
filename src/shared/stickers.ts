import { formatRupees } from './money'
import { code128Modules, stickerCode } from './serials'

/**
 * One label's worth of data. `qty` is how many stickers of it to print. An item with serial numbers lists the
 * serials to print (one sticker per piece, `qty` = how many) and its barcode carries the serial too.
 */
export interface StickerItem { variantId: string; shop: string; name: string; colour: string; size: string; barcode: string; mrp: number; qty: number; serials?: string[] }

export interface LabelSize { id: string; label: string; wMm: number; hMm: number }
export const LABEL_SIZES: LabelSize[] = [
  { id: '50x25', label: '50 × 25 mm', wMm: 50, hMm: 25 },
  { id: '38x25', label: '38 × 25 mm', wMm: 38, hMm: 25 },
  { id: '50x38', label: '50 × 38 mm', wMm: 50, hMm: 38 }
]
export const labelSize = (id: string): LabelSize => LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES[0]!

export interface StickerContext { shop: string; sizeId: string; printer: string; canManage: boolean }
export interface StickerPrintResult { printed: number }
export const MAX_PER_ITEM = 500

/* EAN-13: bar patterns for the left (L/G) and right (R) halves, and which L/G mix the first digit selects. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const FIRST = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** The 95 modules (1 = bar) of an EAN-13 barcode, or null when it is not a valid 13-digit EAN. */
export function ean13Modules(code: string): string | null {
  if (!/^\d{13}$/.test(code)) return null
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1)
  if ((10 - (sum % 10)) % 10 !== Number(code[12])) return null
  const mix = FIRST[Number(code[0])]!
  let m = '101'
  for (let i = 0; i < 6; i++) m += (mix[i] === 'L' ? L : G)[Number(code[i + 1])]!
  m += '01010'
  for (let i = 0; i < 6; i++) m += R[Number(code[i + 7])]!
  return m + '101'
}

/** SVG of the barcode bars; empty when the code is not an EAN-13. */
export function barcodeSvg(code: string, w: string, h: string): string {
  const m = ean13Modules(code)
  if (!m) return ''
  let rects = ''
  for (let i = 0; i < m.length; ) {
    if (m[i] === '1') { let j = i; while (m[j] === '1') j++; rects += `<rect x="${i}" y="0" width="${j - i}" height="1"/>`; i = j } else i++
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 95 1" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`
}

/** SVG of a Code 128 barcode (the sticker code of a piece: barcode + serial). */
export function code128Svg(text: string, w: string, h: string): string {
  const m = code128Modules(text)
  if (!m) return ''
  let rects = ''
  for (let i = 0; i < m.length; ) {
    if (m[i] === '1') { let j = i; while (m[j] === '1') j++; rects += `<rect x="${i}" y="0" width="${j - i}" height="1"/>`; i = j } else i++
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${m.length} 1" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** One label as HTML (also used for the on-screen preview). Sizes are in mm so it prints at true size. */
export function labelHtml(i: StickerItem, size: LabelSize, serial?: string): string {
  const barH = Math.round(size.hMm * 0.3 * 10) / 10
  const bars = serial ? code128Svg(stickerCode(i.barcode, serial), `${size.wMm - 6}mm`, `${barH}mm`) : barcodeSvg(i.barcode, `${size.wMm - 6}mm`, `${barH}mm`)
  const code = serial ? `${i.barcode} · No. ${serial}` : i.barcode
  return `<div class="lbl" style="width:${size.wMm}mm;height:${size.hMm}mm"><b class="shop">${esc(i.shop)}</b><span>${esc(i.name)}</span><span>${esc(i.size)} · ${esc(i.colour)}</span>${bars}<span class="code">${esc(code)}</span><b class="mrp">MRP ${esc(formatRupees(i.mrp))} <small>incl. of all taxes</small></b></div>`
}

export const LABEL_CSS =
  '*{box-sizing:border-box}.lbl{padding:1.5mm 3mm;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:.2mm;font-family:Arial,sans-serif;font-size:7pt;line-height:1.15;background:#fff;color:#000}' +
  '.lbl .shop{font-size:7.5pt}.lbl .code{font-family:monospace;font-size:6.5pt;letter-spacing:.3px}.lbl .mrp{font-size:8pt}.lbl small{font-weight:normal;font-size:6pt}.lbl svg{display:block}'

/** A whole print job: every item repeated `qty` times, one label per page. */
export function printDocument(items: StickerItem[], size: LabelSize): string {
  const body = items.flatMap((i) => (i.serials ? i.serials.map((s) => labelHtml(i, size, s)) : Array.from({ length: i.qty }, () => labelHtml(i, size)))).join('')
  const css = `@page{size:${size.wMm}mm ${size.hMm}mm;margin:0}body{margin:0}.lbl{page-break-after:always;break-after:page}${LABEL_CSS}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`
}
