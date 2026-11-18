# Stock

## 1. Summary

- **What it does:** shows how many pieces of every item are in the shop and why that number changed. Four things: **Stock levels** (search, low-stock filter, value at cost), an item's **History**, **Adjust** (fix one item: damaged, lost, found, correction) and **Stock count** (scan the whole shelf, compare with the system, approve the differences). A fourth tab lists **Recent moves**.
- **Screen:** `Stock` (`src/renderer/screens/Stock.tsx`) with three tabs and dialogs (History, Adjust stock, Discard count, Manager approval).
- **Who can use it:** Owner, Manager, Store staff. Store staff need a **manager/owner PIN** to adjust stock and to approve a count.
- **Status:** **done** (2026-11-12).
- **Code:** screen `src/renderer/screens/Stock.tsx` (+ `Billing.tsx` exports `ApprovalModal`) · service `src/main/services/stock.ts` (`stockLevels`, `stockHistory`, `adjustStock`, `startCount`, `getOpenCount`, `countScan`, `countSet`, `discardCount`, `approveCount`, `recentMoves`, `addMove`, `stockOf`) · `approval.ts` · shapes `src/shared/catalogue.ts`, `src/shared/stockops.ts` · tests `services.test.ts` (low stock), `stockops.test.ts`.

**Core idea:** stock is **never stored as a number**. It is the sum of `stock_moves.qty` (view `v_stock`). Every change (opening, purchase, sale, stock out, adjust, count, later returns) is one row, so the History tab can always explain the number.

- **Serial numbers (2026-11-18):** Items with **serial numbers**: adjust and stock count work piece by piece, and a piece's history can be looked up: see [Serial numbers](../serials/serials.md).
## 2. Screen controls

**Tabs:** Stock levels · Stock count · Recent moves.

| Control | Where | What it does |
|---|---|---|
| *Search* | Levels | Filters by product name, brand, colour, size or barcode |
| **Low stock only** | Levels | Shows items at or below their minimum (default 2). Zero/low shows in a red/amber chip |
| Table: Item, Barcode, In stock, Min, Value at cost | Levels | Value = max(0, stock) × cost |
| **History** | Levels row | Opens the item's last 100 moves: When, Type, Qty, Ref / reason, By |
| **Adjust** | Levels row | Opens *Adjust stock*: *Change (+ or −)* (default −1), *Reason* (Damaged, Lost, Found, Correction), **Cancel**, **Save adjustment**. Store staff then get the Manager approval dialog |
| **Start stock count** | Count (no open count) | Takes a snapshot of every active item's system stock |
| *Scan each piece on the shelf* | Count | Each scan adds 1 to that item (ours or brand barcode); Enter to scan |
| Counted box | Count row | Type the real count; saved when you leave the box |
| Difference chip | Count row | `counted − system` (red = missing, amber = extra) |
| **Discard count** | Count | Asks first (**Keep counting** / **Discard**); stock is not changed |
| **Approve N adjustments** | Count | Posts the differences. Store staff first get Manager approval |
| Recent moves table | Moves tab | Last 60 moves of all items: When, Item, Type, Qty, Ref, By |

## 3. Flows

**View levels** → `stock.levels(q, lowOnly)` → reads `variants, products, categories, v_stock` (active, non-service items only).

**See history** → `stock.history(variantId)` → reads `stock_moves` joined to `staff`.

**Adjust one item** → Adjust → type change and reason → Save → (store staff: approval dialog) → `stock.adjust(...)` → checks the result would not be below zero → `stock_moves` row (type `adjust`, reason) + audit → the table reloads and says "Stock adjusted. <item> is now N."

**Count the shelf** → Start stock count (`count.start`: `stock_counts` row `open` + one `stock_count_lines` row per active item with `system_qty` = stock now, `counted_qty` = 0) → scan each piece (`count.scan`: counted +1) or type a number (`count.set`) → **Approve** (`count.approve`): for each line where counted ≠ system a `stock_moves` row of type `count` with qty = counted − system; the count becomes `approved` (with `approved_by`) → "Count approved: N items adjusted." → or **Discard** (`count.discard`) → status `discarded`, no stock change.

**Items never scanned count as 0** when approved (the screen warns). Only one count can be open at a time.

## 4. APIs

IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`. Approval = `{ "staffId":"9c21…","pin":"2222" }` of a named owner/manager.

### `window.api.stock.levels(q, lowOnly)` · `stock:levels`
- **Called from:** Stock levels. **Roles:** no check (K-02). **Request:** `{ "q":"slim","lowOnly":false }`
- **Response:** `[{ "variantId":"9b1e…","label":"Slim Shirt · Blue · M","barcode":"2000000000015","qty":9,"minStock":2,"costValue":702000 }]`
- **Query:** `SELECT v.id AS variantId,p.name,v.colour,v.size,v.barcode,COALESCE(s.qty,0) AS qty,v.min_stock AS minStock,v.cost FROM variants v JOIN products p … LEFT JOIN v_stock s … WHERE p.active=1 AND c.is_service=0 AND (@q='' OR p.name LIKE @like OR p.brand LIKE @like OR v.colour LIKE @like OR v.size LIKE @like OR v.barcode LIKE @like) AND (@low=0 OR COALESCE(s.qty,0)<=v.min_stock) ORDER BY p.name, v.rowid`
- **Example:** 9 pieces × cost ₹780 = `702000` paise value.

### `window.api.stock.history(variantId)` · `stock:history`
- **Roles:** no check. **Request:** `{ "variantId":"9b1e…" }` · **Response:** `[{ "at":"2026-11-12T10:41:09.512Z","type":"sale","qty":-1,"ref":"C1/2026-27/0003","reason":null,"staff":"Cashier" }]` newest first, 100 max · **Tables read:** `stock_moves, staff`.

### `window.api.stock.adjust(input)` · `stock:adjust`
- **Called from:** Adjust stock → Save adjustment. **Roles:** owner, manager, store (store needs approval).
- **Request:** `{ "variantId":"9b1e…","change":-2,"reason":"damaged","approval":{ "staffId":"3b6f…","pin":"1111" } }`

| Field | Type | Required | Validation |
|---|---|---|---|
| variantId | string | yes | existing item |
| change | integer | yes | whole number, not 0 |
| reason | `damaged` \| `lost` \| `found` \| `correction` | yes | one of these |
| approval | object | store staff | active owner/manager + PIN |

- **Response:** `{ "stock":3 }` (new stock)

| When | Message |
|---|---|
| change 0 or not whole | `Enter a change other than 0.` |
| reason invalid | `Choose a reason.` |
| item missing | `Item not found.` |
| result below zero | `Stock cannot go below zero (now 3).` |
| store staff without approval | `A manager or owner must approve this.` |
| wrong approver PIN | `That PIN is not correct for the chosen manager or owner (3 tries left).` |
| 5th wrong PIN, or that approver is locked | `Too many wrong approval PINs. Approvals by this person are locked for 60 seconds.` / `…Try again in 45 seconds.` |
| cashier | `You are not allowed to do this.` |

- **Tables written:** `stock_moves` (type `adjust`, ref "adjust", reason), `audit_log` (`stock_adjust`, with who approved).
- **Example:** 5 on the shelf, 2 damaged → `change:-2, reason:"damaged"` → stock 3.

### `window.api.stock.moves()` · `stock:moves`
- **Roles:** owner, manager, store · **Response:** last 60: `[{ "at":"…","label":"Slim Shirt · Blue · M","type":"adjust","qty":-1,"ref":"adjust","reason":"lost","staff":"Owner" }]`.

### `window.api.count.get()` · `count:get` — **Roles:** owner, manager, store
- **Response:** `null` (no open count) or `{ "id":"…","at":"…","lines":[{ "variantId":"…","label":"Linen Shirt · Beige · M","barcode":"2000000000046","system":1,"counted":0 }, …] }` listed by product name.

### `window.api.count.start()` · `count:start` — **Roles:** owner, manager, store
- **Response:** the count (as `get`). **Error:** `A stock count is already open.` **Tables written:** `stock_counts`, `stock_count_lines`, `audit_log` (`count_start`).

### `window.api.count.scan(code)` · `count:scan` — **Roles:** owner, manager, store
- **Request:** `{ "code":"2000000000015" }` · **Response:** `{ "variantId":"9b1e…","label":"Slim Shirt · Blue · M","counted":4 }`
- **Errors:** `Start a stock count first.` · `No item with barcode 0000000000000 in this count.` · **Tables written:** `stock_count_lines.counted_qty + 1`.

### `window.api.count.set(variantId, counted)` · `count:set`
- **Roles:** owner, manager, store · **Request:** `{ "variantId":"…","counted":4 }` · **Response:** `null`.
- **Errors:** `Start a stock count first.` · `Enter a whole number, 0 or more.`

### `window.api.count.discard()` · `count:discard`
- **Response:** `null` · **Errors:** `There is no open count.` · **Tables written:** `stock_counts.status='discarded'`, `audit_log` (`count_discard`).

### `window.api.count.approve(approval?)` · `count:approve`
- **Called from:** Approve N adjustments. **Roles:** owner, manager directly; **store staff need an approval**.
- **Request:** `{ "approval":{ "staffId":"9c21…","pin":"2222" } }` (omit for owner/manager)
- **Response:** `{ "adjusted":3 }`
- **Errors:** `There is no open count.` · `A manager or owner must approve this.` · `That PIN is not correct for the chosen manager or owner (3 tries left).` · `Too many wrong approval PINs. …` (lockout, see [Login and roles](../login-and-roles/login-and-roles.md))
- **Tables written:** `stock_moves` (type `count`, qty = counted − system, ref "stock count"), `stock_counts` (`status='approved'`, `approved_by`), `audit_log` (`count_approve`) in one transaction.
- **Example:** system 5, counted 4 → move −1; system 3, counted 4 → +1; one item never scanned (system 1) → −1: **3 adjustments**.

## 5. Database

Read: `variants, products, categories, v_stock, stock_moves, staff, stock_counts, stock_count_lines`. Written: `stock_moves, stock_counts, stock_count_lines, audit_log`.
```sql
-- stock of one item
SELECT COALESCE(SUM(qty),0) FROM stock_moves WHERE variant_id=?;
-- start a count
INSERT INTO stock_counts (id,status,by_staff,at) VALUES (?,'open',?,?);
INSERT INTO stock_count_lines (count_id,variant_id,system_qty,counted_qty)
  SELECT ?,v.id,COALESCE(s.qty,0),0 FROM variants v JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id
  LEFT JOIN v_stock s ON s.variant_id=v.id WHERE p.active=1 AND c.is_service=0;
-- scan
UPDATE stock_count_lines SET counted_qty=counted_qty+1 WHERE count_id=? AND variant_id=?;
-- approve
INSERT INTO stock_moves (variant_id,qty,type,ref,reason,staff_id,at) VALUES (?, counted-system, 'count','stock count',NULL,?,?);
UPDATE stock_counts SET status='approved',approved_by=? WHERE id=?;
```

## 6. Business rules

- **Stock = sum of moves.** Move types: `opening, purchase, sale, sale_return, cancel, supplier_return, damage, dispatch, other_out, adjust, count`.
- **Adjust never makes stock negative** (use Stock out with approval, or a count). Store staff adjustments always need a manager/owner PIN.
- **Count approval:** adjustment = `counted − system snapshot`. Items not scanned count as 0. Store staff can count but need a manager/owner to approve.
- **Snapshot caveat (K-08):** sales made while a count is open are not accounted for. Count when the shop is closed.
- **Low stock:** stock ≤ item's `min_stock` (default 2); red chip at ≤ 0, amber above.
- **Value at cost:** `max(0, stock) × cost` (cost = last purchase cost).
- Only **active, non-service** items appear in levels and counts.
- One open count at a time; a discarded count changes nothing.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| stock in › flags low stock | Levels with "low only" returns the two zero-stock items (min 2) | pass | 2026-11-13 |
| adjusting one item › lets owner and manager adjust, and logs the reason | −2 damaged → 3; +1 found → 4; history top row `adjust +1 found` | pass | 2026-11-13 |
| adjusting one item › makes store staff get a manager approval, and never lets stock go below zero | Store: "must approve"; with owner PIN 1111 → 4; −9 → "below zero"; 0 / bad reason refused; cashier refused | pass | 2026-11-13 |
| stock count › counts the shelf and posts the differences once approved | Snapshot Linen 1, M 5, L 3; scans/sets; wrong barcode refused; store staff cannot approve alone; with manager PIN → 3 adjustments; M 4, L 4, Linen 0; history `count −1` | pass | 2026-11-13 |
| stock count › lets a manager approve directly, and a count can be discarded without changing stock | Discard leaves stock 5; second discard "no open count"; approving an unscanned count zeroes every item | pass | 2026-11-13 |
| stock count › is for owner, manager and store staff only | Cashier "not allowed" | pass | 2026-11-13 |
| recent moves and approvers › lists the latest moves with item names and who did them | Newest move first: label "Slim Shirt · Blue · M", type adjust, −1, staff "Owner" | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Stock levels, low-stock filter, history | n/a (no git) |
| 2026-11-12 | Adjust with approval, stock count (start, scan, set, approve, discard), recent moves tab | n/a |
| 2026-11-12 | Screen matches the prototype tabs; History and Adjust open dialogs | n/a |
| 2026-11-13 | Adjust and count approval protected by the approver lockout (K-01 fixed); tests "stock adjust by store staff" and "stock count approval by store staff" in `approval.test.ts` | n/a |
