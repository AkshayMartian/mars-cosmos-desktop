# Stock out

## 1. Summary

- **What it does:** takes stock out **without a bill**: return to a supplier, damaged, dispatch, or other. Every piece leaves through a document (a `stock_outs` row) with who, why and (when needed) who approved. Going **below zero** stock needs a manager/owner approval when store staff do it.
- **Screen:** `StockOut` (`src/renderer/screens/StockOut.tsx`) using the shared Manager approval dialog.
- **Who can use it:** Owner, Manager, Store staff.
- **Status:** **done** (2026-11-12). Not included: online-order pick lists, branch transfers, a printed challan (later modules).
- **Code:** screen `src/renderer/screens/StockOut.tsx`, `Billing.tsx` (exports `ApprovalModal`) · service `src/main/services/stock.ts` (`stockOut`) · `approval.ts` · shapes `src/shared/stockops.ts` · tests `src/main/services/stockops.test.ts`.

- **Serial numbers (2026-11-18):** Items with **serial numbers** go out by scanning the exact pieces: see [Serial numbers](../serials/serials.md).
## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| *Reason* | dropdown | Return to supplier · Damaged · Dispatch · Other |
| *Supplier* | dropdown | Only for "Return to supplier" (first supplier preselected) |
| *Note* | text | Optional; **required** for "Other" |
| *Scan or search item* | text (auto-focus) | Scan or type; **Enter** adds the first match; click a result to add (uses `stock.search`) |
| Line *Qty* | number | Pieces going out (adding the same item again adds 1) |
| Line **✕** | button | Removes the line |
| *In stock* column | display | Stock when the item was added |
| *Pieces going out* | display | Total pieces |
| **Save stock out** | button | Saves (disabled when no pieces). For store staff taking more than the stock it first opens **Manager approval** |
| Manager approval dialog | dialog | *Approved by* (owner/manager), *Their PIN*, **Cancel**, **Approve** |
| Hint line | text | "Stock goes down at once. Going below zero needs manager approval." |

## 3. Flows

**Take stock out** → choose the reason → scan items and quantities → **Save stock out** → (store staff and some line would go below zero → approval dialog → approver name + PIN) → `stock.out(...)` → one transaction: `stock_outs` header, one `stock_out_lines` row and one `stock_moves` row per item (negative qty, type from the reason), audit `stock_out`. The screen clears and says "N pieces taken out of stock."

If the approver's PIN is wrong the dialog stays open and shows `That PIN is not correct for the chosen manager or owner.`

## 4. APIs

(IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`. `stock.search`, `stock.suppliers`, `stock.approvers` are documented in [Stock in](../stock-in/stock-in.md) and [Login and roles](../login-and-roles/login-and-roles.md).)

### `window.api.stock.out(input)` · channel `stock:out`
- **Called from:** **Save stock out** · **Roles:** owner, manager, store. Below zero by store staff needs an approval; owner/manager need none.
- **Request:**
```json
{ "type":"supplier_return","supplierId":"b21f…","reason":"Wrong size",
  "lines":[{ "variantId":"9b1e…","qty":2 }],
  "approval":{ "staffId":"9c21…","pin":"2222" } }
```

| Field | Type | Required | Validation |
|---|---|---|---|
| type | `supplier_return` \| `damage` \| `dispatch` \| `other` | yes | one of these |
| supplierId | string or null | for supplier_return | existing supplier; ignored for other types |
| reason | string | for `other` | trimmed; stored (null when blank) |
| lines[] | array | yes | at least one; qty whole > 0; item must exist; the same item twice is added together |
| approval | `{staffId,pin}` | only if store staff go below zero | active owner/manager + their PIN |

- **Response:** `{ "id":"5c19…","qty":2 }`

| When | Message |
|---|---|
| type not one of the four | `Choose why the stock is going out.` |
| `other` with empty note | `Type a note for "Other".` |
| supplier return with no supplier | `Choose the supplier.` |
| supplier id unknown | `Supplier not found.` |
| no lines | `Add at least one item.` |
| qty not whole > 0 | `Quantities must be whole numbers above zero.` |
| item gone | `An item on this list no longer exists.` |
| store staff, below zero, no approval | `A manager or owner must approve this.` |
| wrong approver PIN (including a person who cannot approve, such as yourself as store staff) | `That PIN is not correct for the chosen manager or owner (3 tries left).` (no count for someone who cannot approve) |
| 5th wrong PIN, or that approver is locked | `Too many wrong approval PINs. Approvals by this person are locked for 60 seconds.` / `…Try again in 45 seconds.` (see [Login and roles](../login-and-roles/login-and-roles.md)) |
| cashier | `You are not allowed to do this.` |

- **Tables read:** `variants, suppliers, v_stock/stock_moves`. **Written:** `stock_outs`, `stock_out_lines`, `stock_moves`, `audit_log` (`stock_out`). **Side effects:** none (no printed challan yet).
- **Steps:** role → validate type/note/supplier/lines → merge duplicates → find whether any item would go below zero → approval check (store staff only) → transaction → return id and total pieces.
- **Example:** Store staff returns 2 × Linen Shirt (stock 1) to Shree Textiles, reason "Wrong size". 1 − 2 = −1 → approval needed → Manager picks "Manager", types `2222` → saved; stock −1; `stock_outs.approved_by` = the manager's id; move type `supplier_return`, qty −2, reason "Wrong size".

## 5. Database

Read: `variants, suppliers, stock_moves`. Written: `stock_outs, stock_out_lines, stock_moves, audit_log`.
```sql
INSERT INTO stock_outs (id,type,supplier_id,reason,staff_id,approved_by,at) VALUES (?,?,?,?,?,?,?);
INSERT INTO stock_out_lines (stock_out_id,variant_id,qty) VALUES (?,?,?);                 -- qty positive
INSERT INTO stock_moves (variant_id,qty,type,ref,reason,staff_id,at) VALUES (?, -qty, <supplier_return|damage|dispatch|other_out>, 'stock out', <note>, ?, ?);
```

## 6. Business rules

- Reason → move type: Return to supplier → `supplier_return`; Damaged → `damage`; Dispatch → `dispatch`; Other → `other_out`.
- **Approval rule:** only **store staff** need approval, and only when an item would go **below zero** (`current stock − quantity < 0`, after merging duplicate lines). Owner and manager never do.
- The approver is a named owner/manager with their own PIN; nobody can approve themselves unless they are owner/manager.
- A supplier is stored only for "Return to supplier".
- All-or-nothing: if any line is invalid nothing is saved.
- Stock can end **negative** here (with approval); *Stock → Adjust* never allows negative (see Stock).
- The note is mandatory only for "Other".

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| stock out › takes stock down for each reason and records who, why and what | Four stock-outs of 1 piece each take stock 5 → 1; history types `other_out, dispatch, damage, supplier_return`; the supplier return shows reason "Wrong size" and "Store staff" | pass | 2026-11-13 |
| stock out › checks the form: reason, supplier, note for "Other", quantities, items | Each missing/invalid input gives its own message; stock unchanged | pass | 2026-11-13 |
| stock out › needs approval for store staff to go below zero, but not owner or manager | Store staff blocked until manager PIN is right (cannot approve themselves); result stock −1; `approved_by` = manager; owner needs none | pass | 2026-11-13 |
| stock out › is all-or-nothing and blocked for cashiers | A list with one unknown item saves nothing; cashier "not allowed" | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Stock out screen and `stock.out` with approval for going below zero | n/a (no git) |
| 2026-11-12 | Shared approval dialog extracted from Billing and reused here | n/a |
| 2026-11-13 | Approval is now protected by the approver lockout (K-01 fixed); test "stock out below zero by store staff" in `approval.test.ts` | n/a |
