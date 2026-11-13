import { BrowserWindow } from 'electron'
import { labelSize, printDocument, type StickerPrintResult } from '@shared/stickers'
import { logPrint, prepareJob, stickerContext } from './services/stickers'

/**
 * Prints labels through the Windows driver of whatever printer is installed (TSC, Zebra, any label printer).
 * Runs in the main process, in a hidden window, so the screen can never change what is printed.
 * With a printer name saved it prints silently; without one the system print dialog opens.
 */
export async function printStickers(lines: { variantId: string; qty: number }[]): Promise<StickerPrintResult> {
  const items = prepareJob(lines)
  const cfg = stickerContext()
  const size = labelSize(cfg.sizeId)
  const total = items.reduce((n, i) => n + i.qty, 0)

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(printDocument(items, size)))
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: !!cfg.printer, deviceName: cfg.printer || undefined, printBackground: true, margins: { marginType: 'none' },
          pageSize: { width: size.wMm * 1000, height: size.hMm * 1000 }
        },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason === 'cancelled' ? 'Printing was cancelled.' : `The printer did not accept the job (${reason}). Check it is on and the name in Settings is right.`)))
      )
    })
  } finally {
    win.destroy()
  }
  logPrint(total, items.length)
  return { printed: total }
}

/** Printers installed on this PC (names as Windows knows them). */
export async function listPrinters(): Promise<string[]> {
  stickerContext()
  const w = BrowserWindow.getAllWindows()[0]
  if (!w) return []
  return (await w.webContents.getPrintersAsync()).map((p) => p.name)
}
