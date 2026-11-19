import { describe, expect, it } from 'vitest'
import { receiptWidth } from './receipt'
import { rollDoc } from './rollPrint'

describe('rollDoc (JetBrains Mono, thermal "Font A" sizing)', () => {
  const line = '-'.repeat(48)
  const text = ['   RAJ FASHION', line, 'TOTAL                          Rs 1,299.00', 'Exchange within 7 days with this bill. No cash refund on sale items.'].join('\n')

  it('Font A: 48 characters across an 80 mm roll and 32 across a 58 mm roll, in the bold mono font', () => {
    expect(receiptWidth({ width: '80 mm' })).toBe(48)
    expect(receiptWidth({ width: '58 mm' })).toBe(32)
    const wide = rollDoc(text, 48)
    expect(wide).toMatchObject({ wMm: 80, html: expect.stringContaining('600 7.09pt/1.45 "JetBrains Mono"') })
    expect(wide.html).toContain('padding:2mm 4mm') // 72 mm printable on 80 mm paper
    const narrow = rollDoc(text, 32)
    expect(narrow).toMatchObject({ wMm: 58, html: expect.stringContaining('600 7.09pt/1.45 "JetBrains Mono"') })
    expect(narrow.html).toContain('padding:2mm 5mm') // 48 mm printable on 58 mm paper
  })
  it('text made for fewer columns is made larger so it still fills the roll', () => {
    expect(rollDoc(text, 36).html).toContain('9.45pt')
  })
  it('keeps the receipt text as it is (spaces and all) in a pre block', () => {
    const { html } = rollDoc(text, 48)
    expect(html).toContain('<pre>')
    expect(html).toContain('TOTAL                          Rs 1,299.00')
    expect(html).toContain('white-space:pre-wrap')
  })
  it('puts the bundled font into the page when it is given', () => {
    expect(rollDoc('x', 48, '@font-face{font-family:"JetBrains Mono"}').html).toContain('@font-face{font-family:"JetBrains Mono"}')
  })
  it('escapes markup in names', () => {
    expect(rollDoc('Shirt <b> & co', 48).html).toContain('Shirt &lt;b&gt; &amp; co')
  })
  it('makes the page taller for text that has to wrap', () => {
    expect(rollDoc('word '.repeat(60), 48).hMm).toBeGreaterThan(rollDoc('short', 48).hMm)
  })
})
