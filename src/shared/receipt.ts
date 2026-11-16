import type { BillDto, ShopInfo } from './billing'
import { formatPlain, formatRupees } from './money'
import type { GstScheme } from './types'

/** Characters per line: 36 on an 80 mm receipt, 32 on 58 mm. */
export const receiptWidth = (shop: { width?: string }): number => (shop.width === '58 mm' ? 32 : 36)

export function receiptText(b: BillDto, shop: ShopInfo, scheme: GstScheme, copy = false): string {
  const W = receiptWidth(shop)
  const center = (s: string): string => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
  const lr = (l: string, r: string): string => l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r
  const line = '-'.repeat(W)
  const out: string[] = []
  if (copy) out.push(center('** DUPLICATE **'))
  out.push(center(shop.name.toUpperCase()))
  if (shop.address) out.push(center(shop.address))
  if (shop.phone) out.push(center('Ph ' + shop.phone))
  if (scheme === 'regular' && shop.gstin) out.push(center('GSTIN ' + shop.gstin))
  out.push(center(b.type === 'return' ? 'RETURN / CREDIT NOTE' : scheme === 'regular' ? 'TAX INVOICE' : scheme === 'composition' ? 'BILL OF SUPPLY' : 'BILL'), line)
  out.push(lr('Bill ' + b.no, ''))
  out.push(lr(new Date(b.at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), b.staffName))
  if (b.customer) out.push(lr(b.customer.name, b.customer.mobile ?? ''))
  if (b.customer?.gstin && scheme === 'regular') out.push('Buyer GSTIN ' + b.customer.gstin)
  out.push(line)
  for (const l of b.lines) {
    out.push(`${l.name} ${l.colour} ${l.size}`.slice(0, W))
    out.push(lr(`  ${l.qty} x ${formatPlain(l.price)}${scheme === 'regular' ? '  ' + l.rate + '%' : ''}`, formatPlain(b.type === 'return' ? l.total : l.price * l.qty)))
  }
  out.push(line)
  if (b.discount) out.push(lr('Discount', formatPlain(-b.discount)))
  if (b.roundOff) out.push(lr('Round off', formatPlain(b.roundOff)))
  out.push(lr('TOTAL', 'Rs ' + formatPlain(b.grand)))
  if (scheme === 'regular') out.push(lr('Taxable', formatPlain(b.taxable)), lr('CGST', formatPlain(b.cgst)), lr('SGST', formatPlain(b.sgst)))
  out.push(line)
  for (const p of b.payments) out.push(lr('Paid ' + p.mode.replace('_', ' ').toUpperCase(), formatPlain(p.amount)))
  out.push(line)
  if (b.alterations?.length) {
    out.push('ALTERATION')
    for (const a of b.alterations) out.push(`${a.no}  ${a.work.join(', ')}`, `  Ready: ${new Date(a.dueAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`)
    out.push(line)
  }
  if (shop.policy) out.push(shop.policy, '')
  if (shop.footer) out.push(center(shop.footer))
  if (shop.review && b.type !== 'return') out.push('', center('Review us:'), shop.review)
  return out.join('\n')
}

/** The WhatsApp message. The shop presses Send; nothing is sent automatically. */
export function whatsappText(b: BillDto, shop: ShopInfo): string {
  const date = new Date(b.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return [
    `Hi ${b.customer?.name ?? ''}, thank you for shopping at ${shop.name}!`,
    `Bill ${b.no} · ${date}`,
    ...b.lines.map((l) => `• ${l.name} ${l.size} × ${l.qty} = ${formatRupees(l.total)}`),
    `Total: ${formatRupees(b.grand)}`,
    shop.policy
  ].filter(Boolean).join('\n')
}
