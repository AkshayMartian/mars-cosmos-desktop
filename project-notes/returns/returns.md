# Returns and exchange

> **Status: pending.** Not started. Planned scope below; complete the module template when building.

## 1. Summary (planned)

- **What it will do:** find the customer's bill (by bill number or mobile), pick the items coming back and the quantity, optionally scan **new items** (exchange), then settle: the customer pays the difference, or gets a **credit note** or a **cash refund**.
- **Screen:** `Return / exchange` (menu item exists, hidden). Design reference: the approved prototype.
- **Who can use it:** Owner, Manager, Cashier. A bill older than the return window needs a manager's approval.
- **Code (to create):** `src/renderer/screens/Returns.tsx`, `services/returns.ts`, tests.

## 2. What already exists for it

- Tables: `bills` (`type='return'`, `orig_bill_id`), `bill_lines` (`returned_qty`), `payments` (`credit_note` mode, negative amounts for refunds), `credit_notes` (`amount`, `balance`, `expires_at`), `stock_moves` (type `sale_return`), `settings.receipt` (`returnDays` = 7, `creditNoteDays` = 90).
- Day end already treats **negative cash payments as refunds** out of the drawer (tested).

## 3. Planned rules

- Return value per piece = what the customer actually paid for it (`bill_lines.total / qty`), including its share of discounts.
- Return bill is a new `bills` row (`type='return'`, negative totals and GST), never an edit of the original; stock goes back with `sale_return` moves.
- Window: `settings.receipt.returnDays` (7); older bills need approval.
- A credit note is valid `creditNoteDays` (90); **expiry must be enforced when it is used** (the prototype did not: review item).
- Exchange: new items follow the normal billing rules (**no item without stock**).
- Cash refund comes out of the open day's drawer (a negative cash payment).

## 4. Open questions

- GST treatment of a return/credit note on the invoice (CA).
- Partial refunds to UPI/card: record as cash refund or reverse the original mode?

## 5. Done when

Service + screen + tests (return restores stock, credit note balance, cash refund appears in Day end, window and approval, double-return protection via `returned_qty`), README status **done**, this page completed.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
