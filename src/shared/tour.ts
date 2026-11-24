import type { MenuId, Role } from './types'

/** The guided tour: one card per menu item the person can use, plus the top bar. Pure, so it is tested without a screen. */
export interface TourStep {
  id: string
  /** value of the data-tour attribute of the element to highlight; no target = a centred card */
  target?: string
  title: string
  text: string
}

const MENU_TEXT: Partial<Record<MenuId, { title: string; text: string }>> = {
  billing: { title: 'Billing', text: 'Scan a sticker or search an item, pick the customer, take payment, print or WhatsApp the bill. Press F1 from any screen to jump here.' },
  bills: { title: 'Bills', text: 'Find any past bill, reprint it, send it on WhatsApp, or cancel it (cancelling needs permission).' },
  returns: { title: 'Return / exchange', text: 'Search the old bill by number, name or mobile, pick what is coming back, and swap it or issue a credit note. Stock is corrected by itself.' },
  alterations: { title: 'Alterations', text: 'Book a tailoring job against a bill, print the tag, and track it from received to delivered.' },
  products: { title: 'Products', text: 'Add a product once with all its sizes and colours. Every size and colour gets its own barcode. You can also import from Excel.' },
  stickers: { title: 'Print stickers', text: 'Print the barcode label for every new piece, and stick it on the tag before it goes on the shelf.' },
  stockin: { title: 'Stock in', text: 'Enter what arrived from the supplier, or the stock already in the shop on day 1. Then print the stickers.' },
  stockout: { title: 'Stock out', text: 'Pieces that leave without a bill (supplier return, damage, dispatch) are scanned out here, so the count stays right.' },
  stock: { title: 'Stock', text: 'See what is in the shop, its history, and run a stock count. Differences are corrected after approval.' },
  customers: { title: 'Customers', text: 'Customer profiles, sizes, birthdays and coins. Add the mobile number at billing to build this list.' },
  reports: { title: 'Reports', text: 'Sales, GST summary, dead stock and staff commission. Export to Excel or PDF for your CA.' },
  dayend: { title: 'Day end', text: 'Count the cash, enter expenses and close the day. A backup is taken when you close.' },
  settings: { title: 'Settings', text: 'Shop details, GST, receipt, printers, staff PINs, WhatsApp, backup and the licence. Only the owner can open this.' }
}

/** `visible` = the menu ids this person actually sees (from menuFor), so the tour never points at something missing. */
export function tourSteps(role: Role, visible: MenuId[]): TourStep[] {
  const steps: TourStep[] = [{ id: 'welcome', title: 'Welcome to Mars Cosmos', text: 'A quick tour (about a minute) of where things are. You can skip it now and start it again any time from "Take a tour" at the bottom of the menu.' }]
  for (const id of visible) {
    const t = MENU_TEXT[id]
    if (t) steps.push({ id, target: 'menu-' + id, ...t })
  }
  steps.push({ id: 'sales', target: 'my-sales', title: 'My sales today', text: 'Your own sales total for today, as the salesperson on the bill.' })
  steps.push({ id: 'lock', target: 'lock', title: 'Lock', text: 'Lock the screen when you step away. The app also locks by itself after a few idle minutes. Log back in with your 4-digit PIN.' })
  steps.push({ id: 'tour', target: 'menu-tour', title: 'Take a tour', text: 'This button replays the tour whenever you or your staff want a reminder.' })
  steps.push({ id: 'done', title: role === 'owner' ? 'You are ready' : 'You are all set', text: 'Start with Billing for a sale, or Stock in to add stock.' })
  return steps
}
