import { describe, expect, it } from 'vitest'
import { calc } from './calc'
import { ean13, storeBarcode } from './barcode'
import { formatRupees, toPaise } from './money'

const auto = { mode: 'auto', rate: 0 } as const
const line = (price: number, qty = 1, disc = 0) => ({
  variantId: 'v', qty, price: toPaise(price), disc: toPaise(disc), gst: auto
})

describe('calc', () => {
  it('backs 5% GST out of a shirt under Rs 2,500', () => {
    const r = calc('regular', [line(1499)])
    expect(r.grand).toBe(149_900)
    expect(r.lines[0]!.rate).toBe(5)
    expect(r.taxable + r.cgst + r.sgst).toBe(149_900)
  })

  it('uses 18% above Rs 2,500 per piece', () => {
    expect(calc('regular', [line(2799)]).lines[0]!.rate).toBe(18)
  })

  it('charges no GST for composition and unregistered shops', () => {
    expect(calc('composition', [line(1499)]).cgst).toBe(0)
    expect(calc('unregistered', [line(1499)]).lines[0]!.rate).toBe(0)
  })

  it('spreads bill discount so the parts add up exactly', () => {
    const r = calc('regular', [line(1499), line(899, 2), line(799)], toPaise(333))
    expect(r.lines.reduce((a, l) => a + l.share, 0)).toBe(toPaise(333))
    expect(r.lines.reduce((a, l) => a + l.net, 0) + r.roundOff).toBe(r.grand)
  })

  it('rounds the bill to the nearest rupee', () => {
    const r = calc('unregistered', [{ ...line(0), price: 9_950 }])
    expect(r.grand).toBe(10_000)
    expect(r.roundOff).toBe(50)
  })

  it('never lets discount push a bill below zero', () => {
    expect(calc('regular', [line(100)], toPaise(500)).grand).toBe(0)
  })
})

describe('helpers', () => {
  it('formats rupees in Indian grouping', () => {
    expect(formatRupees(toPaise(123456))).toBe('₹1,23,456')
    expect(formatRupees(9_950)).toBe('₹99.50')
  })
  it('makes valid EAN-13 codes', () => {
    expect(ean13('590123412345')).toBe('5901234123457')
    expect(storeBarcode(1)).toHaveLength(13)
    expect(storeBarcode(1).startsWith('200')).toBe(true)
  })
})
