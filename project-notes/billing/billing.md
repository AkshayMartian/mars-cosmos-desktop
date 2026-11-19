# Billing

## 1. Summary

- **What it does:** the counter screen. Staff scan or search items, set quantities and discounts, find or add the customer, choose the salesperson, take payment (cash / UPI / card, split allowed) and save the bill. The main process **recomputes all prices, GST and totals**, numbers the bill, takes the stock down and stores everything in one transaction. Also: **start the day** (opening cash), **hold / resume** bills, **manager approval** for big discounts, receipt text and a WhatsApp link.
- **Screens:** `Billing` (`src/renderer/screens/Billing.tsx`) with dialogs: Start the day, Manager approval, Payment, Held bills, Add customer, Receipt.
- **Who can use it:** Owner, Manager, Cashier. Store staff cannot (menu hidden and the service refuses).
- **Status:** **done** for Phase 1 scope (2026-11-12). Not included: printing the receipt, coins (credit-note payment is now on the payment dialog and alteration jobs are made from the cart line: see the Returns and Alterations notes; cancelling a bill is the Bills module).
- **Code:** screen `src/renderer/screens/Billing.tsx` · service `src/main/services/billing.ts` (+ `customers.ts` for the two customer calls, `approval.ts`) · maths `src/shared/calc.ts` · receipt `src/shared/receipt.ts` · shapes `src/shared/billing.ts` · tests `src/main/services/billing.test.ts`, `src/shared/calc.test.ts`.

- **Serial numbers (2026-11-18):** Items with **serial numbers** are scanned piece by piece (no − / +, "Already added", scan a bunch barcode to add a whole bunch, held bills reserve pieces): see [Serial numbers](../serials/serials.md).
## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| **Hold bill** | button | Saves the current cart as a held bill and clears the screen (message "Bill held…"). "Nothing to hold." if the cart is empty |
| **Held (n)** | button | Opens the list of held bills (n = how many) |
| **Clear** | button | Empties the cart, customer, discount and approval |
| *Scan barcode or type item name* | text box (auto-focus) | Live search while typing; **Enter** looks up again: exactly one match is added |
| Search result row | button | Adds that item (label, price, stock; "out of stock" in red when 0) |
| Cart row: **− / +** | buttons | Quantity down/up (never below 1, never above stock) |
| Cart row: *Discount ₹* | number | Discount on that line (rupees) |
| Cart row photo | thumbnail (48 px) | The photo of the **colour that was scanned** (all sizes of a colour share it); an empty frame when that colour has no photo |
| Cart row: **✕** | button | Removes the line |
| *Customer mobile (F4)* | text (10 digits) | Type the number: the customer is looked up **as soon as the 10th digit is typed** (**Enter** or **Find** also work) |
| **Find** | button | Looks up the customer |
| **Add customer** | button (shows when not found) | Opens the Add customer dialog (mobile, name, WhatsApp and offers consent) |
| Customer card | display | Name, the customer's **usual sizes** as "Shirt 40 · Trouser 32 · Shoe 9" (only the filled ones; nothing when none), GSTIN if any |
| **Change customer** | button | Clears the customer |
| *Salesperson (for commission)* | dropdown | Who gets the sale (default: you) |
| *Bill discount ₹* | number | Discount on the whole bill (rupees) |
| Totals box | display | Items, Subtotal, Discount, GST included, Round off, **Total** |
| *Approved by …* | chip | Shown after a manager approved this bill |
| **Pay (F9)** | button | Starts payment (disabled when the cart is empty or the day is not started) |
| **F2** | shortcut | Focus the scan box |
| **F4** | shortcut | Focus the customer mobile box |
| **F9** | shortcut | Pay |
| **Esc** | shortcut | Clear the bill (only when no dialog is open) |
| **F1** | shortcut (anywhere) | Go to Billing |
| **Start the day** dialog | dialog | *Opening cash ₹* (default 2000) and **Start day**; cannot be closed until done |
| **Manager approval** dialog | dialog | Shows why; *Approved by* (owner/manager list), *Their PIN*, **Cancel**, **Approve** |
| **Payment** dialog | dialog | Cash / UPI / Card amounts with **Full** buttons, *Cash received ₹* (shows change), Paid / Still to pay, **Back**, **Save bill** (enabled only when paid = total) |
| **Held bills** dialog | dialog | Date, items, who held it, **Resume**; **Close** |
| **Receipt** dialog | dialog | The receipt text, **Send on WhatsApp** (needs the customer's mobile), **New bill** |

## 3. Flows

**Open Billing** → `billing.context()` → if `session` is null the **Start the day** dialog appears. Reads `settings`, `day_sessions`, `staff`.

**Start the day** → `billing.openDay(openingCash)` → inserts a `day_sessions` row (status `open`) → audit `day_open`.

**Add an item** → typing calls `billing.search(q)`; the screen blocks items with stock 0 ("<item> is out of stock.") and quantities above stock ("Only N of <item> in stock."). Enter with no result calls `billing.archived(q)` to say "…is archived: restore it in Products → Show archived". Reads `variants, products, categories, v_stock`.

**Find / add customer** → typing the 10th digit (or Enter / Find) calls `customers.find(mobile)` → reads `customers`; the card shows the sizes. A scanned item's photo is fetched once per item with `billing.photo(variantId)` and shown in the cart row. Not found → *Add customer* → `customers.create({...})` writes `customers` (+ consent date and staff) and `audit_log`.

**Pay** → the screen checks the discount against the user's limit (`ctx.maxDiscountPct`): owner/manager never need approval; a cashier above the limit sees the **Manager approval** dialog first → then the **Payment** dialog → **Save bill** → `billing.create(...)`:
1. role, open day, input checks, merge duplicate lines
2. re-read each item (price, GST rule, stock) from the database
3. refuse if stock is 0 or lower than the quantity (no approval can override)
4. `calc()` the totals; work out discount %; if a cashier is over the limit, `checkApprover`
5. payments must be positive integers that **add up to the total**
6. one transaction: next bill number → `bills` → `bill_lines` (+ one `stock_moves` row per line, type `sale`) → `payments` → audit `approve` if approved
7. returns the saved bill → **Receipt** dialog; the top-bar "My sales today" refreshes.

**Hold** → `billing.hold({lines, customerId})` → writes `held_bills` (JSON). **Resume** → `billing.resume(id)` returns the payload and **deletes** the held row; the screen re-reads items (`billing.variants`), keeps only what is still in stock and says what changed.

**WhatsApp** → the receipt dialog builds `https://wa.me/91<mobile>?text=…`; the Electron window opens it in the browser (the only link type allowed). The shop staff press Send. Nothing is sent automatically.

## 4. APIs


All calls: IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`; the screen sees `data` or a rejected promise. Roles for every call below: **owner, manager, cashier** (anything else: `You are not allowed to do this.`; no session: `Not logged in.`).

### `window.api.billing.context()` · channel `billing:context`
- **Called from:** Billing on load, after starting the day, after a bill.
- **Request:** none.
- **Response:**
```json
{ "gstScheme":"regular",
  "session":{ "id":"6e1d…","opening":200000,"openedAt":"2026-11-12T08:55:01.120Z" },
  "salespeople":[{"id":"3b6f…","name":"Owner"},{"id":"9c21…","name":"Manager"}],
  "approvers":[{"id":"3b6f…","name":"Owner","role":"owner"},{"id":"9c21…","name":"Manager","role":"manager"}],
  "maxDiscountPct":10, "actorRole":"cashier",
  "shop":{ "name":"Your Shop","address":"","phone":"","gstin":"","policy":"Exchange within 7 days with this bill. No cash refund on sale items.","footer":"Thank you! Visit again." } }
```
- **Errors:** `Not logged in.` / `You are not allowed to do this.`
- **Tables read:** `settings` (`gst_scheme`, `shop`, `counter`), `day_sessions`, `staff`.
- **Steps:** role check → read my discount limit → read gst scheme, open session of this counter, active staff, owners/managers, shop info (defaults filled in).
- **Example:** cashier on a fresh day → `session: null` (the screen shows "Start the day").

### `window.api.billing.openDay(openingCash)` · channel `billing:openDay`
- **Called from:** Start the day → Start day; Day end → Open the day.
- **Request:** `{ "openingCash":200000 }` (paise)

| Field | Type | Required | Validation |
|---|---|---|---|
| openingCash | integer paise | yes | whole number ≥ 0 |

- **Response:** `{ "id":"6e1d4c2a-9b70-4e55-a1c3-0f2b8d7e6a41" }`

| When | Message |
|---|---|
| not an integer ≥ 0 | `Enter the cash in the drawer (0 or more).` |
| a day is already open on this counter | `The day is already started.` |

- **Tables written:** `day_sessions`, `audit_log` (`day_open`). 
- **Example:** `₹2,000` → `{ openingCash: 200000 }`.

### `window.api.billing.search(q)` · channel `billing:search`
- **Called from:** scan box (typing, Enter).
- **Request:** `{ "q":"slim" }` or a scanned `{ "q":"2000000000015" }`
- **Response:** up to 8 items (an exact barcode or brand-barcode match returns just that one):
```json
[{ "id":"9b1e0c3a-5d7f-4a21-8c44-1f0e2d3b4a55","name":"Slim Shirt","colour":"Blue","size":"M",
   "label":"Slim Shirt · Blue · M","barcode":"2000000000015","mrp":149900,"price":149900,"stock":9,
   "gst":{"mode":"auto","rate":0} }]
```
- **Errors:** role errors only. Empty `q` returns `[]`.
- **Tables read:** `variants, products, categories, v_stock`. Only **active** products, never service categories.
- **Query:** `SELECT v.id,p.name,v.colour,v.size,v.barcode,v.mrp,v.sale_price AS price,COALESCE(s.qty,0) AS stock,c.gst_mode AS mode,c.gst_rate AS rate,c.hsn FROM variants v JOIN products p … LEFT JOIN v_stock s … WHERE p.active=1 AND c.is_service=0 AND (v.barcode=? OR v.brand_barcode=?)`; else a `LIKE` on name, brand, colour, size, barcode, `ORDER BY p.name, v.rowid LIMIT 8`.

### `window.api.billing.archived(q)` · channel `billing:archived`
- **Called from:** scan box Enter when nothing was found.
- **Request:** `{ "q":"slim" }` · **Response:** `["Slim Fit tshirt"]` (up to 3 names of *archived* products matching name, brand or barcode) or `[]`.
- **Tables read:** `products, variants`.

### `window.api.billing.variants(ids)` · channel `billing:variants`
- **Called from:** resuming a held bill. **Request:** `{ "ids":["9b1e…","c04a…"] }` · **Response:** same item objects as `search` (items archived since are missing). Empty list → `[]`.

### `window.api.billing.photo(variantId)` · channel `billing:photo`
- **Called from:** the cart rows (once per item on the bill). **Roles:** any logged-in user.
- **Request:** `{ "variantId":"9b1e0c3a-5d7f-4a21-8c44-1f0e2d3b4a55" }` · **Response:** `"data:image/jpeg;base64,/9j/…"` — the photo of **that item's colour** — or `null` when the colour has no photo.
- **Errors:** `Not logged in.` · **Tables read:** `variants, product_photos` (matched on product and colour); reads the file. **Query:** `SELECT pp.file_path FROM variants v JOIN product_photos pp ON pp.product_id=v.product_id AND pp.colour=v.colour WHERE v.id=?`.
- **Example:** scanning Blue M and later Blue L of the same shirt shows the same Blue photo; scanning Red M shows the Red photo; a Green item with no photo shows an empty frame.

### `window.api.billing.create(input)` · channel `billing:create`
- **Called from:** Payment dialog → **Save bill** · **Roles:** owner, manager, cashier.
- **Request:**
```json
{ "lines":[{ "variantId":"9b1e0c3a-5d7f-4a21-8c44-1f0e2d3b4a55","qty":1,"disc":0 }],
  "customerId":"7d42…" ,"billDisc":30000,"salesBy":"9c21…",
  "payments":[{ "mode":"cash","amount":119900 }],
  "approval":{ "staffId":"9c21…","pin":"2222" } }
```

| Field | Type | Required | Validation |
|---|---|---|---|
| lines[].variantId | string | yes | an active, non-service item |
| lines[].qty | integer | yes | whole number > 0; same item on two lines is added together |
| lines[].disc | integer paise | yes | ≥ 0 and not more than price × qty |
| customerId | string or null | yes | existing, not deleted customer; null = walk-in |
| billDisc | integer paise | yes | ≥ 0 |
| salesBy | string or null | no | active staff id, else the person billing |
| payments[] | array | yes | each `mode` ∈ cash, upi, card and `amount` integer > 0; **sum must equal the total** |
| approval | `{staffId,pin}` | only if needed | an active owner/manager and their PIN |

- **Response:** the saved bill (also what `bill(id)` returns):
```json
{ "id":"e8a0…","no":"C1/2026-27/0003","type":"sale","status":"completed","at":"2026-11-12T10:41:09.512Z","staffName":"Cashier",
  "customer":{ "name":"Rahul Shah","mobile":"9876500045","gstin":null },
  "lines":[{ "name":"Slim Shirt","colour":"Blue","size":"M","qty":1,"price":149900,"rate":5,"total":119900,"hsn":"6205" }],
  "subtotal":149900,"discount":30000,"taxable":114190,"cgst":2855,"sgst":2855,"roundOff":0,"grand":119900,
  "payments":[{ "mode":"cash","amount":119900 }] }
```

| When | Message |
|---|---|
| day not started | `Start the day first: enter the opening cash.` |
| no lines | `Add at least one item.` |
| qty not whole > 0 | `Quantities must be whole numbers above zero.` |
| negative discount | `Discount cannot be negative.` |
| item archived/deleted | `An item on this bill is no longer available.` |
| line discount > price × qty | `Discount on <item> is more than its price.` |
| stock is 0 | `<item> is out of stock.` |
| stock lower than qty | `Only 2 of <item> in stock.` |
| customer missing | `Customer not found.` |
| cashier over their limit, no approval | `A manager or owner must approve this.` |
| wrong approver PIN | `That PIN is not correct for the chosen manager or owner (3 tries left).` The screen goes back to the approval dialog and shows this text |
| 5th wrong approver PIN, or that approver is locked | `Too many wrong approval PINs. Approvals by this person are locked for 60 seconds.` / `Too many wrong approval PINs. Try again in 45 seconds.` (lock rules: [Login and roles](../login-and-roles/login-and-roles.md)) |
| bad payment mode/amount | `Check the payment amounts.` |
| payments ≠ total | `The payments must add up to the bill total.` |

- **Tables read:** `variants, products, categories, v_stock, customers, staff, settings, day_sessions`. **Written:** `bill_counters`, `bills`, `bill_lines`, `stock_moves` (type `sale`, ref = bill no, qty negative), `payments`, `audit_log` (`approve`, only when approved).
- **Steps:** see Flows → Pay.
- **Example (real values):** Cashier sells 1 × Slim Shirt (₹1,499, 5% GST) with ₹300 off, paid cash ₹1,199. Cashier's limit is 10%; discount is 20% → manager Owner approves with `1111`. Result `grand = 119900`, GST backed out of the discounted price; stock 9 → 8; bill `C1/2026-27/0003`.

### `window.api.billing.bill(id)` · channel `billing:bill`
- **Called from:** (reserved for the Bills module; used internally after create). **Request:** `{ "id":"e8a0…" }` · **Response:** the bill shape above · **Error:** `Bill not found.` · **Tables read:** `bills, staff, customers, bill_lines, payments`.

### `window.api.billing.hold(payload)` · channel `billing:hold`
- **Request:** `{ "lines":[{ "variantId":"9b1e…","qty":2,"disc":0 }], "customerId":null }` · **Response:** `null`.
- **Errors:** `Nothing to hold.` · **Tables written:** `held_bills` (`payload` JSON, `staff_id`, `at`).

### `window.api.billing.held()` · channel `billing:held`
- **Response:** `[{ "id":"…","at":"2026-11-12T11:02:00.000Z","staffName":"Cashier","items":2 }]` newest first (`ORDER BY at DESC, rowid DESC`). **Tables read:** `held_bills, staff`.

### `window.api.billing.resume(id)` · channel `billing:resume`
- **Request:** `{ "id":"…" }` · **Response:** the held payload · **Error:** `That held bill is no longer there.` · **Tables:** reads then **deletes** the `held_bills` row.

### `window.api.customers.find(mobile)` · channel `customer:find`
- **Request:** `{ "mobile":"9876500045" }` · **Response:** `{ "id":"7d42…","name":"Rahul Shah","mobile":"9876500045","gstin":null,"sizes":{ "shirt":"40","trouser":"32","shoe":"9" },"waConsent":true,"offersConsent":false }` or `null`. `sizes` always has the three keys (empty strings when not given).
- **Errors:** `Enter a 10-digit mobile number.` · **Tables read:** `customers` (not deleted).

### `window.api.customers.create(input)` · channel `customer:create`
- **Called from:** Billing → Add customer. **Request:** `{ "mobile":"98765 00045","name":"Rahul Shah","waConsent":true,"offersConsent":false }` · **Response:** the customer (as `find`; its `sizes` are empty until edited on the Customers screen).

| When | Message |
|---|---|
| mobile not 10 digits (spaces removed) | `Mobile must be 10 digits.` |
| name empty | `Name is required.` |
| mobile exists | `A customer with this mobile already exists.` |

- **Tables written:** `customers` (consent date/staff only if a box is ticked), `audit_log` (`customer_create`). (The full Customers screen uses `customers:save`; see the [Customers](../customers/customers.md) note.)

## 5. Database

Read: `variants, products, categories, v_stock, customers, staff, settings, day_sessions, held_bills`. Written: `day_sessions, bills, bill_lines, payments, stock_moves, bill_counters, held_bills, customers, audit_log`.

Key queries (from `billing.ts`):
```sql
-- next bill number (atomic)
INSERT INTO bill_counters (counter,fy,next) VALUES (?,?,2)
  ON CONFLICT(counter,fy) DO UPDATE SET next=next+1 RETURNING next;   -- number = next-1 → C1/2026-27/0001

INSERT INTO bills (id,no,type,status,customer_id,staff_id,sales_by,session_id,at,subtotal,discount,taxable,cgst,sgst,round_off,grand)
  VALUES (?,?,'sale','completed',?,?,?,?,?,?,?,?,?,?,?,?);
INSERT INTO bill_lines (bill_id,variant_id,name,size,colour,hsn,qty,mrp,price,discount,taxable,gst_rate,cgst,sgst,total) VALUES (…);
INSERT INTO stock_moves (variant_id,qty,type,ref,reason,staff_id,at) VALUES (?, -qty, 'sale', <bill no>, NULL, ?, ?);
INSERT INTO payments (bill_id,mode,amount) VALUES (?,?,?);
```

## 6. Business rules

- **Prices come from the database** (`variants.sale_price`, GST inclusive). The screen cannot send a price.
- **GST** (`shared/calc.ts`): scheme `regular` uses each category's rule: `auto` (clothing) = **5% if the discounted price per piece ≤ ₹2,500, else 18%**; `fixed` = category rate (18% for belts/watches/goggles/wallets); `exempt` = 0. Schemes `composition` and `unregistered` charge **0%** (and the receipt says BILL OF SUPPLY / BILL).
- **Discount spreading:** bill discount is shared over lines in proportion to their value (rounded), the **last line takes the remainder**, so the parts always add up exactly.
- **GST backed out of the inclusive price:** `taxable = round(net × 100 / (100 + rate))`; `tax = net − taxable`; `cgst = floor(tax / 2)`, `sgst = tax − cgst`. Example: ₹1,499 at 5% → taxable ₹1,427.62, CGST ₹35.69, SGST ₹35.69.
- **Rounding:** total rounded to the nearest rupee (`round(total/100)*100`); the difference is `round_off` (e.g. ₹99.50 → ₹100, round-off 50 paise). A bill never goes below ₹0.
- **Discount limit:** discount % = `round(discount / subtotal × 100)`. Owner and manager unlimited. Cashier up to `staff.max_discount_pct` (10); above → manager approval. Exactly at the limit is allowed.
- **No sale without stock** (D-13): stock ≤ 0 → refused; qty above stock → refused; same item on two lines is summed first. Approval cannot override.
- **Payments:** only cash, UPI, card; each > 0; must equal the total exactly (split allowed).
- **Bill number:** `<counter>/<financial year>/<4-digit running number>`, financial year starts 1 April; numbers restart each year; gap-free because it is taken inside the bill's transaction.
- **Salesperson** for commission: chosen staff if active, else the person billing. "My sales today" uses this.
- **A day must be open** to bill; a closed day cannot take bills (Day end).
- **Archived products** are never sold; the search hints when a match is archived.
- **Receipt:** 48 characters wide on 80 mm paper and 32 on 58 mm, like a thermal printer's Font A (`shared/receipt.ts`); the same text goes to the printer.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| the working day › needs the day started (opening cash) before any bill | Billing before `openDay` fails "Start the day first"; after it works; opening twice fails "already started" | pass | 2026-11-13 |
| the working day › keeps the store staff out of billing | Store staff: "not allowed" | pass | 2026-11-13 |
| making a bill › saves the bill, takes stock down, numbers it per counter and financial year | Bill `C1/<fy>/0001`, then `/0002`; stock 10→9→8; stock_moves `sale` rows reference the bill numbers; taxable+CGST+SGST = ₹1,499 | pass | 2026-11-13 |
| making a bill › works out price and GST itself, never from the screen | 2 shirts (5%) + 1 linen (18%) = ₹5,797; wrong payment totals are refused | pass | 2026-11-13 |
| making a bill › splits payment across modes | ₹500 cash + ₹999 UPI accepted | pass | 2026-11-13 |
| making a bill › rejects empty bills, bad quantities and unknown items | Errors for no lines, qty 0, unknown item, discount above price; stock unchanged | pass | 2026-11-13 |
| making a bill › records the salesperson for commission and counts it in "my sales today" | Manager's "my sales" = ₹1,499, cashier's = ₹0 | pass | 2026-11-13 |
| discount and stock approval › lets the owner and manager discount freely | 50% off by owner and manager works with no approval | pass | 2026-11-13 |
| discount and stock approval › asks a cashier for approval above their limit, and checks the approver PIN | 20% needs approval; wrong PIN / cashier approver refused; manager 2222 accepted; exactly 10% allowed | pass | 2026-11-13 |
| discount and stock approval › never sells more than the stock, for anyone and even with an approval | Qty 3 with stock 2 refused for cashier, manager, owner (with or without approval); qty 2 works | pass | 2026-11-13 |
| discount and stock approval › refuses an item that has no stock at all | "<item> is out of stock" | pass | 2026-11-13 |
| discount and stock approval › counts the same item on two lines together against the stock | 2 + 1 lines vs stock 2 → "Only 2" | pass | 2026-11-13 |
| customers on a bill › finds a customer by mobile, records consent with who and when, and refuses duplicates | Find works, consent_by = cashier, duplicates and short numbers refused | pass | 2026-11-13 |
| customers on a bill › puts the customer on the receipt and the WhatsApp message | Receipt contains bill no, name, TOTAL, 1,499.00, CGST; "unregistered" has no CGST; WhatsApp text has "Total: ₹1,499" | pass | 2026-11-13 |
| held bills › holds a bill and gives it back once | Hold, list (1 item, staff "Cashier"), resume returns it and removes it; resuming again fails | pass | 2026-11-13 |
| finding items to sell › finds by scanned barcode, brand barcode or name, with price, stock and GST rule | Barcode → exactly that item with price 149900, stock 10, gst auto; name search works; nonsense → [] | pass | 2026-11-13 |
| finding items to sell › does not offer archived products, but can say that a match is archived | Archived item not found; `archivedMatches('slim')` = ["Slim Shirt"] | pass | 2026-11-13 |
| calc (6 tests, `calc.test.ts`) | 5% GST backed out of ₹1,499; 18% above ₹2,500; 0% for composition/unregistered; discount shares add up; rounding to rupee; never below zero | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Billing screen, `billing.create`, GST maths, receipt text, hold/resume, customer find/add, day start | n/a (no git) |
| 2026-11-12 | Approval names the approver; discounts above a cashier's limit need it | n/a |
| 2026-11-12 | "No sale without stock" for everyone, replaces the out-of-stock approval (D-13) | n/a |
| 2026-11-12 | Search tells you when a match is archived; held-bill lists order newest first | n/a |
| 2026-11-13 | Cart rows show the photo of the scanned colour (`billing:photo`); the customer card shows the usual sizes and the customer is found as soon as 10 digits are typed | n/a |
| 2026-11-13 | Wrong approver PINs are now limited (lockout); a refused approval returns to the approval dialog with the real reason (e.g. "locked for 60 seconds") | n/a |
| 2026-11-16 | Coins: balance on the customer card, "Use coins" box, coins on the receipt (see [Coins](../coins/coins.md)) | uncommitted |
| 2026-11-16 | "Not now" on the Start the day prompt, so the owner can reach other screens when no day is open (bills still need an open day) | uncommitted |
| 2026-11-17 | Walk-ins: the customer mobile is optional (needed only for an alteration, coins, a credit note or WhatsApp); the salesperson defaults to the person logged in (`meId` in `billing:context`); on the receipt a walk-in can type a mobile to send the bill on WhatsApp | uncommitted |
| 2026-11-17 | Found in a full test: Hold → Resume lost the customer, bill discount and salesperson (now kept); receipt and cash drawer now run by themselves after Save when a receipt printer is chosen; WhatsApp bill link needs the customer's WhatsApp consent | uncommitted |
| 2026-11-17 | Barcode scanner fix: when the scan box has lost focus (after a click on a button or empty space) a typed digit or letter now goes to the scan box (also on Print stickers, Stock in, Stock out, Stock count); an unknown barcode empties the box so the next scan is not glued onto it; Enter reads the box's own value | uncommitted |
| 2026-11-17 | Receipt no longer prints when the bill is saved: it prints only when staff press Print receipt (`print:afterSale` removed). Printed receipt text is now bold black so it is not faint on thermal paper | uncommitted |
