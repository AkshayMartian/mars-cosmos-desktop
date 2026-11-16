# Returns and exchange

## 1. Summary

- **What it does:** a customer brings goods back. Staff find the bill (bill number, last digits of it, or the customer's mobile), choose which items and how many come back, optionally add **new items** (exchange), and settle: the customer pays the difference, or is owed money back as a **credit note** or **cash from the drawer**. Credit notes can then be used as part payment on Billing.
- **Screens:** `Return / exchange` (`src/renderer/screens/Returns.tsx`), plus a *Credit note* row in Billing's payment dialog (`src/renderer/screens/Billing.tsx`).
- **Who can use it:** Owner, Manager, Cashier. A bill older than the return window needs a manager's PIN unless the user is a manager or owner.
- **Status:** **done** (2026-11-13). Receipts print from the done dialog. Not included: coins on returns (coins module not built), cancelling a bill, a Bills list screen.
- **Code:** screen `src/renderer/screens/Returns.tsx` · service `src/main/services/returns.ts` (+ `createBill` in `billing.ts`, which now accepts credit notes and an exchange settle hook) · shapes and the split rule `src/shared/returns.ts` · receipt wording `src/shared/receipt.ts` · tests `src/main/services/returns.test.ts`.

## 2. Screen controls

| Control | Type | What it does |
|---|---|---|
| *Bill number or customer mobile* | text (auto-focus) | Enter or **Find bills** looks up sale bills (max 10, newest first) |
| **Choose** | button | Opens that bill for return |
| **Other bill** | button | Back to the search |
| *Return qty* | number per line | How many pieces come back (capped at what is still returnable; "All returned" when none) |
| Old-bill banner | display | Shown when the bill is older than the return window; says approval will be asked when the user is not a manager |
| *New items (exchange)* | search box | Scan or search; **Enter** adds when exactly one match. Out of stock items are refused |
| New item **− / +**, **✕** | buttons | Quantity (never above stock) and remove |
| *Customer pays by* | dropdown | Cash / UPI / Card, shown when the new items cost more than the return |
| **Credit note / Refund cash** | radio cards | Shown when the customer is owed money. Credit note is disabled on a walk-in bill |
| **Complete return / exchange** | button | Saves everything; disabled until something is chosen and the day is started |
| Manager approval dialog | dialog | *Approved by* + *Their PIN* (same dialog as Billing) |
| Done dialog | dialog | Return receipt (and exchange receipt) text, what was issued or paid |
| Billing → *Credit note* row | number + **Full** | Appears when the customer has usable credit notes; spends the notes that expire first |

## 3. Flows

**Find a bill** → `window.api.returns.find(q)` → `returns:find` → `findBillsForReturn` → reads `bills`, `customers`.

**Open a bill** → `window.api.returns.bill(id)` → `returns:bill` → `getBillForReturn` → reads `bills`, `bill_lines`, `customers`, `settings.receipt`.

**Complete** → validates the screen's choice against the database → manager approval if the bill is outside the window → one transaction: return bill, lines, stock back, `returned_qty` raised, optional exchange sale bill, payments, credit note → `window.api.returns.do(input)` → `returns:do` → `doReturn` → writes `bills`, `bill_lines`, `stock_moves`, `payments`, `credit_notes`, `bill_counters`, `audit_log`.

**Use a credit note at the till** → Billing sends `creditNotes: [{id, amount}]` with the bill → `createBill` checks owner, balance and expiry → `payments` (`credit_note` + `credit_note_id`), `credit_notes.balance` lowered. The list shown on the screen comes from `window.api.returns.creditNotes(customerId)` → `returns:creditNotes` → `usableCreditNotes`.

## 4. APIs

### `window.api.returns.find(q)` · channel `returns:find`

- **Called from:** Return / exchange, *Find bills* · **Allowed roles:** owner, manager, cashier
- **Request:** `q` string: a full bill number (`C1/2026-27/0012`), its last digits (`0012`), or a 10-digit mobile.
- **Response:** `[{ id, no, at, customerName|null, grand }]` (max 10; only completed **sale** bills).
- **Errors:** not logged in / role not allowed.
- **Tables read:** `bills`, `customers`.

### `window.api.returns.bill(id)` · channel `returns:bill`

- **Called from:** Return / exchange, *Choose* · **Allowed roles:** owner, manager, cashier
- **Response:** `{ id, no, at, ageDays, windowDays, overWindow, needsApproval, customerId, customerName, grand, lines:[{ id, variantId, name, colour, size, qty, returned, returnable, total }] }`
- **Errors:** "Bill not found." · "Only a completed sale bill can be returned."
- **Tables read:** `bills`, `bill_lines`, `customers`; setting `receipt.returnDays` (default 7).

### `window.api.returns.do(input)` · channel `returns:do`

- **Called from:** Return / exchange, *Complete* · **Allowed roles:** owner, manager, cashier
- **Request:**

| field | type | required | validation |
|---|---|---|---|
| billId | string | yes | a completed sale bill |
| lines | `{lineId, qty}[]` | yes | at least one with qty > 0; qty whole and ≤ pieces still returnable |
| newLines | `{variantId, qty}[]` | yes (may be empty) | normal billing rules: in stock, whole quantities |
| settle | `'credit_note' \| 'cash'` | yes | used only when the customer is owed money; credit note needs a customer on the bill |
| payMode | `'cash' \| 'upi' \| 'card'` | yes | used only when the customer owes the difference |
| approval | `{staffId, pin}` | when bill is outside the window and the user is not a manager | an active owner or manager with the right PIN (5 wrong PINs lock that approver, same as Billing) |

- **Response:** `{ returnBill: BillDto, saleBill: BillDto|null, creditNote: {amount, expiresAt}|null, cashRefund, customerPaid }`
- **Errors:** "Start the day first: enter the opening cash." · "Choose at least one item to return." · "Only n of … can still be returned." · "A manager or owner must approve this." / "That PIN is not correct…" · "… is out of stock." · "A credit note needs a customer on the bill. Refund in cash…" (everything is rolled back).
- **Side effects:** audit action `return` (who, bills, amounts, approver and bill age when approved). Receipts print from the done dialog.
- **Steps inside:** check day open → check bill and quantities → approval if needed (before the transaction so wrong PINs are counted) → compute each line's share → insert return bill (negative amounts, `orig_bill_id`) → lines, `returned_qty`, `sale_return` stock moves → if new items: `createBill` with a settle hook (returned value pays first, the rest by `payMode`) → payments on the return bill → credit note or negative cash payment for what is still owed.
- **Example:** shirt sold at ₹1,499, returned for a ₹899 polo, customer asks for a credit note → return bill `C1/2026-27/0002` grand −1,499; sale bill `…/0003` grand 899 paid by credit_note 899; credit note ₹600 valid 90 days.

### `window.api.returns.creditNotes(customerId)` · channel `returns:creditNotes`

- **Called from:** Billing, when a customer is on the bill · **Allowed roles:** owner, manager, cashier
- **Response:** `[{ id, balance, expiresAt }]` for notes with balance > 0 that have not expired, soonest expiry first.
- **Tables read:** `credit_notes`.

## 5. Database

- `bills` (`type='return'`, `orig_bill_id`, `sales_by` copied from the original so commission goes back), `bill_lines` (return lines: positive `qty`, **negative** `price/taxable/cgst/sgst/total`; `returned_qty` raised on the original line), `stock_moves` (`sale_return`, + qty, `ref` = return bill no), `payments` (`credit_note` with `credit_note_id`, or negative `cash`), `credit_notes` (`amount`, `balance`, `expires_at`), `bill_counters`.
- Key queries: lookup `WHERE type='sale' AND status='completed' AND (no = ? OR no LIKE '%/'||? OR customer mobile = ?)`; usable notes `WHERE customer_id=? AND balance>0 AND expires_at>=now`.

## 6. Business rules

- **Value of a returned piece** = what the customer actually paid for it (line total, which already contains its share of discounts). Shares use cumulative rounding (`returnPart`), so returning a line over several visits always adds up to exactly the line total.
- Money back is **rounded to the whole rupee** like every bill; the difference is the return bill's `round_off`.
- **Never edited:** the original bill is untouched except `returned_qty`; the return is its own numbered bill (same gap-free series).
- **One rule for reports:** a return bill is `type='return'` with negative `grand`, `taxable`, `cgst`, `sgst`. Sales totals ("My sales today", customer *spent*) just sum `grand`; Day end subtracts negative cash.
- **Window:** `settings.receipt.returnDays` (7). Older bills need a manager or owner PIN unless the user is one.
- **Credit note** valid `settings.receipt.creditNoteDays` (90) and **expiry is enforced when it is used**; it can only be used on the same customer's bill.
- **Exchange:** new items follow normal billing rules (no stock, no sale). The returned value pays for them first; the customer pays any extra, or is owed any balance.
- **Cash refund** is a negative cash payment on the return bill in the open day, so Day end's expected cash drops. Walk-in bills can only be refunded in cash.
- The alteration charge line on a bill is a service and cannot be returned.
- Returned quantity can never exceed what was sold (double-return protection via `returned_qty`).

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| Find by number, last digits, mobile | same bill each way; unknown mobile finds none | pass | 2026-11-13 |
| Plain return | stock +1, return bill −₹1,499, credit note ₹1,499 | pass | 2026-11-13 |
| Return twice / too many | refused, `returnable` 0 | pass | 2026-11-13 |
| Cash refund | Day end cash out and expected drop | pass | 2026-11-13 |
| Walk-in credit note | refused and fully rolled back; cash works | pass | 2026-11-13 |
| Old bill as cashier | needs approval; wrong PIN refused; right PIN recorded in audit | pass | 2026-11-13 |
| Old bill as manager | no approval needed | pass | 2026-11-13 |
| Exchange, customer pays | sale bill paid by credit_note + UPI | pass | 2026-11-13 |
| Exchange, balance back | credit note for the difference | pass | 2026-11-13 |
| Exchange, no stock | refused; nothing saved | pass | 2026-11-13 |
| Credit note at till | part payment, balance lowered, over-balance refused | pass | 2026-11-13 |
| Expired / other customer's note | refused; expired not listed | pass | 2026-11-13 |
| Discounted bill / line splitting | refund equals what was paid; shares add up | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
| 2026-11-13 | Returns, exchange, credit notes (issue, use, expiry), screen, tests | uncommitted |
| 2026-11-16 | A return takes back the coins earned on the value returned (see [Coins](../coins/coins.md)) | uncommitted |
