# EPL Tool

A desktop application for generating and managing customer Export Price Lists (EPL). Replaces a manual Excel-based workflow.

---

## What it does

- Stores all customer, product, and pricing data in a SQLite database file (local or on SharePoint)
- Creates formatted price lists per customer, one at a time or as a mass update across many customers
- Exports price lists to Excel in the standard format (with logo, packaging section, contact line)
- Opens email drafts in Mail / Outlook with the Excel file attached
- Price analysis vs the Standard EPL, with Excel export
- Bulk management of customer / internal email addresses
- Automatic, verified database backups
- Users and roles (Admin / User / Viewer, recognised by their Windows account — no passwords), a pricing management mode per
  customer, an activity log visible to everybody, and built-in **Guides & Help**

---

## Requirements

- **Windows 10/11** or **macOS**
- Node.js 22+ and npm (for development only)
- No admin rights required to run the packaged app

---

## Running from source (development)

```bash
git clone <repo-url>
cd "EPL Tool/epl-tool"
npm install
npm start
```

The app opens with Vite hot-reload for screen (renderer) changes. Main-process changes (IPC, database, export) need a restart: type `rs` in the `npm start` terminal.

`npm test` runs the unit tests (the access rules in `src/shared/permissions.ts`). In development, the environment variables
`EPL_DEV_ACCOUNT` / `EPL_DEV_EMAIL` make the app act as another person (ignored by packaged builds).

**Behind the TotalEnergies corporate proxy (Windows)**, set these in the same PowerShell session before `npm install` / `npm start`:

```powershell
$env:HTTP_PROXY='http://cloudproxy-emea.corp.local:8080'; $env:HTTPS_PROXY=$env:HTTP_PROXY
$env:NODE_OPTIONS='--use-system-ca'
$env:ELECTRON_GET_USE_PROXY='1'; $env:GLOBAL_AGENT_HTTPS_PROXY=$env:HTTP_PROXY
```

---

## Building the app

**macOS:**
```bash
cd epl-tool
npm run package
# Output: out/EPL Tool-darwin-arm64/EPL Tool.app
```

**Windows** (via GitHub Actions):
- Push to `main` branch (with changes under `epl-tool/`) — the workflow builds automatically; download the artifact `EPL-Tool-Windows` from the workflow run
- Or trigger manually from the Actions tab

`npm run package` / `npm run make` first prepare the SQLite module for Electron automatically (`prepackage` / `premake` scripts) — no Visual Studio needed.

---

## Releasing a new version

1. `cd epl-tool` and `npm version X.Y.Z --no-git-tag-version`; commit.
2. Create an annotated tag whose message is the release notes: `git tag -a vX.Y.Z -F notes.txt`
3. `git push origin main vX.Y.Z`

The tag triggers the Windows build and publishes a GitHub Release with `EPL Tool-X.Y.Z Setup.exe` and the ZIP attached. Share the release page link with users: https://github.com/dmitralk/EPL-Tool/releases

---

## First-time setup

1. Launch the app
2. Click **Open Database** and select the existing `.db` file (normally the shared one on SharePoint)
3. The first time a database is opened with v0.6 or later, the person opening it becomes its **first admin**. That admin
   adds the other people in **Settings → Users** (by company email, with a role) and gives them access to the SharePoint
   folder separately (Edit for Admins and Users, Read for Viewers)
4. If exports show no logo, an admin goes to **Settings → Company Logo** and selects the logo image (PNG, JPEG or GIF, under 1 MB). It is stored inside the database, so exports made on any computer show it — this only needs to be done once (logos chosen with older versions were only linked to a file on one computer and must be selected again)
5. The app is ready to use

The original one-off Excel import (`All_Prices.xlsx`) has been removed. A wizard for uploading historical price lists for existing customers and products is planned (see [docs/dev-plan.md](docs/dev-plan.md)).

---

## Sections

| Section | Purpose |
|---|---|
| **Dashboard** | Overview stats and recent price lists |
| **Price Lists** | Create (single or mass), view, compare, export, email, and delete price lists; *Created by* on each list |
| **Customers** | New Customer, details, contacts, pricing management (mode + managers), history, version comparison, hide/restore |
| **Emails** | One row per email address with all customers using it; add / remove / replace across customers in one go |
| **Analysis** | Every price list line vs the Standard EPL (USD, EUR, or All currencies via FX); choose columns; export to Excel |
| **Products** | Add, edit, or delete products (admins) |
| **Standard EPL** | Versioned standard prices (USD + EUR): draft → publish (admins), compare versions; packaging charges; export / email |
| **Guides & Help** | Documentation and how-to guides: roles and permissions, pricing modes, wizards, emails, FX rates, activity log, backups, what's new (sidebar, above *Change Database*) |
| **Settings** | Database, users (admins), activity log, backups, logo, PBP emails, units, packaging, currencies, hidden customers |

Customer pickers everywhere work like Power BI slicers: click the dropdown, type part of the name or SAP code, tick one or several customers.

---

## Users, roles and access

EPL Tool recognises people by their **Windows account and company email** — there is no password. Admins manage the user
list in **Settings → Users**; anybody not on it sees a *No access* screen with a *Request access* button.

| Role | In short |
|---|---|
| **Admin** | Everything (the PBP team) |
| **User** | Sees everything; changes price lists, emails and master data of customers that are *Open* or that they manage; creates customers |
| **Viewer** | Sees everything, exports to Excel and opens email drafts; changes nothing |

Each customer has a **pricing management mode**: *Open* (all admins and users), *Managed by PBP* (admins only) or *Managed by*
named users. Every change is recorded in **Settings → Activity**. Admins can check what someone else sees with
**Preview as…** in Settings → Users. The full permission table is in **Guides & Help → Roles & permissions** (generated from the
rules the app enforces). Design notes: [docs/access-rights-study.md](docs/access-rights-study.md).

---

## Creating a price list

Go to **Price Lists → New Price List** and choose **Single Customer** or **Mass Update** (Admins and Users, for the customers they may change).

**Single customer**
1. **Step 1**: Select customer, effective (application) date, mailing date, version. If the customer already has a price list with the same application date and version, you are asked to pick another date/version (or delete the existing list).
2. **Step 2**: Choose the pricing method — *% Discount from Standard EPL*, *Net prices*, *% change from previous list*, or *fixed amount change from previous list*; optionally override per product type or per product.
3. **Step 3**: Review products; add or remove individual products from the Standard EPL catalogue.
4. **Step 4**: The list is saved; **Export to Excel** and/or **Email**.

Products are pre-populated from the customer's most recent price list. If no previous list exists, you start with an empty list and add products manually.

**Mass update**: filter and tick customers (USD or EUR), choose one change for all (with optional per-type / per-product overrides), preview, then create. Each customer gets the next version number automatically.

**Deleting**: open a price list and click **Delete**; you must type the version (e.g. `V3`) to confirm. The customer's "latest price list" falls back to the previous one.

---

## Database location

The database is a single `.db` file. You can store it on SharePoint or a shared drive. To switch databases, use **Change Database** in the sidebar.

The app remembers the last opened database path between sessions (on your computer only; the path is not stored in the database). If the file is not there (e.g. SharePoint not yet synced), the app reports it instead of creating an empty database. A database last used by a newer version of EPL Tool is not opened: update the app first.

---

## Backups

- Every time the database is opened, a verified backup is written to an **`EPL-Backups`** folder next to the database file (SharePoint database → backups on SharePoint; local → local). The 20 most recent are kept.
- **Settings → Backups**: see the list and **Open folder** (everybody); **Back up now** and **Restore** (admins). Before restoring, the current database is saved as a "pre-restore" copy, so a restore can be undone.
- If the database is damaged, the app does not open it and offers to restore the latest backup instead (allowed for people who are admins in that backup).
- The database uses SQLite's rollback-journal mode so the synced `.db` file is always self-contained (the previous WAL mode was a likely cause of past corruption on OneDrive/SharePoint).

---

## Email integration

- **macOS**: uses AppleScript to open a draft in Mail.app. You may need to grant automation permission the first time: System Settings → Privacy & Security → Automation → EPL Tool → Mail.
- **Windows**: uses Outlook COM via PowerShell. Outlook must be installed.

Every **Email** button (Price Lists selection, price list page, end of both wizards) opens the same compose dialog. Subject and body are saved as **your own** template on your computer (not in the database; until your first send a default text is used); placeholders: `{customer}`, `{customer_full}`, `{version}`, `{effective}`. On send you pick a folder, the Excel file(s) are saved there and one draft per price list opens with the file attached.

Recipients = the customer's *To customer* + *Internal copy* addresses + PBP copy / common. Use the **Emails** tab to change an address across many customers at once.
