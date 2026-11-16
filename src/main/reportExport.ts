import { BrowserWindow, dialog } from 'electron'
import ExcelJS from 'exceljs'
import { writeFile } from 'node:fs/promises'
import { localDate } from '@shared/dates'
import { reportHtml, type ReportPeriod, type ReportTab } from '@shared/reports'
import { audit } from './services/auth'
import { getReport } from './services/reports'
import { requireRole } from './services/session'
import { getSetting } from './services/settings'

/** Saves the report on screen as an Excel or PDF file the owner picks the place for. Returns the path, or null when cancelled. */

const shopName = (): string => getSetting<{ name?: string }>('shop', {}).name || 'Your Shop'
const fileBase = (tab: string): string => `mars-${tab}-${localDate()}`

export async function exportExcel(tab: ReportTab, period: ReportPeriod, deadDays = 30): Promise<string | null> {
  const a = requireRole('owner', 'manager')
  const r = getReport(tab, period, deadDays)
  const pick = await dialog.showSaveDialog({ defaultPath: `${fileBase(tab)}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
  if (pick.canceled || !pick.filePath) return null

  const wb = new ExcelJS.Workbook()
  wb.creator = shopName()
  r.tables.forEach((t, i) => {
    const ws = wb.addWorksheet((t.title ?? (r.tables.length > 1 ? `${r.title} ${i + 1}` : r.title)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
    ws.addRow([`${shopName()} · ${r.title}`]).font = { bold: true, size: 13 }
    ws.addRow([r.periodLabel])
    if (i === 0) for (const k of r.kpis) {
      const row = ws.addRow([k.label, k.value === null ? '—' : k.kind === 'money' ? Number(k.value) / 100 : k.value])
      if (k.kind === 'money') row.getCell(2).numFmt = '#,##0.00'
    }
    ws.addRow([])
    const head = ws.addRow(t.columns.map((c) => c.label))
    head.font = { bold: true }
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE4' } } })
    const put = (row: Record<string, string | number | null>): void => {
      const x = ws.addRow(t.columns.map((c) => (c.kind === 'money' && row[c.key] !== null && row[c.key] !== undefined ? Number(row[c.key]) / 100 : row[c.key] ?? null)))
      t.columns.forEach((c, n) => {
        const cell = x.getCell(n + 1)
        if (c.kind === 'money') cell.numFmt = '#,##0.00'
        if (c.right) cell.alignment = { horizontal: 'right' }
      })
      return void x
    }
    t.rows.forEach(put)
    if (t.total) { put(t.total); ws.lastRow!.font = { bold: true } }
    t.columns.forEach((c, n) => { ws.getColumn(n + 1).width = Math.max(14, c.label.length + 4, ...t.rows.map((row) => String(row[c.key] ?? '').length + 2)) })
  })
  await writeFile(pick.filePath, Buffer.from(await wb.xlsx.writeBuffer()))
  audit(a.id, 'report_export', { tab, period, format: 'excel' })
  return pick.filePath
}

export async function exportPdf(tab: ReportTab, period: ReportPeriod, deadDays = 30): Promise<string | null> {
  const a = requireRole('owner', 'manager')
  const r = getReport(tab, period, deadDays)
  const pick = await dialog.showSaveDialog({ defaultPath: `${fileBase(tab)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (pick.canceled || !pick.filePath) return null
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHtml(r, shopName())))
    await writeFile(pick.filePath, await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true }))
  } finally {
    win.destroy()
  }
  audit(a.id, 'report_export', { tab, period, format: 'pdf' })
  return pick.filePath
}
