# Serial numbers

## 1. Summary

- **What it does:** every single piece of a *tracked* product gets its own serial number (0001, 0002 …, running per item). The sticker carries the item's barcode **plus** the serial. Billing then sells **real pieces**, not a quantity that goes up and down: the same piece cannot be scanned twice, a sold piece cannot be sold again, and stock always equals the pieces on the shelf. Based on the team paper *Serial numbers in Stock and Billing* (17 Nov 2026, v3).
- **Screens:** Billing (scan, bunch), Returns (pick pieces, exchange), Stock (adjust, count, piece lookup), Stock out, Print stickers, Add / Edit product (switch). Files in `src/renderer/screens/`.
- **Who can use it:** Billing and Returns: owner, manager, cashier. Stock, Stock out, Stickers: owner, manager, store. Switching a product on or off: owner, manager.
- **Status:** built (2026-11-18). **Needs a real sticker test before go-live** (paper question 5: does the Code 128 sticker scan with our scanner and print clearly on our printer?).
- **Code:** service `src/main/services/serials.ts` (+ the serial parts of `billing.ts`, `stock.ts`, `returns.ts`, `bills.ts`, `stickers.ts`, `catalogue.ts`) · shared `src/shared/serials.ts` (sticker code, Code 128, messages) · tests `src/main/services/serials.test.ts`, `src/shared/serials.test.ts`.

### Answers used for the paper's open questions (section 9 "Our suggestion")

| No. | Question | What was built |
|---|---|---|
| 1 | Brand barcode with no serial | Not sold by scanning: message "<item>: This barcode has no serial number. Scan the sticker on the piece. Old sticker? Print a new one in Print stickers." |
| 2 | All products or per product | **Per product** (`products.track_serials`). **Off for existing products**; the Add product form has it ticked by default; Excel import leaves it off |
| 3 | Bunch size, partial return | **No limit**; a return picks pieces by serial, so 2 of a bunch of 6 can come back later |
| 4 | Serial look | **Running numbers**, 4 digits (`0001`), more digits after 9999 |
| 5 | Longer sticker code | Sticker barcode is **Code 128** (digits packed in pairs, so `2000000000015` + `0001` stays short). **Not yet tried on the real scanner/printer** |

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| Add product → *Give every piece its own serial number* | checkbox (default on) | Makes the new product tracked; opening stock gets serials |
| Edit product → *Serial numbers* | checkbox | Switches tracking on (every piece in stock gets a serial: "N pieces in stock got serials: print new stickers") or off (Billing sells by quantity again; pieces stay on record) |
| Billing scan box | text | A sticker (`barcode` + `serial`, or typed `barcode-serial`) adds that piece. Same variant → same line, quantity +1. A plain barcode of a tracked item is refused (no serial) |
| Billing line of a tracked item | row | Quantity is a number, **no − / + buttons**; serials listed under the item; **✕** removes the **whole line**; **Scan to remove** turns on a mode where each scanned sticker takes off just that piece (Done ends it) |
| **Scan a bunch barcode** | scan box | A bunch made earlier (Add product / Stock in) goes on the bill as ONE row "bunch of N" with all its pieces; no "Add as bunch" button any more (2026-11-19) |
| Returns → pieces | checkboxes of serials | Choose exactly which pieces come back |
| Returns → New items | scan box | Serial items are added by scanning; no − / + |
| Stock out | scan box | Serial items go out by scanning each piece (not a typed number) |
| Stock → Adjust (tracked item) | select + scan | *Remove pieces*: scan them. *Add pieces*: type how many (new serials) or scan lost / damaged pieces found again |
| Stock → Stock count | scan | Each piece counted once ("Already counted"); the not-yet-scanned serials are listed as missing; approving marks them lost |
| Stock → *Look up a piece* | text | Scan or type a sticker: shows status, bill number and the piece's history |
| Print stickers | list | A tracked item prints **one sticker per piece**, each with its serial (all pieces in stock by default; "Last purchase" prints the serials of that purchase; typing a sticker code reprints that one piece) |

## 3. Flows

**Receive stock** (`stock.in`, opening stock, import with tracking on) → one `stock_moves` row **and** one `pieces` row per unit (serial = next number of that variant, event `received`).

**Scan in Billing** → `billing.scanPiece(code, inBill)` → code is split into barcode + serial → checks, in this order: serial known (else *This serial number is not in the stock records*) · already on this bill (*Already added*) · piece not `in_stock` (*This piece is not in stock*) · piece in a held bill (*This piece is in another bill on hold*). `null` back = not a sticker of a serial item, the screen falls back to the normal barcode / name search.

**Bunch** → `billing.scanBunch(code, inBill)` → the bunch made in Add product / Stock in: its variant and the serials of ALL its pieces; refuses with *This bunch is not in stock* (sold, or a piece has gone), *This piece is in another bill on hold* or *Already added*. A piece packed in a whole bunch cannot be scanned or sold alone (*This piece is inside a bunch: scan the bunch barcode*).

**Save bill** → `billing.create` re-checks every serial (`takeFree`: exists, in stock, not held, no duplicates, quantity = number of serials) → bill, lines, `stock_moves` (`sale`) → each piece `sold` + `bill_id` (+ `bunches` row and `pieces.bunch_id` for a bunch) + event. The bill saved keeps **one line per item** (price and GST are the same for all its pieces); the pieces are linked through `pieces.bill_id`.

**Hold / resume** → a held bill's serials are **reserved** (every free-piece check reads `held_bills`). Resume deletes the held row, then drops serials that are no longer in stock (a bunch that lost a piece is dropped whole) and says so.

**Cancel bill** → every piece of the bill goes back to `in_stock` (event `bill cancelled`).

**Return / exchange** → a line with serials returns exactly the chosen pieces (`ReturnInput.lines[].serials`, must be pieces sold on **this** bill and still sold): back to stock with the **same serial**, event `returned`. A tracked item sold *before* tracking was switched on has no pieces on the bill: the returned units get new serials (new stickers needed). Exchange items that use serials carry `newLines[].serials`.

**Stock out / adjust** → exact pieces by serial; status becomes `damaged`, `supplier_return`, `dispatched`, `other_out` (stock out) or `damaged` / `lost` (adjust). *Found* revives a lost / damaged / taken-out piece; an add with no serials makes new pieces.

**Stock count** → scanning a sticker inserts one `stock_count_pieces` row (counted = number of scanned pieces; typing a number is refused). Approve: unscanned `in_stock` pieces → `lost`, scanned pieces that were not in stock → `in_stock`; the `count` stock move brings stock to the counted pieces.

**Switch tracking on** → `catalogue.setTrackSerials` → `syncPieces` for every variant: missing pieces are created so that `in_stock` pieces = stock (stock numbers do not change); extra pieces would be marked lost.

## 4. APIs

Roles: Billing calls owner / manager / cashier; Stock calls owner / manager / store; `serials:history` any of the four.

### `window.api.billing.scanPiece(code, inBill)` · channel `billing:scanPiece`
- **Request:** `{ "code":"20000000000150001", "inBill":[{ "variantId":"9b1e…","serial":"0002" }] }`
- **Response:** `{ "variant":{ …same item object as billing.search, "tracked":true }, "serial":"0001" }` or `null` (not a serial sticker).
- **Errors:** `Already added` · `This piece is not in stock` · `This piece is in another bill on hold` · `This serial number is not in the stock records`.
- **Tables read:** `variants, pieces, held_bills`.

### `window.api.billing.pickPiece(variantId, inBill)` · channel `billing:pickPiece`
- **Request:** `{ "variantId":"9b1e…","inBill":[{"variantId":"9b1e…","serial":"0001"}] }` → **Response:** `{ "variant":{…},"serial":"0002" }` (the next free single piece).
- **Errors:** `This item does not use serial numbers.` · `No free piece of … is left (the rest are on a bill, on hold or in a bunch).` · `… is out of stock.`
- **Writes:** nothing. The piece is only sold when the bill is saved (`billing.create` checks it again).

### `window.api.billing.scanBunch(code, inBill)` · channel `billing:scanBunch`
- **Request:** `{ "code":"2100000000019","inBill":[{"variantId":"9b1e…","serial":"0004"}] }` → **Response:** `{ "code":"2100000000019","variant":{…},"serials":["0001","0002","0003"] }`, or `null` when the code is not a bunch barcode.
- **Errors:** `Already added` · `This bunch is not in stock` · `This piece is in another bill on hold`.
- **Writes:** nothing. Bunches are made when stock is received (`catalogue.create` with `bunchSize`, `stock.in` lines with `bunchSize`): each full bunch of N pieces gets a `bunches` row with ONE barcode (`21…`); the rest stay single pieces. Pieces keep `bunch_id`; selling the bunch sets `bunches.bill_id`, cancelling the bill clears it (the bunch is whole again).

### `window.api.billing.create(input)` · channel `billing:create` (serial parts)
- `lines[]` may carry `serials` (required, same count as `qty`, for a tracked item) and `bunch` (the bunch barcode). A bunch line must be a whole, unsold bunch made earlier: its code, variant and EXACT pieces are checked (`This bunch is not in stock`). Pieces packed in a whole bunch cannot be sold alone.
- **Errors:** `Scan the sticker of every piece: this item uses serial numbers.` · the piece messages above (with the serial in brackets).

### `window.api.stock.scanPiece(code, inList, want)` · channel `stock:scanPiece`
- For Stock out and Adjust. `want` = `"free"` (pieces leaving stock) or `"gone"` (lost / damaged pieces found again). Returns `{ variant, serial }` or `null`.

### `window.api.stock.pieceHistory(code)` · channel `serials:history`
- **Response:** `{ "label":"Slim Shirt · Blue · M","barcode":"2000000000015","serial":"0001","status":"sold","bill":"C1/2026-27/0007","events":[{ "at":"…","event":"received","ref":"S1","staff":"Owner" },{ "at":"…","event":"sold","ref":"C1/2026-27/0007","staff":"Cashier" }] }`
- **Error:** `This serial number is not in the stock records`.

### `window.api.catalogue.trackSerials(id, on)` · channel `cat:trackSerials`
- **Roles:** owner, manager. **Response:** `{ "newSerials":5 }` (pieces created for existing stock). Audit `serials_toggle`.

### `window.api.stickers.piece(code)` · channel `stickers:piece`
- **Roles:** owner, manager, store. **Response:** the sticker item of that one piece (`serials:["0004"]`).

Changed calls: `stock.out` lines and `stock.adjust` take `serials`; `count.scan` accepts stickers; `returns.do` takes `serials` on returned lines and on `newLines`; `returns.bill` lines list `pieces`; `billing.resume` returns `notes`; `stickers.print` lines take `serials`; `catalogue.create` takes `trackSerials`.

## 5. Database

Migration 6:

- `products.track_serials` (0 / 1, default 0).
- `pieces` (`id`, `variant_id`, `serial`, `status`, `bill_id`, `bunch_id`, `purchase_id`, `created_at`; unique `(variant_id, serial)`). Status: `in_stock`, `sold`, `damaged`, `supplier_return`, `dispatched`, `other_out`, `lost`.
- `piece_events` (`piece_id`, `event`, `ref`, `staff_id`, `at`): the history of a piece.
- `bunches` (`code` unique, `variant_id`, `bill_id`, `qty`, `created_at`).
- `stock_count_pieces` (`count_id`, `piece_id`): pieces scanned in a count.

`stock_moves` stays the quantity ledger and `v_stock` is unchanged. **Invariant (rule 6):** for a tracked variant, `COUNT(pieces WHERE status='in_stock') = stock`. Every flow that writes a stock move for a tracked variant also moves its pieces in the same transaction; `syncPieces` restores the invariant when tracking is switched on.

## 6. Business rules

The six rules of the paper, as built:

1. One variant has one barcode; every piece has its own serial (unique per variant).
2. All pieces of a variant share **one** line on the bill (a bunch is the only exception, rule 4).
3. The same piece scanned again changes nothing: *Already added*.
4. A bunch is one extra line with its own barcode; its size is fixed.
5. A scanned piece's quantity cannot be reduced: no − / + buttons; **✕** removes the whole line and its pieces are free at once. **Scan to remove** (added after the paper) removes single pieces by scanning them, so 2 of 50 do not need 48 re-scans; a piece not on the bill is refused with "This piece is not on this bill".
6. Stock equals the real pieces. A held bill keeps its pieces reserved.

Also: the main process never trusts the screen: serials, status, holds and duplicates are re-checked when the bill is saved.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| `serials.test.ts` (23 cases): opening stock and stock in make serials; switching tracking on; scan rules and messages; sold piece refused; quantity ≠ serials refused; bunch picks, own barcode, *Only N are free*; held pieces reserved and re-checked on resume; cancel; return by serial and re-sale; exchange; return of a pre-tracking sale; stock out; adjust; stock count missing / lost; history; sticker serials | all pass | pass | 2026-11-18 |
| `shared/serials.test.ts`: sticker code split / join, Code 128 structure | pass | pass | 2026-11-18 |
| **Scan a printed sticker with the shop's scanner** | the scanner reads barcode + serial in one scan | **not tested yet** | |
| Old stickers (no serial) after switching a product on | refused with the "no serial number" message until re-stuck | not tested on a counter | |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-18 | Serial numbers built (migration 6, billing, bunches, returns, stock out, adjust, count, stickers, history) | |

## 2026-11-19: serial numbers are the rule for every product

The per-product tick box is gone (Add product and Edit product just say every piece has its own serial). New products and Excel imports are always tracked. At every start `enableSerialsEverywhere()` (catalogue.ts) switches on any product still on quantity-only and gives its stock serials (0001...), keeping the stock numbers; it does nothing once all are on. Consequence (paper section 8): a plain barcode or an old sticker without a serial is refused in Billing ("This sticker has no serial number..."); print new stickers from Print stickers. The service still has `setTrackSerials` (used by tests); there is no screen to switch serials off.

## Scan to add / Scan to remove (2026-11-19)

Every serial row has **Scan to add** and **Scan to remove** buttons. Either one opens a banner with three buttons: *Scan to add*, *Scan to remove* (the cashier switches between them while scanning) and *Done* (back to normal scanning, which also adds by search). In add mode a scanned sticker is put on the bill (same piece again: "Already added"); in remove mode it takes just that piece off. Clear also goes back to normal.

## 2026-11-19: bunches are made at receiving, not at the counter

- The billing "Add as bunch" button and `billing:makeBunch` are gone. A bunch is now **pieces packed together when stock arrives**: Add product has *Pieces per bunch (optional)* (the opening stock is split into full bunches plus single pieces), and each Stock in line has *Bunch of*. Every full bunch gets ONE barcode (`21…`, EAN-13) and ONE sticker; its pieces keep their own serials in the database (history, returns by serial).
- Billing: scan the bunch barcode and the row "bunch of N" goes on the bill with quantity N. The whole bunch only: to sell fewer, scan single-piece stickers. Scan to remove: scan the bunch barcode to take the whole bunch off; one piece of a bunch cannot be taken out.
- Print stickers: a bunch is its own row ("Bunch of N", copies editable); single pieces keep their serial stickers; a bunch barcode typed or scanned in the search box adds that bunch.
- Stock count: scanning the bunch barcode counts all its pieces once. Cancelling a bill puts its bunches together again. A bunch that loses a piece (damaged, lost) is no longer whole: it cannot be scanned and its other pieces sell singly (they then need their own stickers).
- Not covered yet: Stock out / Adjust take pieces by serial only (a bunch barcode is not accepted there).
- **Plain barcode (2026-11-19):** scanning the variant's plain barcode (an old sticker, no serial) no longer shows the "no serial number" refusal in Billing: `billing.pickPiece(variantId, inBill)` puts the **next free single piece** (lowest serial, not on the bill, not held, not in a bunch) on the bill as a normal scanned piece. Trade-off (paper question 1): the serial sold may not be the one on the piece in the customer's hand, and scanning the same plain barcode twice adds two pieces, because a plain barcode cannot tell pieces apart. Errors: `No free piece of … is left` · `… is out of stock.` Returns / Stock out still ask for the piece's own sticker.
