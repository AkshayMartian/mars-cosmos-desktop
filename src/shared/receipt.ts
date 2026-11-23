import type { BillDto, ShopInfo } from './billing'
import { formatPlain, formatRupees } from './money'
import type { GstScheme } from './types'

/** Characters per line: 36 on an 80 mm receipt, 32 on 58 mm. */
/** Characters per line, like a thermal printer's Font A: 48 on an 80 mm roll, 32 on a 58 mm roll. */
export const receiptWidth = (shop: { width?: string }): number => (shop.width === '58 mm' ? 32 : 48)

/** The bill's discount split into what was taken off items and what was taken off the whole bill. null when the bill is too old to know. */
export function discountParts(b: BillDto): { item: number; bill: number } | null {
  if (b.type !== 'sale' || b.lines.some((l) => l.itemDisc == null)) return null
  const item = b.lines.reduce((a, l) => a + (l.itemDisc ?? 0), 0)
  return { item, bill: Math.max(0, b.discount - item) }
}

export function receiptText(b: BillDto, shop: ShopInfo, scheme: GstScheme, copy = false): string {
  const W = receiptWidth(shop)
  const center = (s: string): string => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
  const lr = (l: string, r: string): string => l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r
  const line = '-'.repeat(W)
  // the first print of a sale (the customer's copy) has the fuller design; a reprint keeps the plain one with DUPLICATE on top
  const first = !copy && b.type === 'sale'
  const heavy = '='.repeat(W)
  const out: string[] = []
  if (copy) out.push(center('** DUPLICATE **'))
  if (first) out.push(heavy)
  out.push(center(shop.name.toUpperCase()))
  if (shop.address) out.push(center(shop.address))
  if (shop.phone) out.push(center('Ph ' + shop.phone))
  if (scheme === 'regular' && shop.gstin) out.push(center('GSTIN ' + shop.gstin))
  out.push(center(b.type === 'return' ? 'RETURN / CREDIT NOTE' : scheme === 'regular' ? 'TAX INVOICE' : scheme === 'composition' ? 'BILL OF SUPPLY' : 'BILL'), first ? heavy : line)
  out.push(lr('Bill ' + b.no, ''))
  out.push(lr(new Date(b.at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), b.staffName))
  if (b.customer) out.push(lr(b.customer.name, b.customer.mobile ?? ''))
  if (b.customer?.gstin && scheme === 'regular') out.push('Buyer GSTIN ' + b.customer.gstin)
  out.push(line)
  if (first) out.push(lr('ITEM', ''), lr('  QTY x RATE' + (scheme === 'regular' ? '  GST' : ''), 'AMOUNT'), line)
  for (const l of b.lines) {
    out.push(`${l.name} ${l.colour} ${l.size}`.slice(0, W))
    out.push(lr(`  ${l.qty} x ${formatPlain(l.price)}${scheme === 'regular' ? '  ' + l.rate + '%' : ''}`, formatPlain(b.type === 'return' ? l.total : l.price * l.qty)))
    if (l.itemDisc && b.type === 'sale') out.push(lr('  Item discount', formatPlain(-l.itemDisc)))
  }
  out.push(line)
  if (first) out.push(lr(`Items ${b.lines.length}`, `Qty ${b.lines.reduce((n, l) => n + l.qty, 0)}`))
  const parts = discountParts(b)
  if (first && b.discount) out.push(lr('Subtotal', formatPlain(b.subtotal)))
  if (parts) {
    if (parts.item) out.push(lr('Item discounts', formatPlain(-parts.item)))
    if (parts.bill) out.push(lr('Bill discount', formatPlain(-parts.bill)))
  } else if (b.discount) out.push(lr('Discount', formatPlain(-b.discount)))
  if (b.coinsUsed && b.coinValue) out.push(lr(`Coins used (${b.coinsUsed})`, formatPlain(-b.coinValue)))
  if (b.roundOff) out.push(lr('Round off', formatPlain(b.roundOff)))
  if (first) out.push(heavy)
  out.push(lr('TOTAL', 'Rs ' + formatPlain(b.grand)))
  if (first) out.push(heavy)
  if (first && b.discount > 0) out.push(center('You saved Rs ' + formatPlain(b.discount) + '!'))
  if (scheme === 'regular') out.push(lr('Taxable', formatPlain(b.taxable)), lr('CGST', formatPlain(b.cgst)), lr('SGST', formatPlain(b.sgst)))
  out.push(line)
  for (const p of b.payments) out.push(lr('Paid ' + p.mode.replace('_', ' ').toUpperCase(), formatPlain(p.amount)))
  out.push(line)
  if (b.customer && b.type === 'sale' && (b.coinsEarned || b.coinsUsed || b.coinBalance)) {
    out.push(lr('Coins earned', String(b.coinsEarned ?? 0)), lr('Coin balance', String(b.coinBalance ?? 0)), line)
  }
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
    `Hi${b.customer?.name ? ' ' + b.customer.name : ''}, thank you for shopping at ${shop.name}!`,
    `Bill ${b.no} · ${date}`,
    ...b.lines.map((l) => `• ${l.name} ${l.size} × ${l.qty} = ${formatRupees(l.total)}`),
    `Total: ${formatRupees(b.grand)}`,
    b.coinsEarned ? `You earned ${b.coinsEarned} coins. Your coin balance: ${b.coinBalance ?? 0}.` : '',
    shop.policy
  ].filter(Boolean).join('\n')
}
