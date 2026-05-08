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
│   │           │   ├── PriceListsScreen.tsx    ← list, bulk export, bulk email compose dialog
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
price_lists     -- price list headers; price_type IN ('Discount','Net Price')
price_list_entries -- one row per product per price list
admin_emails    -- shared email addresses (PBP Costing, PBP Common)
app_settings    -- key/value store (logo_path, db_path, email_subject_template, email_body_template)
units           -- configurable unit list; seeded with '100 KG', '100 L' on DB open
```

Pragmas set on every open: `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`.

Schema runs `CREATE TABLE IF NOT EXISTS` so opening an existing DB is safe. Units table is seeded with `INSERT OR IGNORE`.

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
- Row layout: rows 1-2 logo space → rows 3-6 header info → row 8 "EXPORT PRICES" → row 9 disclaimer → row 10 column headers → product rows → blank → packaging section → contact row
- Logo positioned top-right covering cols D-F rows 1-6
- Uses `centerContinuous` alignment (not merge) for "EXPORT PRICES" header
- Column widths: A=20, B=18, C=50, D=20, E=14, F=16
- Packaging section groups by `product_type`, filters `price !== null` rows

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
4. **Step 4** — save to DB + export to Excel

### Bulk email compose dialog (PriceListsScreen.tsx)
Clicking "Email (N)" opens a compose dialog with Subject + Body fields. Supports `{customer}`, `{customer_full}`, `{version}`, `{effective}` placeholders (substituted per customer at send time). Template auto-saved to `app_settings` on send.

### Standard units (Settings + StandardEplScreen)
Units stored in `units` table; seeded on DB open. Settings screen has a "Standard Units" card for add/remove. StandardEplScreen uses a `<select>` dropdown (not text input) for unit editing.

### products:update cascade
When a product's `product_name` or `product_type` is updated, the handler also updates matching rows in `standard_epl`. When a product is deleted, its `standard_epl` rows are deleted first.

---

## Build commands

```bash
cd epl-tool
npm install          # install dependencies
npm start            # dev mode with Vite HMR
npm run package      # build macOS app → out/EPL Tool-darwin-arm64/
npm run make         # build installers (Squirrel for Windows via GitHub Actions)
```

**IMPORTANT**: After any change to main process code (IPC handlers, database, export), run `npm run package` — the renderer hot-reloads but main process changes require a rebuild.

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
