/**
 * Receipt text on a paper roll in Arial Black. Arial Black is not a fixed-width font, so the spaces the receipt text uses
 * to line things up would drift. Instead each line is laid out by its shape: a rule becomes a dashed border, a line with
 * a gap ("Total      1,299.00") puts its parts at the left and right edges, a line with leading spaces is centred, and
 * anything else is plain text that wraps if it is too long for the paper.
 */

export interface RollDoc { html: string; wMm: number; hMm: number }

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const MM_PER_PT = 25.4 / 72
const CHAR_EM = 0.72 // average width of an Arial Black character, in em (a little generous, so paper is never cut short)

export function rollDoc(text: string, chars: number): RollDoc {
  const wMm = chars <= 32 ? 58 : 80
  const pt = chars <= 32 ? 9 : 11
  const lineMm = pt * 1.3 * MM_PER_PT
  const perLine = Math.floor((wMm - 6) / (pt * CHAR_EM * MM_PER_PT))
  let rows = 0
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^[-=_*]{5,}$/.test(line.trim())) { out.push('<div class="sep"></div>'); rows += 0.5; continue }
    if (!line.trim()) { out.push('<div class="l">&nbsp;</div>'); rows += 1; continue }
    const lead = line.length - line.trimStart().length
    const parts = line.trim().split(/\s{2,}/)
    if (parts.length >= 2) {
      const indent = lead > 0 ? ` style="padding-left:${Math.min(lead, 6) * 0.5}em"` : ''
      out.push(`<div class="l c"${indent}>${parts.map((p) => `<span>${esc(p)}</span>`).join('')}</div>`)
      rows += Math.max(1, Math.ceil(parts.join(' ').length / perLine))
    } else if (lead >= 2) {
      out.push(`<div class="l m">${esc(line.trim())}</div>`)
      rows += Math.max(1, Math.ceil(line.trim().length / perLine))
    } else {
      out.push(`<div class="l">${esc(line)}</div>`)
      rows += Math.max(1, Math.ceil(line.length / perLine))
    }
  }
  const hMm = Math.ceil((rows + 1) * lineMm + 8)
  const css = `@page{size:${wMm}mm ${hMm}mm;margin:0}body{margin:0;padding:2mm 3mm;color:#000;font:${pt}pt/1.3 "Arial Black","Arial",sans-serif}` +
    `.l{margin:0;overflow-wrap:anywhere}.c{display:flex;justify-content:space-between;gap:2mm}.c span:last-child{text-align:right;flex:none}.m{text-align:center}` +
    `.sep{border-top:.5mm dashed #000;margin:1.2mm 0}`
  return { html: `<!doctype html><meta charset="utf-8"><style>${css}</style>${out.join('')}`, wMm, hMm }
}
