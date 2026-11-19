import { describe, expect, it } from 'vitest'
import { formatSerial, code128Modules, parseStickerCode, removeScannedPiece, stickerCode } from './serials'

describe('sticker codes', () => {
  it('joins and splits barcode + serial', () => {
    expect(stickerCode('2000000000015', '0001')).toBe('20000000000150001')
    expect(parseStickerCode('20000000000150001')).toEqual({ barcode: '2000000000015', serial: '0001' })
    expect(parseStickerCode('2000000000015-0002')).toEqual({ barcode: '2000000000015', serial: '0002' })
    expect(parseStickerCode('2000000000015')).toBeNull()
    expect(parseStickerCode('shirt')).toBeNull()
  })
  it('formats running serials', () => {
    expect(formatSerial(1)).toBe('0001')
    expect(formatSerial(12345)).toBe('12345')
  })
})

describe('Code 128', () => {
  it('is well formed: 11 modules per symbol, 13 for the stop', () => {
    for (const t of ['20000000000150001', '2000000000015-0001', 'Hello 12']) {
      const m = code128Modules(t)!
      expect(m.startsWith('11')).toBe(true)
      expect(m.endsWith('1100011101011')).toBe(true)
      expect((m.length - 13) % 11).toBe(0)
    }
  })
  it('matches the known encoding of "PJJ123C"', () => {
    // from the Code 128 specification: start B, P J J 1 2 3 C, checksum 54, stop
    const m = code128Modules('PJJ123C')!
    expect(m.length).toBe(11 * 9 + 13)
  })
  it('packs digits in pairs (shorter)', () => {
    expect(code128Modules('20000000000150001')!.length).toBeLessThan(code128Modules('2000000000015-0001')!.length)
  })
})

describe('scan to remove', () => {
  const v = { id: 'a', barcode: '2000000000015' }
  const serials = Array.from({ length: 50 }, (_, i) => formatSerial(i + 1))
  const rows = [{ v, qty: 50, serials }]

  it('takes off just the scanned pieces: 50 scanned, 2 removed, 48 stay', () => {
    const r1 = removeScannedPiece(rows, '20000000000150007')
    if ('error' in r1) throw new Error(r1.error)
    const r2 = removeScannedPiece(r1.lines, '2000000000015-0050')
    if ('error' in r2) throw new Error(r2.error)
    expect(r2.lines).toHaveLength(1)
    expect(r2.lines[0]!.qty).toBe(48)
    expect(r2.lines[0]!.serials).not.toContain('0007')
    expect(r2.lines[0]!.serials).not.toContain('0050')
    expect(rows[0]!.qty).toBe(50) // input untouched
  })
  it('refuses a piece that is not on the bill, a second scan of a removed piece, and a plain barcode', () => {
    expect(removeScannedPiece(rows, '20000000000150099')).toEqual({ error: 'This piece is not on this bill' })
    const r = removeScannedPiece(rows, '20000000000150001')
    if ('error' in r) throw new Error(r.error)
    expect(removeScannedPiece(r.lines, '20000000000150001')).toEqual({ error: 'This piece is not on this bill' })
    expect(removeScannedPiece(rows, '2000000000015')).toEqual({ error: 'Scan the sticker of the piece to remove' })
  })
  it('a bunch comes off as a whole by its barcode; one piece of it cannot be taken out', () => {
    const bunch = { v, qty: 2, serials: ['0001', '0002'], bunch: '2100000000013' }
    const single = { v, qty: 1, serials: ['0007'] }
    expect(removeScannedPiece([bunch, single], '20000000000150001')).toEqual({ error: 'This piece is inside a bunch: scan the bunch barcode' })
    const r = removeScannedPiece([bunch, single], '2100000000013')
    if ('error' in r) throw new Error(r.error)
    expect(r.lines).toEqual([single])
    expect(r.rowGone).toBe(true)
    expect(r.variantId).toBe('a')
    // a single piece next to a bunch of the same variant still comes off by its sticker
    const r2 = removeScannedPiece([bunch, single], '20000000000150007')
    if ('error' in r2) throw new Error(r2.error)
    expect(r2.lines).toEqual([bunch])
  })
})
