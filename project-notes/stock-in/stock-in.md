# Stock in

## 1. Summary

- **What it does:** records stock that arrives from a supplier. Pick the supplier, type the supplier's bill number and date, scan or search the items, set quantity and cost for each, and save. Stock goes up, each item's **cost** is updated, and the purchase is kept. Suppliers can be added on the spot.
- **Screen:** `StockIn` (`src/renderer/screens/StockIn.tsx`) with an *Add supplier* dialog.
- **Who can use it:** Owner, Manager, Store staff. (Cashier: no.) **+ New product** is shown to Owner/Manager only.
- **Status:** **done** (2026-11-12). Not included: printing stickers for the received pieces (the **Stickers** button next to each recent purchase opens Print stickers with it loaded).
- **Code:** screen `src/renderer/screens/StockIn.tsx` · service `src/main/services/stock.ts` (`stockIn`, `createSupplier`, `listSuppliers`, `recentPurchases`, `searchVariants`, `addMove`) · shapes `src/shared/catalogue.ts` · tests `src/main/services/services.test.ts` (stock in group).

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| **+ New product** (top right) | button (owner/manager) | Opens Products → Add product |
| *Supplier* | dropdown | Supplier of this purchase (first supplier preselected; "— none —" allowed) |
| **+ Supplier** | button | Opens *Add supplier*: *Name*, *Mobile*, *GSTIN*, **Cancel**, **Save** |
| *Supplier bill no* | text | The supplier's invoice number (used as the stock-move reference) |
| *Bill date* | date | Date on the supplier's bill (default today) |
| *Scan or search item* | text (auto-focus) | Type a name or scan a barcode (ours or the brand's); **Enter** adds the first match; clicking a result adds it. Message "No item found…" if nothing matches |
| Line: *Qty* | number | Pieces received (adding the same item again adds 1) |
| Line: *Cost ₹* | number | Cost per piece (starts from the item's last cost) |
| Line **✕** | button | Removes the line |
| Totals box | display | Lines, Pieces, **Cost value** |
| **Save stock in** | button | Saves (disabled when no pieces) |
| *Recent purchases* | list | Last 5: supplier · bill no, date · pieces; **Stickers** button (message only) |

## 3. Flows

**Add a supplier** → *+ Supplier* → Save → `stock.addSupplier(...)` → `suppliers` row + audit → the new supplier is selected.

**Receive stock** → scan/search (`stock.search`) → items appear with their current stock → set quantities and costs → **Save stock in** → `stock.in(...)`: validates, then in one transaction writes `purchases`, `purchase_lines`, updates `variants.cost` for each line, adds a `stock_moves` row (type `purchase`, ref = bill no or "purchase") per line, and logs `stock_in`. The form clears and shows "Saved: N pieces added to stock."; Recent purchases refresh.

## 4. APIs

- **Same supplier bill twice:** `stock:in` refuses a bill number already entered for the same supplier with `Duplicate purchase: supplier bill … was already entered for this supplier.` The screen asks "Save it again anyway?" and, on yes, sends `allowDuplicate:true`.

IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`.

### `window.api.stock.search(q)` · channel `stock:search`
- **Called from:** the scan box here, also Stock out. **Roles:** no check (Known issue K-02).
- **Request:** `{ "q":"slim" }` · **Response:** up to 12 matches (an exact barcode/brand barcode returns only that item):
```json
[{ "id":"9b1e…","label":"Slim Shirt · Blue · M","barcode":"2000000000015","salePrice":149900,"cost":78000,"stock":9 }]
```
- **Tables read:** `variants, products, categories, v_stock` (active, non-service products only).

### `window.api.stock.suppliers()` · `stock:suppliers`
- **Roles:** no check · **Response:** `[{ "id":"…","name":"Shree Textiles","mobile":"9824011122","gstin":"24BBBBB2222B1Z1" }]` sorted by name · **Tables read:** `suppliers`.

### `window.api.stock.addSupplier(input)` · `stock:addSupplier`
- **Called from:** Add supplier → Save · **Roles:** owner, manager, store.
- **Request:** `{ "name":"Om Accessories","mobile":"9909033344","gstin":"24ccccc3333c1z2" }`

| Field | Type | Required | Validation |
|---|---|---|---|
| name | string | yes | not blank |
| mobile | string | no | stored trimmed |
| gstin | string | no | upper-cased; if given: exactly 15 letters/digits |

- **Response:** `{ "id":"…","name":"Om Accessories","mobile":"9909033344","gstin":"24CCCCC3333C1Z2" }`
- **Errors:** `Enter the supplier name.` · `GSTIN must be 15 letters and numbers.` · role error. **Tables written:** `suppliers`, `audit_log` (`supplier_create`).

### `window.api.stock.in(input)` · `stock:in`
- **Called from:** **Save stock in** · **Roles:** owner, manager, store.
- **Request:**
```json
{ "supplierId":"b21f…","billNo":"ST/2190","billDate":"2026-11-12",
  "lines":[{ "variantId":"9b1e…","qty":6,"cost":80000 },{ "variantId":"c04a…","qty":6,"cost":80000 }] }
```

| Field | Type | Required | Validation |
|---|---|---|---|
| supplierId | string or null | yes | existing supplier, or null |
| billNo | string | no | trimmed; blank → reference "purchase" |
| billDate | string | no | stored as given (YYYY-MM-DD) |
| lines[] | array | yes | at least one |
| lines[].variantId | string | yes | an existing item (archived allowed) |
| lines[].qty | integer | yes | whole number > 0 |
| lines[].cost | paise | yes | ≥ 0 |

- **Response:** `{ "purchaseId":"7a30…","qty":12 }`

| When | Message |
|---|---|
| no lines | `Add at least one item.` |
| qty not whole > 0 | `Quantities must be whole numbers above zero.` |
| negative cost | `Cost cannot be negative.` |
| item gone | `An item on this list no longer exists.` |
| supplier gone | `Supplier not found.` |
| cashier | `You are not allowed to do this.` |

- **Tables written:** `purchases`, `purchase_lines`, `variants` (`cost`), `stock_moves` (type `purchase`), `audit_log` (`stock_in`). **Side effects:** none (no printing yet).
- **Steps:** validate every line → one transaction: purchase header (total = Σ qty × cost) → for each line: purchase line, update cost, stock move → audit. A bad line anywhere = **nothing saved**.
- **Example:** supplier Shree Textiles, bill ST/2190, 6 × ₹800 + 6 × ₹800 → 12 pieces, total ₹9,600 (`960000` paise); stock +6 on each item; each item's cost becomes `80000`.

### `window.api.stock.recent()` · `stock:recent`
- **Roles:** no check · **Response:** `[{ "id":"7a30…","supplier":"Shree Textiles","billNo":"ST/2190","at":"2026-11-12T11:30:00.000Z","qty":12,"total":960000 }]` (last 5, newest first; supplier/billNo can be `null`).
- **Query:** `SELECT p.id,s.name AS supplier,p.bill_no AS billNo,p.at,p.total,(SELECT COALESCE(SUM(qty),0) FROM purchase_lines WHERE purchase_id=p.id) AS qty FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.at DESC, p.rowid DESC LIMIT ?`

## 5. Database

Read: `variants, products, categories, v_stock, suppliers, purchases, purchase_lines`. Written: `suppliers, purchases, purchase_lines, variants.cost, stock_moves, audit_log`.
```sql
INSERT INTO purchases (id,supplier_id,bill_no,bill_date,total,staff_id,at) VALUES (?,?,?,?,?,?,?);
INSERT INTO purchase_lines (purchase_id,variant_id,qty,cost) VALUES (?,?,?,?);
UPDATE variants SET cost=? WHERE id=?;
INSERT INTO stock_moves (variant_id,qty,type,ref,reason,staff_id,at) VALUES (?,?, 'purchase', <bill no or 'purchase'>, NULL, ?, ?);
```

## 6. Business rules

- Stock goes up **only** through a `stock_moves` row (type `purchase`); history keeps the supplier bill number as the reference.
- **Cost is replaced** by the latest purchase cost on each item (no average cost yet).
- All-or-nothing: one bad line saves nothing.
- Quantities are whole pieces; money is paise (screen takes rupees).
- The same item added twice in the screen is one line with a higher quantity.
- Archived items can still be received; they stay hidden from search until restored (search lists active products only).
- No duplicate-bill-number check (the same supplier bill number can be entered twice).
- Printing stickers after receiving comes with the Stickers module.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| stock in › adds stock, updates cost and records history | Store staff receives 6 pieces: stock 5 → 11, history shows `purchase +6` with ref "ST/1", cost becomes ₹800 | pass | 2026-11-13 |
| stock in › lists recent purchases with supplier, bill number, pieces and value, newest first | Two purchases listed newest first with supplier "Om Accessories" / none, bill no, 4 and 2 pcs, totals ₹2,000 and ₹1,200; GSTIN stored upper-case | pass | 2026-11-13 |
| stock in › refuses a bad supplier GSTIN or an empty name | "GSTIN must be 15 letters…" and "Enter the supplier name." | pass | 2026-11-13 |
| stock in › rejects bad quantities and cashiers, and is all-or-nothing | qty 0 refused; a list with one unknown item saves nothing (stock stays 8); cashier "not allowed" | pass | 2026-11-13 |
| stock in › flags low stock | Items at or below the minimum (2) are listed (two of four) | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | First version: supplier, scan/search, lines, save, recent purchases | n/a (no git) |
| 2026-11-12 | Matched the design: + New product, Add supplier dialog with mobile and GSTIN, first supplier preselected, Stickers button | n/a |
| 2026-11-12 | Scan box looks up again on Enter (fast scanners no longer race the live search) | n/a |
| 2026-11-12 | Recent purchases ordered by time then insertion (ties) | n/a |
| 2026-11-16 | Saving the same supplier bill number again asks first ("Duplicate purchase") | uncommitted |
