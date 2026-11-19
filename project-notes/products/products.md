# Products

## 1. Summary

- **What it does:** the product catalogue. A product has a name, brand, category, MRP / sale price / cost and a list of **sizes × colours; each combination is its own item (a "variant") with its own barcode and its own stock**. Includes **categories** (HSN code + GST rule), **one photo per colour**, **brand barcodes**, **archive / restore**, price changes, and **import from Excel/CSV** with opening stock.
- **Screens:** `Products` list (`Products.tsx`), `Add product` / `Edit product` (`ProductForm.tsx`), dialogs `Categories` (`CategoriesModal.tsx`) and `Import opening stock` (`ImportModal.tsx`).
- **Who can use it:** everyone can *see* the list (menu). **Owner and Manager** can add, edit, archive/restore, change colour photos, manage categories and import. Brand barcodes: Owner, Manager, Store staff. Price change: Owner, Manager, or anyone with the `can_change_price` flag.
- **Status:** **done** (2026-11-12). Not included: "Print stickers" (waits for printing), product delete (by design: archive).
- **Code:** screens `src/renderer/screens/Products.tsx`, `ProductForm.tsx`, `CategoriesModal.tsx`, `ImportModal.tsx`; services `src/main/services/catalogue.ts`, `importer.ts`, `importTemplate.ts`; photo files `src/main/photoStore.ts`; file dialogs `src/main/dialogs.ts`; shapes `src/shared/catalogue.ts`; EAN-13 `src/shared/barcode.ts`; script `scripts/make-import-template.ts`, `scripts/sample-products.ts`; tests `services.test.ts` (catalogue group), `importer.test.ts`, `photo.test.ts`.

- **Serial numbers:** every product has them (no checkbox since 2026-11-19; new products, imports and existing stock are all tracked): see [Serial numbers](../serials/serials.md).
## 2. Screen controls

**Products list**

| Control | Type | What it does |
|---|---|---|
| **Categories** | button (owner/manager) | Opens the Categories dialog |
| **Import from Excel** | button (owner/manager) | Opens the import dialog |
| **+ Add product** | button (owner/manager) | Opens the Add product form |
| *Search name, brand or barcode* | text | Filters the list (also matches an exact barcode or brand barcode) |
| *Category* | dropdown | Filters by category |
| **Show archived** | checkbox (owner/manager) | Shows only archived products (hidden from billing and stock) |
| Table row | click (owner/manager) | Opens Edit product. Columns: Product (+brand), Category, Sizes, Colours, Stock, MRP |

**Add product** (`ProductForm.tsx`): *Product name*, *Brand*, *Category* (shows HSN), *GST applies* switch (off = no GST, 0%, box locked) and *GST %* input (starts as the category's fixed rate; empty = follow the category, placeholder `Auto: 5% at this price`; a typed rate 0 to 28 is kept on the product, migration 7, and billing uses it), *MRP ₹*, *Sale price ₹* (blank = MRP), *Cost ₹*, *Sizes* (comma separated, default `S, M, L, XL`), *Colours* (comma separated, default `Blue`), **Pieces per bunch (optional)** (packs the opening stock into bunches with one barcode each, rest single; see Serial numbers), **Opening stock grid** (colour × size, optional), the **Photos panel** (one row per colour typed in the Colours field: thumbnail, colour name, file name, **Add photo** (becomes **Change** once there is one) and **✕** to remove; all sizes of a colour share that colour's photo; photos are optional), **Save**, **Save & print stickers** (saves; printing arrives later), **Back to products**. Text under the grid: "N items will be created."

**Edit product:** *Product name*, *Brand*, *Category*, a table with Colour, Size, Barcode, **Brand barcode** (type to set; saved when you leave the box), Stock, **MRP ₹**, **Sale ₹**; the same **Photos panel** with a row for each colour of the product (**Add photo** / **Change** / **✕** save at once), **Save changes**, **Print stickers** (message only), **Archive** (asks first) or, for an archived product, **Restore** and a banner "This product is archived…". Non-owners/managers see the photo rows without buttons.

**Categories dialog:** list of Name / HSN / GST; fields *New category*, *HSN*, *GST* (Clothing auto, 5%, 12%, 18% fixed), **Add**, **Done**.

**Import dialog:** **Download template**, **Choose file**, a preview table (Row, Product, Size, Colour, Qty, Status OK / reason), **Cancel/Close**, **Import N good rows**.

## 3. Flows

**Add a product** → fill the form → Save → `catalogue.create(...)` → checks → `insertProduct`: one transaction creates the `products` row, one `variants` row per colour × size (each gets the next EAN-13 from `settings.barcode_seq`), and a `stock_moves` row of type `opening` for every cell with a quantity; then each colour's photo (if any) is moved to `<productId>-<colour>.jpg` and a `product_photos` row is written for it → audit `product_create`.

**Edit** → Save changes → `catalogue.update` (name/brand/category) then, for every changed row, `catalogue.prices` → audit `product_update`, `price_change`.

**Brand barcode** → leave the box → `catalogue.brandBarcode(variantId, code)` → unique check → `variants.brand_barcode`; billing, stock and counts then accept the brand's own barcode too.

**Photo of a colour** → **Add photo** / **Change** on that colour's row → the screen opens the file picker, decodes the picture with the browser engine (JPG, PNG, WebP, BMP, GIF, AVIF), flips transparency to white, shrinks to ≤ 1,200 px, encodes JPEG (quality 0.85) → `photo:save` stores `tmp-<uuid>.jpg` and the row shows the picked file name → on **Save** (new product) each tmp file becomes `<productId>-<colour>.jpg`; on Edit `catalogue.setColourPhoto(productId, colour, file)` does it at once (replacing that colour's earlier photo). **✕** → `catalogue.removePhoto(productId, colour)` deletes the row and the file (a file still used by another colour is kept). All sizes of a colour use that colour's photo, so Billing shows it for whichever size is scanned (`billing:photo`).

**Archive / restore** → Archive (confirm) → `catalogue.archive(id)` sets `products.active=0`; the product disappears from list, billing, stock, search. **Show archived → open → Restore** → `catalogue.restore(id)` (refused if another active product has the same name).

**Add a category** → Categories → fill → Add → `catalogue.addCategory` → new row in `categories` (visible at once in product forms, the import template and customer size boxes).

**Import** → *Download template* (`import:template`: save dialog; the file lists this shop's categories) → fill → *Choose file* (`import:choose`: open dialog, reads the first sheet, checks every row, returns a preview and a token) → *Import N good rows* (`import:commit(token)`): one transaction creates each new product with its variants and opening stock (`stock_moves` type `opening`, reason "Excel import"). Bad rows are skipped, shown with the reason.

## 4. APIs

IPC result `{ ok:true, data }` / `{ ok:false, error:"message" }`. Roles listed per call; "no check" = the call does not require a login (Known issue K-02).

### `window.api.catalogue.categories()` · `cat:categories`
- **Called from:** Products filter, Add/Edit product, Categories dialog. **Roles:** no check.
- **Response:** `[{ "id":"c2f1…","name":"Shirts","hsn":"6205","mode":"auto","rate":0 }, { "id":"a7e0…","name":"Belts","hsn":"4203","mode":"fixed","rate":18 }]` (service categories excluded, sorted by name).
- **Tables read:** `categories`.

### `window.api.catalogue.addCategory(input)` · `cat:addCategory`
- **Called from:** Categories → Add · **Roles:** owner, manager.
- **Request:** `{ "name":"Skirt","hsn":"2331","gst":"auto" }`

| Field | Type | Required | Validation |
|---|---|---|---|
| name | string | yes | not blank; unique ignoring case |
| hsn | string | no | trimmed text |
| gst | `"auto"` or 5, 12, 18 | yes | `auto` = clothing rule |

- **Response:** `{ "id":"5d09…","name":"Skirt","hsn":"2331","mode":"auto","rate":0 }`
- **Errors:** `Enter the category name.` · `A category with this name already exists.` · `You are not allowed to do this.`
- **Tables written:** `categories`, `audit_log` (`category_create`).

### `window.api.catalogue.products(q, categoryId, archived)` · `cat:products`
- **Called from:** Products list. **Roles:** no check.
- **Request:** `{ "q":"shirt","categoryId":"","archived":false }`
- **Response:** `[{ "id":"…","name":"Oxford Formal Shirt","brand":"Own","categoryId":"…","categoryName":"Shirts","sizes":["38","40","42","44"],"colours":["White","Sky"],"stock":37,"mrp":149900 }]`
- **Tables read:** `products, categories, variants, v_stock`. Active products only, or archived only when `archived=true`.
- **Query:** `… WHERE p.active=@act AND c.is_service=0 AND (@cat='' OR p.category_id=@cat) AND (@q='' OR p.name LIKE @like OR p.brand LIKE @like OR v.barcode=@q OR v.brand_barcode=@q) ORDER BY p.name, v.rowid`; rows are grouped per product in code (sizes/colours de-duplicated, stock summed, MRP of the first variant).

### `window.api.catalogue.product(id)` · `cat:product`
- **Called from:** Edit product. **Roles:** no check. **Request:** `{ "id":"0123…" }`
- **Response:** `{ "id":"…","name":"Slim Fit tshirt","brand":"H & M","categoryId":"…","active":true,"variants":[{ "id":"…","productId":"…","size":"S","colour":"Blue","barcode":"2000000000015","brandBarcode":null,"mrp":50000,"salePrice":50000,"cost":0,"minStock":2,"stock":0 }] }`
- **Errors:** `Product not found.`

### `window.api.catalogue.create(input)` · `cat:create`
- **Called from:** Add product → Save / Save & print stickers · **Roles:** owner, manager.
- **Request:**
```json
{ "name":"Slim Shirt","brand":"Own","categoryId":"c2f1…","mrp":149900,"salePrice":149900,"cost":78000,
  "sizes":["M","L"],"colours":["Blue","White"],
  "opening":{ "Blue|M":5,"White|L":3 }, "photos":{ "Blue":"tmp-4f2a….jpg" } }
```

| Field | Type | Required | Validation |
|---|---|---|---|
| name | string | yes | not blank; not equal (ignoring case) to another **active** product |
| brand | string | no | text |
| categoryId | string | yes | an existing, non-service category |
| mrp | paise | yes | > 0 |
| salePrice | paise | no | ≥ 0; 0 or blank = MRP |
| cost | paise | no | ≥ 0 |
| sizes / colours | string[] | yes | at least one each; trimmed, duplicates removed |
| opening | `{ "colour|size": qty }` | no | missing = 0; rounded down; negatives ignored |
| photos | `{ "colour": file name }` | no | each colour must be one of `colours`; each file name must come from `photo:save`; colours without an entry have no photo |

- **Response:** `{ "id":"0123…","variantIds":["…","…","…","…"] }`

| When | Message |
|---|---|
| blank name | `Enter a product name.` |
| no sizes or no colours | `Enter at least one size and one colour.` |
| MRP ≤ 0 | `Enter the MRP.` |
| negative sale price / cost | `Prices cannot be negative.` |
| bad category | `Choose a category.` |
| name taken | `A product with this name already exists. Use a different name.` |
| a photo for a colour that is not on the product | `A photo refers to a colour that is not on this product.` |
| photo name not from the chooser | `That photo is not valid. Choose it again.` |
| temp photo missing | `The chosen photo was not found. Choose it again.` |
| not owner/manager | `You are not allowed to do this.` |

- **Tables written:** `products`, `variants`, `stock_moves` (type `opening`), `settings` (`barcode_seq`), `audit_log` (`product_create`); `product_photos` (one row per photo); files `photos/<id>-<colour>.jpg`. Photos are checked **before** anything is saved, so a bad photo never leaves a half-saved product.
- **Example:** 2 sizes × 2 colours = 4 variants with barcodes `2000000000015`, `…022`, `…039`, `…046`; opening stock 5 + 3 = 8 pieces; a Blue photo is saved as `0123…-blue.jpg` and shared by Blue M and Blue L.

### `window.api.catalogue.update(id, patch)` · `cat:update`
- **Request:** `{ "id":"0123…","patch":{ "name":"Slim Fit T-shirt","brand":"H & M","categoryId":"…" } }` · **Roles:** owner, manager · **Response:** `null`.
- **Errors:** `Enter a product name.` · `A product with this name already exists.` · role error. **Tables written:** `products`, `audit_log` (`product_update`).

### `window.api.catalogue.prices(variantId, mrp, salePrice)` · `cat:prices`
- **Called from:** Edit product → Save changes (one call per changed row). **Roles:** owner, manager, or a user with `can_change_price`.
- **Request:** `{ "variantId":"…","mrp":179900,"salePrice":159900 }` · **Response:** `null`.
- **Errors:** `You are not allowed to change prices.` · `Enter valid prices.` (mrp ≤ 0 or negative sale) · `Item not found.`
- **Tables written:** `variants`, `audit_log` (`price_change` with old and new values).

### `window.api.catalogue.brandBarcode(variantId, code)` · `cat:brandBarcode`
- **Roles:** owner, manager, store. **Request:** `{ "variantId":"…","code":"8901234567890" }` (blank clears it) · **Response:** `null`.
- **Errors:** `That barcode is already used by another item.` (checked against our barcode *and* other brand barcodes). **Tables written:** `variants`, `audit_log` (`brand_barcode`).

### `window.api.catalogue.archive(id)` / `restore(id)` · `cat:archive` / `cat:restore`
- **Called from:** Edit product → Archive (after confirm) / Restore · **Roles:** owner, manager · **Request:** `{ "id":"0123…" }` · **Response:** `null`.
- **Errors (restore):** `Product not found.` · `Another product with this name exists now. Rename that one first.`
- **Tables written:** `products.active`, `audit_log` (`product_archive` / `product_restore`). Stock and history are untouched.

### `window.api.catalogue.savePhoto(bytes)` · `photo:save`
- **Called from:** the photo picker in `ui.tsx` · **Roles:** owner, manager.
- **Request:** a `Uint8Array` of JPEG bytes (the screen already resized it).
- **Response:** `{ "file":"tmp-4f2a8c10-….jpg","dataUrl":"data:image/jpeg;base64,/9j/…" }`
- **Errors:** `That file could not be read as a photo.` (not a JPEG: first bytes must be `FF D8`) · `That photo is too large.` (> 8 MB) · role error.
- **Side effect:** writes a temporary file in `photos/`.

### `window.api.catalogue.photos(productId)` · `cat:photos`
- **Called from:** Edit product (photo rows). **Roles:** any logged-in user (`Not logged in.` otherwise).
- **Request:** `{ "productId":"0123…" }`
- **Response:** the photos the product has, one per colour that has one, in colour order; colours without a photo are absent:
```json
[{ "colour":"Blue","file":"0123…-blue.jpg","dataUrl":"data:image/jpeg;base64,/9j/…" },
 { "colour":"Red","file":"0123…-red.jpg","dataUrl":"data:image/jpeg;base64,/9j/…" }]
```
- **Tables read:** `product_photos`; reads the files. (`dataUrl` is `null` if the file is missing.)

### `window.api.catalogue.setColourPhoto(productId, colour, file)` · `cat:setColourPhoto`
- **Called from:** Edit product → **Add photo** / **Change** on a colour row. **Roles:** owner, manager.
- **Request:** `{ "productId":"0123…","colour":"Blue","file":"tmp-4f2a….jpg" }`

| Field | Type | Required | Validation |
|---|---|---|---|
| productId | string | yes | an existing product |
| colour | string | yes | a colour of that product (exact text) |
| file | string | yes | a name returned by `photo:save` |

- **Response:** `null`.

| When | Message |
|---|---|
| product missing | `Product not found.` |
| colour not on the product | `This product has no colour "Pink".` |
| bad / missing temp photo | `That photo is not valid. Choose it again.` / `The chosen photo was not found. Choose it again.` |
| not owner/manager | `You are not allowed to do this.` |

- **Tables written:** `product_photos` (insert, or update `file_path` and `updated_at` for that colour), `audit_log` (`product_photo`); the file is renamed to `<productId>-<colour>.jpg` (a name already owned by *another* colour gets `-2`, `-3`…); an old file that nobody uses any more is deleted.
- **Example:** Blue photo changed at 11:00 → still one row and one file for Blue; `created_at` stays 10:00, `updated_at` becomes 11:00.

### `window.api.catalogue.removePhoto(productId, colour)` · `cat:removePhoto`
- **Called from:** the **✕** on a colour row. **Roles:** owner, manager. **Request:** `{ "productId":"0123…","colour":"Blue" }` · **Response:** `null`.
- **Errors:** `There is no photo for "Blue".` · role error. **Tables written:** `product_photos` (row deleted), `audit_log` (`product_photo_remove`); the file is deleted unless another colour still uses it.

*(Billing's photo of a scanned item is `billing:photo`; see [Billing](../billing/billing.md).)*

### `window.api.import.template()` · `import:template`
- **Called from:** Import → Download template · **Roles:** owner, manager.
- **Response:** the saved path, e.g. `"C:\\Users\\MARS\\Downloads\\mars-products-template.xlsx"`, or `null` if cancelled.
- **Side effect:** native Save dialog; writes an `.xlsx` with 4 sheets: **Products** (blank, frozen header, category dropdown, number checks on rows 2–2000), **How to fill**, **Categories** (this shop's), **Examples** (not imported).
- **Tables read:** `categories`.

### `window.api.import.choose()` · `import:choose`
- **Called from:** Import → Choose file · **Roles:** owner, manager.
- **Response:** `null` if cancelled, else
```json
{ "token":"2f0c…","fileName":"mars-products-import-sample.xlsx","goodRows":59,"goodPieces":297,
  "rows":[{ "row":2,"product":"Oxford Formal Shirt","size":"38","colour":"White","qty":2,"error":null },
          { "row":9,"product":"Mystery","size":"M","colour":"Red","qty":1,"error":"Unknown category \"Nope\"" }] }
```
- **Errors (whole file):** `The file has no sheet.` · `The file has no "Category" column. Use the template.` (also Product, Size, Colour, MRP) · `The file has no rows to import.`
- **Row errors (the row is skipped):** `Product name missing` · `Size missing` · `Colour missing` · `Category missing` · `Unknown category "X"` · `MRP must be a number above 0` · `Sale price is not a number` · `Cost is not a number` · `Qty must be a whole number` · `Same size and colour appears twice` · `Product already exists` · `Different category from the first row of this product`.
- **Steps:** open file (xlsx or csv) → read the **first sheet** → find the columns by name (case-insensitive) → validate each row in order → keep good rows in memory under a token (only the latest preview can be imported). Writes nothing yet.

### `window.api.import.commit(token)` · `import:commit`
- **Roles:** owner, manager · **Request:** `{ "token":"2f0c…" }` · **Response:** `{ "products":11,"items":59,"pieces":297 }`
- **Errors:** `This preview has expired. Choose the file again.` (also when the same preview is imported twice)
- **Tables written:** `products`, `variants`, `stock_moves` (opening, reason "Excel import"), `settings` (`barcode_seq`), `audit_log` (`product_import`), all in one transaction.

## 5. Database

Tables: `products`, `variants`, `categories`, `stock_moves`, `settings` (`barcode_seq`), `audit_log`, **`product_photos`**. Photo files on disk.

```sql
-- product list (grouped per product in code)
SELECT p.id,p.name,p.brand,p.category_id AS categoryId,c.name AS categoryName,v.size,v.colour,v.mrp,COALESCE(s.qty,0) AS stock
FROM products p JOIN categories c ON c.id=p.category_id JOIN variants v ON v.product_id=p.id LEFT JOIN v_stock s ON s.variant_id=v.id
WHERE p.active=@act AND c.is_service=0 AND (@cat='' OR p.category_id=@cat)
  AND (@q='' OR p.name LIKE @like OR p.brand LIKE @like OR v.barcode=@q OR v.brand_barcode=@q)
ORDER BY p.name, v.rowid;

-- next barcode
INSERT INTO settings (key,value) VALUES ('barcode_seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value;  -- then ean13('2000'+8 digits)

-- create
INSERT INTO products (id,name,brand,category_id,active,created_at) VALUES (?,?,?,?,1,?);
INSERT INTO variants (id,product_id,size,colour,barcode,mrp,sale_price,cost) VALUES (?,?,?,?,?,?,?,?);   -- sale_price = given or MRP
INSERT INTO stock_moves (variant_id,qty,type,ref,reason,staff_id,at) VALUES (?,?, 'opening','product','Opening stock',?,?);
```

## 6. Business rules

- **One barcode per size × colour.** EAN-13, prefix `2000`, sequence in `settings.barcode_seq`, check digit computed (`shared/barcode.ts`). Example sequence: `2000000000015`, `2000000000022`, `2000000000039`.
- **Product names are unique among active products** (case-insensitive). An archived name can be reused; restoring then fails if it clashes.
- **GST by category**: `auto` = clothing (5% to ₹2,500 per piece, 18% above, decided at billing from the discounted price); `fixed` = 5/12/18%; the Add form shows the rate for the typed price.
- **Prices are GST-inclusive** and stored in paise. Cost is overwritten by each stock in.
- **Opening stock** is a normal stock move (type `opening`); stock is never typed as a number.
- **Archive, never delete.** Archived items vanish from billing, search, stock lists and counts but history and bills remain.
- **Import** only creates *new* products (an existing name is skipped). Rows of one product must share a category. Sale price blank = MRP. Cost and Qty blank = 0. CSV works too (UTF-8).
- **Photos are per colour** (D-26): one optional photo for each colour of a product, shared by every size of that colour (`UNIQUE(product_id, colour)`). Table `product_photos(id, product_id, colour, file_path, sort_order, created_at, updated_at)`; the `products.photo` column was removed (migration 4). File: `photos/<productId>-<colour>.jpg` (colour made safe: "Dark Blue" → `dark-blue`). JPEG ≤ 1,200 px, ≤ 8 MB, stored outside the database; **not** in backups (K-05). Photos picked but never saved are deleted after 24 hours at start-up.
- **Photos from before this change** (one per product) were given to every colour of that product; the shared file stays until the last colour using it gets its own photo or is removed.
- **Price changes** need the permission and are logged with old and new values.
- **Sample data** (`npm run template -- <file> --sample`): 11 products, 59 rows, 297 pieces (for trying the import).

## 7. Test cases

| Test | Expected result | Pass / fail | Date tested |
|---|---|---|---|
| catalogue › creates one variant per size × colour with unique barcodes and opening stock | 2 sizes × 2 colours = 4 variants, 4 distinct 13-digit barcodes, 8 pieces of opening stock; list shows stock 8 | pass | 2026-11-13 |
| catalogue › rejects duplicate names and missing data | Same name again: "already exists"; no sizes: "size"; MRP 0: "MRP" | pass | 2026-11-13 |
| catalogue › archives a product out of the list and restores it with everything intact | Archived: not in list, shown under archived, `active:false`, 4 variants kept; restored: stock 8 again | pass | 2026-11-13 |
| catalogue › will not restore over a newer product with the same name, and only for owner/manager | Restore refused ("Another product with this name"); cashier cannot archive/restore | pass | 2026-11-13 |
| catalogue › only price-permitted staff can change prices | Cashier refused; manager changes sale price to ₹900 | pass | 2026-11-13 |
| catalogue › keeps brand barcodes unique and findable by scan | A second item with the same brand barcode is refused; search by that barcode finds the first | pass | 2026-11-13 |
| categories › adds categories with a fixed or automatic GST rule | Fixed 12% and auto saved; duplicate/blank refused; cashier refused | pass | 2026-11-13 |
| category persistence › is saved in the database file and survives closing and reopening it | Category row in a real file, audit entry written, still there after reopen, seeding not repeated | pass | 2026-11-13 |
| excel import › previews good and bad rows, then imports only the good ones | 7 rows → statuses null,null,"Size missing","Same size and colour appears twice","Unknown category…","Product already exists","Qty must be a whole number"; 2 imported (11 pieces); second commit "expired" | pass | 2026-11-13 |
| excel import › refuses a file without the required columns, and non-managers | "no "Category" column"; store staff "not allowed" | pass | 2026-11-13 |
| excel import › imports the whole sample file cleanly | 59 rows, none skipped, 11 products, 297 pieces | pass | 2026-11-13 |
| excel import › leaves out sample products whose category the shop does not have | Only Shirts samples when only Shirts exists | pass | 2026-11-13 |
| excel import › reads CSV files too | CSV imports with Qty 3 | pass | 2026-11-13 |
| excel import › makes a template the importer accepts | 4 sheets, Products first and blank, dropdown + number checks, shop categories listed, blank file refused, examples import cleanly | pass | 2026-11-13 |
| one photo per colour › attaches a photo to each colour when the product is created, named <productId>-<colour>.jpg | Blue and Red photos → files `<id>-blue.jpg`, `<id>-red.jpg`, two `product_photos` rows (sort 0 and 1), `created_at` = `updated_at`, both listed with a data URL | pass | 2026-11-13 |
| one photo per colour › gives every size of a colour the same photo, and a colour without a photo none | Blue M and Blue L give the same picture; Red differs; Green (no photo) gives null and is absent from the list | pass | 2026-11-13 |
| one photo per colour › works with no photos at all, and the products table no longer has a photo column | No rows, no files, and no `photo` column on `products` | pass | 2026-11-13 |
| one photo per colour › checks every photo before saving anything | Photo for a colour not on the product, `..\\secret.jpg`, `C:\\…`, a missing temp file: each refused; **no product was created**; the good temp photo is kept | pass | 2026-11-13 |
| one photo per colour › adds, changes and removes the photo of one colour later | Add, Change (one row, one file, picture changed, `updated_at` moves, `created_at` stays), Remove (row and file gone), second Remove → "There is no photo for "Blue"" | pass | 2026-11-13 |
| one photo per colour › refuses a photo for a colour or product that does not exist, and for non-managers | "no colour "Pink"", "Product not found"; cashier "not allowed"; any logged-in user can list | pass | 2026-11-13 |
| one photo per colour › gives colours whose names make the same file name different files | "Dark Blue", "dark-blue", "DARK BLUE!" → three different files all starting `<id>-dark-blue` | pass | 2026-11-13 |
| one photo per colour › has one row per colour of a product in the database | A second row for the same product and colour is refused (UNIQUE) | pass | 2026-11-13 |
| one photo per colour › needs a login to see a photo | Logged out: "Not logged in." for the list and for a scanned item's photo | pass | 2026-11-13 |
| photo files › accepts JPEG bytes from the screen and refuses anything else | JPEG accepted; PNG, empty, and a JPEG over 8 MB refused; cashier refused | pass | 2026-11-13 |
| photo files › cleans up old unsaved picks but never saved photos or fresh picks | 3-day-old temp file removed; a fresh pick and a saved photo kept; paths never read | pass | 2026-11-13 |
| upgrading a database that has one photo per product › gives that photo to every colour of the product; the file is kept until nobody uses it | Version-3 file: one row per *colour* (not per size), none for a product with no photo, `products.photo` gone; Blue gets its own file, Red keeps the old one; removing Red then deletes the old file | pass | 2026-11-13 |

## 8. Changelog

| Date | Change | Commit |
|---|---|---|
| 2026-11-12 | Product list, Add/Edit product, size × colour grid, EAN-13 barcodes, prices, brand barcode | n/a (no git) |
| 2026-11-12 | Categories dialog; Excel/CSV import with template; Add product photo panel and real photos | n/a |
| 2026-11-12 | Photo picker now decodes in the screen (fixes "could not be read as a photo") | n/a |
| 2026-11-13 | **Photos per colour**: Photos panel with one row per colour on Add/Edit product; table `product_photos`; `products.photo` removed (schema v4); APIs `cat:photos`, `cat:setColourPhoto`, `cat:removePhoto` replace `cat:photo`, `cat:setPhoto`; `photos` replaces `photo` in `cat:create`; unsaved picks cleaned up after 24 h | n/a |
| 2026-11-13 | **Fix: Edit product "Save changes" looked like it did nothing.** The save worked, but the reload that follows erased the "Saved" message. The reload no longer clears messages, and the screen scrolls to the message after saving | n/a |
| 2026-11-12 | Archive / restore with confirmation and "Show archived" | n/a |
| 2026-11-12 | Import template rebuilt: dropdown, number checks, shop categories, examples sheet; sample file script | n/a |
| 2026-11-12 | Fixed a corrupted `₹` in the form labels (encoding) | n/a |
