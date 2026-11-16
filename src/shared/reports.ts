import { formatRupees } from './money'

export const REPORT_TABS = [
  ['sales', 'Sales'], ['best', 'Best sellers'], ['size', 'Size sell-through'], ['dead', 'Dead stock'],
  ['stock', 'Stock value'], ['staff', 'Staff & commission'], ['alter', 'Alterations'], ['gst', 'GST summary']
] as const
export type ReportTab = (typeof REPORT_TABS)[number][0]

export const REPORT_PERIODS = [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['365', 'Last 12 months']] as const
export type ReportPeriod = (typeof REPORT_PERIODS)[number][0]

export type Cell = string | number | null
/** money = paise, shown as ₹; int = whole number; pct = whole percent; mono = code-like text; chip = a coloured word; text */
export interface ReportCol { key: string; label: string; kind: 'text' | 'int' | 'money' | 'pct' | 'mono' | 'chip'; right?: boolean }
export interface ReportTable {
  id: string
  title?: string
  columns: ReportCol[]
  rows: Record<string, Cell>[]
  total?: Record<string, Cell>
  empty: string
}
export interface ReportKpi { label: string; value: Cell; kind: 'int' | 'money' | 'text' }
export interface ReportDto {
  tab: ReportTab
  title: string
  period: ReportPeriod
  periodLabel: string
  /** tabs that look at a date range (the stock tabs show the situation right now) */
  usesPeriod: boolean
  kpis: ReportKpi[]
  tables: ReportTable[]
  hint?: string
  /** two tables side by side */
  even: boolean
}

export const DEAD_DAYS = [30, 60, 90] as const

export function fmtCell(col: Pick<ReportCol, 'kind'>, v: Cell): string {
  if (v === null || v === undefined || v === '') return '—'
  if (col.kind === 'money') return formatRupees(Number(v))
  if (col.kind === 'pct') return typeof v === 'string' ? v : `${v}%`
  return String(v)
}

/** Chip colour for the "Next buy" column. */
export const chipTone = (v: Cell): 'good' | 'warn' | 'muted' => (v === 'Buy more' ? 'good' : v === 'Buy less' ? 'warn' : 'muted')

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The report as a printable page (used for the PDF). */
export function reportHtml(r: ReportDto, shop: string): string {
  const kpis = r.kpis.length
    ? `<div class="k">${r.kpis.map((k) => `<div><b>${esc(fmtCell({ kind: k.kind === 'text' ? 'text' : k.kind }, k.value))}</b><span>${esc(k.label)}</span></div>`).join('')}</div>`
    : ''
  const tables = r.tables.map((t) => {
    const head = t.columns.map((c) => `<th class="${c.right ? 'r' : ''}">${esc(c.label)}</th>`).join('')
    const body = t.rows.length
      ? t.rows.map((row) => `<tr>${t.columns.map((c) => `<td class="${c.right ? 'r' : ''}">${esc(fmtCell(c, row[c.key] ?? null))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${t.columns.length}" class="e">${esc(t.empty)}</td></tr>`
    const total = t.total ? `<tr class="t">${t.columns.map((c) => `<td class="${c.right ? 'r' : ''}">${esc(c.key in t.total! ? fmtCell(c, t.total![c.key] ?? null) : '')}</td>`).join('')}</tr>` : ''
    return `${t.title ? `<h2>${esc(t.title)}</h2>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>`
  }).join('')
  const css = '@page{size:A4;margin:14mm}body{font:10pt Arial,sans-serif;color:#111}h1{font-size:16pt;margin:0}h2{font-size:11pt;margin:14px 0 4px}.s{color:#555;margin:2px 0 12px}' +
    '.k{display:flex;gap:10px;margin-bottom:8px}.k div{border:1px solid #ccc;border-radius:6px;padding:6px 10px}.k b{display:block;font-size:13pt}.k span{color:#555;font-size:8.5pt}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;font-size:9pt}th{background:#f1f1f1}.r{text-align:right}.t td{font-weight:bold;border-top:2px solid #999}.e{color:#777;text-align:center}.h{color:#555;font-size:8.5pt;margin-top:6px}'
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><h1>${esc(shop)} · ${esc(r.title)}</h1><div class="s">${esc(r.periodLabel)} · printed ${esc(new Date().toLocaleString('en-IN'))}</div>${kpis}${tables}${r.hint ? `<div class="h">${esc(r.hint)}</div>` : ''}</body></html>`
}
