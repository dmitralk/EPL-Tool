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
│   │   │   │   ├── standardEpl.ts    ← includes list-combined (LEFT JOIN) and upsert
│   │   │   │   ├── packaging.ts
│   │   │   │   ├── settings.ts       ← DB open/create, logo, admin emails, units
│   │   │   │   ├── export.ts         ← xlsx single/bulk, mail single/bulk
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
│   │       │   └── utils.ts
│   │       ├── components/
│   │       │   ├── ui/     ← button, input, select, dialog, card, badge, toast, etc.
│   │       │   └── layout/ ← AppShell.tsx, Sidebar.tsx
│   │       └── screens/
│   │           ├── DatabaseSelector.tsx
│   │           ├── Dashboard.tsx
│   │           ├── Settings/SettingsScreen.tsx
│   │           ├── Customers/
│   │           │   ├── CustomersScreen.tsx     ← list with search
│   │           │   ├── CustomerDetail.tsx      ← inline editing, price list table
│   │           │   └── ComparisonPanel.tsx     ← side-by-side price list diff
│   │           ├── PriceLists/
│   │           │   ├── PriceListsScreen.tsx    ← list with latest-only toggle, bulk export, bulk email compose dialog
│   │           │   ├── PriceListDetail.tsx
│   │           │   └── CreatePriceList/        ← 4-step wizard
│   │           │       ├── index.tsx           ← WizardContext + reducer
│   │           │       ├── Step1SelectCustomer.tsx  ← fetches prev price list on customer select
│   │           │       ├── Step2ConfigurePricing.tsx ← discount or net price mode
│   │           │       ├── Step3ReviewProducts.tsx  ← add/remove products, inline price edit
│   │           │       └── Step4ExportPreview.tsx
│   │           ├── MasterData/MasterDataScreen.tsx   ← product CRUD
│   │           └── StandardEpl/StandardEplScreen.tsx ← combined USD+EUR table, click-to-edit
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
customers       -- customer masterdata; currency IN ('USD','EUR')
products        -- product catalogue; rip_code UNIQUE
standard_epl    -- standard prices; UNIQUE(currency, rip_code); USD and EUR rows separate
packaging       -- packaging charges + pallets; groups by packaging_version
price_lists     -- price list headers; price_type IN ('Discount','Net Price'); has created_at DEFAULT datetime('now')
price_list_entries -- one row per product per price list
admin_emails    -- shared email addresses (PBP Costing, PBP Common)
app_settings    -- key/value store (logo_path, db_path, email_subject_template, email_body_template)
units           -- configurable unit list; seeded with '100 KG', '100 L' on DB open
```

Pragmas set on every open: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`.

Schema runs `CREATE TABLE IF NOT EXISTS` so opening an existing DB is safe. Units table is seeded with `INSERT OR IGNORE`.

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
products:list, products:create, products:update, products:delete
standard-epl:list, standard-epl:list-combined, standard-epl:update-price, standard-epl:upsert
packaging:list, packaging:update-price
price-lists:list, price-lists:get, price-lists:create, price-lists:delete, price-lists:stats
export:xlsx, export:xlsx-bulk, export:open-mail-with-attachment, export:open-mail-bulk
settings:get, settings:set, settings:get-admin-emails, settings:update-admin-email
settings:get-units, settings:create-unit, settings:delete-unit, settings:select-logo
migration:select-file, migration:import-excel
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
Critical bugs that were fixed — do not revert:
1. **EUR column indices in Standard EPL sheet**: USD is cols 0-5, EUR is cols **8-13** (cols 6-7 are NULL separators). Old code used 6-11 → all EUR rows silently skipped.
2. **Packaging currency operator precedence**: `clean(r[4]) ?? (version.includes('EUR') ? 'EUR' : 'USD')` — the parentheses are required. Without them JS parses it as `(clean(r[4]) ?? version.includes('EUR')) ? 'EUR' : 'USD'` which always returns `'EUR'`.
3. **Packaging header detection**: `clean()` removes spaces, so compare against `'PackaginVersion'` and `'PackagingVersion'` (not the original strings with spaces).
4. **Duplicate entries on re-import**: Before inserting price list entries, `DELETE FROM price_list_entries WHERE price_list_id = ?` is called within `seenPriceLists` guard.
5. **isOpen() guard**: migration handler returns a friendly error if no DB is open instead of throwing raw SQLite error.

### clean() function (migration.ts)
```typescript
function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/ /g, '');  // removes regular spaces only
  return s === '' ? null : s;
}
// Note: .trim() does remove \xa0 (non-breaking space) in JavaScript
// Note: .replace(/ /g, '') removes regular ASCII spaces — results have no spaces
// Consequence: cleaned strings must be compared against space-stripped versions
```

### Price list creation wizard (CreatePriceList/)
4-step flow with shared `WizardContext` reducer:
1. **Step 1** — customer + dates; on customer select, async fetches their latest price list entries → `previousEntries` in wizard state
2. **Step 2** — pricing mode (Discount % or Net Price); computes product lines from `previousEntries` (not from all standard EPL). If no previous list, starts empty.
3. **Step 3** — review/edit prices, remove products, add products from EPL catalogue via dialog
4. **Step 4** — auto-saves price list to DB on mount (no user action needed); export button triggers native save dialog; mail button only enabled after export

**Step 4 sequential dependency**: DB save → export to file → open mail client. Each step is gated on the previous one completing successfully.

**Single price list email** (Step 4) uses a hardcoded subject/body, not the saved template from bulk email settings. Template: subject = `"Price List — {shortName} — {version}"`, body = fixed greeting text. This is intentional (quick one-off) but is inconsistent with bulk email — something to unify if needed later.

### PriceListsScreen.tsx — list view
Default view shows **one row per customer** — the price list with the latest `effective` date ("Latest only" mode). A toggle button in the filter bar switches to "View all" to show every price list, then back. The subtitle reflects the mode: `N customers` (latest only) or `N of Total price lists` (all). Null `effective` dates are treated as oldest so a dated list always wins. Switching the toggle clears the current selection to avoid stale state. Filtering by customer or search text is applied first; the latest-only reduction runs after.

### Bulk email compose dialog (PriceListsScreen.tsx)
Clicking "Email (N)" opens a compose dialog with Subject + Body fields. Supports `{customer}`, `{customer_full}`, `{version}`, `{effective}` placeholders (substituted per customer at send time). Template auto-saved to `app_settings` (`email_subject_template`, `email_body_template`) on send, and reloaded from settings on next open.

**Email recipients** (both single and bulk): combines `email_to_customer`, `email_internal_copy`, `email_pbp_copy`, `email_pbp_common` from the customer record, filters out null/empty, joins with `;`. All four addresses can be present simultaneously.

**Bulk flow**: user selects N price lists → clicks "Email (N)" → compose dialog → "Send" → for each selected list: exports xlsx to a chosen folder, opens a mail draft. The folder picker appears once before the loop starts.

### Standard units (Settings + StandardEplScreen)
Units stored in `units` table; seeded on DB open. Settings screen has a "Standard Units" card for add/remove. StandardEplScreen uses a `<select>` dropdown (not text input) for unit editing.

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
npm run package      # build macOS app → out/EPL Tool-darwin-arm64/
npm run make         # build installers (Squirrel for Windows via GitHub Actions)
```

**IMPORTANT**: Run `npm run package` after any code change — main process changes (IPC, database, export) require it unconditionally; renderer changes only hot-reload in `npm start` dev mode, not in the packaged `.app`. The user launches the packaged app normally, so always rebuild to ship renderer changes too.

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

User goes to **Settings → Import Data from Excel** → selects `All_Prices.xlsx` → migration runs in-process. Import order: `admin_emails` → `customers` → `products` → `standard_epl` → `packaging` → `price_lists` + `price_list_entries`. All operations are `INSERT OR REPLACE` (idempotent) except packaging which `DELETE`s first.

---

## Decisions not to revisit without good reason

- **Two tables (products + standard_epl)**: standard_epl has currency-specific rows (same rip_code appears twice for USD and EUR). Merging into one table would require price_usd/price_eur columns, which breaks partial pricing and different currencies.
- **Electron over web stack**: Corporate IT cannot provision servers. Web stack (Python + PostgreSQL + Entra ID) was evaluated and deferred until IT can provide infrastructure.
- **SQLite over PostgreSQL**: Single user, file on SharePoint. WAL mode handles network latency adequately.
- **Email via mail client**: No SMTP credentials available; AppleScript/Outlook COM opens a draft the user reviews before sending.
