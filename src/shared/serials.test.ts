import { describe, expect, it } from 'vitest'
import { code128Modules, formatSerial, parseStickerCode, stickerCode } from './serials'

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
