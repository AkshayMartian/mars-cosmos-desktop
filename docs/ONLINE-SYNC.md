# Using Mars Cosmos online: SQLite offline, MongoDB online

Status: **proposal, not built yet.** Today the app is fully offline (SQLite on the shop PC). Only activation, the licence check-in (`/v1/refresh`) and the owner's forgot-PIN go over the internet. This document explains how the shop data reaches MongoDB when there is internet, without ever stopping the shop when there is none.

## 1. The rule: offline first

**SQLite on the shop PC is always the working database.** Billing, stock, returns and day end read and write SQLite only, with or without internet. MongoDB is a copy in the cloud, kept up to date in the background when the PC is online.

| | No internet | With internet |
|---|---|---|
| Billing, stock, returns, day end | Works (SQLite) | Works (SQLite), same speed |
| Data reaches MongoDB | Waits in a queue on the PC | Sent in the background every few seconds |
| Owner sees sales from phone / web | Last synced figures | Live (a few seconds behind) |
| Second counter / second branch | Works on its own data; catches up when back online | Sees the other counters' stock and customers |
| Cloud backup | Next time online | Daily, plus at day end |

Why not use MongoDB directly when online:
- A shop's internet drops several times a day. Switching databases mid-bill risks a lost or duplicated bill.
- Every scan would wait for the network. SQLite answers in under a millisecond.
- One code path (SQLite) is simpler to test than two.

## 2. Who talks to whom

```
Shop PC (Electron)                          MARS cloud
┌──────────────────────────┐   HTTPS    ┌──────────────────────────┐
│ screens → services       │            │ admin portal API (Fastify)│
│        → SQLite (always) │            │   /v1/sync/push           │
│        → sync_outbox ────┼──────────► │   /v1/sync/pull           │
│ sync worker (background) │ ◄──────────┼   /v1/backup/*            │
└──────────────────────────┘            │        │                  │
                                        │        ▼                  │
                                        │ MongoDB Atlas (mars_cosmos)│
                                        └──────────────────────────┘
```

**The app never connects to MongoDB itself.** The MongoDB password would have to ship inside the installer, and anyone could copy it from there. The app talks only to the portal API over HTTPS, as it already does for activation. The portal checks who is calling and writes to MongoDB.

Identity: the licence key + this PC's id (as `/v1/refresh` uses today). Later, a per-device secret issued at activation, sent as a header, so a copied key alone is not enough.

## 3. What gets synced

Each shop is one `shopId` in MongoDB (already used for `shops`, `owners`, `activation_keys`). Every synced document carries `shopId`, the row's own `id`, `deviceId` and `updatedAt`.

| Kind | Tables | How conflicts are avoided |
|---|---|---|
| **Append-only records** | bills, bill_lines, payments, stock_moves, credit_notes, coin_ledger, expenses, stock_outs, purchases, piece_events, audit_log, alteration_history | Never edited after saving, so two PCs can never change the same row. Just upload. A cancelled bill is a new status record, not an edit. |
| **Master data** | products, variants, categories, customers, suppliers, tailors, staff (without PINs), settings (shop, GST, receipt) | Edited rarely. Last change wins, per row, by `updatedAt`. |
| **Never synced** | PIN hashes, recovery code, licence, backups list, held bills, printer settings | Belong to this PC or are secrets. |

Two facts from the current design make this safe:
- **Stock is the sum of `stock_moves`**, not a number that gets overwritten. Two counters selling the same shirt each add a `-1` move, and the total is right on both once synced. Nothing to merge.
- **Bill numbers already carry the counter** (`C1/2026-27/0001`), so two counters never produce the same bill number.

## 4. How it works on the PC

**a. Every change goes into an outbox in the same transaction.**
The service that saves a bill already writes the bill, lines, payments and stock moves in one SQLite transaction. It also writes one row per changed record into a new `sync_outbox` table:

```
sync_outbox(seq INTEGER PK, table_name, row_id, op 'upsert'|'delete', payload JSON, created_at, sent_at NULL)
```

If the transaction fails, there is no outbox row either. Data and queue can never disagree.

**b. A background worker sends the queue.**
- Every 5 seconds while online (and right after a bill is saved), send up to 500 unsent rows: `POST /v1/sync/push { deviceId, batchId, changes[] }`.
- The server upserts each change by `(shopId, table, id)` and answers with the highest `seq` it stored. The PC marks those rows sent.
- Sending the same batch twice does no harm (upsert by id, `batchId` remembered). A dropped connection is simply retried.
- Offline: nothing is sent and nothing blocks. The queue grows and empties when the internet is back. Settings shows "Last synced: 2 min ago · 0 waiting".

**c. Pulling other counters' changes (multi-counter plans only).**
`GET /v1/sync/pull?since=<cursor>` returns changes made by the shop's other PCs since the last pull. They are written into SQLite (without going back into the outbox) and the cursor is saved. A single-counter shop skips this.

## 5. Changes needed in the app

1. **Ids:** most tables already use text UUIDs. Four use auto-numbers (`payments`, `coin_ledger`, `audit_log`, `alteration_history`): add a `uid TEXT` (UUID) column and sync by that, because number 57 on counter 1 and number 57 on counter 2 are different rows.
2. **`updated_at` and `deleted`** on master tables (only `product_photos` has `updated_at` today). A delete becomes `deleted=1` so the delete can be synced.
3. **New tables:** `sync_outbox`, `sync_state` (last pushed seq, pull cursor, last success time, last error).
4. **Write to the outbox** in each service's transaction (one helper, `queueChange(table, id, op)`).
5. **Sync worker** in the main process (`src/main/sync/`), started only when the licence `mode` is `cloud`. A `local` plan never sends shop data.
6. **Settings → Cloud** tab: on/off (from the plan), last synced, items waiting, last error, "Sync now".
7. A migration that queues every existing row once, so a shop switching to cloud uploads its history.

## 6. Changes needed in the portal / MongoDB

1. `POST /v1/sync/push` and `GET /v1/sync/pull` (device identity check, size limit, per-shop rate limit).
2. One collection per synced table (`bills`, `stock_moves`, `products` …) with a unique index on `{ shopId, id }` and an index on `{ shopId, updatedAt }` for pulling.
3. Everything filtered by `shopId`: one shop can never read another's data.
4. Owner web/mobile dashboard (sales today, stock, best sellers) read from these collections.
5. **Cloud backup:** the PC uploads its daily `VACUUM INTO` backup file (encrypted) to object storage; the portal keeps the last 30. Restore on a new PC is allowed only for the same licence. This is the "full copy" safety net; sync is the live data.

## 7. Recovery when a PC is lost or replaced

1. Install the app on the new PC and activate with the same key (MARS support releases the old PC).
2. Download the latest cloud backup, then pull the changes synced after it.
3. The shop continues with nothing lost except bills made on the old PC after its last sync (shown as "items waiting" on the old PC while it still worked).

## 8. Security

- No MongoDB credentials on shop PCs. HTTPS only.
- PINs, the recovery code and the licence never leave the PC through sync.
- Every request is checked against an activated key + device; every query is scoped by `shopId`.
- Customer data in MongoDB is protected like today's owner data; a shop's data is deleted on request when it leaves MARS.

## 9. Suggested order

| Step | What | Result |
|---|---|---|
| 1 | Cloud backup upload + restore | Data safe if the PC dies (biggest risk today) |
| 2 | Outbox + push (one counter) | Owner sees sales online; MongoDB has every bill |
| 3 | Owner dashboard on web | Value the owner can see |
| 4 | Pull (multi-counter, same shop) | Two counters share stock and customers |
| 5 | Multi-branch (several shops, one owner) | Stock and reports across branches |

## 10. Open questions

- Sync interval and batch size on slow shop internet (start: 5 s / 500 rows; measure).
- Should a second counter be allowed to **edit** products, or only the main PC (simplest: only the owner's PC edits master data)?
- How long MongoDB keeps old data for small plans (cost).
- Is the Atlas free tier enough for the first shops, or do we need M10 (backups, more connections)?
