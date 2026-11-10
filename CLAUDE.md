# CLAUDE.md — EPL Tool project handoff

This file is read automatically by Claude Code at conversation start. It gives full context to continue work without re-explanation.

---

## Current state & next session (updated 10 Nov 2026: v0.7.0 released, Phase D steps 1–3 done)

**Released:** **v0.7.0** (9 Nov 2026) = dev-plan Phase C (read copy + publish): https://github.com/dmitralk/EPL-Tool/releases/tag/v0.7.0.
Before: **v0.6.1** (6 Nov 2026) = Phase A (foundations) + Phase B (access rights + Guides & Help).

**Phase C (v0.7.0)** follows the dev-plan's Phase C section (kickoff decisions of 9 Nov and the **approved technical design**),
built in five commits: 1) Migration 8 `sync_meta` + `CentralStore`/`SyncedFolderStore` (`main/sync/centralStore.ts`) · 2) read
mode (`main/sync/sync.ts`, `ipc/sync.ts`, guard `writes` flag) · 3) admin edit mode (publish + generation check,
`EPL-Conflicts/`, recovery, restore, publish on quit) · 4) screens (setup screen, sidebar status line, banners, `useCan()`
read-only gating, busy signal) · 5) Guides & Help topic *Shared database* + docs. Commit `aff14b5` (between steps 3 and 4) is
another agent's docs-only pointer to a local-only AI study (`docs/local/`, excluded via `.git/info/exclude`).

**Next:**
1. The **two-PC test** of v0.7.0 with a colleague on a separate SharePoint **test** folder holding a copy of the database
   (decision 10) — running in parallel; fix what it finds in a v0.7.x patch.
2. **Phase D (edit slot) → v0.8** — started right after the v0.7.0 release at the user's request (no need to wait for the
   test). Kickoff decisions + approved technical design in the dev-plan's Phase D section. **Step 1 (slot core, incl. the
   take-over record `takesOver` accepted by the user), step 2 (idle release, waiting, notifications) and step 3 (recovery
   with the slot: Resume editing; rescue tool) done and committed on `main`, not pushed yet — ask before pushing.** **Next:
   step 4** (screens: claim/waiting/take-over dialogs, "Anna is editing" status line, recovery banner, Settings → Conflict
   copies screen with review / re-apply / archive and a count badge — replacing the interim toasts/banners of steps 1–3), 5
   (Help editing topics, README, *What's new*), then Phase E → release v0.8.0. Extend `phase-d.checks.ts` with each step.
3. Open item: the tracked sample data files (Known issues). Company/proxy details live in `docs/local/corporate-network.md`.

**Working agreements with the user**
- Ask (with a form) before committing; always add the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
  trailer. Never stage the data files `All_Prices.xlsx`, `All_PricesTest.xlsx`, `EPL-Database.db`, `EPL-Database BackUp.db`
  (modified locally before these sessions; not our work).
- Don't launch the app (`npm start` / packaged) without asking: it auto-opens the user's real SharePoint database and writes a
  startup backup. Test main-process code outside the app instead (see *Testing main-process code* below). For a visual check
  (asked first), the dev-only switch `EPL_DEV_USER_DATA=<temp dir>` gives `npm start` its own profile (settings.json,
  Chromium data, `%LOCALAPPDATA%` copies) — seed `<dir>\userData\settings.json` with a `connection` to a temp copy, start
  forge through a Node wrapper that keeps stdin open (forge quits on stdin EOF) with `-- --remote-debugging-port=9223`, and
  drive/screenshot it over CDP (`Page.captureScreenshot`, `Runtime.evaluate`; Node 24 has a global `WebSocket`).
- Keep `docs/` (dev-plan + studies), CLAUDE.md and README.md updated as phases complete; update the Guides & Help topic
  *What's new* (`epl-tool/src/renderer/help/10-whats-new.md`) with each release.
- Never hard-code people's emails or names in the repo (admins are added in Settings → Users).
- **The GitHub repo is public** (decided by the user 9 Nov 2026): never commit or push corporate details (company hosts, IDs,
  internal links, user paths, real emails); sensitive notes stay in `docs/local/` (excluded via `.git/info/exclude`). Stage
  files explicitly and scan the diff before each commit; ask before pushing.

**Verify after changes** (from `epl-tool/`; for anything that downloads — npm, packaging — first set the corporate proxy
variables in the same PowerShell call: the one-liner is in `docs/local/corporate-network.md`, local only — see *Corporate
network* below):
`npx tsc --noEmit -p .` (exactly 4 known errors: `export.ts` ×2, `Step2ConfigurePricing.tsx`, `Step3ReviewProducts.tsx`),
`npx eslint <changed files>`, `npm test` (67 tests), `npm run test:main` (main-process checks, see below), and packaging into a temp folder (`out/` is often locked by OneDrive):
`node -e "require('@electron-forge/core').api.package({dir:process.cwd(),outDir:process.env.TEMP+'\\epl-pkg-check',interactive:false})"`,
then delete that folder. Release procedure: see *GitHub Actions* below (`npm version X.Y.Z --no-git-tag-version`, commit, BOM-free
annotated tag, push `main` + tag; CI runs `npm test`, builds and publishes).

**Facts worth remembering**
- Schema is at `user_version` 8 (Migration 8 = `sync_meta`, Phase C). New schema changes = numbered entries in `MIGRATIONS` (`database.ts`), never edits of `SCHEMA_SQL`.
- Every IPC channel is registered with `handle(channel, rule, fn, options?)` from `main/ipc/guard.ts`; rules live in `src/shared/permissions.ts`;
  every write calls `audit()` inside its transaction. `editor`/`admin` channels carry the `writes` flag (default): refused on a
  read-only copy of the shared database (`writeBlockMessage` in `main/sync/sync.ts`), after the role check; `SQLITE_READONLY`
  errors are translated to the same message.
- Phase C connection logic lives in `main/sync/sync.ts`: `openLocal` (local mode; refuses a DB with `<name>.manifest.json`
  next to it), `connectShared` (copy to `%LOCALAPPDATA%\epl-tool\cache`, opened with `query_only`), `startup` (settings.json
  `connection`, or the v0.6 `lastDbPath` → `legacySuggestion` when in a synced folder), `checkNow`/`applyUpdate`, `getStatus`
  (`SyncStatus`, pushed to the window as `sync:status`). `dataPath()` = the central DB in shared mode (used by `db:get-path`,
  backups). Edit mode (same file): `startEditing` (canWrite probe, fresh copy to `work\`, backup, open read-write, bootstrap /
  account linking), change tracking via SQLite `total_changes()` (`afterWrite` from the guard), `publishNow` (snapshot `VACUUM
  INTO` → stamp `sync_meta` + `sync.publish` audit → generation check → same stamp on the working copy; writes wait while it
  runs), `finishEditing`, refused publish → unstamped working copy to `EPL-Conflicts/` + back to read mode,
  `recoverUnpublished` (`work\session.json`), `restoreSharedBackup`. `main/index.ts` publishes on quit.
- **Edit slot (Phase D)**: rules in `main/sync/editSlot.ts` (pure, unit-tested): one claim file per editing session in
  `EPL-EditSlot/<slotId>.json` (written only by its owner); **holder** = the active claim (heartbeat < 15 min) with the earliest
  `claimedAt`, smaller `slotId` on a tie; sessions listed in another claim's `takesOver` never hold the slot again. In `sync.ts`
  (section "Edit slot"): `acquireSlot` (others active → `waiting`; only an inactive session → `takeOver` question, confirmed
  with `{ takeOver: true }`; else my claim → waiting window → second look), `heartbeatNow` (timer only after
  `startBackgroundChecks`), `verifySlot` (also before every publish and at every check) → `slotLost` (work to
  `EPL-Conflicts/`, read mode). My old claims (same account + computer) are removed at the next *Start editing*; recovery reuses
  the session's claim if it still holds the slot. Timings in `shared/sync.ts`, shortened in the checks with `configureTimings`.
  **Idle release / waiting / notifications (same file):** the screens report open dialogs/wizards (`setBusy` via
  `sync:set-busy`, from `SyncProvider`); `EditState.activeAt` = last change, end of busy or Keep editing; one `idleTimer`
  (warning → `edit.releaseAt` in the status, then `finishEditing` + `released` message; retried later if the publish fails);
  `waitForSlot`/`stopWaiting` + `watchSlotForWaiter` (at every check: one notice per taken→free change). `sync.ts` emits
  notices (`onNotice`: slot-free, released, refused, slot-lost); `main/notify.ts` shows them as Windows notifications
  (subscribed in `main/index.ts`, so the checks record them via the worker op `notices`).
  **Recovery:** `recoverUnpublished('resume' | 'publish' | 'discard', { takeOver })` goes through `acquireSlot` (keeps the
  session's claim if it still holds the slot; returns the same waiting / takeOver answers as Start editing), then
  `centralMovedOn` (manifest generation / sha256) sends a copy that can no longer be published to `EPL-Conflicts/` at once.
  **Rescue tool:** `main/sync/rescue.ts` (list / analyze / reapply / archive; copies are read through a temp copy;
  `CentralStore.listConflictsFolder` / `copyConflictCopy` / `archiveConflictCopy` accept only conflict copies of this DB;
  copies kept on this PC are in `localConflictsDir()`), `ipc/conflicts.ts`. Price-list creation lives in
  `main/priceLists.ts` (`createPriceList`, `findDuplicatePriceList`) — used by `price-lists:create` and by re-apply.
- Simulated PCs for the checks: `scripts/main-checks/pcs.ts` (used by `phase-c` and `phase-d`): each check file forks itself
  into worker "PCs" (`EPL_PC` env) with their own userData, `%LOCALAPPDATA%`, identity and computer name (`EPL_MACHINE`); the
  orchestrator publishes as "someone else" and writes/ages claim files.
- On the Windows dev PC, `whoami /upn` resolves to one of the named admins' accounts (relevant for first-admin bootstrap tests).
- The stored legacy logo path was a macOS path; the logo must be selected once in Settings (done by the user or still to do —
  ask if exports lack a logo).
- The main-process checks are in the repo: `epl-tool/scripts/main-checks/` (`npm run test:main`: phase-a 51, phase-b 106,
  phase-c 166, phase-d 148 — phase-d grows with each Phase D step; temp copies of the sample DBs; not run in CI). The sample DBs are at schema 0 (WAL, no
  users), so the checks build their own databases from copies.
- npm on this PC: `npm install <pkg>` also bumped an existing dev dependency (tsx) — check the `package.json`/lockfile diff and
  revert unintended changes; npm warns that package install scripts are held back (`allow-scripts`), so avoid a fresh `npm ci`
  locally unless needed (better-sqlite3 must stay built for Electron: `build/Release/.forge-meta` = `x64--<ABI>`; the
  `prepackage` script `electron-rebuild -o better-sqlite3` rebuilds it).
- Opening the WAL-mode sample `EPL-Database.db` read-only creates `-wal`/`-shm` side files (now in `.gitignore`).

---

## What this project is

**EPL Tool** — an Electron desktop app for the PBP team that replaces an Excel-based workflow for generating customer Export Price Lists (EPL). It stores all pricing data in a SQLite database, lets users create formatted price lists per customer, exports them to Excel in a standard format, and opens email drafts with the file attached.

**Key constraints that drove all architectural decisions:**
- No admin rights on corporate machines (no IT-managed servers, no PostgreSQL)
- Cross-platform: macOS and Windows (the multi-user features of v0.7+ are Windows only — there are no Mac users)
- Single editor at a time, DB stored on SharePoint as a file (v0.6.1: one person edits the central DB; v0.7–v0.8 add a local
  read copy, publishing and an edit slot so several people can work safely)
- Email via local mail client (Mail.app / Outlook) — no SMTP

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App framework | Electron Forge + Vite + React + TypeScript | Portable builds, no admin install |
| SQLite | better-sqlite3 | Synchronous, fast; rebuilt for Electron via `packageAfterCopy` hook |
| Excel write | ExcelJS | Free image embedding + full styling (also the planned reader for the historical import wizard; SheetJS was removed with the old import) |
| UI | Tailwind CSS + shadcn/ui-style components | Copy-owned components in `src/renderer/components/ui/` |
| Email macOS | osascript (AppleScript → Mail.app) | Requires NSAppleEventsUsageDescription in Info.plist |
| Email Windows | PowerShell + Outlook COM | No SMTP needed |

---

## Project root layout

```
<repo root>/                ← GitHub: dmitralk/EPL-Tool (development folders on macOS and in the SharePoint-synced folder on Windows: see docs/local/corporate-network.md)
├── epl-tool/               ← the Electron app (all code here)
│   ├── src/
│   │   ├── main/           ← Electron main process
│   │   │   ├── index.ts    ← window creation, app lifecycle (identity detection, menu, DevTools guard, auto-reopen last DB)
│   │   │   ├── database.ts ← better-sqlite3 connection, schema DDL, journal/FK pragmas, integrity check + startup backup, schema versioning (user_version)
│   │   │   ├── backup.ts   ← backup create/list/prune/verify helpers (EPL-Backups folder next to the DB)
│   │   │   ├── auth.ts     ← Windows identity: account (os.userInfo), email (whoami /upn → OneDrive registry fallback), dev override
│   │   │   ├── currentUser.ts ← user-list lookup (account, then email), effective actor (with Preview as…), audit label, AuthState
│   │   │   ├── customerAccess.ts ← customer managers, requireCustomerChange / requireCustomerHide (per-customer refusals)
│   │   │   ├── audit.ts    ← audit(db, entry) — call inside the same transaction as the change; diffFields()
│   │   │   ├── localSettings.ts ← per-PC settings.json (connection {mode local|shared, path}, lastDbPath, per-user prefs); never in the DB
│   │   │   ├── sync/       ← Phase C/D shared database: centralStore.ts (CentralStore/SyncedFolderStore — the only code touching the shared folder, incl. edit-slot claim files and conflict copies), sync.ts (connection, read/edit modes, edit slot, publish, recovery, status), editSlot.ts (slot rules, pure), rescue.ts (conflict copies: list, review, re-apply, archive), paths.ts (%LOCALAPPDATA%\epl-tool cache/work/conflicts), oneDrive.ts (synced-folder detection)
│   │   │   ├── priceLists.ts ← createPriceList (rights, duplicate guard, customer update, audit) — used by price-lists:create and the rescue tool
│   │   │   ├── logo.ts     ← logo stored in the DB as a data URL (app_settings.logo_data_url)
│   │   │   ├── menu.ts     ← release menu policy (none on Windows) + DevTools guard (admins only in releases)
│   │   │   ├── notify.ts   ← Windows notifications for the edit slot (slot free, released, refused, slot lost); Squirrel sets the app id
│   │   │   ├── ipc/        ← all IPC handlers (entity:action naming), each registered via guard.ts handle()
│   │   │   │   ├── index.ts          ← registers all handlers
│   │   │   │   ├── guard.ts          ← handle(channel, rule, fn): rule public/viewer/editor/admin; ipcMain.handle is disabled
│   │   │   │   ├── auth.ts           ← auth:whoami, auth:me, auth:preview-start/stop, auth:request-access
│   │   │   │   ├── users.ts          ← users:list/create/update (last-admin guard)
│   │   │   │   ├── audit.ts          ← audit:list (filters + facets), audit:export-xlsx
│   │   │   │   ├── prefs.ts          ← prefs:get / prefs:set (allow-listed keys, local settings.json)
│   │   │   │   ├── customers.ts      ← list/get/create/update (allow-list)/set-access/hide/restore/delete-permanent, per-customer checks
│   │   │   │   ├── products.ts       ← cascades name/type sync to standard_epl on update
│   │   │   │   ├── priceLists.ts     ← create (duplicate guard), delete (customer last-list fallback)
│   │   │   │   ├── standardEpl.ts    ← versioned EPL: list-versions, create-draft, publish-draft, delete-draft, delete-row, list-combined, upsert
│   │   │   │   ├── packaging.ts
│   │   │   │   ├── currencies.ts
│   │   │   │   ├── settings.ts       ← DB open/create/get-path, logo, PBP emails (admin_emails table), units
│   │   │   │   ├── export.ts         ← xlsx single/bulk, mail single/bulk; standard EPL xlsx + mail
│   │   │   │   ├── analysis.ts       ← analysis:list-rows, fx rates, analysis:export-xlsx
│   │   │   │   ├── emails.ts         ← email management (index/replace/remove addresses across customers)
│   │   │   │   └── backup.ts         ← backup:* channels + db:last-open-error
│   │   │   └── export/
│   │   │       └── buildPriceListXlsx.ts ← ExcelJS builder, replicates reference format
│   │   ├── preload/
│   │   │   └── index.ts    ← contextBridge; all API methods exposed to renderer
│   │   ├── shared/         ← plain modules imported by BOTH main and renderer (no Electron/Node APIs)
│   │   │   ├── permissions.ts ← THE access rules (roles × pricing modes), refusal texts, generated PERMISSION_MATRIX for Help
│   │   │   ├── permissions.test.ts ← node:test unit tests (`npm test`)
│   │   │   ├── customerFields.ts ← CUSTOMER_EDITABLE_FIELDS allow-list + required fields
│   │   │   └── prefs.ts    ← PREF_KEYS allow-list for prefs:get/set
│   │   ├── types/
│   │   │   └── index.ts    ← all shared TypeScript interfaces
│   │   └── renderer/
│   │       ├── main.tsx
│   │       ├── App.tsx     ← React Router, AuthProvider, AccessGuard (no DB → /setup, not on user list → /no-access), all routes
│   │       ├── help/       ← Help topics as Markdown (NN-topic.md) + index.ts (?raw imports, display order)
│   │       ├── lib/
│   │       │   ├── ipc.ts  ← typed wrapper: `export const api = window.api`
│   │       │   ├── auth.tsx  ← AuthProvider (auth:me), useAuth(), useCan() — mirrors shared/permissions.ts for UI gating
│   │       │   └── utils.ts  ← cn, ipcErrorMessage, formatDate, formatCurrency, todayISO, nextVersion, priceTypeLabel, fmtNum/absDelta/pctDelta (shared delta helpers)
│   │       ├── components/
│   │       │   ├── ui/     ← button, input, select, dialog, card, badge, toast, searchable-select (slicer-style dropdown)
│   │       │   ├── layout/ ← AppShell.tsx (Preview-as banner + SyncBanners, Outlet keyed by dataVersion), SyncBanners.tsx, Sidebar.tsx (bottom: Guides & Help, Change Database → /setup, Settings; sync status line + Start/Finish editing + Refresh; user + role)
│   │       │   ├── LockBadge.tsx          ← lock + reason ("Managed by PBP — view only"), AdminOnlyNote
│   │       │   ├── ModeBadge.tsx          ← pricing mode badge
│   │       │   ├── Markdown.tsx           ← tiny Markdown renderer for Help ({{BLOCK}} lines = generated content)
│   │       │   ├── BackupPanel.tsx        ← backup list / back up now / open folder / restore (Settings + damaged-DB screen)
│   │       │   └── EmailComposeDialog.tsx ← shared subject/body compose step used by every Email button
│   │       └── screens/
│   │           ├── DatabaseSelector.tsx        ← route /setup: Connect to shared database, open/create a local DB, offer for a v0.6 DB in a synced folder; restore UI when a local DB failed its integrity check
│   │           ├── NoAccessScreen.tsx          ← route /no-access: identity, admin contacts, Request access, Try again, open another DB
│   │           ├── Help/HelpScreen.tsx         ← routes /help, /help/:topic: topic list + search, "Your access" block, generated roles/matrix
│   │           ├── Dashboard.tsx               ← stats cards, recent price lists table; "+ New Price List" routes to /price-lists/new (gateway)
│   │           ├── Settings/
│   │           │   ├── SettingsScreen.tsx      ← DB path, Users + Activity links, Backups, logo, PBP Emails (admins add/edit/remove), units, packaging/currencies/hidden customers links; admin-only cards locked for others
│   │           │   ├── UsersScreen.tsx         ← route /settings/users (admins): add/edit/deactivate, SharePoint reminder + Open shared folder, customers without active manager, Preview as…
│   │           │   ├── ActivityScreen.tsx      ← route /settings/activity (everybody): filters (user, area/action, customer, dates, text), details, Excel export
│   │           │   ├── DeletedCustomersScreen.tsx ← lists soft-deleted customers; Restore or Delete Permanently per row (admins)
│   │           │   ├── CurrenciesScreen.tsx    ← route /settings/currencies: main currencies (USD/EUR, read-only) + other currencies (add/remove)
│   │           │   ├── PackagingScreen.tsx     ← route /settings/packaging: version list with row/customer counts; New Version dialog (clone-from support); Delete blocked if customers assigned
│   │           │   └── PackagingVersionScreen.tsx ← route /settings/packaging/:version: per-row inline editor (type, name, price, currency, unit, sort); Add Row dialog; label rows (null price) shown as italic "label"
│   │           ├── Customers/
│   │           │   ├── CustomersScreen.tsx     ← active customers; searchable multi-select filter, "My customers", mode badges, New Customer (Admins/Users)
│   │           │   ├── CustomerDetail.tsx      ← inline editing (allowed fields only, Edit/Hide gated), price list table, Pricing management card, History; Packaging field is a dropdown
│   │           │   ├── NewCustomerDialog.tsx   ← SAP ref + names + currency + packaging required; admins choose the mode, users manage what they create
│   │           │   ├── PricingManagementCard.tsx ← mode + managers (customers:set-access), warning before losing rights
│   │           │   ├── ManagersPicker.tsx      ← multi-select of active Admins/Users
│   │           │   ├── CustomerHistory.tsx     ← the customer's audit_log entries
│   │           │   └── ComparisonPanel.tsx     ← side-by-side price list diff
│   │           ├── Emails/EmailsScreen.tsx     ← route /emails (nav after Customers): one row per address with its customers; bulk edit/replace/remove
│   │           ├── PriceLists/
│   │           │   ├── PriceListsScreen.tsx    ← searchable multi-select customer filter, latest-only toggle, bulk export, bulk Email (N), compare button
│   │           │   ├── PriceListDetail.tsx     ← Export XLSX, Email, Delete (type-version-to-confirm)
│   │           │   ├── NewPriceListGateway.tsx ← choice screen: Single Customer vs Mass Update (route /price-lists/new)
│   │           │   ├── CreatePriceList/        ← single-customer 4-step wizard (route /price-lists/create)
│   │           │   │   ├── index.tsx           ← WizardContext + reducer
│   │           │   │   ├── Step1SelectCustomer.tsx  ← searchable single-select customer; fetches prev price list; duplicate date/version check on Next
│   │           │   │   ├── Step2ConfigurePricing.tsx ← 4 pricing methods (see below)
│   │           │   │   ├── Step3ReviewProducts.tsx  ← add/remove products, inline price edit
│   │           │   │   └── Step4ExportPreview.tsx   ← saves on mount; Export to Excel + Email
│   │           │   └── MassPriceList/          ← mass update 4-step wizard (route /price-lists/create/mass)
│   │           │       ├── index.tsx           ← MassWizardContext + reducer + shared computeLines()
│   │           │       ├── Step1SelectCustomers.tsx ← currency toggle, filter bar (customer multi-select/region/date), customer table, loads entries on Next
│   │           │       ├── Step2ConfigureChange.tsx ← method + overrides + dates/comments + live preview
│   │           │       ├── Step3Preview.tsx    ← per-customer summary with expandable price detail rows
│   │           │       └── Step4CreateResults.tsx  ← sequential creation, results table, Export All + Email (N)
│   │           ├── Analysis/AnalysisScreen.tsx       ← route /analysis: read-only price analysis table; USD|EUR|All (default All); column picker; compare vs any EPL version; FX editor; Excel export of visible columns
│   │           ├── MasterData/MasterDataScreen.tsx   ← product CRUD (nav label: "Products")
│   │           └── StandardEpl/
│   │               ├── StandardEplScreen.tsx ← two tabs: “Standard Prices” (version selector, draft management, combined USD+EUR table, Export/Email buttons) and “Packaging Charges” (version selector, read-only table, Export/Email buttons)
│   │               └── StandardEplComparisonPanel.tsx ← side-by-side diff of two EPL versions (Changed / Added / Removed sections)
│   ├── scripts/main-checks/ ← `npm run test:main`: run.js (esbuild + Electron-as-Node), electron-stub.js, harness.ts, pcs.ts (simulated PCs), phase-a/b/c/d .checks.ts
│   ├── forge.config.ts     ← IMPORTANT: contains packageAfterCopy for better-sqlite3
│   └── package.json
├── All_Prices.xlsx         ← original master data file (source of the initial DB load; the in-app import was removed)
├── All_PricesTest.xlsx     ← test dataset
├── EPL-Database.db         ← sample/test database (see Known issues: data files in the repo)
├── .gitignore              ← ignores EPL-Backups/ and SQLite temp files
├── README.md               ← user-facing guide
├── docs/                   ← design studies (not implemented yet): multi-user-study.md, access-rights-study.md, dev-plan.md (combined plan)
└── CLAUDE.md               ← this file
```

---

## Database schema (SQLite, rollback journal)

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
admin_emails         -- shared PBP email addresses (PBP Costing, PBP Common); shown as "PBP Emails" in the UI (renamed from "Admin Email Addresses" to avoid confusion with admin users)
app_settings         -- key/value store: logo_data_url (logo as data:image/...;base64, set in Settings)
                     -- legacy keys that may exist in older DBs and are no longer read: logo_path (per-PC file path), db_path,
                     -- email_subject_template / email_body_template (templates are per user in settings.json now), standard_epl_editable
units                -- configurable unit list; seeded with '100 KG', '100 L' on DB open
currencies           -- currency list; seeded with USD (is_main=1) and EUR (is_main=1); other currencies (is_main=0) can be added for one-off price lists
fx_rates             -- display-only FX rates for the Analysis "All" mode = the shared DEFAULT rates (admins, fx:set-defaults); PK currency_code, rate_to_usd (USD per 1 unit); seeded USD=1, EUR=1.08, GBP=1.27; NEVER used for actual pricing/stored data
users                -- (Migration 7) display_name, email UNIQUE NOCASE, account UNIQUE NOCASE (Windows account, filled at first sign-in), role IN ('admin','user','viewer'), is_active; never deleted, only deactivated
customer_managers    -- (Migration 7) (customer_ref_sap → customers ON DELETE CASCADE, user_id → users); only meaningful when customers.pricing_mode = 'managed'
audit_log            -- (Migration 7) at (ISO UTC), user_id (the real person), user_label snapshot ("Name (account)" or "… as Previewed"), action ('customer.update', …), entity_type/key, customer_ref_sap (for History), summary, details JSON
-- also in Migration 7: customers.pricing_mode IN ('open','pbp','managed') (existing → 'pbp'); customers.price_list_managed_by DROPPED; price_lists.created_by_user_id → users (NULL for older lists)
```

Pragmas set on every open: `journal_mode=DELETE`, `foreign_keys=ON`, `synchronous=FULL`. **Do not switch back to WAL**: the separate `-wal` file gets synced out of step with the `.db` by OneDrive/SharePoint, which caused past corruption. Existing WAL databases are converted automatically on open.

**Open sequence (`openDatabase`)**: open with `fileMustExist` (only `db:create` passes `create: true`, so a not-yet-synced SharePoint file is never replaced by an empty DB) → `journal_mode=DELETE` → `PRAGMA quick_check` (fail → close, record `lastOpenError` with `corrupt: true`, throw; renderer shows restore UI on `/setup`) → `PRAGMA user_version` newer than `SCHEMA_VERSION` → refuse (*"This database needs a newer version of EPL Tool"*, `corrupt: false`, file untouched) unless `allowNewerSchema` (shared read copies: opened as they are with `query_only`, no migrations) → close previous connection → startup backup (existing files only, never blocks open; shared copies pass `skipBackup`) → schema/seed/migrations → first-admin bootstrap (not with `bootstrap: false` / `readOnly`) → `query_only = ON` when `readOnly`.

**Opening an up-to-date database must not change the file** (needed for the shared-DB plan): no `db_path` is written, and seeds on `AUTOINCREMENT` tables use `INSERT … WHERE NOT EXISTS` — `INSERT OR IGNORE` there still rewrites `sqlite_sequence` and bumps the file change counter on every open.

**Backups (`main/backup.ts`, `ipc/backup.ts`, `components/BackupPanel.tsx`)**: stored in `EPL-Backups/` next to the DB file (so SharePoint DB → SharePoint backups, local → local). Name `{dbname}_YYYY-MM-DD_HH-mm-ss.db`; created with `VACUUM INTO` to a `.partial` file, verified with `quick_check` read-only, then renamed. 20 most recent kept (sorted by the timestamp in the name — Windows `copyFile` preserves mtime). Restore: verifies backup → closes DB → raw copy of current file as `..._pre-restore.db` → copy backup over DB (via `.restoring` temp + rename, stale `-wal/-shm/-journal` removed) → reopen with `skipBackup`. `backup:restore` only accepts files inside the target DB's `EPL-Backups` folder matching the name pattern. UI: Settings → Backups card, and the `/setup` screen when the DB is damaged. Channels: `db:last-open-error`, `backup:list`, `backup:create`, `backup:open-folder`, `backup:restore`. **Shared database (Phase C):** the backup is taken at *Start editing* (of the downloaded copy, into the central folder's `EPL-Backups/`), never on open; `backup:create` needs edit mode (writes flag); `backup:restore` goes through `restoreSharedBackup` (backup → working copy → publish at once; allowed from read mode only when the central file is damaged).

Schema runs `CREATE TABLE IF NOT EXISTS` so opening an existing DB is safe. Units and currencies are seeded with `INSERT … WHERE NOT EXISTS`, `fx_rates` with `INSERT OR IGNORE` (so `fx_rates` needs no numbered migration — it appears automatically on next DB open).

**Schema version = `PRAGMA user_version`** (`SCHEMA_VERSION` exported from database.ts). Databases from before the numbering have `user_version = 0`: they run the detection-based legacy Migrations 1–6 below once and are stamped **6**. `SCHEMA_SQL` / `SEED_SQL` are **frozen at that v6 baseline** — every later schema change must be a numbered entry in the `MIGRATIONS` array (`{ version: 7, up(db) }`, …), never an edit of `SCHEMA_SQL`. The runner applies pending steps in order, each in one transaction together with `user_version = N` (so a failed step leaves no trace), with `foreign_keys = OFF` and `legacy_alter_table = ON` set around it (they can't change inside a transaction).

**Migration 7 (access rights, `MIGRATION_7_SQL`)** — creates `users`, `customer_managers`, `audit_log` (+ indexes), adds `customers.pricing_mode` (default `'pbp'`) and `price_lists.created_by_user_id`, and `DROP COLUMN customers.price_list_managed_by`. Data otherwise untouched (verified on copies of both DB files). **First-admin bootstrap** (`bootstrapFirstAdmin`, after the migrations on every open): if `users` is empty and the Windows identity is known, the person opening the DB becomes the first admin (`user.bootstrap` audit entry) — also for brand-new databases. Callers must `await getIdentity()` before `openDatabase` (startup, `db:open`, `db:create` do).

**Migration 8 (shared database, `MIGRATION_8_SQL`)** — creates `sync_meta` (one row, `id = 1`: `generation` (0 = never published), `published_by`, `published_by_account`, `published_at`, `published_app_version`). Only the Phase C publish code stamps it. `main/sync/centralStore.ts` (`SyncedFolderStore`) is the only code that touches the shared folder: it copies the central DB (never opens it with SQLite), verifies copies (`inspectDbFile`/`describeDbFile`: quick_check + sha256 + sync_meta), publishes with the generation check (central sha256 must equal the expected one and the manifest generation must not be higher; `<name>.db.tmp` + rename; `<name>.manifest.json`), saves conflict copies to `EPL-Conflicts/` and lists OneDrive conflict copies (`<name>-<PC>.db`). Local copies: `main/sync/paths.ts` (`%LOCALAPPDATA%\epl-tool\cache|work`); synced-folder detection: `main/sync/oneDrive.ts` (registry `SyncEngines\Providers\OneDrive\*\MountPoint` + `OneDrive*` env vars).

**Legacy migrations (`runLegacyMigrations` in database.ts)** — only for databases below version 6. Contains six sequential migrations:

**Migration 1** — Widens the `price_type` CHECK constraint on `price_lists` to include `'PrevPercent'` and `'PrevAbsolute'`. Detection: checks `sqlite_master` for the old two-value constraint string; skips if already migrated. Uses `PRAGMA foreign_keys = OFF` and **`PRAGMA legacy_alter_table = ON`** before renaming `price_lists → _price_lists_old`, then creates new table, copies data, drops old. The `legacy_alter_table` pragma is critical: without it, SQLite 3.26.0+ automatically rewrites FK references in child tables during rename — so `price_list_entries.FOREIGN KEY → price_lists` silently becomes `→ _price_lists_old`, which breaks all subsequent inserts once `_price_lists_old` is dropped.

**Migration 2** — Fixes `price_list_entries` whose FK was already corrupted by a prior run of Migration 1 without `legacy_alter_table`. Detection: checks `sqlite_master` for `_price_lists_old` in the `price_list_entries` DDL. If found, recreates the table with the correct FK `REFERENCES price_lists(price_list_id)` and copies all data. This handles databases that were migrated with the buggy version of Migration 1.

**Migration 3** — Adds `main_supply_region TEXT CHECK (main_supply_region IN ('ASIA','EUROPE','AMERICA'))` to `customers`. Simple `ALTER TABLE ADD COLUMN`; existing rows default to `NULL`. Detection: checks `sqlite_master` for `main_supply_region` in the customers DDL.

**Migration 4** — Adds `is_deleted INTEGER NOT NULL DEFAULT 0` to `customers` for soft-delete. Simple `ALTER TABLE ADD COLUMN`; existing rows default to `0` (active). Detection: checks `sqlite_master` for `is_deleted` in the customers DDL.

**Migration 5** — Relaxes `customers.currency` CHECK constraint from `IN ('USD','EUR')` to no constraint (any currency code allowed). Uses rename/recreate pattern with `PRAGMA foreign_keys = OFF` (no `legacy_alter_table` needed here — no other tables have FK references to `customers`). Detection: checks for the old two-value constraint string in the `customers` DDL.

**Migration 6** — Adds `standard_epl_versions` table and `version_id` column to `standard_epl`; changes UNIQUE constraint from `(currency, rip_code)` to `(version_id, currency, rip_code)`. Detection: checks `sqlite_master` for `version_id` in the `standard_epl` DDL; skips if already migrated. Uses rename/recreate pattern with `PRAGMA foreign_keys = OFF` + **`PRAGMA legacy_alter_table = ON`** (consistent with Migrations 1/2/5 even though no other table FKs into `standard_epl`). Seeds `standard_epl_versions` row with `version_id=1, version_name='Initial', status='published'` via SEED_SQL (runs before the migrations), so the migration can safely assign all existing rows `version_id=1`. After migration, exports and price-list creation use `getLatestPublishedEplVersionId()` helper (exported from `database.ts`) to resolve the current active version.

**Indexes:** Three performance indexes are created: `idx_price_lists_customer` (for customer filter), `idx_price_list_entries_pl` (for entry lookups), `idx_standard_epl_currency` (for currency filter).

**`price_lists.created_at`** — automatically set on insert via `DEFAULT (datetime('now'))`. `price-lists:list` orders by `created_at DESC`, so `lists[0]` is always the most recent. This is how Step 1 of the wizard finds the customer's latest price list to pre-populate products.

**price-lists:create** — **duplicate guard first**: throws a user-facing error if a list already exists for the same customer with the same `effective` date and version (version compared trimmed + case-insensitive) or the same generated `price_list_id` (`{ref}{effective}{mailing}{version}`). Message: *"A price list with application date … and version … already exists for this customer. Please choose another date or version, or delete the existing price list."* The single wizard also checks this on Step 1 "Next". Renderer strips Electron's `Error invoking remote method '…': Error:` prefix with `ipcErrorMessage()` (utils.ts) — use it wherever IPC errors are shown.

**price-lists:create side effect** — after saving the price list and entries, it also updates `customers.last_price_list_version`, `last_price_list_id`, `effective`, `mailing_date` for the customer. This keeps the customers table in sync with the latest list without a separate query.

**price-lists:delete** — one transaction: deletes entries + header; if the customer's `last_price_list_id` pointed at the deleted list, those four customer fields fall back to the customer's latest remaining list (`ORDER BY effective IS NULL, effective DESC, created_at DESC` — same "latest" rule as Price Lists "Latest only" and Analysis) or are cleared to NULL if none remain. UI: Delete link on the Price Lists table (simple confirm) and Delete button on PriceListDetail (must type the version to enable "Delete permanently").

---

## IPC channel naming convention

All channels follow `entity:action`. The preload (`src/preload/index.ts`) exposes every channel as a typed method on `window.api`. The renderer only ever calls `api.someMethod()` — never `ipcRenderer` directly.

**Channel list (grouped, with the guard rule: P = public, V = viewer, E = editor, A = admin):**
```
P  auth:whoami, auth:me, auth:preview-start (checks real admin), auth:preview-stop, auth:request-access
V  prefs:get, prefs:set
P  db:select-file, db:open, db:create, db:get-path, db:is-open, db:last-open-error      V  db:open-folder
P  sync:status, sync:select-central, sync:connect, sync:check, sync:apply-update, sync:refresh   (+ event sync:status → window)
P  sync:start-editing ({ takeOver }; Admins/Users, or anybody on a DB without users), sync:cancel-claim, sync:wait-for-slot, sync:stop-waiting
P  sync:set-busy, sync:keep-editing, sync:dismiss-released, sync:publish, sync:finish-editing, sync:recover (resume/publish/discard, { takeOver }), sync:dismiss-conflict
V  conflicts:list, conflicts:analyze      E  conflicts:reapply (edit mode; per-customer + duplicate checks per list)      A  conflicts:archive (no writes flag: moves a file only)
P  backup:list, backup:open-folder, backup:restore (A when a DB is open; else admin in the backup)      A  backup:create
V  users:list      A  users:create, users:update
V  audit:list, audit:export-xlsx
V  customers:list, customers:get, customers:list-deleted
E  customers:create, customers:update, customers:set-access, customers:soft-delete   (+ per-customer checks)
A  customers:restore, customers:delete-permanent
V  products:list      A  products:create, products:update, products:delete
V  standard-epl:list-versions, standard-epl:list, standard-epl:list-combined
A  standard-epl:update-price, standard-epl:upsert, standard-epl:create-draft, standard-epl:publish-draft, standard-epl:delete-draft, standard-epl:update-draft-meta, standard-epl:delete-row
V  packaging:list, packaging:list-versions      A  packaging:create-version, packaging:delete-version, packaging:add-row, packaging:update-row, packaging:delete-row
V  price-lists:list, price-lists:get, price-lists:stats      E  price-lists:create, price-lists:delete   (+ per-customer checks)
V  export:xlsx, export:xlsx-bulk, export:open-mail-bulk, export:standard-epl-xlsx, export:standard-epl-mail, export:packaging-xlsx, export:packaging-mail
V  settings:get-admin-emails, settings:get-logo, settings:get-units
A  settings:create-admin-email, settings:update-admin-email, settings:delete-admin-email, settings:select-logo, settings:create-unit, settings:delete-unit
V  currencies:list      A  currencies:create, currencies:delete
V  analysis:list-rows, analysis:export-xlsx, fx:list      A  fx:set-defaults
V  emails:list      E  emails:set-assignments, emails:replace, emails:remove   (only allowed customers; skipped ones reported)
```

Removed: generic `settings:get` / `settings:set` (Phase A); `customers:delete`, `packaging:update-price`, `export:open-mail-with-attachment` (unused, Phase B); `fx:set` → `fx:set-defaults`.

### Access rights (v0.6 — access-rights study, dev-plan Phase B)

- **One source of rules: `src/shared/permissions.ts`** — `canChangeCustomer` (price lists, emails, master data: admin, or user on an Open customer / one they manage), `canHideCustomer` (admin or manager), `canChangeCustomerAccess` + `accessChangeError` (§3.3), `canCreateCustomer`, `canEditReferenceData` / `canManageUsers` / `canBackup` (admin), refusal texts (`customerChangeError`, `hideCustomerError`, `customerLockReason`) and the `PERMISSION_MATRIX` that Help renders. Unit tests: `src/shared/permissions.test.ts` (`npm test`). Change a rule there, and the main process, screens, Help and tests follow.
- **Guard (`main/ipc/guard.ts`)**: every channel is registered with `handle(channel, rule, fn, deniedMessage?)`; `ipcMain.handle` is replaced by a thrower, so no channel can exist without a rule. Rules: `public` (no DB/user needed), `viewer` (any active user), `editor` (Admin/User), `admin`. Order of checks: DB open → on the user list and active → role → (inside the handler) per-customer rule. Messages: *"Viewers can only view and export."*, *"Only admins can change products."*, *"ACME is managed by PBP: only admins can change it."*
- **Who is it (`main/currentUser.ts`)**: identity → user by `account` (NOCASE), else by `email`; a user added by email only gets their Windows account recorded at first sign-in (`user.link-account`). Looked up on every check (cheap), so user-list changes apply at once. `getActor()` = effective active user (the previewed one during **Preview as…**, admins only, memory only, reset when another DB is opened). Activity entries use the **real** user's id with label *"Name (account) as Previewed"*. `created_by_user_id` is the real user.
- **Per-customer checks (`main/customerAccess.ts`)**: `requireCustomerChange` in `price-lists:create/delete`, `customers:update`; `requireCustomerHide` in `customers:soft-delete`; `emails:*` skip forbidden customers and return `skipped`. Price lists whose customer row no longer exists (orphans) behave as PBP: only admins delete them. `price-lists:create` inserts only the line fields of each entry (the list id is always server-computed). Customers carry `pricing_mode`, `manager_ids`, `manager_names` (from `withManagers`) in `customers:list/get/list-deleted`, `price-lists:list/get`, `emails:list`, so screens can gate with the same functions.
- **`customers:create`** (Admin/User): allow-listed fields + `customer_ref_sap` (unique, case-insensitive incl. hidden), currency/packaging must exist; a User's customer is `managed` by them, an admin picks the mode (default `pbp`); `email_pbp_copy` / `email_pbp_common` filled from `admin_emails` (names containing "costing" / "common"). **`customers:set-access`**: managers must be active Admins/Users (existing managers may stay); non-managed modes clear the managers.
- **Activity log (`main/audit.ts`)**: `audit(db, { action, summary, entityType, entityKey, customerRef, details })` is called inside the same `db.transaction` as every write (all handlers above, plus bootstrap, account linking and backup restore). `audit:list` filters: userId, action (exact, or prefix ending in `.`), customerRef, from/to (dates), search; returns facets (users, actions). Visible to everybody (Settings → Activity, customer History).
- **Users (`ipc/users.ts`)**: never deleted (deactivate); `users:update` refuses to demote/deactivate the last active admin. The Users screen shows the SharePoint reminder (Edit for Admin/User, Read for Viewer — managed outside the app) and lists managed customers without an active manager (they behave as PBP).
- **Restore on the damaged-DB screen**: no DB to look the person up in, so `backup:restore` checks that the identity is an active admin **in the backup** (backups without a `users` table are allowed).
- **FX**: `fx_rates` = shared defaults (`fx:set-defaults`, admins, one audited call); the Analysis screen keeps **session rates** in a module variable (forgotten when the app closes), with *Reset to defaults* and *Save as default rates* (admins).
- **Renderer**: `AuthProvider` (`auth:me`) + `AccessGuard` in App.tsx; `useCan()` exposes the shared rules for the effective user; `LockBadge` shows the reason; admin-only cards/buttons are hidden or locked. The UI only mirrors the rules — the guard is the protection. **Phase C**: `SyncProvider` (`lib/sync.tsx`, context in `lib/syncState.ts`) holds the pushed `SyncStatus`, applies new data when not busy (`lib/busy.ts`: open `Dialog`s + wizard routes) and bumps `dataVersion` (AppShell `<Outlet key={dataVersion}>` re-mounts the screen) when another copy was opened; `useCan()` ANDs every change permission with `writable` and offers `readOnly` + `why(roleAllows, roleReason)` for lock texts (use it for any new hard-coded "admins only" text); `SyncBanners.tsx`, sidebar status line, setup screen `/setup` (`DatabaseSelector.tsx`).
- **DevTools in releases**: admins only (Ctrl+Shift+I / F12 via `before-input-event`, real user, not the previewed one); otherwise closed on `devtools-opened`.
- **Help — shown to users as "Guides & Help"** (sidebar entry above *Change Database*; code, routes `/help` and files keep the name `help`) **(`renderer/help/*.md`, `screens/Help/HelpScreen.tsx`)**: topics are Markdown files listed in `help/index.ts` (`?raw` imports; `import.meta.glob` can't be used because tsconfig `module` is CommonJS). `{{ROLES}}` and `{{PERMISSION_MATRIX}}` lines are replaced by content generated from `shared/permissions.ts`. Links `help:<id>`. "?" links: Pricing management card → `pricing-modes`, FX popover → `analysis-fx`. Update *What's new* (`10-whats-new.md`) with each release.

### Identity (main/auth.ts) and local settings (main/localSettings.ts)

- **Identity** is detected once at start-up (`initIdentity`, awaited by `getIdentity()`; `getResolvedIdentity()` once done): Windows account from `os.userInfo()`, email from `whoami /upn`, falling back to the OneDrive **Business** account email in `HKCU\Software\Microsoft\OneDrive\Accounts\Business<N>\UserEmail`. Returns `Identity { account, email, emailSource, displayNameHint, overridden }` (`displayNameHint` is derived from the email, e.g. `jan-martin.x@…` → "Jan-Martin X"). Matched against the user list by `main/currentUser.ts`.
- **Dev override**: `EPL_DEV_ACCOUNT` and/or `EPL_DEV_EMAIL` env vars pretend to be another user in `npm start`; ignored in packaged builds (`allowOverride: !app.isPackaged`). Unset parts stay empty so the real identity can't leak in.
- **Local settings** (`%APPDATA%\epl-tool\settings.json`, atomic write): `lastDbPath` (auto-reopen) and `prefs` (per-user preferences: `emailSubjectTemplate`, `emailBodyTemplate` — the allow-list is `PREF_KEYS` in `src/shared/prefs.ts`). It holds nothing that grants rights.

### Release menu (main/menu.ts)
Packaged builds have **no menu** on Windows/Linux (`Menu.setApplicationMenu(null)`), so Ctrl+R, zoom and the default DevTools shortcuts don't exist; macOS keeps only the app/Edit/Window menus (needed for Cmd+Q/C/V). `npm start` keeps Electron's default menu with DevTools. `guardDevTools(win, isRealUserAdmin)`: in releases admins toggle DevTools with Ctrl+Shift+I / F12; for anybody else DevTools opened by any route are closed again.

---

## Key implementation details

### Excel export (buildPriceListXlsx.ts)
- Uses ExcelJS; replicates a specific reference format exactly
- Row layout: rows 1-2 logo space → rows 3-6 header info → row 7 empty → row 8 "EXPORT PRICES" → row 9 disclaimer → row 10 column headers → product rows → blank → packaging section → contact row
- Logo positioned top-right covering cols D-F rows 1-6 (added last so anchor doesn't pre-create rows). The logo comes **from the database** (`app_settings.logo_data_url`, read by `getLogoImage()` in `main/logo.ts`, added with `addImage({ base64 })`), so every PC exports the same image. Settings → Company Logo stores PNG/JPEG/GIF ≤ 1 MB as a data URL and deletes the old `logo_path` key; the old per-PC path is **not** used as a fallback (decided 6 Nov 2026 — an admin selects the logo once; Settings shows a hint while only the legacy path exists).
- Uses `centerContinuous` alignment (not merge) for "EXPORT PRICES" and packaging section headers — adjacent cells must be empty (null value) for this to work in Excel
- Column widths: A=20, B=18, C=50, D=20, E=14, F=16
- Packaging section groups by `product_type`, filters `price !== null` rows (null-price rows are section headers in the DB but excluded from export output — groupBy already handles this)
- Top 10 rows frozen, gridlines hidden: `ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 10, showGridLines: false }]`
- Contact row uses admin email selected by `LIKE '%Common%' OR LIKE '%common%'` — picks the "PBP Common" shared inbox
- Price cells use `#,##0.00` number format (Excel formats, not renderer-side strings)

### Price Analysis view (Analysis/AnalysisScreen.tsx + ipc/analysis.ts)

Read-only analytical surface (route `/analysis`, nav after Emails). No mutations except `fx:set-defaults` (admins). One flat table: every price list entry across all **active** customers (`customers.is_deleted = 0`), joined with the standard EPL price (USD + EUR) for a chosen comparison version. Default currency mode is **All**.

**Data flow:** `analysis:list-rows(comparisonVersionId?)` runs one JOIN (`price_list_entries → price_lists → customers`, LEFT JOIN `standard_epl` for USD and EUR at the version, default `getLatestPublishedEplVersionId()`) and returns `AnalysisRow[]`. Each row's `is_latest` flag is computed in the handler (latest price list per customer by `effective` desc, `created_at` tiebreak; null effective sorts oldest). The renderer loads once per comparison version and does all filtering/computation client-side (re-query only on version change).

**Currency modes (toggle USD | EUR | All):**
- **USD / EUR** — table filtered to that currency; diff computed natively (`net_price − same-currency EPL`). Rigorous, no FX involved.
- **All** — every currency shown; non-USD net prices converted to USD via editable `fx_rates` (USD per 1 unit) and compared against the **USD EPL** as a single yardstick. This is a deliberate product decision by the user (see design note below): the converted diff **blends FX with the independently-set USD/EUR pricing** and is a bird's-eye scan, not exact. Converted values are marked `≈`; an amber banner states the caveat. GBP/other currencies get a diff in All mode (via USD EPL) that they cannot get in a native tab.

**FX rates**: the `fx_rates` table holds the shared **default** rates. The "FX rates" popover (All mode only, one input per non-USD currency present in the data) edits **session rates** kept in a module-level variable of `AnalysisScreen.tsx` (survive navigation, forgotten when the app closes — never saved); it shows *Your rates (this session)* / *FX rates · yours*, *Reset to defaults*, and for admins *Save as default rates* → `fx:set-defaults(rates[])` (one transaction, one `fx.default` audit entry, only changed rates upserted). Rates are **display-only, never written to price lists**. `fx:list` returns all rows.

**Other controls:** comparison EPL version selector (any published or draft; default active published); latest-only / all-versions toggle (default latest-only — one row-set per customer's most recent list; off shows all versions with a "latest" badge); product multi-select popover (checkbox list of distinct products in the data, filters by `rip_code`); free-text search (customer/product/rip/type); "Clear filters".

**Cell layout** — **Net Price**: USD/EUR modes show `net currency` on one line; All mode (converted rows) shows the estimated `≈ USD` on top in normal size with the native `value currency` beneath in small grey. **Diff**: two-line cell with the **percentage on top** (larger) and the **absolute delta beneath** (small, dimmed), reusing the shared `absDelta`/`pctDelta`/`fmtNum` helpers (in `utils.ts`, also used by `StandardEplComparisonPanel`) — red for premium over EPL / green for below, `≈` prefix on the absolute in All mode.

**Columns + picker** — columns are defined in the `COLUMNS` array (`key`, `label`, `defaultVisible`, `locked`): Customer (locked), Customer SAP Code (hidden), Customer Type, Customer Type SAP (hidden), Country, Supply Region, Version, Effective, Mailing Date (hidden), Product Type, Product (locked), Unit, Terms, Net Price, EPL, Diff. The "Columns" popover toggles visibility; state persists in `localStorage` key `analysis.visibleColumns` (merged with defaults, so newly added columns get their default). `AnalysisRow` carries `customer_type`, `customer_ref_type_sap`, `country`, `effective`, `mailing_date` from the `analysis:list-rows` query.

**Export** — `analysis:export-xlsx` is generic: the renderer computes the exact display grid (currency conversion + filters live there) and sends `{ headers, rows, numericCols, dateCols, mode }`; only **visible** columns are exported (one table column can map to several export columns, e.g. Product → Product + RIP, Diff → Diff + Diff %). The main process writes it via ExcelJS (bold header, gray fill, frozen row 1, `#,##0.00` on numeric cols, ISO strings in `dateCols` converted to real Excel dates `yyyy-mm-dd` at UTC midnight, auto width). Filename `Price-Analysis-{mode}-YYYY-MM-DD.xlsx`.

**Profitability-ready:** `AnalysisRow` carries optional `cost`/`margin` fields reserved for the future cost feature (which will need its own cost table); no cost columns are rendered yet.

### Email management (Emails/EmailsScreen.tsx + ipc/emails.ts)

Route `/emails` (nav after Customers). No schema change: `customers.email_to_customer` / `email_internal_copy` remain the source of truth (`;`-separated strings), so export/mail/import/customer form are untouched. `emails:list` parses both fields across **all** customers (incl. hidden) and groups by address (case-insensitive) → `EmailUsage[]` with per-customer `to`/`internal` flags. Writes are token-level in one transaction and only rewrite fields containing the address:
- `emails:set-assignments(email, changes)` — add/remove an address per customer and field (Edit / Add Email dialog; active customers only, hidden left unchanged)
- `emails:replace(old, new)` — swap everywhere, de-duplicating if `new` already present (merge)
- `emails:remove(email)` — remove from all customers

PBP emails (`admin_emails`, Settings → PBP Emails) are shown read-only with a "PBP" badge and an "All customers" tag, and link to Settings.

### Old Excel import (removed 5 Nov 2026)

The one-off `All_Prices.xlsx` import (`ipc/migration.ts`, `ImportScreen.tsx`, `migration:*` channels, `SheetPreview`/`ImportPreview`/`ImportOptions`/`MigrationResult` types) and the SheetJS `xlsx` dependency were deleted: it was only needed for the initial database load, and its `INSERT OR REPLACE INTO customers` reset columns it didn't import (`main_supply_region`, `is_deleted`). A replacement **historical price-list import wizard** (existing customers/products only, ExcelJS for reading) is planned — see `docs/dev-plan.md`. Lessons to carry over: never strip internal spaces from display names (the old `clean()` did and corrupted names / doubled rows); convert Excel serial dates yourself (`(serial - 25569) * 86400 * 1000`) to avoid timezone drift; never use `INSERT OR REPLACE` on rows other tables or columns depend on.

### Price list creation wizard (CreatePriceList/)
4-step flow with shared `WizardContext` reducer:
1. **Step 1** — customer (searchable single-select: name / SAP / full name) + dates + version; on customer select, async fetches their latest price list entries → `previousEntries` in wizard state. "Next" blocks with a red message if the customer already has a list with the same effective date + version.
2. **Step 2** — pricing method selector (4 options, see below); computes product lines from `previousEntries`. If no previous list, starts empty.
3. **Step 3** — review/edit prices, remove products, add products from EPL catalogue via dialog
4. **Step 4** — auto-saves price list to DB on mount (no user action needed); "Export to Excel" (save dialog) and "Email" (compose dialog) are independent. On save failure: message + "Change date / version" (Step 1) and "Back to products" (Step 3).

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

**Step 4**: see step list above.

**Single price list email** (Step 4) uses the same `EmailComposeDialog` and saved template as every other Email button (see "Email compose dialog" below).

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

**Step 1 — Select Customers**: Currency toggle (USD/EUR) at top; switches `SET_CURRENCY`, clears selection, and resets all filters. Filter bar below the header: customer multi-select (`SearchableSelect multiple`, options limited to the selected currency — it **filters the table**, it does not select rows), supply region dropdown (All / ASIA / EUROPE / AMERICA), and effective date range (From / To, applied to the customer's latest effective date). A "Clear filters" link appears when any filter is active. Customers without any price list in the selected currency are greyed out/non-selectable but still visible. The select-all checkbox and "N customers selected" count reflect only the currently filtered visible rows. On Next: calls `api.getPriceList()` in parallel for all selected customers to load their latest entries into `selectedRows`, then advances to Step 2. Back navigates to `/price-lists/new`.

**Step 2 — Configure Change**: Four method cards. Base value input hidden for "Net Price" (shows info banner instead). Same override system as single wizard: Product Type Overrides + Product (RIP) Overrides. Dates (effective, mailing) and comments fields. Live preview table shows first selected customer's computed prices via `computeLines()`. Summary: "N customers · N total products · currency". Validation: effective/mailing required; base value required for non-carry-forward; discount 0–99.99; all override valueStr must be numeric.

**Step 3 — Preview**: Summary bar (method badge, effective, mailing date, currency, comments). Per-customer table: customer name, base version, new version (blue), product count. Rows are clickable to expand, showing up to 20 products with previous → new price columns.

**Step 4 — Create Results**: On mount, loads Standard EPL for the selected currency, then sequentially creates each price list (to avoid DB contention) via `computeLines()` + `api.createPriceList()`. Stored to DB as: `price_type` set to the method value; "Net Price" carry-forward stored as `price_type: 'Net Price'` with `discount_percent: null`; all others store the base value in `discount_percent`. Results table shows status per customer (pending → spinner → ok / "Not saved: <full message>", e.g. the duplicate date/version message; other customers still get created). After all saved: "Export All" and "Email (N)" buttons; Email opens the shared `EmailComposeDialog`.

**Version numbering**: each customer's new version is auto-incremented from their latest price list version, same logic as single wizard (`nextVersion()` in `utils.ts`). Version is determined per-customer in Step 1 and stored in `selectedRows`.

**No new products in mass mode**: mass update is repricing only. Overrides targeting products/types not already in a customer's price list are silently skipped. No mechanism to add new products across multiple customers at once.

### Customer soft-delete (hide/restore)

Customers can be hidden from the customer card using the **Hide** button (EyeOff icon). This sets `is_deleted = 1` in the `customers` table — no data is moved or copied.

**Filtering is done entirely at the IPC layer**, so no renderer code outside of the settings pages needs to know about `is_deleted`:
- `customers:list` — `WHERE is_deleted = 0` → active customers only
- `price-lists:list` and `price-lists:stats` — `AND (c.is_deleted IS NULL OR c.is_deleted = 0)` via the existing LEFT JOIN. The `IS NULL` guard handles orphaned price lists (no matching customer row at all).
- All wizards, customer selectors, and the price list screen automatically exclude hidden customers without any changes to their code.

**IPC handlers** (rules in the Access rights section): `customers:soft-delete` (Admins + the customer's managers), `customers:restore` and `customers:delete-permanent` (admins; the permanent delete removes entries, price lists, the customer and — by `ON DELETE CASCADE` — its manager links; the audit entries stay), `customers:list-deleted` (everybody).

**Settings → Hidden Customers** (`DeletedCustomersScreen.tsx`, route `/settings/deleted-customers`): table of all hidden customers; Restore and Delete Permanently for admins (others see a lock). Delete Permanently shows a confirm dialog and runs `customers:delete-permanent`.

### Customer masterdata fields

**`customers:update` allow-list**: only the fields in `CUSTOMER_EDITABLE_FIELDS` (`src/shared/customerFields.ts`: names, types, business model, currency, packaging, country, zone, region, SPOC, `email_to_customer`, `email_internal_copy`) are accepted; any other key (id, `customer_ref_sap`, `is_deleted`, `effective`/`mailing_date`/`last_price_list_*`, `email_pbp_*`) is refused with *"These customer fields can't be changed here: …"*. Values must be string or null; short/full name, currency and packaging can't be empty. CustomerDetail sends **only the changed** allowed fields. When adding an editable customer field, add it to that list.

`customers` table has additional fields beyond the import schema:
- `main_supply_region` — `TEXT CHECK (main_supply_region IN ('ASIA','EUROPE','AMERICA'))`, nullable. Editable via a dropdown in the CustomerDetail Details card. Displayed as "Supply Region" in Mass Price Update Step 1 and on the Analysis tab.
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
Default view shows **one row per customer** — the price list with the latest `effective` date ("Latest only" mode). A toggle button in the filter bar switches to "View all" to show every price list, then back. The subtitle reflects the mode: `N customers` (latest only) or `N of Total price lists` (all). Null `effective` dates are treated as oldest so a dated list always wins. Switching the toggle clears the current selection to avoid stale state. The customer filter (`SearchableSelect multiple`, empty = all customers; changing it clears the selection) is applied first; the latest-only reduction runs after.

### SearchableSelect (components/ui/searchable-select.tsx)
Power BI slicer-style dropdown: trigger button + popover with an autofocused search box (matches `label`, `sublabel`, and hidden `keywords`), ↑/↓/Enter/Esc keyboard support. Props: `values: string[]`, `onChange(values)`, `options: { value, label, sublabel?, keywords? }[]`, `placeholder`, `multiple?`, `pluralLabel?`. **Multiple** mode: checkboxes, "Select all (matching)", Clear/Done footer, × to clear; empty selection means "all". **Single** mode: click/Enter picks and closes, no clear. Used by: Price Lists, Customers, mass wizard Step 1 (multiple, as filters) and single wizard Step 1 (single). Customers are shown as short name with SAP code (and currency in the wizard) as `sublabel`, full name as `keywords`.

Note: the plain `ui/select.tsx` always applies `w-full`; since `cn()` is plain `clsx` (no tailwind-merge), a width class passed in does **not** override it — wrap it in a sized container instead.

### Dialog close behaviour (components/ui/dialog.tsx)
All modal windows use the shared native-`<dialog>` `Dialog`. Backdrop close only when **both** mousedown and click are outside the dialog box (a drag that starts inside — scrollbar, text selection — and ends on the backdrop must not close; the browser fires that click on the `<dialog>` itself). Once the user has clicked or typed inside (`dirty`), backdrop clicks and Esc (`cancel` event prevented) are ignored — only ×, Cancel or the action buttons close it. `dirty` resets each time the dialog opens.

**Compare button** — always visible in the filter bar. Enabled (blue) when exactly 2 rows are checked; disabled (grey, "Select 2 to compare") otherwise. Clicking it sets `comparing: { idA, idB }` state and renders a `<ComparisonPanel>` below the table (same component used in CustomerDetail). The page auto-scrolls to the panel on open. Panel has its own "Close" button.

### Email compose dialog (components/EmailComposeDialog.tsx)
Used by **all four** Email buttons: Price Lists bulk "Email (N)", PriceListDetail "Email", single wizard Step 4 "Email", mass wizard Step 4 "Email (N)". Props: `open`, `onClose`, `priceListIds`. Subject + Body fields support `{customer}`, `{customer_full}`, `{version}`, `{effective}` placeholders (substituted per customer at send time). Template saved **per user on this PC** (local `settings.json` via `prefs:set` — `emailSubjectTemplate`, `emailBodyTemplate`) on send, and reloaded on every open; the built-in default is used until a user's first send (old DB keys `email_*_template` are ignored). Sending an email never writes to the database. Send calls `export:open-mail-bulk` (works for 1 or N ids).

**Email recipients** (all Email buttons): combines `email_to_customer`, `email_internal_copy`, `email_pbp_copy`, `email_pbp_common` from the customer record, filters out null/empty, joins with `;`. All four addresses can be present simultaneously. Note: the PBP addresses come from the customer's own columns, not from `admin_emails` (see Known issues); `customers:create` fills them from `admin_emails` (names containing "costing" / "common") for new customers.

**Flow**: Email button → compose dialog → "Send" → folder picker (once) → for each price list: exports xlsx to the folder, opens a mail draft with it attached. `export:open-mail-with-attachment` still exists in main/preload but is no longer used by the renderer.

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
- **Compare versions** toggle — inline version A/B selectors and `StandardEplComparisonPanel` rendered **above the product table** (between the version banners and the search bar), so the panel is immediately visible without scrolling

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
- `getLatestPublishedEplVersionId()` — exported helper from `database.ts`; resolves current active version for export handlers and price-list creation

**Comparison panel (`StandardEplComparisonPanel.tsx`):**
- Props: `versionIdA`, `versionIdB`, `versions`, `onClose`
- Fetches `getStandardEplCombined(versionIdA)` and `getStandardEplCombined(versionIdB)`
- Sections: Changed / Added (in B not A) / Removed (in A not B); columns: RIP, Product, USD A, USD B, USD Δ, EUR A, EUR B, EUR Δ
- Each Δ cell shows two lines: absolute delta on top (e.g. `+12.50`), percentage below in dimmed text (e.g. `+2.3%`)
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

---

## Build commands

```bash
cd epl-tool
npm install          # install dependencies
npm start            # dev mode with Vite HMR (DevTools auto-open in dev)
npm run package      # build unpackaged app (dev/testing only, no installer); prepackage prepares better-sqlite3 for Electron
npm run make         # build distributable installers (Squirrel .exe + ZIP for Windows); premake does the same
npm test             # unit tests (node:test via tsx): src/**/*.test.ts — shared/permissions.test.ts, shared/sync.test.ts, main/sync/editSlot.test.ts (67 tests); also run in CI
npm run test:main    # main-process checks (scripts/main-checks/*.checks.ts) on temp copies of the sample DBs; local only
```

**When to use which command:**
- `npm start` — dev mode. Renderer changes (`src/renderer/`) hot-reload instantly. Changes in `src/main/` or `src/preload/` (IPC handlers, database, export logic) are rebuilt but need a main-process restart: type `rs` in the `npm start` terminal (or restart it).
- `npm run package` — produces an unpacked app in `out/` for local testing of the packaged build.
- `npm run make` — produces the release artifacts: Squirrel Windows installer (`.exe`) and a ZIP. Releases themselves are built and published by GitHub Actions from a `v*` tag (see GitHub Actions below).

Local builds in the SharePoint-synced folder can fail with `EBUSY` on `out/…/app.asar` while OneDrive syncs the previous build output; delete `out/` (or pause sync) and retry.

A packaged app does not pick up source changes — rebuild it after every change you want to test there.

**Type check / lint**: `npx tsc --noEmit -p .` and `npx eslint <files>` from `epl-tool/`. Pre-existing tsc errors (not blocking Vite builds): `export.ts` lines ~48/~358 (`Promise<Buffer>` casts) and `Step2ConfigurePricing.tsx` / `Step3ReviewProducts.tsx` (currency `string` passed where `'USD' | 'EUR'` expected). ESLint config lacks the `react-hooks` plugin, so existing `eslint-disable react-hooks/...` comments report "rule not found". ExcelJS's own `Buffer` type clashes with Node's `Buffer<ArrayBufferLike>`: pass images as `addImage({ base64 })` rather than `{ buffer }`.

**Testing main-process code without launching the app** (launching opens the real SharePoint DB and writes a startup backup): **`npm run test:main`** runs `epl-tool/scripts/main-checks/*.checks.ts`. `run.js` bundles each file with esbuild (`platform: 'node'`, `external: ['better-sqlite3', 'exceljs']`, `alias: { electron: electron-stub.js }` — the stub captures `ipcMain.handle` into a Map, fakes `app.getPath` / `dialog`, and records `shell.openExternal` so mailto drafts don't open Outlook) and runs it with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`, `NODE_PATH=epl-tool/node_modules`) — `better-sqlite3` is built for Electron's ABI, so plain `node` can't load it. `harness.ts` has the helpers (`invoke(channel, …)` calls the real handlers, `check`, `expectError`, `allowed`, `sha`, `userVersion`, `setupTemp`, `finish`). The checks only work on **copies** of the repo-root sample DBs in `%TEMP%`. `phase-a.checks.ts` (51: migrations, byte-identical re-open, allow-list, logo export, prefs, identity — the UPN/OneDrive checks are skipped off Windows work PCs) and `phase-b.checks.ts` (106: Migration 7 on both DB files, bootstrap, guard declarations, Admin/User/Viewer/unknown/deactivated rules via `EPL_DEV_*` + `initIdentity({ allowOverride: true })`, preview, email skip-reporting, audit entries, orphan/crafted-entry price-list cases, damaged-DB restore), `phase-c.checks.ts` (166: Migration 8, the shared-folder store, then read/edit mode on simulated PCs) and `phase-d.checks.ts` (100: the edit slot on simulated PCs — claim/hold, waiting, waiting window + cancel, competing and late claims, take-over and revived claims, crash recovery with the slot, sleeping laptop, Users within their rights, a v0.7 app read-only, 7-day cleanup, waiting + slot-free notifications, idle release with real shortened timers, notifications, Resume editing / take-over / early refusal on recovery, rescue tool: list, review, re-apply with rights and duplicate checks, archive, OneDrive and local copies, refused paths). `npm run test:main -- phase-b` runs one file; `EPL_CHECKS_VERBOSE=1` prints passing checks too. Not in CI (needs the local sample DBs). The scripts are type-checked by `tsc` (tsconfig includes `scripts/**/*`).

### Corporate network (company Windows machines)
Direct access to GitHub/npm/Electron downloads is blocked and HTTPS is SSL-inspected. The working setup — session environment
variables `HTTP_PROXY` / `HTTPS_PROXY`, `NODE_OPTIONS=--use-system-ca` (trust the corporate root CA, Node 22+),
`ELECTRON_GET_USE_PROXY=1` + `GLOBAL_AGENT_HTTPS_PROXY` (Electron binary download), set in `epl-tool/` before `npm ci` /
`npm start` / packaging — and the repo-local git proxy (`git config --local http.proxy …`) are in
**`docs/local/corporate-network.md`** (local only: excluded via `.git/info/exclude`, the repo is public; it exists only in the
SharePoint-synced working folder).

### forge.config.ts — native module packaging

`NATIVE_MODULES = ['better-sqlite3', 'bindings', 'file-uri-to-path']`

The `packageAfterCopy` hook copies these into the packaged app's `node_modules/` alongside the asar; they contain compiled `.node` binaries (native addons) that Vite cannot bundle (`better-sqlite3` is also `external` in `vite.main.config.ts`). SheetJS (`xlsx`) used to be in this list; it was removed together with the old Excel import.

Additionally: `asar.unpack: '**/*.node'` unpacks `.node` binaries from the asar so Electron can `dlopen` them at runtime.

**Electron build of better-sqlite3 — `prepackage` / `premake` npm scripts** run `electron-rebuild -o better-sqlite3` in the project folder before every `npm run package` / `npm run make`. There `prebuild-install` is resolvable, so the prebuilt Electron binary is downloaded and a `build/Release/.forge-meta` marker (`x64--<ABI>`) is written. The packager's own rebuild runs later inside a temp folder that only contains the copied native modules: it can't find `prebuild-install` there and would fall back to compiling with node-gyp (fails without Visual Studio, e.g. on the CI runner and on corporate laptops). With the marker present it skips the module. Do not add `force` to `rebuildConfig` (that would force the compile). The old `forceRebuild: true` was never a valid option and did nothing.

`NSAppleEventsUsageDescription` is set in `extendInfo` so macOS shows the "Allow EPL Tool to control Mail?" permission dialog instead of returning Apple Events error `-1743`.

### DB path persistence

The connection is kept only in the local **`settings.json`**: `connection: { mode: 'local' | 'shared', path }` (written by `saveDbPath()` for local mode — which also keeps `lastDbPath` — and `saveSharedConnection()` for shared mode, both in `main/localSettings.ts`), read at startup by `startup()` in `main/sync/sync.ts`. Without a `connection` (a v0.6 install), `lastDbPath` is reopened as a local DB unless it lies in a OneDrive/SharePoint-synced folder: then the setup screen offers to connect to it as shared (`legacySuggestion`). `db:get-path` returns `dataPath()` (the central DB in shared mode). The path is **never written into the database** (the old `app_settings.db_path` key may remain in older DBs and is ignored).

---

## GitHub Actions (Windows build)

`.github/workflows/build-windows.yml` — triggers on push to `main` when `epl-tool/**` files change, on any `v*` tag push, or manually. Runs on `windows-latest`, runs `npm ci` + `npm test` + `npm run make`, uploads artifact `EPL-Tool-Windows` (30-day retention). On a `v*` tag it also publishes a **GitHub Release** (`gh release create`, `GITHUB_TOKEN` with `contents: write`) with the Squirrel `.exe` and the ZIP attached; release notes come from the annotated tag message (`--notes-from-tag`).

**Release procedure**: bump `epl-tool/package.json` (`npm version X.Y.Z --no-git-tag-version`), commit, then `git tag -a vX.Y.Z -F notes.txt` (notes = tag message) and `git push origin main vX.Y.Z`. On Windows PowerShell 5 write `notes.txt` without a BOM (`[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding($false)))`) — `Set-Content -Encoding utf8` adds one and it ends up at the start of the release notes. CI requires Node 22 (`@electron/rebuild` 4 needs >= 22.12).

**Release history**: latest published release is **v0.7.0** (9 Nov 2026: shared database — local read copy, change detection, offline copy, admin edit mode with auto-publish and the generation check, `EPL-Conflicts/`, setup screen and status line, Guides & Help *Shared database*; Migration 8). Before: **v0.6.1** (6 Nov 2026: users and roles, per-customer pricing management, activity log, New Customer, Preview as…, session FX rates, Guides & Help, logo in the DB, per-user email templates; Migration 7). v0.6.0 was never tagged. Before that: **v0.5.2** (Emails tab, backups, Analysis columns/column picker, searchable customer dropdowns, unified email dialog, price list delete, duplicate guard, dialog close fix). Tags v0.5.0 and v0.5.1 exist but their CI builds failed (Node 20; then native rebuild in the packager temp dir) — no releases for them.

---

## Decisions not to revisit without good reason

- **Two tables (products + standard_epl)**: standard_epl has currency-specific rows (same rip_code appears twice for USD and EUR). Merging into one table would require price_usd/price_eur columns, which breaks partial pricing and different currencies.
- **Electron over web stack**: Corporate IT cannot provision servers. Web stack (Python + PostgreSQL + Entra ID) was evaluated and deferred until IT can provide infrastructure.
- **SQLite over PostgreSQL**: Single user, file on SharePoint. Rollback-journal mode (not WAL) so the synced `.db` is always self-contained; automatic backups in `EPL-Backups/`.
- **Email via mail client**: No SMTP credentials available; AppleScript/Outlook COM opens a draft the user reviews before sending.
- **Email addresses stay as `;`-separated strings on `customers`**: the Emails screen indexes and bulk-edits them instead of normalising into tables, so export/mail/import/customer form need no changes.

---

## Known issues / open items

- **PBP emails in drafts**: the customer page displays PBP copy/common from `admin_emails` (Settings), but drafts use each customer's own `email_pbp_copy` / `email_pbp_common` columns. Changing an admin email in Settings does not change existing customers' drafts. Candidate fix: build recipients from `admin_emails` in `export:open-mail-bulk`.
- **Data files in the repo**: `EPL-Database.db`, `EPL-Database BackUp.db`, `All_Prices.xlsx`, `All_PricesTest.xlsx` are tracked in git and contain customer names, emails and prices. If the repo is public, make it private or untrack them (history keeps old copies unless rewritten).
- **Pre-existing type/lint errors**: see Build commands → Type check / lint.
- **Multi-user access + user access rights (Phase C released; edit slot next)**: `docs/multi-user-study.md` (local read copy + single "edit slot" via claim files next to the DB on SharePoint + atomic publish with a generation check), `docs/access-rights-study.md` (Windows-account identity, Admin/User/Viewer roles, per-customer pricing mode Open / Managed by PBP / Managed by named users, server-side IPC guard, audit log) and `docs/dev-plan.md` (phases A–F, releases v0.6–v0.8.1, in-app Help plan, historical price-list import spec). Decisions are recorded in each study. **Phase A (Foundations) and Phase B (access rights + Guides & Help) done and released as v0.6.1 on 6 Nov 2026** (permission matrix checked by the user with *Preview as…*). **Phase C (read copy + publish) released as v0.7.0 on 9 Nov 2026** (two-PC test with a colleague running on the release); in v0.7 only admins edit the shared database, and two admins editing at once is caught by the generation check. **Phase D (edit slot) in progress** (steps 1–3 done: claim files, Users may start editing, v0.7 apps read-only after a v0.8 publish via `minAppVersion` 0.8.0, idle release after 30 min, waiting with notifications, Resume editing, rescue tool in the main process). Heads-up for Migration 7: the bootstrap admin is whoever's Windows identity first opens a database with v0.6.1 (on the Windows dev PC that is the account whose UPN is one of the named admins); the other admins are then added in Settings → Users. With v0.7, a shared database without users gets its first admin at *Start editing*.
- **Open product questions (not yet decided by the user)**: (1) mass wizard Step 1 customer dropdown currently only *filters* the table — the user may prefer that ticking in the dropdown also selects rows for repricing; (2) after deleting a price list, the customer falls back to the remaining list with the latest *effective* date (not the most recently *created*) — confirm if this is the desired rule.
- **AI features (study only, nothing implemented; 9 Nov 2026)**: using the company's per-user LLM service from EPL Tool was studied and tested end to end on the Windows dev PC (browser sign-in, quota, model list, a model answer). Findings, connection details, integration design (sign-in in the main process, `net.fetch`, encrypted token cache, no AI write path), use cases, open questions and a re-runnable test script are in **`docs/local/ai-study.md`** + `docs/local/llmhub-test/`. That folder is **local only**: excluded through `.git/info/exclude` because this GitHub repo is public and the study contains internal company details — it exists only in the SharePoint-synced working folder, not in clones. Don't copy those details (hosts, IDs, internal links) into tracked files or code before the open questions in the study (incl. repo visibility) are settled.
