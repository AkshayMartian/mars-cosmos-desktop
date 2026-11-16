import { getDb } from '../db'
import { variantLabel } from '@shared/catalogue'
import { localDate } from '@shared/dates'
import { DEAD_DAYS, REPORT_PERIODS, REPORT_TABS, type ReportDto, type ReportPeriod, type ReportTab, type ReportTable } from '@shared/reports'
import { requireRole } from './session'

/**
 * Reports for the owner and manager. Everything is worked out from the bills and the stock ledger,
 * so it always agrees with Day end and the Bills list. Money is in paise.
 */

const DAY = 864e5

/** Start of the period: today means from midnight; the others are "now minus N days" like the design. */
function periodStart(p: ReportPeriod): Date {
  if (p === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
  return new Date(Date.now() - Number(p) * DAY)
}

const NON_SERVICE = 'c.is_service=0'
const VAR_JOIN = 'FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id'

type Row = Record<string, string | number | null>
const all = (sql: string, ...args: unknown[]): Row[] => getDb().prepare(sql).all(...args) as Row[]
const num = (v: unknown): number => Number(v ?? 0)
const str = (v: unknown): string => String(v ?? '')

export function getReport(tab: ReportTab, period: ReportPeriod, deadDays = 30): ReportDto {
  requireRole('owner', 'manager')
  if (!REPORT_TABS.some(([k]) => k === tab)) throw new Error('Unknown report.')
  const periodLabel = REPORT_PERIODS.find(([k]) => k === period)?.[1]
  if (!periodLabel) throw new Error('Unknown period.')
  if (!(DEAD_DAYS as readonly number[]).includes(deadDays)) throw new Error('Choose 30, 60 or 90 days.')
  const from = periodStart(period).toISOString()
  const title = REPORT_TABS.find(([k]) => k === tab)![1]
  const base = { tab, title, period, periodLabel, usesPeriod: !['dead', 'stock', 'size'].includes(tab), kpis: [], tables: [], even: false }
  switch (tab) {
    case 'sales': return { ...base, ...sales(from) }
    case 'best': return { ...base, ...best(from) }
    case 'size': return { ...base, ...sizeThrough(), periodLabel: 'Since the start' }
    case 'dead': return { ...base, ...dead(deadDays), periodLabel: `Not sold in ${deadDays} days` }
    case 'stock': return { ...base, ...stockValue(), periodLabel: 'Right now' }
    case 'staff': return { ...base, ...staff(from) }
    case 'alter': return { ...base, ...alterations(from) }
    default: return { ...base, ...gst(from) }
  }
}

type Part = Partial<ReportDto>

function sales(from: string): Part {
  const bills = all("SELECT at,type,grand FROM bills WHERE status='completed' AND at>=?", from)
  const sale = bills.filter((b) => b.type === 'sale')
  const returns = bills.filter((b) => b.type === 'return')
  const total = bills.reduce((a, b) => a + num(b.grand), 0)
  const saleSum = sale.reduce((a, b) => a + num(b.grand), 0)
  const modes = all("SELECT p.mode,SUM(p.amount) AS amount FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.status='completed' AND b.at>=? GROUP BY p.mode ORDER BY amount DESC", from)
  const byDay = new Map<string, { n: number; v: number }>()
  for (const b of bills) {
    const k = localDate(new Date(String(b.at)))
    const e = byDay.get(k) ?? { n: 0, v: 0 }
    if (b.type === 'sale') e.n++
    e.v += num(b.grand)
    byDay.set(k, e)
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14)
  const pay: ReportTable = {
    id: 'modes', columns: [{ key: 'mode', label: 'Payment mode', kind: 'text' }, { key: 'amount', label: 'Amount', kind: 'money', right: true }],
    rows: modes.map((m) => ({ mode: String(m.mode).replace('_', ' '), amount: num(m.amount) })), empty: 'No sales'
  }
  const day: ReportTable = {
    id: 'days', columns: [{ key: 'day', label: 'Day', kind: 'text' }, { key: 'bills', label: 'Bills', kind: 'int', right: true }, { key: 'sales', label: 'Sales', kind: 'money', right: true }],
    rows: days.map(([k, v]) => ({ day: new Date(k + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), bills: v.n, sales: v.v })), empty: 'No sales'
  }
  return {
    even: true,
    kpis: [
      { label: 'Net sales', value: total, kind: 'money' },
      { label: 'Bills', value: sale.length, kind: 'int' },
      { label: 'Average bill', value: sale.length ? Math.round(saleSum / sale.length) : null, kind: 'money' },
      { label: 'Returns', value: 0 - returns.reduce((a, b) => a + num(b.grand), 0), kind: 'money' }
    ],
    tables: [pay, day]
  }
}

function best(from: string): Part {
  const src = `FROM bill_lines l JOIN bills b ON b.id=l.bill_id JOIN variants v ON v.id=l.variant_id JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
    WHERE b.status='completed' AND b.type='sale' AND b.at>=? AND ${NON_SERVICE}`
  const products = all(`SELECT l.name AS name,SUM(l.qty) AS pieces,SUM(l.total) AS sales ${src} GROUP BY l.name ORDER BY pieces DESC, sales DESC`, from)
  const sizes = all(`SELECT l.size AS size,SUM(l.qty) AS pieces ${src} GROUP BY l.size ORDER BY pieces DESC`, from)
  return {
    even: true,
    tables: [
      { id: 'products', columns: [{ key: 'name', label: 'Product', kind: 'text' }, { key: 'pieces', label: 'Pieces', kind: 'int', right: true }, { key: 'sales', label: 'Sales', kind: 'money', right: true }], rows: products.map((r) => ({ name: str(r.name), pieces: num(r.pieces), sales: num(r.sales) })), empty: 'No sales in this period' },
      { id: 'sizes', columns: [{ key: 'size', label: 'Size', kind: 'text' }, { key: 'pieces', label: 'Pieces sold', kind: 'int', right: true }], rows: sizes.map((r) => ({ size: str(r.size), pieces: num(r.pieces) })), empty: 'No sales in this period' }
    ]
  }
}

function sizeThrough(): Part {
  const rows = all(
    `SELECT c.name AS cat,v.size AS size,MIN(v.rowid) AS ord,
       COALESCE(SUM(CASE WHEN m.type IN ('opening','purchase') THEN m.qty END),0) AS received,
       -COALESCE(SUM(CASE WHEN m.type IN ('sale','sale_return','cancel') THEN m.qty END),0) AS sold
     ${VAR_JOIN} LEFT JOIN stock_moves m ON m.variant_id=v.id WHERE ${NON_SERVICE} GROUP BY c.name,v.size ORDER BY c.name,ord`
  )
  return {
    hint: 'Pieces received (opening stock and purchases) against pieces sold, per category and size, since the start. Use it before buying: high % sizes sell out, low % sizes pile up.',
    tables: [{
      id: 'size',
      columns: [{ key: 'cat', label: 'Category', kind: 'text' }, { key: 'size', label: 'Size', kind: 'text' }, { key: 'received', label: 'Received', kind: 'int', right: true }, { key: 'sold', label: 'Sold', kind: 'int', right: true }, { key: 'pct', label: 'Sold %', kind: 'pct', right: true }, { key: 'next', label: 'Next buy', kind: 'chip' }],
      rows: rows.map((r) => {
        const rec = num(r.received), sold = num(r.sold)
        const pct = rec ? Math.round((sold / rec) * 100) : 0
        return { cat: str(r.cat), size: str(r.size), received: rec, sold, pct, next: pct >= 60 ? 'Buy more' : pct <= 15 ? 'Buy less' : 'Same' }
      }),
      empty: 'No stock yet'
    }]
  }
}

function dead(days: number): Part {
  const limit = new Date(Date.now() - days * DAY).toISOString()
  const rows = all(
    `SELECT p.name AS name,v.colour AS colour,v.size AS size,s.qty AS stock,v.cost AS cost,
       (SELECT MAX(m.at) FROM stock_moves m WHERE m.variant_id=v.id AND m.type='sale') AS last
     ${VAR_JOIN} JOIN v_stock s ON s.variant_id=v.id WHERE ${NON_SERVICE} AND s.qty>0 ORDER BY p.name,v.rowid`
  ).filter((r) => !r.last || String(r.last) < limit)
  const value = rows.reduce((a, r) => a + num(r.stock) * num(r.cost), 0)
  return {
    kpis: [{ label: 'Items', value: rows.length, kind: 'int' }, { label: 'Money stuck (at cost)', value: value, kind: 'money' }],
    tables: [{
      id: 'dead',
      columns: [{ key: 'item', label: 'Item', kind: 'text' }, { key: 'stock', label: 'Stock', kind: 'int', right: true }, { key: 'last', label: 'Last sold', kind: 'text' }, { key: 'value', label: 'Value at cost', kind: 'money', right: true }],
      rows: rows.map((r) => ({
        item: variantLabel(String(r.name), String(r.colour), String(r.size)), stock: num(r.stock),
        last: r.last ? new Date(String(r.last)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never', value: num(r.stock) * num(r.cost)
      })),
      empty: 'Nothing stuck. Good.'
    }]
  }
}

function stockValue(): Part {
  const rows = all(`SELECT p.name AS name,v.colour AS colour,v.size AS size,COALESCE(s.qty,0) AS stock,v.cost AS cost,v.mrp AS mrp,v.min_stock AS min ${VAR_JOIN} LEFT JOIN v_stock s ON s.variant_id=v.id WHERE ${NON_SERVICE} ORDER BY p.name,v.rowid`)
  const pos = (r: Row): number => Math.max(0, num(r.stock))
  const low = rows.filter((r) => num(r.stock) <= num(r.min))
  return {
    kpis: [
      { label: 'Pieces in shop', value: rows.reduce((a, r) => a + pos(r), 0), kind: 'int' },
      { label: 'Value at cost', value: rows.reduce((a, r) => a + pos(r) * num(r.cost), 0), kind: 'money' },
      { label: 'Value at MRP', value: rows.reduce((a, r) => a + pos(r) * num(r.mrp), 0), kind: 'money' },
      { label: 'Low-stock items', value: low.length, kind: 'int' }
    ],
    tables: [{
      id: 'low',
      columns: [{ key: 'item', label: 'Low stock', kind: 'text' }, { key: 'stock', label: 'In stock', kind: 'int', right: true }, { key: 'min', label: 'Min', kind: 'int', right: true }],
      rows: low.map((r) => ({ item: variantLabel(String(r.name), String(r.colour), String(r.size)), stock: num(r.stock), min: num(r.min) })), empty: 'None'
    }]
  }
}

function staff(from: string): Part {
  const people = all('SELECT id,name,commission_pct AS comm,active FROM staff ORDER BY rowid')
  const bills = all("SELECT staff_id AS staff,COALESCE(sales_by,staff_id) AS salesBy,type,discount,grand FROM bills WHERE status='completed' AND at>=?", from)
  const rows = people.map((s) => {
    const made = bills.filter((b) => b.type === 'sale' && b.staff === s.id)
    const sp = bills.filter((b) => b.salesBy === s.id).reduce((a, b) => a + num(b.grand), 0)
    const comm = num(s.comm)
    return { name: str(s.name), made: made.length, sp, disc: made.reduce((a, b) => a + num(b.discount), 0), comm, amount: Math.round((sp * comm) / 100), active: s.active }
  }).filter((r) => r.active || r.made || r.sp)
  return {
    hint: 'Commission is worked out on sales (returns subtracted) where the person is chosen as Salesperson on the bill.',
    tables: [{
      id: 'staff',
      columns: [{ key: 'name', label: 'Staff', kind: 'text' }, { key: 'made', label: 'Bills made', kind: 'int', right: true }, { key: 'sp', label: 'Sales as salesperson', kind: 'money', right: true }, { key: 'disc', label: 'Discounts given', kind: 'money', right: true }, { key: 'comm', label: 'Commission %', kind: 'pct', right: true }, { key: 'amount', label: 'Commission ₹', kind: 'money', right: true }],
      rows: rows.map(({ active: _a, ...r }) => r), empty: 'No staff'
    }]
  }
}

function alterations(from: string): Part {
  const tailors = all('SELECT id,name,rate_per_job AS rate FROM tailors ORDER BY rowid')
  const jobs = all("SELECT tailor_id AS tailor,status,due_at AS due,charge,paid FROM alterations WHERE created_at>=? OR status NOT IN ('delivered','cancelled')", from)
  const now = new Date().toISOString()
  const rows = tailors.map((t) => {
    const j = jobs.filter((x) => x.tailor === t.id)
    const del = j.filter((x) => x.status === 'delivered')
    return {
      tailor: str(t.name), jobs: j.length, open: j.filter((x) => !['delivered', 'cancelled'].includes(String(x.status))).length,
      late: j.filter((x) => !['ready', 'delivered', 'cancelled'].includes(String(x.status)) && String(x.due) < now).length,
      delivered: del.length, collected: del.filter((x) => x.paid).reduce((a, x) => a + num(x.charge), 0), pay: del.length * num(t.rate)
    }
  })
  return {
    hint: "To pay tailor = delivered jobs × the tailor's rate per job (Settings › Alterations).",
    tables: [{
      id: 'tailors',
      columns: [{ key: 'tailor', label: 'Tailor', kind: 'text' }, { key: 'jobs', label: 'Jobs', kind: 'int', right: true }, { key: 'open', label: 'Open', kind: 'int', right: true }, { key: 'late', label: 'Late', kind: 'int', right: true }, { key: 'delivered', label: 'Delivered', kind: 'int', right: true }, { key: 'collected', label: 'Charges collected', kind: 'money', right: true }, { key: 'pay', label: 'To pay tailor', kind: 'money', right: true }],
      rows, empty: 'No tailors yet'
    }]
  }
}

function gst(from: string): Part {
  // return bills carry negative taxable and tax on their lines, so a plain sum is already net of returns
  const rows = all(
    `SELECT l.gst_rate AS rate,COALESCE(l.hsn,'') AS hsn,SUM(l.taxable) AS taxable,SUM(l.cgst) AS cgst,SUM(l.sgst) AS sgst
     FROM bill_lines l JOIN bills b ON b.id=l.bill_id WHERE b.status='completed' AND b.at>=? GROUP BY l.gst_rate,l.hsn ORDER BY l.gst_rate,l.hsn`, from
  )
  const sum = (k: string): number => rows.reduce((a, r) => a + num(r[k]), 0)
  return {
    tables: [{
      id: 'gst',
      columns: [{ key: 'rate', label: 'GST rate', kind: 'pct' }, { key: 'hsn', label: 'HSN', kind: 'mono' }, { key: 'taxable', label: 'Taxable', kind: 'money', right: true }, { key: 'cgst', label: 'CGST', kind: 'money', right: true }, { key: 'sgst', label: 'SGST', kind: 'money', right: true }],
      rows: rows.map((r) => ({ rate: num(r.rate), hsn: str(r.hsn), taxable: num(r.taxable), cgst: num(r.cgst), sgst: num(r.sgst) })),
      total: { rate: 'Total', taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst') }, empty: 'No bills in this period'
    }]
  }
}
