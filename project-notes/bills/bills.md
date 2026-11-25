# Bills

## 1. Summary

- **What it does:** lists every bill (sales, returns, cancelled ones), searchable by bill number, customer mobile or name, for Today / Last 7 days / All (latest 80). Click a bill to see its items, payments and who billed. From there: **Reprint** (duplicate receipt), **Send on WhatsApp**, and **Cancel bill** (today's bills only).
- **Screens:** `Bills` (`src/renderer/screens/Bills.tsx`) with dialogs: duplicate receipt, cancel (reason), manager approval.
- **Who can use it:** Owner, Manager, Cashier. Cancelling needs the `can_cancel` permission (owner and manager have it by default) or a manager's approval PIN.
- **Status:** **done** (2026-11-13). The reprint prints to the receipt printer (**Print** in the duplicate receipt).
- **Code:** screen `src/renderer/screens/Bills.tsx` · service `src/main/services/bills.ts` (+ `getBill` in `billing.ts`) · shapes `src/shared/bills.ts` · receipt `src/shared/receipt.ts` · tests `src/main/services/bills.test.ts`.

- **Serial numbers (2026-11-18):** Cancelling a bill puts every **serial-numbered piece** of it back in stock: see [Serial numbers](../serials/serials.md).
## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| *Bill number, mobile or name* | text (auto-focus) | Filters the list as you type |
| *Period* | dropdown | Today / Last 7 days / All |
| Bill row | click | Opens the bill on the right (status chip: Paid, Cancelled, Return) |
| **Reprint** | button | Shows the receipt marked "DUPLICATE" |
| **Send on WhatsApp** | button | Opens WhatsApp with the bill text; disabled without a customer mobile and for return bills |
| **Cancel bill** | button (only when allowed) | Opens the reason dialog |
| Cancel dialog | dialog | *Reason* (required), **Keep**, **Cancel bill**; asks for a manager's PIN when the user may not cancel alone |
| Hint under the buttons | text | Says why a bill cannot be cancelled (old day, items already returned, exchange sale) |

## 3. Flows

**Open the list / filter** → `window.api.bills.list(period, q)` → `bills:list` → `listBills` → reads `bills`, `customers`, `payments`.

**Open a bill** → `window.api.bills.detail(id)` → `bills:detail` → `billDetail` → reads `bills`, `bill_lines`, `payments`, `staff`.

**Cancel** → reason typed → approval PIN if needed → `window.api.bills.cancel(input)` → `bills:cancel` → `cancelBill` → writes `bills`, `stock_moves`, `credit_notes`, `audit_log`.

## 4. APIs

### `window.api.bills.list(period, q)` · channel `bills:list`

- **Called from:** Bills screen · **Allowed roles:** owner, manager, cashier
- **Request:** `period` = `'today' | '7' | 'all'`; `q` text (bill number part, mobile part or name part, may be empty).
- **Response:** `[{ id, no, type:'sale'|'return', status:'completed'|'cancelled', at, customerName|null, grand, modes:['cash','upi'] }]` newest first, max 80.
- **Errors:** "Unknown period." · not logged in / role not allowed.
- **Tables read:** `bills`, `customers`, `payments`.

### `window.api.bills.detail(id)` · channel `bills:detail`

- **Called from:** Bills screen, clicking a row · **Allowed roles:** owner, manager, cashier
- **Response:** `{ bill: BillDto, cancelReason|null, cancelledBy|null, cancellable, cancelHint|null, needsApproval }`
- **Errors:** "Bill not found."
- **Tables read:** `bills`, `bill_lines`, `payments`, `customers`, `staff`, `day_sessions`.

### `window.api.bills.cancel(input)` · channel `bills:cancel`

- **Called from:** Bills screen, *Cancel bill* · **Allowed roles:** owner, manager, cashier (cashier needs approval unless granted `can_cancel`)
- **Request:**

| field | type | required | validation |
|---|---|---|---|
| billId | string | yes | a completed sale bill of today's open day |
| reason | string | yes | not empty |
| approval | `{staffId, pin}` | when the user may not cancel alone | active owner or manager with the right PIN (5 wrong PINs lock that approver) |

- **Response:** the updated `BillDetail`.
- **Errors:** "Type a reason for cancelling." · "Only bills of today's open day can be cancelled. Use Return / exchange for older bills." · "This bill is already cancelled." · "A return bill cannot be cancelled." · "Some items of this bill were already returned…" · "This bill is the new-items side of an exchange…" · "A manager or owner must approve this." / "That PIN is not correct…"
- **Side effects:** audit action `bill_cancel` (bill, reason, approver, credit note restored).
- **Steps inside:** refusal checks → approval check (before the transaction) → `bills.status='cancelled'`, reason, approver → `cancel` stock moves (+qty for every line) → credit notes used as payment get their balance back.
- **Example:** cashier cancels `C1/2026-27/0003` with the manager's PIN: stock +1, bill listed as Cancelled, Day end expected cash drops by the cash taken.

## 5. Database

- `bills` (`status`, `cancel_reason`, `cancelled_by`), `stock_moves` (type `cancel`), `credit_notes.balance`, `payments`, `day_sessions` (open session decides what is "today's"). A bill row is never deleted.
- List query: `bills LEFT JOIN customers` with `at >= start of today / 7 days ago`, `no/mobile/name LIKE %q%`, `ORDER BY at DESC LIMIT 80`.

## 6. Business rules

- Only **sale** bills of the **currently open day** can be cancelled; older bills go through Return / exchange.
- Not cancellable when any item was already returned, or when the bill is the sale side of an exchange (it was paid with returned goods).
- A cancelled bill disappears from Day end cash, "My sales today", customer totals and (later) reports, because they count only completed bills. Its number is kept (gap-free numbering).
- A credit note used as payment gets its balance back (it may already be past its expiry; the shop decides).
- **Alterations:** jobs of the bill that are still *received* are cancelled with it; once a job is with the tailor, ready or delivered the bill cannot be cancelled. The alteration charge line is a service, so cancelling puts no stock back for it.
- Cancelling gives back the coins the bill used and takes back the coins it earned (see Coins).

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| List order and filters (number, mobile, name, period) | newest first, filters work | pass | 2026-11-13 |
| Payment modes and customer shown | cash + upi, name | pass | 2026-11-13 |
| Store staff | refused | pass | 2026-11-13 |
| Cancel needs reason | refused with message | pass | 2026-11-13 |
| Cancel restores stock, cash, sales chip | stock +1, drawer and chip drop, listed Cancelled | pass | 2026-11-13 |
| Cashier approval | refused, wrong PIN refused, right PIN recorded | pass | 2026-11-13 |
| Old day's bill | refused, points to Return / exchange | pass | 2026-11-13 |
| Returned bill / return bill | refused | pass | 2026-11-13 |
| Credit note used as payment | balance restored | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
| 2026-11-13 | Bills list, detail, reprint, WhatsApp, cancel; tests | uncommitted |
| 2026-11-16 | Cancelling gives back the coins used and takes back the coins earned (see [Coins](../coins/coins.md)) | uncommitted |
| 2026-11-17 | Cancel rule tightened: a cashier always needs a manager or owner PIN (the old "can cancel" flag no longer skips it; the checkbox is gone from Settings → Staff); a reason is required; stock and coins come back; the bill stays Cancelled and its number is never reused (tests added) | uncommitted |
