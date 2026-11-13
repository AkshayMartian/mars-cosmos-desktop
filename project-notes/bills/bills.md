# Bills

> **Status: pending.** Not started. This page records what is planned so the next task can start from it. Fill in the full module template ([`_module-template.md`](../_module-template.md)) when building.

## 1. Summary (planned)

- **What it will do:** list every bill (search by bill number, mobile or name; Today / Last 7 days / All), show one bill in detail (lines, payments, who billed), **reprint**, **send on WhatsApp**, and **cancel a bill** (today's bills only).
- **Screen:** `Bills` (menu item exists but hidden: `ENABLED` in `src/shared/types.ts`). Design reference: the approved prototype's *Bills* screen.
- **Who can use it:** Owner, Manager, Cashier. Cancelling needs the `can_cancel` permission (owner and manager have it) or a manager's approval.
- **Code (to create):** `src/renderer/screens/Bills.tsx`, `services/billing.ts` additions (`listBills`, `cancelBill`), tests.

## 2. What already exists for it

- Tables `bills`, `bill_lines`, `payments`, `stock_moves`, `audit_log`, and `getBill(id)` (`billing:bill`) which returns one bill with lines and payments.
- `bills.status` (`completed` / `cancelled`), `cancel_reason`, `cancelled_by`, and stock move type `cancel` are already in the schema.
- Receipt text (`shared/receipt.ts`) supports a "duplicate" copy.

## 3. Planned rules (from the prototype review)

- Cancel only **today's** bills of the **open day**; reason is required; bills stay in the list marked Cancelled.
- Cancelling puts the stock back (`stock_moves` type `cancel`, positive qty) and removes the sale from the day's cash.
- **Review items to fix, not copy:** the prototype did not restore a credit note used as payment and did not reverse cash/UPI; coins and alterations linked to the bill must be reversed too.
- Never edit or delete a bill row (rule 5): cancelling only changes `status` and adds the reason and who.
- Older bills are not cancelled; they go through **Returns**.

## 4. Planned APIs (names only)

`bills:list(period, q)`, `bills:get(id)` (exists as `billing:bill`), `bills:cancel(id, reason, approval?)`, reprint (needs printing).

## 5. Open questions

- Should a cancelled bill's number be reused? (Plan: no; gap-free numbering means a cancelled bill keeps its number.)
- Can a manager cancel yesterday's bill with a reason? (Plan: no; use a return.)

## 6. Done when

Screen, `listBills`/`cancelBill`, tests (cancel restores stock and cash, refuses old bills, needs reason, role/approval rules), schema notes (none expected), this page completed, README status changed to **done**.

## Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-13 | Placeholder note created | n/a (no git) |
