# Coins (loyalty)

> Open question **Q-2**: do coins reduce the taxable value on the invoice? Built the safe way: coins are a discount before GST (they are spread over the lines like a bill discount), so the GST on the bill is worked out on what the customer really pays. Confirm with the CA before switching coins on.

## 1. Summary

- **What it does:** customers earn coins on every bill and spend them on a later bill as a discount. Coins expire. Off until the owner turns them on in Settings → Coins.
- **Screens:** no screen of its own. Rules are set in **Settings → Coins** (`Settings.tsx`); coins are used on **Billing** (customer card and "Use coins" box); the balance shows on the Billing customer card, the **Customers** profile and the receipt.
- **Who can use it:** owner sets the rules; owner, manager and cashier spend and earn coins when billing.
- **Status:** **done** (2026-11-16).
- **Code:** rules and maths `src/shared/coins.ts` · service `src/main/services/coins.ts` · used by `billing.ts` (`createBill`), `returns.ts` (`doReturn`), `bills.ts` (`cancelBill`), `customers.ts` · screen `src/renderer/screens/Billing.tsx` · tests `src/main/services/coins.test.ts`.

## 2. Screen controls

| Control | Where | What it does |
|---|---|---|
| Coins on, 1 coin for every ₹, coin worth ₹, expire after months, max use % of a bill | Settings → Coins | The rules (`settings:saveCoins`) |
| *Use coins* box and **Use max** | Billing, under the salesperson | Coins spent on this bill. Shows the balance and the most this bill allows. Only when coins are on and the customer has some |
| Coins and Credit notes lines | Billing customer card, Customers profile | What the customer has now |
| `Coins used`, `Coins earned`, `Coin balance` | Receipt and WhatsApp bill | What happened on this bill |

## 3. Flows

**Earn and spend** → Billing **Pay** → `billing:create` with `coinsUsed` → `createBill`: checks coins are on and the customer is on the bill, drops expired coins, checks the amount against the balance and the max % of the bill, spreads the coin value over the lines as a discount, then in the same transaction writes a `use` row (−) and an `earn` row (+) in `coin_ledger` and keeps `coins_used` / `coins_earned` on the bill.

**Return** → `returns:do` → coins earned on the value returned are taken back (a `reverse` row), never more than the customer still has. Coins spent on the original bill are not given back.

**Cancel bill** → `bills:cancel` → coins the bill used are given back and coins it earned are taken back (two `reverse` rows).

**Expiry** → every time a balance is read (finding the customer, billing, the customer profile) → `expireCoins`: coins are spent oldest first; whatever is left of a batch older than the expiry months gets an `expire` row. Running it twice changes nothing.

## 4. APIs

No new channel. `customer:find` and `customers:get` now return `coins` (balance after expiry); `billing:create` accepts `coinsUsed`; `billing:context` returns the coin rules (`coins`); a bill (`BillDto`) carries `coinsUsed`, `coinValue`, `coinsEarned`, `coinBalance`.

- **Rules:** earned = whole coins in `bill total ÷ (₹ per coin)`; value = coins × coin value; most usable = the smaller of the balance and `max %` of the bill total (before coins), in whole coins.
- **Errors:** "Coins must be a whole number." · "Coins are switched off in Settings." · "Coins can only be used when the customer is on the bill." · "This bill can use at most N coins." · "This customer has no coins to use on this bill."

## 5. Database

`coin_ledger` (`customer_id`, `bill_id`, `type` earn / use / reverse / expire, `coins`, `at`); balance = the sum of `coins`. `bills.coins_used`, `bills.coins_earned`. Settings key `coins`. No migration: expiry is worked out from the `at` of each earn row and the current expiry setting.

## 6. Business rules

- Earning needs a customer on the bill and coins on. A bill with no customer earns nothing.
- The balance never goes below zero through returns and cancels (they take back at most what is there).
- A new batch given back by a cancelled bill starts its own expiry from the day it is given back.

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| Earn per ₹100, max share of bill | maths right | pass | 2026-11-16 |
| Off by default; sale earns; no customer earns nothing | balance right | pass | 2026-11-16 |
| Spend coins as a discount; GST adds up; receipt lines | grand, taxable, balance right | pass | 2026-11-16 |
| More than balance / more than allowed / switched off / expired | refused with a clear message | pass | 2026-11-16 |
| Return takes back earned coins; cancel gives back and takes back | balance right | pass | 2026-11-16 |
| Expiry oldest first, idempotent, still-valid kept | right coins written off | pass | 2026-11-16 |
| Used on the real counter with a real customer | works | not tested | n/a |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-16 | Coins built: earn, spend, expire, return and cancel, balance on the customer and the receipt | uncommitted |
