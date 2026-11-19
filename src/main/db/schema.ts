/**
 * Migrations are append-only. Never edit an applied one; add the next entry.
 * Money = INTEGER paise. Timestamps = ISO-8601 TEXT (UTC). Stock is never edited
 * directly: it is the sum of stock_moves (see v_stock).
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: /* sql */ `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- shop, gst scheme, receipt, printers, coins, backup, security (JSON values)

CREATE TABLE staff (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','cashier','store')),
  pin_hash TEXT NOT NULL, must_change_pin INTEGER NOT NULL DEFAULT 1,
  max_discount_pct INTEGER NOT NULL DEFAULT 0, commission_pct REAL NOT NULL DEFAULT 0,
  can_cancel INTEGER NOT NULL DEFAULT 0, can_change_price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, hsn TEXT NOT NULL DEFAULT '',
  gst_mode TEXT NOT NULL CHECK (gst_mode IN ('auto','fixed','exempt')), gst_rate INTEGER NOT NULL DEFAULT 0,
  is_service INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL REFERENCES categories(id), photo TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

CREATE TABLE variants (            -- one row per size x colour; this is what gets scanned
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  size TEXT NOT NULL, colour TEXT NOT NULL,
  barcode TEXT NOT NULL UNIQUE, brand_barcode TEXT UNIQUE,
  mrp INTEGER NOT NULL, sale_price INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0, min_stock INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT, variant_id TEXT NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL,            -- + in, - out
  type TEXT NOT NULL CHECK (type IN ('opening','purchase','sale','sale_return','cancel','supplier_return','damage','dispatch','other_out','adjust','count')),
  ref TEXT, reason TEXT, staff_id TEXT REFERENCES staff(id), at TEXT NOT NULL
);
CREATE INDEX ix_moves_variant ON stock_moves(variant_id, at);
CREATE VIEW v_stock AS SELECT variant_id, SUM(qty) AS qty FROM stock_moves GROUP BY variant_id;

CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, mobile TEXT, gstin TEXT);
CREATE TABLE purchases (
  id TEXT PRIMARY KEY, supplier_id TEXT REFERENCES suppliers(id), bill_no TEXT, bill_date TEXT,
  total INTEGER NOT NULL, staff_id TEXT REFERENCES staff(id), at TEXT NOT NULL
);
CREATE TABLE purchase_lines (purchase_id TEXT NOT NULL REFERENCES purchases(id), variant_id TEXT NOT NULL REFERENCES variants(id), qty INTEGER NOT NULL, cost INTEGER NOT NULL);

CREATE TABLE stock_outs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, supplier_id TEXT, reason TEXT,
  staff_id TEXT REFERENCES staff(id), approved_by TEXT REFERENCES staff(id), at TEXT NOT NULL
);
CREATE TABLE stock_out_lines (stock_out_id TEXT NOT NULL REFERENCES stock_outs(id), variant_id TEXT NOT NULL REFERENCES variants(id), qty INTEGER NOT NULL);

CREATE TABLE stock_counts (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('open','approved','discarded')), by_staff TEXT, approved_by TEXT, at TEXT NOT NULL);
CREATE TABLE stock_count_lines (count_id TEXT NOT NULL REFERENCES stock_counts(id), variant_id TEXT NOT NULL REFERENCES variants(id), system_qty INTEGER NOT NULL, counted_qty INTEGER NOT NULL DEFAULT 0);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, mobile TEXT UNIQUE, name TEXT NOT NULL,
  birthday TEXT, anniversary TEXT,                         -- MM-DD
  size_shirt TEXT, size_trouser TEXT, size_shoe TEXT, notes TEXT, gstin TEXT,
  wa_consent INTEGER NOT NULL DEFAULT 0, offers_consent INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT, consent_by TEXT, deleted_at TEXT        -- delete = anonymise, bills stay
);

CREATE TABLE day_sessions (
  id TEXT PRIMARY KEY, counter TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','closed')),
  opening_cash INTEGER NOT NULL, opened_by TEXT, opened_at TEXT NOT NULL,
  expected_cash INTEGER, counted_cash INTEGER, diff INTEGER, closed_by TEXT, closed_at TEXT
);
CREATE TABLE expenses (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES day_sessions(id), amount INTEGER NOT NULL, note TEXT NOT NULL, staff_id TEXT, at TEXT NOT NULL);

CREATE TABLE bill_counters (counter TEXT NOT NULL, fy TEXT NOT NULL, next INTEGER NOT NULL, PRIMARY KEY (counter, fy));  -- gap-free numbers: C1/2026-27/0001

CREATE TABLE bills (
  id TEXT PRIMARY KEY, no TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK (type IN ('sale','return')), orig_bill_id TEXT REFERENCES bills(id),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')), cancel_reason TEXT, cancelled_by TEXT,
  customer_id TEXT REFERENCES customers(id), staff_id TEXT NOT NULL REFERENCES staff(id), sales_by TEXT REFERENCES staff(id),
  session_id TEXT REFERENCES day_sessions(id), at TEXT NOT NULL,
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL, coins_used INTEGER NOT NULL DEFAULT 0, coins_earned INTEGER NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL, cgst INTEGER NOT NULL, sgst INTEGER NOT NULL, round_off INTEGER NOT NULL, grand INTEGER NOT NULL
);
CREATE INDEX ix_bills_at ON bills(at);
CREATE INDEX ix_bills_customer ON bills(customer_id);

CREATE TABLE bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL REFERENCES bills(id), variant_id TEXT NOT NULL REFERENCES variants(id),
  name TEXT NOT NULL, size TEXT, colour TEXT, hsn TEXT,                    -- snapshot, so old bills never change
  qty INTEGER NOT NULL, mrp INTEGER NOT NULL, price INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL, gst_rate INTEGER NOT NULL, cgst INTEGER NOT NULL, sgst INTEGER NOT NULL, total INTEGER NOT NULL, returned_qty INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL REFERENCES bills(id), mode TEXT NOT NULL CHECK (mode IN ('cash','upi','card','credit_note')), amount INTEGER NOT NULL, credit_note_id TEXT);  -- negative = money out

CREATE TABLE held_bills (id TEXT PRIMARY KEY, staff_id TEXT, payload TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE coin_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL REFERENCES customers(id), bill_id TEXT, type TEXT NOT NULL CHECK (type IN ('earn','use','reverse','expire')), coins INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE credit_notes (id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), from_bill_id TEXT REFERENCES bills(id), amount INTEGER NOT NULL, balance INTEGER NOT NULL, at TEXT NOT NULL, expires_at TEXT NOT NULL);

CREATE TABLE tailors (id TEXT PRIMARY KEY, name TEXT NOT NULL, mobile TEXT, kind TEXT NOT NULL, rate_per_job INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE alterations (
  id TEXT PRIMARY KEY, no TEXT NOT NULL UNIQUE, bill_id TEXT REFERENCES bills(id), customer_id TEXT NOT NULL REFERENCES customers(id), variant_id TEXT,
  item TEXT NOT NULL, work TEXT NOT NULL, notes TEXT, tailor_id TEXT NOT NULL REFERENCES tailors(id), due_at TEXT NOT NULL,
  charge INTEGER NOT NULL DEFAULT 0, charge_mode TEXT NOT NULL DEFAULT 'free', paid INTEGER NOT NULL DEFAULT 0, pay_bill_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('received','with_tailor','ready','delivered','cancelled')), created_at TEXT NOT NULL
);
CREATE TABLE alteration_history (id INTEGER PRIMARY KEY AUTOINCREMENT, alteration_id TEXT NOT NULL REFERENCES alterations(id), status TEXT NOT NULL, staff_id TEXT, at TEXT NOT NULL);

CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, staff_id TEXT, action TEXT NOT NULL, details TEXT);
CREATE TABLE backups (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, file TEXT NOT NULL, size_bytes INTEGER);
`
  },
  {
    // Customer sizes follow the shop's categories (Shirts, Jeans, Shoes...) instead of three fixed columns.
    // The old size_shirt / size_trouser / size_shoe columns stay in the table but are no longer used.
    version: 2,
    sql: /* sql */ `
CREATE TABLE customer_sizes (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  size TEXT NOT NULL,
  PRIMARY KEY (customer_id, category_id)
);
INSERT OR IGNORE INTO customer_sizes (customer_id,category_id,size)
  SELECT c.id,k.id,trim(c.size_shirt) FROM customers c JOIN categories k ON lower(k.name) IN ('shirts','shirt')
  WHERE trim(COALESCE(c.size_shirt,''))<>'';
INSERT OR IGNORE INTO customer_sizes (customer_id,category_id,size)
  SELECT c.id,k.id,trim(c.size_trouser) FROM customers c JOIN categories k ON lower(k.name) IN ('trousers','trouser')
  WHERE trim(COALESCE(c.size_trouser,''))<>'';
INSERT OR IGNORE INTO customer_sizes (customer_id,category_id,size)
  SELECT c.id,k.id,trim(c.size_shoe) FROM customers c JOIN categories k ON lower(k.name) IN ('shoes','shoe','footwear')
  WHERE trim(COALESCE(c.size_shoe,''))<>'';
`
  },
  {
    // Wrong approver PINs are counted per approver, separately from login, so guessing a manager's PIN through
    // billing / stock approvals is locked out without locking the manager out of their own login.
    version: 3,
    sql: /* sql */ `
CREATE TABLE approval_attempts (
  staff_id TEXT PRIMARY KEY REFERENCES staff(id),   -- the approver being tried
  fails INTEGER NOT NULL DEFAULT 0,                  -- wrong PINs since the last lock or success
  locks INTEGER NOT NULL DEFAULT 0,                  -- how many times it has been locked in a row (lock time doubles)
  locked_until INTEGER NOT NULL DEFAULT 0            -- epoch ms
);
`
  },
  {
    // (a) One photo per COLOUR of a product (all sizes of that colour share it) instead of one per product.
    // (b) A customer's usual sizes are three plain-text boxes (shirt, trouser, shoe) kept as JSON in customers.sizes.
    //     This replaces the per-category customer_sizes of migration 2; that table is kept but no longer used.
    version: 4,
    sql: /* sql */ `
CREATE TABLE product_photos (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  colour TEXT NOT NULL,
  file_path TEXT NOT NULL,                           -- file name in the photos folder, e.g. <productId>-blue.jpg
  sort_order INTEGER NOT NULL DEFAULT 0,             -- position of the colour on the product
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, colour)
);
-- An existing one-per-product photo becomes the photo of every colour of that product (the file is shared until a colour gets its own).
INSERT INTO product_photos (id,product_id,colour,file_path,sort_order,created_at,updated_at)
  SELECT lower(hex(randomblob(16))), p.id, v.colour, p.photo, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM products p JOIN (SELECT DISTINCT product_id, colour FROM variants) v ON v.product_id=p.id
  WHERE p.photo IS NOT NULL AND trim(p.photo)<>'';
ALTER TABLE products DROP COLUMN photo;

ALTER TABLE customers ADD COLUMN sizes TEXT;         -- JSON {"shirt":"40","trouser":"32","shoe":"9"}
UPDATE customers SET sizes = json_object(
  'shirt',   COALESCE((SELECT cs.size FROM customer_sizes cs JOIN categories k ON k.id=cs.category_id WHERE cs.customer_id=customers.id AND lower(k.name) IN ('shirts','shirt') LIMIT 1), trim(size_shirt), ''),
  'trouser', COALESCE((SELECT cs.size FROM customer_sizes cs JOIN categories k ON k.id=cs.category_id WHERE cs.customer_id=customers.id AND lower(k.name) IN ('trousers','trouser') LIMIT 1), trim(size_trouser), ''),
  'shoe',    COALESCE((SELECT cs.size FROM customer_sizes cs JOIN categories k ON k.id=cs.category_id WHERE cs.customer_id=customers.id AND lower(k.name) IN ('shoes','shoe','footwear') LIMIT 1), trim(size_shoe), '')
) WHERE deleted_at IS NULL;
`
  },
  {
    // The GST rate of an alteration charge is kept on the job when it is made (not read later from the category), so a
    // later change of the rate never alters old jobs.
    version: 5,
    sql: /* sql */ `
ALTER TABLE alterations ADD COLUMN gst_rate INTEGER NOT NULL DEFAULT 18;
`
  },
  {
    // Serial numbers: a product can be tracked piece by piece. Every piece gets its own serial (unique within its variant)
    // and a status; stock_moves stay the quantity ledger and always agree with the pieces that are 'in_stock'.
    version: 6,
    sql: /* sql */ `
ALTER TABLE products ADD COLUMN track_serials INTEGER NOT NULL DEFAULT 0;   -- off for existing products; switched on per product

CREATE TABLE bunches (                          -- many pieces of one variant sold together as one line with its own barcode
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  variant_id TEXT NOT NULL REFERENCES variants(id),
  bill_id TEXT REFERENCES bills(id),
  qty INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id TEXT NOT NULL REFERENCES variants(id),
  serial TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','damaged','supplier_return','dispatched','other_out','lost')),
  bill_id TEXT REFERENCES bills(id),            -- the sale bill the piece is on while it is 'sold'
  bunch_id INTEGER REFERENCES bunches(id),
  purchase_id TEXT REFERENCES purchases(id),    -- the stock-in that brought it (for "print what just arrived")
  created_at TEXT NOT NULL,
  UNIQUE (variant_id, serial)
);
CREATE INDEX ix_pieces_variant ON pieces(variant_id, status);
CREATE INDEX ix_pieces_bill ON pieces(bill_id);

CREATE TABLE piece_events (                     -- the piece's history: received, sold on bill ..., returned, ...
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id INTEGER NOT NULL REFERENCES pieces(id),
  event TEXT NOT NULL, ref TEXT, staff_id TEXT, at TEXT NOT NULL
);
CREATE INDEX ix_piece_events ON piece_events(piece_id);

CREATE TABLE stock_count_pieces (count_id TEXT NOT NULL REFERENCES stock_counts(id), piece_id INTEGER NOT NULL REFERENCES pieces(id), PRIMARY KEY (count_id, piece_id));
`
  },
  {
    // A product can carry its own GST rate (entered when the product is added). NULL = follow the category's rule.
    version: 7,
    sql: /* sql */ `
ALTER TABLE products ADD COLUMN gst_rate INTEGER;
`
  }
]
