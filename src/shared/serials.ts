/**
 * Serial numbers: every piece of a tracked product has its own serial, printed on its sticker together with the
 * variant's barcode. Shared by the main process and the screens.
 */

/** Messages the cashier sees (section 7 of the serial-numbers paper). */
export const SERIAL_MSG = {
  already: 'Already added',
  notInStock: 'This piece is not in stock',
  onHold: 'This piece is in another bill on hold',
  unknown: 'This serial number is not in the stock records',
  noSerial: 'This sticker has no serial number. Stick one of our own stickers on the piece first.',
  notOnBill: 'This piece is not on this bill',
  removeNotSticker: 'Scan the sticker of the piece to remove',
  only: (n: number): string => `Only ${n} are free`
} as const

export type PieceStatus = 'in_stock' | 'sold' | 'damaged' | 'supplier_return' | 'dispatched' | 'other_out' | 'lost'

export const PIECE_STATUS_LABEL: Record<PieceStatus, string> = {
  in_stock: 'In stock', sold: 'Sold', damaged: 'Damaged', supplier_return: 'Sent back to supplier', dispatched: 'Dispatched', other_out: 'Taken out', lost: 'Lost'
}

/** Running serial, easy to read and check: 0001, 0002 ... (more digits after 9999). */
export const formatSerial = (n: number): string => String(n).padStart(4, '0')

/** What the sticker barcode says: the variant's barcode followed by the piece's serial. */
export const stickerCode = (barcode: string, serial: string): string => barcode + serial

/**
 * Reads a scanned sticker code. Our barcodes are 13 digits, so "2000000000015" + "0001" splits into both. A typed
 * "barcode-serial" works too. Returns candidates (the caller checks the barcode exists); null = not a sticker code.
 */
export function parseStickerCode(raw: string): { barcode: string; serial: string } | null {
  const c = raw.trim()
  const dash = /^(.+)-(\d+)$/.exec(c)
  if (dash) return { barcode: dash[1]!, serial: dash[2]! }
  const m = /^(\d{13})(\d+)$/.exec(c)
  return m ? { barcode: m[1]!, serial: m[2]! } : null
}

/**
 * Scan to remove: takes one scanned piece off the bill, from whichever row holds it (a variant row or a bunch row).
 * A row left with no pieces goes away. Returns the new rows, or the message to show when the piece is not on the bill.
 */
export function removeScannedPiece<L extends { v: { barcode: string; id: string }; qty: number; serials?: string[] }>(
  lines: L[], code: string
): { lines: L[]; serial: string; rowGone: boolean } | { error: string } {
  const s = parseStickerCode(code)
  if (!s) return { error: SERIAL_MSG.removeNotSticker }
  const hit = lines.find((l) => l.v.barcode === s.barcode && l.serials?.includes(s.serial))
  if (!hit) return { error: SERIAL_MSG.notOnBill }
  const next = lines
    .map((l) => (l === hit ? { ...l, serials: l.serials!.filter((x) => x !== s.serial), qty: l.qty - 1 } : l))
    .filter((l) => !l.serials || l.serials.length > 0)
  return { lines: next, serial: s.serial, rowGone: hit.serials!.length === 1 }
}

/** One piece on a piece list (history, return, stock out). */
export interface PieceDto { serial: string; status: PieceStatus }

export interface PieceHistoryDto {
  label: string
  barcode: string
  serial: string
  status: PieceStatus
  /** bill number the piece is on (when sold) */
  bill: string | null
  events: { at: string; event: string; ref: string | null; staff: string | null }[]
}

/* ---------- Code 128 (the longer sticker code needs more than EAN-13 can carry) ---------- */

const C128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112'
).split(' ')

/** The module string (1 = bar) of a Code 128 barcode; digit pairs are packed (subset C) so the code stays short. */
export function code128Modules(text: string): string | null {
  if (!text || !/^[\x20-\x7e]+$/.test(text)) return null
  const codes: number[] = []
  const digits = /^\d+$/.test(text)
  if (digits && text.length >= 4) {
    let i = 0
    if (text.length % 2) { codes.push(104, text.charCodeAt(0) - 32, 99); i = 1 } else codes.push(105)
    for (; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)))
  } else {
    codes.push(104)
    for (const ch of text) codes.push(ch.charCodeAt(0) - 32)
  }
  let sum = codes[0]!
  for (let i = 1; i < codes.length; i++) sum += codes[i]! * i
  codes.push(sum % 103, 106)
  let m = ''
  for (const c of codes) {
    const w = C128[c]!
    for (let k = 0; k < w.length; k++) m += (k % 2 === 0 ? '1' : '0').repeat(Number(w[k]))
  }
  return m
}
