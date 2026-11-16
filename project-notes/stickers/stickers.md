# Print stickers

> Receipts, tags and slips also print through the Windows driver now (see settings.md for the `print:*` calls). This page covers **barcode labels**.

## 1. Summary

- **What it does:** prints a barcode label for each piece. Staff scan or search an item, set how many stickers, see the label preview and press **Print N stickers**.
- **Screens:** `Print stickers` (`src/renderer/screens/Stickers.tsx`): search box, list with a stickers count per item, preview, **Print N sticker(s)**, **Clear list**, **Last purchase**, and (owner, manager) **Change** for *Label settings*. Stock in's **Stickers** button next to each recent purchase opens this screen with that purchase loaded.
- **Who can use it:** Owner, Manager, Store staff. Only Owner and Manager change the label size and printer.
- **Status:** **done** (2026-11-13). The Products screen's *Print stickers* buttons still show a message. Test sticker is in Settings → Printers.
- **Code:** screen `Stickers.tsx` · services `src/main/services/stickers.ts` (data, checks, settings) and `src/main/print.ts` (the actual print, Electron) · label drawing and EAN-13 bars `src/shared/stickers.ts` · tests `src/main/services/stickers.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| *Scan or search item* | text (auto-focus) | Scanner or typing; **Enter** adds when exactly one match; a click on a result adds it |
| Stickers column | number per item | 1 to 500 |
| **✕** | button | Removes the item from the list |
| List row | click | Shows that item's label in the preview |
| **Last purchase** | button | Adds every item of the latest purchase, one sticker per piece received |
| **Clear list** | button | Empties the list |
| Preview | display | The label at the chosen size, drawn from the same code that prints |
| **Print N stickers** | button | Prints the list |
| **Change** (owner, manager) | button | *Label settings* dialog: label size (50 × 25, 38 × 25, 50 × 38 mm) and printer (or "Ask me every time") |

## 3. Flows

**Search** → `window.api.stock.search(q)` (the same search Stock in uses) → `window.api.stickers.items([id])` → `stickers:items` → `stickerItems`.
**Last purchase / from Stock in** → `window.api.stickers.lastPurchase(purchaseId?)` → `stickers:lastPurchase`.
**Print** → `window.api.stickers.print(lines)` → `stickers:print` → `printStickers` (`print.ts`) → checks, builds the page, sends it to the printer, writes the audit.

## 4. APIs

- `stickers:context` · `window.api.stickers.context()`: `{ shop, sizeId, printer, canManage }`. Roles owner, manager, store.
- `stickers:items` · `window.api.stickers.items(ids)`: label data per variant `{ variantId, shop, name, colour, size, barcode, mrp, qty:1 }`. The MRP comes from the database.
- `stickers:lastPurchase` · `window.api.stickers.lastPurchase(purchaseId?)`: items of that purchase (latest when none) with `qty` = pieces received; empty list when there is none.
- `stickers:printers` · `window.api.stickers.printers()`: names of printers installed on this PC.
- `stickers:savePrefs` · `window.api.stickers.savePrefs({ size, printer })`: owner, manager. Errors: "Choose a label size." Stored in `settings` key `stickers`; audit `settings_change`.
- `stickers:print` · `window.api.stickers.print([{ variantId, qty }])`: returns `{ printed }`. Errors: "Add at least one item to print." · "Enter how many stickers for …" · "At most 500 stickers per item at a time." · "An item on the list no longer exists." · "The printer did not accept the job …" · "Printing was cancelled." Audit `stickers_print` (count, items).

## 5. Database

No new table. Reads `variants`, `products`, `purchases`, `purchase_lines`; reads and writes `settings` key `stickers` (`{ size, printer }`); writes `audit_log`.

## 6. Business rules

- Barcodes are our EAN-13 codes (`shared/barcode.ts`), unique per size × colour. A code that is not a valid EAN-13 prints without bars (text only).
- Label: shop name, product, size · colour, barcode with its number, "MRP ₹… incl. of all taxes". Default 50 × 25 mm.
- Printing happens in the **main process** in a hidden window; the screen only sends variant ids and counts, and the label text and MRP are rebuilt from the database.
- With a printer chosen, labels print straight away. With none chosen, the Windows print dialog opens. A failed print changes no data.
- One label per page at the exact label size, so any label printer driver can print it. If the printed size is off, set the paper size in that printer's Windows driver to the label size.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| EAN-13 bars | 95 modules, guards, matches the standard encoding of 4006381333931, invalid codes refused | pass | 2026-11-13 |
| Label text | shop, size · colour, barcode, MRP, "incl. of all taxes", escaped | pass | 2026-11-13 |
| Print document | each item repeated by quantity; page size set | pass | 2026-11-13 |
| MRP from the database | label shows the stored MRP | pass | 2026-11-13 |
| Last purchase | one line per variant with pieces received | pass | 2026-11-13 |
| Print request checks | empty, 0, 501, unknown item refused | pass | 2026-11-13 |
| Label settings and roles | owner saves, store reads only, cashier refused | pass | 2026-11-13 |
| Real print on the TSC TE244 | label comes out at the right size | not tested | n/a |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
| 2026-11-13 | Print stickers screen, EAN-13 labels, print through the Windows driver, label settings, Stock in link, tests | uncommitted |
