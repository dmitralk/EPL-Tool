# CLAUDE.md — EPL Tool project handoff

This file is read automatically by Claude Code at conversation start. It gives full context to continue work without re-explanation.

---

## What this project is

**EPL Tool** — an Electron desktop app for Lubmarine that replaces an Excel-based workflow for generating customer Export Price Lists (EPL). It stores all pricing data in a SQLite database, lets users create formatted price lists per customer, exports them to Excel in a standard format, and opens email drafts with the file attached.

**Key constraints that drove all architectural decisions:**
- No admin rights on corporate machines (no IT-managed servers, no PostgreSQL)
- Cross-platform: macOS and Windows
- Single user at a time, DB stored on SharePoint as a file
- Email via local mail client (Mail.app / Outlook) — no SMTP

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App framework | Electron Forge + Vite + React + TypeScript | Portable builds, no admin install |
| SQLite | better-sqlite3 | Synchronous, fast; rebuilt for Electron via `packageAfterCopy` hook |
| Excel write | ExcelJS | Free image embedding + full styling |
| Excel read | xlsx (SheetJS) | Best reader; must be external to Vite bundle |
| UI | Tailwind CSS + shadcn/ui-style components | Copy-owned components in `src/renderer/components/ui/` |
| Email macOS | osascript (AppleScript → Mail.app) | Requires NSAppleEventsUsageDescription in Info.plist |
| Email Windows | PowerShell + Outlook COM | No SMTP needed |

---

## Project root layout

```
/Users/yadmitrieva/EPL Tool/
├── epl-tool/               ← the Electron app (all code here)
│   ├── src/
│   │   ├── main/           ← Electron main process
│   │   │   ├── index.ts    ← window creation, app lifecycle
│   │   │   ├── database.ts ← better-sqlite3 connection, schema DDL, WAL/FK pragmas
│   │   │   ├── ipc/        ← all IPC handlers (entity:action naming)
│   │   │   │   ├── index.ts          ← registers all handlers
│   │   │   │   ├── customers.ts
│   │   │   │   ├── products.ts       ← cascades name/type sync to standard_epl on update
│   │   │   │   ├── priceLists.ts
│   │   │   │   ├── standardEpl.ts    ← versioned EPL: list-versions, create-draft, publish-draft, delete-draft, delete-row, list-combined, upsert
│   │   │   │   ├── packaging.ts
│   │   │   │   ├── settings.ts       ← DB open/create, logo, admin emails, units
│   │   │   │   ├── export.ts         ← xlsx single/bulk, mail single/bulk; standard EPL xlsx + mail
│   │   │   │   └── migration.ts      ← Excel import from All_Prices.xlsx
│   │   │   └── export/
│   │   │       └── buildPriceListXlsx.ts ← ExcelJS builder, replicates reference format
│   │   ├── preload/
│   │   │   └── index.ts    ← contextBridge; all API methods exposed to renderer
│   │   ├── types/
│   │   │   └── index.ts    ← all shared TypeScript interfaces
│   │   └── renderer/
│   │       ├── main.tsx
│   │       ├── App.tsx     ← React Router, DbGuard, all routes
│   │       ├── lib/
│   │       │   ├── ipc.ts  ← typed wrapper: `export const api = window.api`
│   │       │   └── utils.ts  ← cn, formatDate, formatCurrency, todayISO, nextVersion, priceTypeLabel
│   │       ├── components/
│   │       │   ├── ui/     ← button, input, select, dialog, card, badge, toast, etc.
│   │       │   └── layout/ ← AppShell.tsx, Sidebar.tsx
│   │       └── screens/
│   │           ├── DatabaseSelector.tsx
│   │           ├── Dashboard.tsx               ← stats cards, recent price lists table; "+ New Price List" routes to /price-lists/new (gateway)
│   │           ├── Settings/
│   │           │   ├── SettingsScreen.tsx      ← DB path, logo, admin emails, units, packaging/currencies/hidden customers links, Standard EPL editing toggle, import button
│   │           │   ├── DeletedCustomersScreen.tsx ← lists soft-deleted customers; Restore or Delete Permanently per row
│   │           │   ├── CurrenciesScreen.tsx    ← route /settings/currencies: main currencies (USD/EUR, read-only) + other currencies (add/remove)
│   │           │   ├── PackagingScreen.tsx     ← route /settings/packaging: version list with row/customer counts; New Version dialog (clone-from support); Delete blocked if customers assigned
│   │           │   ├── PackagingVersionScreen.tsx ← route /settings/packaging/:version: per-row inline editor (type, name, price, currency, unit, sort); Add Row dialog; label rows (null price) shown as italic "label"
│   │           │   └── ImportScreen.tsx        ← dedicated import screen (route /settings/import): file picker, per-entity preview cards with checkboxes, selective import, results
│   │           ├── Customers/
│   │           │   ├── CustomersScreen.tsx     ← list with search (shows only active customers)
│   │           │   ├── CustomerDetail.tsx      ← inline editing, price list table, Hide Customer button; Packaging field is a dropdown (fetches packaging:list-versions)
│   │           │   └── ComparisonPanel.tsx     ← side-by-side price list diff
│   │           ├── PriceLists/
│   │           │   ├── PriceListsScreen.tsx    ← list with latest-only toggle, bulk export, bulk email compose dialog, compare button
│   │           │   ├── PriceListDetail.tsx
│   │           │   ├── NewPriceListGateway.tsx ← choice screen: Single Customer vs Mass Update (route /price-lists/new)
│   │           │   ├── CreatePriceList/        ← single-customer 4-step wizard (route /price-lists/create)
│   │           │   │   ├── index.tsx           ← WizardContext + reducer
│   │           │   │   ├── Step1SelectCustomer.tsx  ← fetches prev price list on customer select
│   │           │   │   ├── Step2ConfigurePricing.tsx ← 4 pricing methods (see below)
│   │           │   │   ├── Step3ReviewProducts.tsx  ← add/remove products, inline price edit
│   │           │   │   └── Step4ExportPreview.tsx
│   │           │   └── MassPriceList/          ← mass update 4-step wizard (route /price-lists/create/mass)
│   │           │       ├── index.tsx           ← MassWizardContext + reducer + shared computeLines()
│   │           │       ├── Step1SelectCustomers.tsx ← currency toggle, filter bar (name/region/date), customer table, loads entries on Next
│   │           │       ├── Step2ConfigureChange.tsx ← method + overrides + dates/comments + live preview
│   │           │       ├── Step3Preview.tsx    ← per-customer summary with expandable price detail rows
│   │           │       └── Step4CreateResults.tsx  ← sequential creation, results table, bulk export/email
│   │           ├── MasterData/MasterDataScreen.tsx   ← product CRUD (nav label: "Products")
│   │           └── StandardEpl/
│   │               ├── StandardEplScreen.tsx ← two tabs: “Standard Prices” (version selector, draft management, combined USD+EUR table, Export/Email buttons) and “Packaging Charges” (version selector, read-only table, Export/Email buttons)
│   │               └── StandardEplComparisonPanel.tsx ← side-by-side diff of two EPL versions (Changed / Added / Removed sections)
│   ├── forge.config.ts     ← IMPORTANT: contains packageAfterCopy for better-sqlite3
│   └── package.json
├── All_Prices.xlsx         ← original master data file for import
├── All_PricesTest.xlsx     ← test dataset
├── Logo.png                ← company logo for exports
└── CLAUDE.md               ← this file
```

---

## Database schema (SQLite, WAL mode)

```sql
customers            -- customer masterdata; currency TEXT NOT NULL (no CHECK — any currency code allowed);
                     -- main_supply_region IN ('ASIA','EUROPE','AMERICA') (nullable);
                     -- is_deleted INTEGER NOT NULL DEFAULT 0 (soft-delete flag)
products             -- product catalogue; rip_code UNIQUE
standard_epl_versions -- EPL version history; status IN ('draft','published'); one draft at most; seeded with version_id=1 'Initial' published
standard_epl         -- standard prices; UNIQUE(version_id, currency, rip_code); version_id FK → standard_epl_versions; USD and EUR rows only (CHECK enforced)
packaging            -- packaging charges + pallets; groups by packaging_version; null price = label/section header row (excluded from export output)
price_lists          -- price list headers; price_type IN ('Discount','Net Price','PrevPercent','PrevAbsolute'); has created_at DEFAULT datetime('now')
price_list_entries   -- one row per product per price list
admin_emails         -- shared email addresses (PBP Costing, PBP Common)
app_settings         -- key/value store (logo_path, db_path, email_subject_template, email_body_template)
                     -- note: standard_epl_editable key may exist in older DBs but is no longer used by the UI (replaced by draft/publish model)
units                -- configurable unit list; seeded with '100 KG', '100 L' on DB open
currencies           -- currency list; seeded with USD (is_main=1) and EUR (is_main=1); other currencies (is_main=0) can be added for one-off price lists
```

Pragmas set on every open: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`.

Schema runs `CREATE TABLE IF NOT EXISTS` so opening an existing DB is safe. Units table is seeded with `INSERT OR IGNORE`.

**DB migration (`migrateIfNeeded` in database.ts)** — runs on every `openDatabase` call after schema init. Contains two sequential migrations:

**Migration 1** — Widens the `price_type` CHECK constraint on `price_lists` to include `'PrevPercent'` and `'PrevAbsolute'`. Detection: checks `sqlite_master` for the old two-value constraint string; skips if already migrated. Uses `PRAGMA foreign_keys = OFF` and **`PRAGMA legacy_alter_table = ON`** before renaming `price_lists → _price_lists_old`, then creates new table, copies data, drops old. The `legacy_alter_table` pragma is critical: without it, SQLite 3.26.0+ automatically rewrites FK references in child tables during rename — so `price_list_entries.FOREIGN KEY → price_lists` silently becomes `→ _price_lists_old`, which breaks all subsequent inserts once `_price_lists_old` is dropped.

**Migration 2** — Fixes `price_list_entries` whose FK was already corrupted by a prior run of Migration 1 without `legacy_alter_table`. Detection: checks `sqlite_master` for `_price_lists_old` in the `price_list_entries` DDL. If found, recreates the table with the correct FK `REFERENCES price_lists(price_list_id)` and copies all data. This handles databases that were migrated with the buggy version of Migration 1.

**Migration 3** — Adds `main_supply_region TEXT CHECK (main_supply_region IN ('ASIA','EUROPE','AMERICA'))` to `customers`. Simple `ALTER TABLE ADD COLUMN`; existing rows default to `NULL`. Detection: checks `sqlite_master` for `main_supply_region` in the customers DDL.

**Migration 4** — Adds `is_deleted INTEGER NOT NULL DEFAULT 0` to `customers` for soft-delete. Simple `ALTER TABLE ADD COLUMN`; existing rows default to `0` (active). Detection: checks `sqlite_master` for `is_deleted` in the customers DDL.

**Migration 5** — Relaxes `customers.currency` CHECK constraint from `IN ('USD','EUR')` to no constraint (any currency code allowed). Uses rename/recreate pattern with `PRAGMA foreign_keys = OFF` (no `legacy_alter_table` needed here — no other tables have FK references to `customers`). Detection: checks for the old two-value constraint string in the `customers` DDL.

**Migration 6** — Adds `standard_epl_versions` table and `version_id` column to `standard_epl`; changes UNIQUE constraint from `(currency, rip_code)` to `(version_id, currency, rip_code)`. Detection: checks `sqlite_master` for `version_id` in the `standard_epl` DDL; skips if already migrated. Uses rename/recreate pattern with `PRAGMA foreign_keys = OFF` + **`PRAGMA legacy_alter_table = ON`** (consistent with Migrations 1/2/5 even though no other table FKs into `standard_epl`). Seeds `standard_epl_versions` row with `version_id=1, version_name='Initial', status='published'` via SEED_SQL (runs before `migrateIfNeeded`), so the migration can safely assign all existing rows `version_id=1`. After migration, exports and price-list creation use `getLatestPublishedEplVersionId()` helper (exported from `database.ts`) to resolve the current active version.

**Indexes:** Three performance indexes are created: `idx_price_lists_customer` (for customer filter), `idx_price_list_entries_pl` (for entry lookups), `idx_standard_epl_currency` (for currency filter).

**`price_lists.created_at`** — automatically set on insert via `DEFAULT (datetime('now'))`. `price-lists:list` orders by `created_at DESC`, so `lists[0]` is always the most recent. This is how Step 1 of the wizard finds the customer's latest price list to pre-populate products.

**price-lists:create side effect** — after saving the price list and entries, it also updates `customers.last_price_list_version`, `last_price_list_id`, `effective`, `mailing_date` for the customer. This keeps the customers table in sync with the latest list without a separate query.

---

## IPC channel naming convention

All channels follow `entity:action`. The preload (`src/preload/index.ts`) exposes every channel as a typed method on `window.api`. The renderer only ever calls `api.someMethod()` — never `ipcRenderer` directly.

**Channel list (grouped):**
```
db:select-file, db:open, db:create, db:get-path, db:is-open
customers:list, customers:get, customers:create, customers:update, customers:delete
customers:soft-delete, customers:restore, customers:list-deleted, customers:delete-permanent
products:list, products:create, products:update, products:delete
standard-epl:list-versions, standard-epl:list, standard-epl:list-combined, standard-epl:update-price, standard-epl:upsert
standard-epl:create-draft, standard-epl:publish-draft, standard-epl:delete-draft, standard-epl:update-draft-meta, standard-epl:delete-row
packaging:list, packaging:update-price, packaging:list-versions, packaging:create-version, packaging:delete-version, packaging:add-row, packaging:update-row, packaging:delete-row
price-lists:list, price-lists:get, price-lists:create, price-lists:delete, price-lists:stats
export:xlsx, export:xlsx-bulk, export:open-mail-with-attachment, export:open-mail-bulk, export:standard-epl-xlsx, export:standard-epl-mail, export:packaging-xlsx, export:packaging-mail
settings:get, settings:set, settings:get-admin-emails, settings:update-admin-email
settings:get-units, settings:create-unit, settings:delete-unit, settings:select-logo
currencies:list, currencies:create, currencies:delete
migration:select-file, migration:preview-excel, migration:import-excel
```

---

## Key implementation details

### Excel export (buildPriceListXlsx.ts)
- Uses ExcelJS; replicates a specific reference format exactly
- Row layout: rows 1-2 logo space → rows 3-6 header info → row 7 empty → row 8 "EXPORT PRICES" → row 9 disclaimer → row 10 column headers → product rows → blank → packaging section → contact row
- Logo positioned top-right covering cols D-F rows 1-6 (added last so anchor doesn't pre-create rows)
- Uses `centerContinuous` alignment (not merge) for "EXPORT PRICES" and packaging section headers — adjacent cells must be empty (null value) for this to work in Excel
- Column widths: A=20, B=18, C=50, D=20, E=14, F=16
- Packaging section groups by `product_type`, filters `price !== null` rows (null-price rows are section headers in the DB but excluded from export output — groupBy already handles this)
- Top 10 rows frozen, gridlines hidden: `ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 10, showGridLines: false }]`
- Contact row uses admin email selected by `LIKE '%Common%' OR LIKE '%common%'` — picks the "PBP Common" shared inbox
- Price cells use `#,##0.00` number format (Excel formats, not renderer-side strings)

### Migration (migration.ts)

Two IPC handlers:
- **`migration:preview-excel`** — read-only scan; reads the file and returns a `ImportPreview` object (one `SheetPreview` per entity) with counts, sample names, and notes. **No DB writes.** Used by `ImportScreen` before the user commits.
- **`migration:import-excel`** — accepts `(filePath, options?: ImportOptions)`. `ImportOptions` has one boolean per entity (`adminEmails`, `customers`, `products`, `standardEpl`, `packaging`, `priceLists`); defaults all to `true` for backwards compatibility. Only the selected entities are written.

Both handlers share the same parsing logic (column indices, `clean()`, `trimOnly()`, `safeFloat()`, `excelDateToISO()`).

Critical bugs that were fixed — do not revert:
1. **EUR column indices in Standard EPL sheet**: USD is cols 0-5, EUR is cols **8-13** (cols 6-7 are NULL separators). Old code used 6-11 → all EUR rows silently skipped.
2. **Packaging currency operator precedence**: `clean(r[4]) ?? (version.includes('EUR') ? 'EUR' : 'USD')` — the parentheses are required. Without them JS parses it as `(clean(r[4]) ?? version.includes('EUR')) ? 'EUR' : 'USD'` which always returns `'EUR'`.
3. **Packaging header detection**: `clean()` removes spaces, so compare against `'PackaginVersion'` and `'PackagingVersion'` (not the original strings with spaces).
4. **Duplicate entries on re-import**: Before inserting price list entries, `DELETE FROM price_list_entries WHERE price_list_id = ?` is called within `seenPriceLists` guard.
5. **isOpen() guard**: migration handler returns a friendly error if no DB is open instead of throwing raw SQLite error.
6. **Packaging name/type spaces stripped**: `clean()` strips all ASCII spaces, so "Packaging Charge" → `"PackagingCharge"`. Fixed by using `trimOnly()` for `packaging_name` (col2) and `product_type` (col1). Same root cause as the admin email doubling bug (bug #7 below). Rule: **never use `clean()` on human-readable display names**.
7. **Admin email display name spaces stripped**: `email_name` field passed through `clean()` → "PBP Common Mail Box" → `"PBPCommonMailBox"`, creating a new unique key on each import and doubling rows. Fixed by using `String(row[0] ?? '').trim()` (i.e. `trimOnly`) for `email_name`, plus DELETE-all + re-insert pattern for admin emails.
8. **Customers/Products/Standard EPL/Price Lists display names stripped**: Same `clean()` bug propagated to customers (`customer_short_name`, `customer_full_name`, `country`, `customer_type`, `comment_on_business_model`, `price_list_managed_by`, `customer_spoc`), products (`product_type`, `product_name`), standard_epl (`product_type`, `product_name`, `unit`), and price_list_entries (`product_type`, `product_name`, `unit`, `comments_about_changes`). All fixed by switching these display name fields to `trimOnly()`.

### clean() and trimOnly() functions (migration.ts)
```typescript
function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/ /g, '');  // removes regular spaces only
  return s === '' ? null : s;
}
// Note: .trim() does remove \xa0 (non-breaking space) in JavaScript
// Note: .replace(/ /g, '') removes regular ASCII spaces — results have no spaces
// Consequence: cleaned strings must be compared against space-stripped versions
// USE FOR: identifiers and codes (SAP refs, RIP codes, currency codes, version names for detection)
// DO NOT USE FOR: human-readable display names — use trimOnly() instead

function trimOnly(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
// USE FOR: display names that must preserve internal spaces:
//   - packaging_name (e.g. "Packaging Charge", "IBC 1000L")
//   - product_type display labels (e.g. "Base Oils")
//   - admin email_name (e.g. "PBP Common Mail Box")
// Past bugs: using clean() on these fields stripped spaces, creating new unique keys
// on each import and either corrupting data or doubling rows.
```

### Price list creation wizard (CreatePriceList/)
4-step flow with shared `WizardContext` reducer:
1. **Step 1** — customer + dates; on customer select, async fetches their latest price list entries → `previousEntries` in wizard state
2. **Step 2** — pricing method selector (4 options, see below); computes product lines from `previousEntries`. If no previous list, starts empty.
3. **Step 3** — review/edit prices, remove products, add products from EPL catalogue via dialog
4. **Step 4** — auto-saves price list to DB on mount (no user action needed); export button triggers native save dialog; mail button only enabled after export

**Step 2 pricing methods** — `WizardState.price_type` stores one of four values:

| `price_type` | Label | `discount_percent` stores | Available when |
|---|---|---|---|
| `'Discount'` | % Discount from Standard EPL | discount % (0–99.99) | always |
| `'Net Price'` | Enter Net Prices Directly | `null` | always |
| `'PrevPercent'` | % Change from Previous List | signed change % (e.g. 5 or -3.5) | requires `previousEntries` |
| `'PrevAbsolute'` | Fixed Amount Change from Previous List | signed amount (e.g. 10 or -5.5) | requires `previousEntries` |

- `'Discount'` applies the % to the **standard EPL price** for each product (falls back to previous price if no EPL row exists).
- `'PrevPercent'` applies `prev_price × (1 + pct/100)` to each entry in the **previous price list**.
- `'PrevAbsolute'` applies `prev_price + amount` to each entry in the **previous price list**.
- `'Net Price'` pre-loads previous prices unchanged; user edits freely in Step 3. No overrides available for this method.
- Methods requiring `previousEntries` are rendered disabled (greyed out) when no previous list is found.
- All methods (except Net Price) show a live price preview table as the user types the value.
- `discount_percent` is repurposed for the signed value in `PrevPercent` / `PrevAbsolute` — the meaning depends on `price_type`.

**Granular overrides (three-level pricing)** — for all methods except `'Net Price'`, Step 2 shows two optional override sections below the base value. The same method applies at every level; only the value differs. Resolution order: **product (RIP) override > product-type override > all-products base**.

`WizardState` carries:
```typescript
typeOverrides: Override[];  // level 2 — per product_type
ripOverrides:  Override[];  // level 3 — per rip_code
// Override = { scopeValue: string; valueStr: string }
// valueStr is the raw input string; parsed to float during computation; invalid/empty → fall through to next level
```

- **Product Type Overrides**: dropdown lists unique `product_type` values from the standard EPL. Each selected type is removed from other rows' options to prevent duplicates.
- **Product Overrides**: dropdown lists all EPL products (`rip_code — product_name`), same duplicate prevention.
- Clicking "+ Add" inserts a new row defaulting to the first unused option and copying the current base value as the starting `valueStr`.
- Switching the pricing method resets all overrides (values have different meanings across methods) — handled in the reducer's `SET_FIELD` case for `price_type`.
- The preview table shows a `type` (blue) or `product` (amber) badge per row when an override is applied; rows using the base value show nothing.
- Overrides are wizard-only state — they are not stored in the DB. Only the final computed `net_price` per product ends up in `price_list_entries`. `discount_percent` on the header row always stores the all-products base value.

**Step 3 behaviour for all methods**: `isNetPrice` is `true` for every method except `'Discount'` (prices are freely editable). When adding a new product from the EPL catalogue in Step 3, `'Discount'` mode applies the discount to the EPL price; all other modes use the raw EPL price as a starting point. The Step 3 subtitle notes how many granular overrides were applied (e.g. "with 3 granular overrides").

**Step 4 sequential dependency**: DB save → export to file → open mail client. Each step is gated on the previous one completing successfully.

**Single price list email** (Step 4) uses a hardcoded subject/body, not the saved template from bulk email settings. Template: subject = `"Price List — {shortName} — {version}"`, body = fixed greeting text. This is intentional (quick one-off) but is inconsistent with bulk email — something to unify if needed later.

### Mass Price Update wizard (MassPriceList/)

Route: `/price-lists/create/mass`. 4-step flow driven by `MassWizardContext` + reducer in `MassPriceList/index.tsx`. Entry point is `NewPriceListGateway.tsx` at `/price-lists/new`, which offers "Single Customer" or "Mass Update" choices.

**Shared `computeLines()` function** — exported from `index.tsx`, called by both Step 3 (preview display) and Step 4 (DB save). Applies method + overrides to a customer's existing price list entries:

```typescript
export function computeLines(
  entries: ProductLine[],         // customer's existing price list entries
  price_type: MassPriceMethod,
  baseVal: number,                // 0 for 'Net Price' carry-forward
  typeOverrides: Override[],      // per product_type
  ripOverrides:  Override[],      // per rip_code (highest priority)
  eplByRip: Map<string, StandardEplRow>,
): ProductLine[]
// Resolution: RIP override > product-type override > baseVal
// 'Net Price': treated as PrevAbsolute with baseVal=0 (carry forward, delta overrides still apply)
// 'Discount': applies % to EPL price, falls back to entry.net_price if no EPL row
// Skip-silently: overrides targeting RIPs/types not in a customer's list are ignored
```

**`MassPriceMethod` type**: `'Discount' | 'PrevPercent' | 'PrevAbsolute' | 'Net Price'`

| Method | UI Label | Meaning |
|---|---|---|
| `'PrevAbsolute'` | Fixed Amount Change | `prev_price + amount` per product |
| `'PrevPercent'` | % Change from Previous | `prev_price × (1 + pct/100)` |
| `'Discount'` | % Discount from Standard EPL | `epl_price × (1 − pct/100)` |
| `'Net Price'` | Carry Forward (no change) | copies prices unchanged; delta overrides still applied |

**Step 1 — Select Customers**: Currency toggle (USD/EUR) at top; switches `SET_CURRENCY`, clears selection, and resets all filters. Filter bar below the header: text search (by customer name), supply region dropdown (All / ASIA / EUROPE / AMERICA), and effective date range (From / To, applied to the customer's latest effective date). A "Clear filters" link appears when any filter is active. Customers without any price list in the selected currency are greyed out/non-selectable but still visible. The select-all checkbox and "N customers selected" count reflect only the currently filtered visible rows. On Next: calls `api.getPriceList()` in parallel for all selected customers to load their latest entries into `selectedRows`, then advances to Step 2. Back navigates to `/price-lists/new`.

**Step 2 — Configure Change**: Four method cards. Base value input hidden for "Net Price" (shows info banner instead). Same override system as single wizard: Product Type Overrides + Product (RIP) Overrides. Dates (effective, mailing) and comments fields. Live preview table shows first selected customer's computed prices via `computeLines()`. Summary: "N customers · N total products · currency". Validation: effective/mailing required; base value required for non-carry-forward; discount 0–99.99; all override valueStr must be numeric.

**Step 3 — Preview**: Summary bar (method badge, effective, mailing date, currency, comments). Per-customer table: customer name, base version, new version (blue), product count. Rows are clickable to expand, showing up to 20 products with previous → new price columns.

**Step 4 — Create Results**: On mount, loads Standard EPL for the selected currency, then sequentially creates each price list (to avoid DB contention) via `computeLines()` + `api.createPriceList()`. Stored to DB as: `price_type` set to the method value; "Net Price" carry-forward stored as `price_type: 'Net Price'` with `discount_percent: null`; all others store the base value in `discount_percent`. Results table shows status per customer (pending → spinner → ok/error). After all saved: "Export All" and "Email All" buttons using saved email templates (`email_subject_template`, `email_body_template`).

**Version numbering**: each customer's new version is auto-incremented from their latest price list version, same logic as single wizard (`nextVersion()` in `utils.ts`). Version is determined per-customer in Step 1 and stored in `selectedRows`.

**No new products in mass mode**: mass update is repricing only. Overrides targeting products/types not already in a customer's price list are silently skipped. No mechanism to add new products across multiple customers at once.

### Customer soft-delete (hide/restore)

Customers can be hidden from the customer card using the **Hide** button (EyeOff icon). This sets `is_deleted = 1` in the `customers` table — no data is moved or copied.

**Filtering is done entirely at the IPC layer**, so no renderer code outside of the settings pages needs to know about `is_deleted`:
- `customers:list` — `WHERE is_deleted = 0` → active customers only
- `price-lists:list` and `price-lists:stats` — `AND (c.is_deleted IS NULL OR c.is_deleted = 0)` via the existing LEFT JOIN. The `IS NULL` guard handles orphaned price lists (no matching customer row at all).
- All wizards, customer selectors, and the price list screen automatically exclude hidden customers without any changes to their code.

**New IPC handlers:**
- `customers:soft-delete` — `UPDATE customers SET is_deleted = 1`
- `customers:restore` — `UPDATE customers SET is_deleted = 0`
- `customers:list-deleted` — `SELECT * FROM customers WHERE is_deleted = 1`
- `customers:delete-permanent` — transaction: deletes all `price_list_entries` for the customer's lists, then `price_lists`, then the `customers` row

**Settings → Hidden Customers** (`DeletedCustomersScreen.tsx`, route `/settings/deleted-customers`): table of all hidden customers with Restore and Delete Permanently actions. Delete Permanently shows a confirm dialog and runs `customers:delete-permanent`.

### Customer masterdata fields

`customers` table has additional fields beyond the import schema:
- `main_supply_region` — `TEXT CHECK (main_supply_region IN ('ASIA','EUROPE','AMERICA'))`, nullable. Editable via a dropdown in the CustomerDetail Details card. Displayed as "Supply Region" column in Mass Price Update Step 1.
- `is_deleted` — `INTEGER NOT NULL DEFAULT 0`. Managed via soft-delete flow; never edited directly.
- `currency` — `TEXT NOT NULL`, no CHECK constraint (removed in Migration 5). Any code from the `currencies` table can be used. Dropdown in CustomerDetail loads options from `currencies:list` at runtime.

### Currencies

Managed via the `currencies` table (`code TEXT UNIQUE, is_main INTEGER`). Seeded on DB open with `USD` (is_main=1) and `EUR` (is_main=1).

**Main currencies (USD, EUR):**
- Full Standard EPL price reference support
- Available in Mass Price Update wizard
- Non-removable in the UI

**Other currencies (e.g. GBP):**
- Added by the user via Settings → Currencies
- No Standard EPL rows — one-off price lists only
- Cannot be used in Mass Price Update (those customers won't appear when the USD/EUR toggle is selected in Step 1)
- `currencies:delete` blocks deletion if any customer (active or deleted) is still assigned that currency

**Customer currency dropdown** (`CustomerDetail.tsx`) fetches `currencies:list` on mount and renders all codes as options. The currency is stored as a plain string in `customers.currency` — no FK enforced in SQLite.

### Packaging management (Settings → Packaging)

Managed via the existing `packaging` table — no schema changes required. The table already supported multiple named versions side-by-side.

**`packaging` table columns:** `packaging_version TEXT`, `product_type TEXT`, `packaging_name TEXT`, `price REAL` (null = label/section header row, excluded from export), `currency TEXT`, `unit TEXT`, `sort_order INTEGER`.

**Settings → Packaging** (`PackagingScreen.tsx`, route `/settings/packaging`):
- Lists all distinct `packaging_version` values with currency, row count, active customer count
- **+ New Version** dialog: enter a name; optionally clone rows from an existing version (most common flow for non-standard currencies, e.g. clone EUR-Standard → GBP-Custom, then adjust prices)
- **Delete** blocked if any customer (active or soft-deleted) references that version

**Settings → Packaging → Version editor** (`PackagingVersionScreen.tsx`, route `/settings/packaging/:version`):
- Table of all rows for that version, ordered by `sort_order`
- Per-row inline edit (all fields: type, name, price, currency, unit, sort order) — click Edit → all cells become inputs → Save/Cancel
- Null-price rows displayed as italic "label" tag; they appear in the DB but are excluded from the export output by `buildPriceListXlsx`
- **+ Add Row** dialog: currency pre-filled from existing rows; sort_order pre-filled as max+10

**`packaging:delete-version`** — checks `COUNT(*) FROM customers WHERE packaging_version = ?` (no `is_deleted` filter — blocks even if only hidden customers use it).

**`packaging:update-row`** — whitelists column names before building dynamic SQL: `['product_type', 'packaging_name', 'price', 'currency', 'unit', 'sort_order']`.

**Customer Packaging field** (`CustomerDetail.tsx`) — upgraded from free-text `ERow` to a dropdown that fetches `packaging:list-versions` on mount. If the customer's current `packaging_version` is not found in the list (edge case), it is still shown as a selectable option to prevent the select from jumping to a different value silently.

### PriceListsScreen.tsx — list view
Default view shows **one row per customer** — the price list with the latest `effective` date ("Latest only" mode). A toggle button in the filter bar switches to "View all" to show every price list, then back. The subtitle reflects the mode: `N customers` (latest only) or `N of Total price lists` (all). Null `effective` dates are treated as oldest so a dated list always wins. Switching the toggle clears the current selection to avoid stale state. Filtering by customer or search text is applied first; the latest-only reduction runs after.

**Compare button** — always visible in the filter bar. Enabled (blue) when exactly 2 rows are checked; disabled (grey, "Select 2 to compare") otherwise. Clicking it sets `comparing: { idA, idB }` state and renders a `<ComparisonPanel>` below the table (same component used in CustomerDetail). The page auto-scrolls to the panel on open. Panel has its own "Close" button.

### Bulk email compose dialog (PriceListsScreen.tsx)
Clicking "Email (N)" opens a compose dialog with Subject + Body fields. Supports `{customer}`, `{customer_full}`, `{version}`, `{effective}` placeholders (substituted per customer at send time). Template auto-saved to `app_settings` (`email_subject_template`, `email_body_template`) on send, and reloaded from settings on next open.

**Email recipients** (both single and bulk): combines `email_to_customer`, `email_internal_copy`, `email_pbp_copy`, `email_pbp_common` from the customer record, filters out null/empty, joins with `;`. All four addresses can be present simultaneously.

**Bulk flow**: user selects N price lists → clicks "Email (N)" → compose dialog → "Send" → for each selected list: exports xlsx to a chosen folder, opens a mail draft. The folder picker appears once before the loop starts.

### priceTypeLabel (utils.ts)
Shared helper used by all badge display locations (PriceListsScreen, CustomerDetail, Dashboard, PriceListDetail, Step4ExportPreview). Returns a short human-readable label for any `price_type` + `discount_percent` combination:
- `'Discount'` → `"10% disc."`
- `'Net Price'` → `"Net Price"`
- `'PrevPercent'` → `"+5% adj."` / `"-3.5% adj."`
- `'PrevAbsolute'` → `"+10 adj."` / `"-5.5 adj."`

When adding a new `price_type` value, update this function and the DB CHECK constraint together.

### Standard units (Settings + StandardEplScreen)
Units stored in `units` table; seeded on DB open. Settings screen has a "Standard Units" card for add/remove. StandardEplScreen uses a `<select>` dropdown (not text input) for unit editing.

### Standard EPL versioning (draft/publish model)

The Standard EPL uses a **draft/publish versioning model** — all published versions are permanently read-only; the only editable surface is the current draft (at most one at a time).

**Mental model:**
- Always one **latest published version** (the active baseline, used by all price list creation and exports by default)
- At most one **draft** being prepared (cloned from a published version)
- Publishing a draft creates a new immutable published version; old versions are retained for history and comparison
- Replaced the former `standard_epl_editable` Settings toggle — that approach is gone

**StandardEplScreen (`StandardEplScreen.tsx`):**
- **Version selector dropdown** — lists all published versions + draft (if any); shows latest published by default; each version has a status badge (● Active green, ◐ Draft amber, ○ Older gray)
- **Draft management bar** (amber banner, visible only when draft is selected) — shows draft name + notes; "Publish" button opens the publish modal; "Discard Draft" shows a confirm dialog
- **"New Version" button** (shown only when no draft exists) — dialog: version name input, clone-from published version selector, optional notes textarea
- **Read-only banner** — displayed when viewing a published version; message differs based on whether a draft already exists
- **Add Product button** (draft only) — dialog with searchable product list, USD price, USD unit, EUR price, EUR unit inputs; calls `standard-epl:upsert` for each currency with a price
- **Delete row button** per product row (draft only, hover-reveal trash icon) — calls `standard-epl:delete-row`; product disappears entirely because `list-combined` filters out products with no price entries for the selected version (`WHERE usd.id IS NOT NULL OR eur.id IS NOT NULL`)
- **Price/unit editing** — click-to-edit only when draft is selected; `PriceCell` is called as a plain function `{PriceCell({ row, currency })}` (not JSX `<PriceCell .../>`); this is intentional to avoid React unmount/remount on every re-render (see React pattern note below)
- **Compare versions** toggle — inline version A/B selectors and `StandardEplComparisonPanel` rendered below the table

**React pattern — `PriceCell` as function call:**
`PriceCell` is defined as a nested function inside `StandardEplScreen`. If used as a JSX element `<PriceCell .../>`, React treats each re-render as a new component type (different function reference) and unmounts/remounts it — destroying focus and firing stale `onBlur` with the original price. Calling it as `{PriceCell({ row, currency })}` inlines its output into the parent virtual DOM: no separate lifecycle, no unmount, edits save correctly. Do not revert to JSX element syntax.

**IPC channel details:**
- `standard-epl:list-versions` — returns all versions ordered: draft first, then published DESC by `published_at`; includes `row_count` subquery
- `standard-epl:list-combined` — accepts optional `versionId`; defaults to latest published; `WHERE usd.id IS NOT NULL OR eur.id IS NOT NULL` ensures only products with at least one price entry for the version appear
- `standard-epl:update-price` — validates row belongs to a draft before updating; errors on published version
- `standard-epl:upsert` — validates draft status; uses `ON CONFLICT (version_id, currency, rip_code) DO UPDATE SET`
- `standard-epl:create-draft` — checks no existing draft; inserts version row; clones all standard_epl rows from sourceVersionId
- `standard-epl:publish-draft` — requires `effectiveFrom`; sets status/published_at/effective_from/notes/name
- `standard-epl:delete-draft` — transaction: deletes all standard_epl rows then version row
- `standard-epl:delete-row` — deletes all rows for `(versionId, ripCode)` (both USD and EUR); draft only
- `getLatestPublishedEplVersionId()` — exported helper from `database.ts`; resolves current active version for export handlers and migration import

**Comparison panel (`StandardEplComparisonPanel.tsx`):**
- Props: `versionIdA`, `versionIdB`, `versions`, `onClose`
- Fetches `getStandardEplCombined(versionIdA)` and `getStandardEplCombined(versionIdB)`
- Sections: Changed / Added (in B not A) / Removed (in A not B); columns: RIP, Product, USD A, USD B, USD Δ%, EUR A, EUR B, EUR Δ%
- Color-coded deltas: red for price increase, green for decrease

### Standard EPL export

**StandardEplScreen tab layout**: the screen has two underlined tabs — "Standard Prices" and "Packaging Charges". Export/Email buttons in the top-right header swap based on the active tab. The lock banner and search bar are Standard Prices tab only.

#### Standard Prices tab export

Two independent action buttons (top-right, always visible, disabled only when no rows loaded):

- **"Export EPL to Excel"** — calls `export:standard-epl-xlsx`; shows native save dialog; default filename `Standard-EPL-{version_name}-YYYY-MM-DD.xlsx`. Toast on success/error.
- **"Email EPL"** — calls `export:standard-epl-mail`; saves to `os.tmpdir()` automatically (no dialog); opens Outlook / Mail.app draft with the file attached, subject `"Standard EPL Prices — {version_name} — YYYY-MM-DD"`, To field empty. Toast on error.

Both buttons pass `selectedVersionId` so the export always reflects the currently viewed version (draft or any published). Both work independently — email does not require a prior export to disk.

**`export:standard-epl-xlsx` and `export:standard-epl-mail` handlers** (in `export.ts`):

```
fetchStandardEplRows(versionId)  — LEFT JOIN standard_epl for USD and EUR filtered by version_id;
                                   WHERE usd.id IS NOT NULL OR eur.id IS NOT NULL (same guard as list-combined)
                                   Runs directly against DB (no IPC round-trip); defaults to getLatestPublishedEplVersionId()
buildStandardEplXlsx()           — ExcelJS table: columns RIP Code / Product Type / Product Name / USD Price / USD Unit / EUR Price / EUR Unit
                                   Bold header row, light gray fill (#F2F2F2), thin bottom border, frozen row 1
                                   Column widths: 16 / 22 / 46 / 13 / 13 / 13 / 13
                                   Price cells use #,##0.00 number format; null prices → empty cell
                                   No logo, no customer header — internal use only
```

The email handler passes `to: ''` so the draft opens with an empty To field (internal recipient varies each time).

#### Packaging Charges tab

Read-only table of packaging rows for the selected version. Version selector dropdown at top (defaults to first version); rows reload on version change. Null-price rows (section labels) displayed as italic grey "label" text — same display as Settings → Packaging editor but without edit/delete controls. A small note at the bottom links users to Settings → Packaging for edits.

Two export buttons (top-right, disabled when no version selected or no rows):

- **"Export to Excel"** — calls `export:packaging-xlsx`; shows native save dialog; default filename `Packaging-{version}-YYYY-MM-DD.xlsx` (version sanitized for filesystem: `[/\\:*?"<>|]` → `-`).
- **"Email"** — calls `export:packaging-mail`; saves to `os.tmpdir()`, opens mail draft, subject `"Packaging Charges — {version} — YYYY-MM-DD"`, To blank.

**`export:packaging-xlsx` and `export:packaging-mail` handlers** (in `export.ts`):

```
fetchPackagingRows(db, version)  — SELECT * FROM packaging WHERE packaging_version = ? ORDER BY sort_order
buildPackagingXlsx(version, rows) — ExcelJS table: columns Type / Name / Price / Currency / Unit
                                    Bold header row, light gray fill, thin bottom border, frozen row 1
                                    Column widths: 22 / 36 / 14 / 12 / 14
                                    Price cells use #,##0.00 numFmt; null prices → empty cell
```

### products:update cascade
When a product's `product_name` or `product_type` is updated, the handler also updates matching rows in `standard_epl`. When a product is deleted, its `standard_epl` rows are deleted first (no FK cascade in SQLite without `ON DELETE CASCADE` — handled manually).

### Migration helpers (migration.ts)
- `excelDateToISO()` handles both Excel serial numbers (`(serial - 25569) * 86400 * 1000`) and strings already in `YYYY-MM-DD` or parseable format — returns `null` for empty/unparseable values.
- `safeFloat()` parses numeric values safely, returning `null` on failure.
- `XLSX.readFile(filePath, { cellDates: false })` — `cellDates: false` is intentional; we handle date conversion ourselves to avoid timezone drift from SheetJS Date objects.

---

## Build commands

```bash
cd epl-tool
npm install          # install dependencies
npm start            # dev mode with Vite HMR (DevTools auto-open in dev)
npm run package      # build unpackaged app (dev/testing only, no installer)
npm run make         # build distributable installers (Squirrel .exe + ZIP for Windows)
```

**When to use which command:**
- `npm start` — sufficient for renderer-only changes (`src/renderer/`); Vite HMR picks them up instantly.
- `npm run package` — required for any change in `src/main/` (IPC handlers, database, export logic, `index.ts`). Use for local testing; produces an unpacked app in `out/`.
- `npm run make` — produces the release artifacts: Squirrel Windows installer (`.exe`) and a ZIP. Run this before creating a GitHub release. Windows builds are also produced automatically via GitHub Actions on push to `main`.

Always run one of these after every code change — renderer HMR only works in `npm start` dev mode, not in the packaged app.

### forge.config.ts — native module packaging

`NATIVE_MODULES = ['better-sqlite3', 'bindings', 'file-uri-to-path', 'xlsx']`

The `packageAfterCopy` hook copies these into the packaged app's `node_modules/` alongside the asar:
- `better-sqlite3`, `bindings`, `file-uri-to-path` — contain compiled `.node` binaries (native addons)
- `xlsx` — uses `require('fs')` internally; Vite bundling breaks that call, so it must remain external

Additionally: `asar.unpack: '**/*.node'` unpacks `.node` binaries from the asar so Electron can `dlopen` them at runtime.

`NSAppleEventsUsageDescription` is set in `extendInfo` so macOS shows the "Allow EPL Tool to control Mail?" permission dialog instead of returning Apple Events error `-1743`.

### DB path persistence — two layers

The app remembers the last-opened DB via two parallel mechanisms:
1. **`settings.json`** in `app.getPath('userData')` — written by `saveDbPath()` in `main/index.ts`. Read on startup by `getSavedDbPath()` to auto-reconnect.
2. **`app_settings` table** key `db_path` — written inside the DB itself on `db:open` / `db:create`. Used by the renderer to show the current path.

Both are updated together when a DB is opened or created. The `userData` file persists across DB changes; the in-DB key is only readable after the DB is open.

---

## GitHub Actions (Windows build)

`.github/workflows/build-windows.yml` — triggers on push to `main` when `epl-tool/**` files change, or manually. Runs on `windows-latest`, runs `npm ci` + `npm run make`, uploads artifact `EPL-Tool-Windows` (30-day retention).

---

## Data import workflow

**Entry point**: Settings → "Import from Excel…" button → navigates to `/settings/import` (`ImportScreen.tsx`).

**Three-phase flow on one page:**

1. **File selection** — "Select File…" button calls `migration:select-file`; on pick immediately calls `migration:preview-excel` (read-only, no DB writes).

2. **Preview** — per-entity cards appear, each with:
   - Checkbox (all enabled by default); disabled if the sheet is not present in the file
   - Record count badge from the preview scan
   - Sample names (first 3 identifiers)
   - Entity-specific notes: USD/EUR split for Standard EPL; version list for Packaging; customer count + date range for Price Lists
   - Amber warning for rows that would be skipped (missing key field) and for packaging full-replacement

3. **Import** — "Import Selected (N)" calls `migration:import-excel(filePath, options)` where `options` is the `ImportOptions` object built from the checkboxes. Results appear inline on each card (green "✓ N imported" or red "Failed").

**Import order** (within a single call, only selected entities run): `admin_emails` → `customers` → `products` → `standard_epl` → `packaging` → `price_lists` + `price_list_entries`. All operations are `INSERT OR REPLACE` (idempotent) except packaging which `DELETE`s first.

**Standard EPL import targets the latest published version** — the import handler calls `getLatestPublishedEplVersionId()` and upserts all EPL rows into that version (not a draft). This is intentional: import is a privileged admin operation that writes directly to the active baseline. If a draft exists, it is not affected by the import.

**Types** (`src/types/index.ts`): `SheetPreview` (per-entity scan result), `ImportPreview` (all six sheets), `ImportOptions` (six booleans).

---

## Decisions not to revisit without good reason

- **Two tables (products + standard_epl)**: standard_epl has currency-specific rows (same rip_code appears twice for USD and EUR). Merging into one table would require price_usd/price_eur columns, which breaks partial pricing and different currencies.
- **Electron over web stack**: Corporate IT cannot provision servers. Web stack (Python + PostgreSQL + Entra ID) was evaluated and deferred until IT can provide infrastructure.
- **SQLite over PostgreSQL**: Single user, file on SharePoint. WAL mode handles network latency adequately.
- **Email via mail client**: No SMTP credentials available; AppleScript/Outlook COM opens a draft the user reviews before sending.
