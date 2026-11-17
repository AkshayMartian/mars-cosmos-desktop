import { BrowserWindow } from 'electron'
import { tagLines, slipText } from '@shared/alterations'
import { labelSize, printDocument, LABEL_CSS, type StickerItem, type StickerPrintResult } from '@shared/stickers'
import { getAltJob } from './services/alterations'
import { alterationConfig } from './services/altcore'
import { getBill, receiptTextFor } from './services/billing'
import { daySlip } from './services/dayend'
import { requireRole } from './services/session'
import { getSetting } from './services/settings'
import { logPrint, prepareJob, stickerContext } from './services/stickers'
import { audit } from './services/auth'

/**
 * Printing goes through the Windows driver of whatever printer is installed (TSC, Zebra, TVS, Epson, any).
 * It runs in the main process, in a hidden window, so the screen can never change what is printed.
 * With a printer name saved in Settings it prints silently; without one the system print dialog opens.
 */

interface Job { html: string; printer: string; wMm: number; hMm: number }

async function sendToPrinter(j: Job): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(j.html))
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        { silent: !!j.printer, deviceName: j.printer || undefined, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: Math.round(j.wMm * 1000), height: Math.round(j.hMm * 1000) } },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason === 'cancelled' ? 'Printing was cancelled.' : `The printer did not accept the job (${reason}). Check it is on and its name in Settings → Printers is right.`)))
      )
    })
  } finally {
    win.destroy()
  }
}

const receiptPrinter = (): string => getSetting<{ receipt?: string }>('printers', {}).receipt ?? ''
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/** Plain receipt text on a roll: monospace, as wide as the paper, as tall as the text. */
function textJob(text: string, chars: number): Job {
  const wMm = chars <= 32 ? 58 : 80
  const pt = chars <= 32 ? 7 : 8.5
  const lines = text.split('\n').length
  const hMm = Math.ceil(((lines + 3) * pt * 1.25 * 25.4) / 72)
  const html = `<!doctype html><meta charset="utf-8"><style>@page{size:${wMm}mm ${hMm}mm;margin:0}body{margin:0;padding:2mm 3mm}pre{margin:0;font:${pt}pt/1.25 "Courier New",monospace;white-space:pre}</style><pre>${esc(text)}</pre>`
  return { html, printer: receiptPrinter(), wMm, hMm }
}

/* ---------- stickers ---------- */

export async function printStickers(lines: { variantId: string; qty: number }[]): Promise<StickerPrintResult> {
  const items = prepareJob(lines)
  const cfg = stickerContext()
  const size = labelSize(cfg.sizeId)
  await sendToPrinter({ html: printDocument(items, size), printer: cfg.printer, wMm: size.wMm, hMm: size.hMm })
  const total = items.reduce((n, i) => n + i.qty, 0)
  logPrint(total, items.length)
  return { printed: total }
}

/** A sample label so the owner can check the printer and the size before real work. */
export async function testSticker(): Promise<void> {
  requireRole('owner')
  const cfg = stickerContext()
  const size = labelSize(cfg.sizeId)
  const item: StickerItem = { variantId: 'test', shop: cfg.shop, name: 'Test sticker', colour: 'Blue', size: 'M', barcode: '2000000000015', mrp: 99_900, qty: 1 }
  await sendToPrinter({ html: printDocument([item], size), printer: cfg.printer, wMm: size.wMm, hMm: size.hMm })
}

/* ---------- receipts ---------- */

export async function printReceipt(billId: string, copy = false): Promise<void> {
  const { text, width } = receiptTextFor(billId, copy) // checks the role too
  await sendToPrinter(textJob(text, width))
}

export async function testReceipt(): Promise<void> {
  requireRole('owner')
  const width = getSetting<{ width?: string }>('receipt', {}).width === '58 mm' ? 32 : 36
  const shop = getSetting<{ name?: string }>('shop', {}).name || 'Your Shop'
  const line = '-'.repeat(width)
  await sendToPrinter(textJob([shop.toUpperCase(), 'TEST RECEIPT', line, 'If you can read this, the receipt', 'printer is working.', line, new Date().toLocaleString('en-IN')].join('\n'), width))
}

/**
 * Right after a bill is saved: print the receipt and open the drawer for cash, with no questions asked.
 * Only when a receipt printer is chosen in Settings (without one, every bill would open the print dialog: staff press
 * "Print receipt" instead). A printer problem never undoes the bill: it comes back as a note for the screen.
 */
export interface AfterSale { printed: boolean; drawer: boolean; note: string | null }
export async function afterSale(billId: string): Promise<AfterSale> {
  const bill = getBill(billId) // checks the role
  const cfg = getSetting<{ receipt?: string; drawer?: boolean }>('printers', {})
  const out: AfterSale = { printed: false, drawer: false, note: null }
  if (!cfg.receipt) return out
  try {
    await printReceipt(billId)
    out.printed = true
    if (cfg.drawer && bill.payments.some((p) => p.mode === 'cash' && p.amount > 0)) { await sendToPrinter(textJob('.', 36)); out.drawer = true }
  } catch (e) {
    out.note = `Bill saved, but the receipt was not printed: ${e instanceof Error ? e.message : 'printer error'} Use Print receipt to try again.`
  }
  return out
}

/** The day-end slip of a closed day, on the receipt printer. */
export async function printDayEnd(sessionId: string): Promise<void> {
  const width = getSetting<{ width?: string }>('receipt', {}).width === '58 mm' ? 32 : 36
  await sendToPrinter(textJob(daySlip(sessionId, width), width))
}

/**
 * Most cash drawers plug into the receipt printer and open when it gets a job (set "open drawer" in the printer's
 * Windows driver). So "open the drawer" sends a one-line job to the receipt printer.
 */
export async function openDrawer(): Promise<void> {
  const a = requireRole('owner', 'manager', 'cashier')
  await sendToPrinter(textJob('.', 36))
  audit(a.id, 'drawer_open')
}

/* ---------- alteration tag and slip ---------- */

export async function printAlteration(jobId: string, which: 'tag' | 'slip'): Promise<void> {
  const job = getAltJob(jobId) // checks the role
  const shop = getSetting<{ name?: string; phone?: string }>('shop', {})
  const s = { name: shop.name || 'Your Shop', phone: shop.phone ?? '' }
  const cfg = alterationConfig()
  const printer = receiptPrinter()
  if (which === 'slip') return sendToPrinter(textJob(slipText(job, s), 36))
  if (cfg.tagPrinter === 'receipt') return sendToPrinter(textJob(tagLines(job, s).join('\n'), 36))
  const sc = stickerContext()
  const [head, no, who, ...rest] = tagLines(job, s)
  const html = `<!doctype html><meta charset="utf-8"><style>@page{size:50mm 50mm;margin:0}body{margin:0}${LABEL_CSS}.t{width:50mm;height:50mm;padding:2mm 3mm;font:7.5pt/1.25 Arial,sans-serif;display:flex;flex-direction:column;gap:.4mm}.t .no{font-size:14pt;font-weight:bold}.t .due{font-weight:bold;font-size:8.5pt;margin-top:auto}</style>` +
    `<div class="t"><span>${esc(head!)}</span><span class="no">${esc(no!)}</span><b>${esc(who!)}</b>${rest.slice(0, -1).map((l) => `<span>${esc(l)}</span>`).join('')}<span class="due">${esc(rest[rest.length - 1]!)}</span></div>`
  await sendToPrinter({ html, printer: sc.printer || printer, wMm: 50, hMm: 50 })
}

/** Printers installed on this PC (names as Windows knows them). */
export async function listPrinters(): Promise<string[]> {
  stickerContext()
  const w = BrowserWindow.getAllWindows()[0]
  if (!w) return []
  return (await w.webContents.getPrintersAsync()).map((p) => p.name)
}
