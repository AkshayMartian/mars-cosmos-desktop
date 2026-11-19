/**
 * Receipt text on a paper roll in JetBrains Mono (the font of the on-screen receipt), sized like a thermal printer's
 * "Font A": 48 characters across an 80 mm roll (576 dots at 203 dpi = 72 mm printable, 1.5 mm per character) and 32
 * across a 58 mm roll (384 dots = 48 mm). The font has a fixed width, so the receipt text, which is padded with spaces
 * to its width, lines up exactly as it does on screen. Text built for a narrower width (for example 36 columns) is made
 * larger so it still fills the roll.
 */

export interface RollDoc { html: string; wMm: number; hMm: number }

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const MM_PER_PT = 25.4 / 72
const ADVANCE = 0.6 // JetBrains Mono: every character is 0.6 em wide
const LINE_HEIGHT = 1.45

/** Fonts tried in order; the first is the bundled one (its @font-face is passed in by the main process). */
export const MONO_FAMILY = '"JetBrains Mono","Consolas","Courier New",monospace'

/** `fontFace`: an @font-face rule that makes "JetBrains Mono" available inside the print window (it has no access to the app's files). */
export function rollDoc(text: string, chars: number, fontFace = ''): RollDoc {
  const narrow = chars <= 32
  const wMm = narrow ? 58 : 80
  const printMm = narrow ? 48 : 72
  const sideMm = (wMm - printMm) / 2
  const fontMm = printMm / chars / ADVANCE
  const pt = Math.round((fontMm / MM_PER_PT) * 100) / 100
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / chars)), 0) // a line longer than the paper wraps
  const hMm = Math.ceil(rows * fontMm * LINE_HEIGHT + 8)
  const css = `@page{size:${wMm}mm ${hMm}mm;margin:0}${fontFace}` +
    `body{margin:0;padding:2mm ${sideMm}mm;color:#000;font:600 ${pt}pt/${LINE_HEIGHT} ${MONO_FAMILY}}` +
    `pre{margin:0;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}`
  return { html: `<!doctype html><meta charset="utf-8"><style>${css}</style><pre>${lines.map(esc).join('\n')}</pre>`, wMm, hMm }
}
