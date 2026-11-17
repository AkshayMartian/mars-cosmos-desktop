import { describe, expect, it } from 'vitest'
import { rollDoc } from './rollPrint'

describe('rollDoc (Arial Black receipt layout)', () => {
  const line = '-'.repeat(36)
  const text = ['   RAJ FASHION', line, 'TOTAL                    Rs 1,299.00', 'Exchange within 7 days with this bill. No cash refund on sale items.'].join('\n')

  it('uses Arial Black, 11 pt on 80 mm paper and 9 pt on 58 mm', () => {
    expect(rollDoc(text, 36)).toMatchObject({ wMm: 80, html: expect.stringContaining('11pt/1.3 "Arial Black"') })
    expect(rollDoc(text, 32)).toMatchObject({ wMm: 58, html: expect.stringContaining('9pt/1.3 "Arial Black"') })
  })
  it('turns rules into borders, gaps into left/right columns and indents into centred lines', () => {
    const { html } = rollDoc(text, 36)
    expect(html).toContain('class="sep"')
    expect(html).toContain('<div class="l c"><span>TOTAL</span><span>Rs 1,299.00</span></div>')
    expect(html).toContain('<div class="l m">RAJ FASHION</div>')
  })
  it('escapes markup in names', () => {
    expect(rollDoc('Shirt <b> & co', 36).html).toContain('Shirt &lt;b&gt; &amp; co')
  })
  it('makes the page taller for text that has to wrap', () => {
    expect(rollDoc('word '.repeat(60), 36).hMm).toBeGreaterThan(rollDoc('short', 36).hMm)
  })
})
