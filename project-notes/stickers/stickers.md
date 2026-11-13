# Print stickers (and printing in general)

> **Status: pending.** Not started. Blocked on Open question **Q-4** (printer models and languages).

## 1. Summary (planned)

- **What it will do:** print a barcode **label** for every piece (after stock in or on demand) and, in the same milestone, send the **receipt** to the receipt printer and open the **cash drawer** on cash bills.
- **Screens:** `Print stickers` (menu item exists, hidden): scan/search items, number of stickers per item, a preview of the label, **Print N stickers**, **Clear list**, **Last purchase**. Also the existing *Stickers* buttons on Stock in and *Print stickers* / *Save & print stickers* on Products (today they only show a message).
- **Who can use it:** Owner, Manager, Store staff.
- **Code (to create):** `Stickers.tsx`, `src/main/print/` (receipt ESC/POS, label TSPL/ZPL, drawer kick), settings for printers.

## 2. What already exists for it

- Receipt text is built in `src/shared/receipt.ts` (36 characters wide; duplicate copy supported).
- Barcodes are EAN-13 (`shared/barcode.ts`), unique per size × colour.
- The Billing receipt dialog, Day end and Stock in already have the points where printing will be called (they currently say printing is not built).

## 3. Planned rules

- Label size default 50 × 25 mm (38 × 25 and 50 × 38 also offered); shows shop name, product, size · colour, barcode, number, "MRP ₹… incl. of all taxes".
- A label is printed per received piece; reprints on demand; a price change should prompt a reprint.
- Printing happens in the **main process** (never from the screen); a failed print must not lose a saved bill.
- Cash drawer opens only for bills with a cash payment.

## 4. Open questions

- **Q-4**: models; ESC/POS over USB or LAN for the receipt printer; TSPL (TSC) or ZPL (Zebra) for labels; label stock (thermal vs thermal transfer).

## 5. Done when

Print queue + preview, real print to the devices on the shop PC, test print buttons, tests for the label/receipt generators, README status **done**, this page completed.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
