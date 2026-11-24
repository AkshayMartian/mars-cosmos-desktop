import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatRupees } from '@shared/money'
import { checkMobile } from '@shared/mobile'
import { receiptPdf } from './print'
import { audit } from './services/auth'
import { getBill, receiptTextFor } from './services/billing'
import { current } from './services/session'
import { getSetting } from './services/settings'

/**
 * "Send on WhatsApp" with the bill as a PDF. WhatsApp's chat link cannot carry a file, so: the PDF is made, copied to the
 * clipboard like a file copied in Explorer, and the customer's chat is opened with a short message. Staff press Ctrl+V
 * (the PDF appears as an attachment) and then Send. Nothing is sent by the app itself.
 */
export interface WhatsAppResult { pasted: boolean; file: string }

const dir = (): string => join(app.getPath('temp'), 'mars-whatsapp-bills')

/** The PDFs are only needed for a moment; older ones are removed so customer bills do not pile up on the PC. */
function tidy(folder: string): void {
  try {
    for (const f of readdirSync(folder)) if (Date.now() - statSync(join(folder, f)).mtimeMs > 24 * 3_600_000) unlinkSync(join(folder, f))
  } catch { /* nothing to tidy */ }
}

function copyFileToClipboard(file: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${file.replace(/'/g, "''")}'`], { timeout: 15_000, windowsHide: true }, (err) => resolve(!err))
  })
}

export async function sendBillOnWhatsApp(billId: string, typedMobile?: string): Promise<WhatsAppResult> {
  const { text, width } = receiptTextFor(billId) // also checks who is logged in
  const bill = getBill(billId)
  if (bill.type !== 'sale') throw new Error('Only sale bills can be sent on WhatsApp.')
  if (bill.customer && bill.customer.waConsent === false) throw new Error('This customer has not agreed to WhatsApp bills. Edit the customer to record their consent.')
  const mobile = bill.customer?.mobile || checkMobile(typedMobile)

  const folder = dir()
  mkdirSync(folder, { recursive: true })
  tidy(folder)
  const file = join(folder, `Bill-${bill.no.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`)
  writeFileSync(file, await receiptPdf(text, width))

  const pasted = await copyFileToClipboard(file)
  if (!pasted) shell.showItemInFolder(file) // could not copy: show the file so staff can attach it by hand
  const shop = getSetting<{ name?: string }>('shop', {}).name || 'our shop'
  const msg = `Hi${bill.customer?.name ? ' ' + bill.customer.name : ''}, thank you for shopping at ${shop}! Your bill ${bill.no} for ${formatRupees(bill.grand)} is attached as a PDF.`
  await shell.openExternal(`https://wa.me/91${mobile}?text=${encodeURIComponent(msg)}`)
  audit(current().id, 'whatsapp_bill', { bill: bill.no })
  return { pasted, file }
}
