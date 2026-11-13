# Prototype review

Two prototypes were reviewed: **MARS-POS-App-Design** (the app, ~25 screens, working billing/GST/returns/alterations logic) and **MARS-POS-Store-Walkthrough** (a guided sales/training story for the store kit).

## What is good (keep)
- Money in integer paise; GST backed out of GST-inclusive prices; bill discount spread proportionally with the last line taking the remainder. Ported to `src/shared/calc.ts` with tests.
- Stock as a ledger of moves (never edited directly); old bills snapshot name/size/HSN.
- Roles + PIN, manager-approval prompts, audit log, day sessions with cash reconciliation, held bills, credit notes, coins, alterations with tailor tags.
- Gap-free bill numbers per counter and financial year (`C1/2026-27/0001`).

## Decisions where the two prototypes disagree
| Topic | Design app | Walkthrough | Decision |
|---|---|---|---|
| Platform | SQLite on the shop PC | Chrome on PC/tablet, "offline then sync" | **Windows desktop (Electron + SQLite)**. Silent printing, cash drawer and backup-to-USB need it. Sync is a later phase. |
| Barcode | EAN-13 with check digit | 8-digit `200xxxxx`, no check digit | **EAN-13** (`src/shared/barcode.ts`). |
| Brand barcode | not modelled | scan brand tag into "Brand barcode" | **Add it** (`variants.brand_barcode`, already in schema). |
| Outbound stock | Stock out (supplier return/damage/dispatch/other) | + online order pick-list, branch transfer | Build Stock out first; pick-list/transfer later. |
| Staff | 4 roles | Owner + counter | 4 roles. |

## Defects to fix when porting (found in the prototype logic)
1. **PINs stored in plain text** and approval matches *any* manager PIN. Now scrypt-hashed; approvals must identify the approver (pick name + PIN).
2. **Cancelling a bill** does not restore the credit-note balance used as payment, and does not reverse cash/UPI.
3. **Coins**: expiry setting is never applied; coins-used on a *return* are not handled.
4. **Credit note expiry** (`cnDays`) is stored but never enforced at payment.
5. **Discount % for approval** includes coin value; should be only real discounts.
6. **Day-end** is computed twice with slightly different formulas (`vDayEnd` vs `closeDay`). Use one service function.
7. **Return GST**: return bills carry negative taxable but `bill.taxable/cgst/sgst` are summed after creation; reports must treat `type='return'` consistently (one rule, tested).
8. **Alteration charge paid at pickup** creates a new bill but the alteration's GST rate comes from a category tweak (`c9.rate`); store the rate on the job.
9. **Reset/demo/localStorage** code and "Prototype" settings tab must not ship.
10. Customer **GSTIN** accepted if 15 alphanumerics only; add proper GSTIN checksum validation.
11. Idle lock timer only checks every 20 s and doesn't clear in-progress bill; decide whether a locked session keeps the open bill.

## Open questions for the owner / CA (block go-live, not scaffolding)
- GST rate and SAC code for alteration service; whether coin redemption reduces taxable value.
- Clothing threshold wording (5% up to ₹2,500 per piece; ₹1,000 boundary rules changed over time) — CA to confirm.
- Printers' exact models and whether the receipt printer supports ESC/POS over USB (drives the print library).
