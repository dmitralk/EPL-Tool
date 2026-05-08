# EPL Tool

A desktop application for generating and managing customer Export Price Lists (EPL) at Lubmarine. Replaces a manual Excel-based workflow.

---

## What it does

- Stores all customer, product, and pricing data in a local SQLite database
- Creates formatted price lists per customer (discount-based or net price)
- Exports price lists to Excel in the standard Lubmarine format (with logo, packaging section, contact line)
- Opens email drafts in Mail / Outlook with the Excel file attached
- Imports master data from the `All_Prices.xlsx` source file

---

## Requirements

- **macOS** (Apple Silicon or Intel) or **Windows 10/11**
- Node.js 20+ and npm (for development only)
- No admin rights required to run the packaged app

---

## Running from source (development)

```bash
git clone <repo-url>
cd "EPL Tool/epl-tool"
npm install
npm start
```

The app opens with Vite hot-reload for renderer changes. Main process changes (IPC, database, export) require a restart.

---

## Building the app

**macOS:**
```bash
cd epl-tool
npm run package
# Output: out/EPL Tool-darwin-arm64/EPL Tool.app
```

**Windows** (via GitHub Actions):
- Push to `main` branch (with changes under `epl-tool/`) — the workflow builds automatically
- Or trigger manually from the Actions tab
- Download the artifact `EPL-Tool-Windows` from the workflow run

---

## First-time setup

1. Launch the app
2. Click **Create New Database** (or **Open Database** if you have an existing `.db` file)
3. Go to **Settings → Company Logo** and select `Logo.png`
4. Go to **Settings → Import Data from Excel** and select `All_Prices.xlsx`
5. The app is ready to use

---

## Sections

| Section | Purpose |
|---|---|
| **Dashboard** | Overview stats and recent price lists |
| **Price Lists** | Create, view, export, and email price lists |
| **Customers** | View customer details, history, and compare price list versions |
| **Master Data** | Add, edit, or delete products |
| **Standard EPL** | Edit standard prices (USD and EUR) per product |
| **Settings** | Logo, admin emails, standard units, data import |

---

## Creating a price list

1. Go to **Price Lists → New Price List**
2. **Step 1**: Select customer, effective date, mailing date, version
3. **Step 2**: Choose pricing mode — *Discount %* (applies a percentage off standard EPL prices) or *Net Price* (enter prices manually)
4. **Step 3**: Review products; add or remove individual products from the Standard EPL catalogue
5. **Step 4**: Save and export to Excel

Products are pre-populated from the customer's most recent price list. If no previous list exists, you start with an empty list and add products manually.

---

## Importing data

Go to **Settings → Import Data from Excel** and select your `All_Prices.xlsx` file.

The file must contain these sheets:
- `Admin` — admin email addresses
- `Customers Masterdata` — customer records
- `Products Masterdata` — product catalogue
- `Standard EPL` — standard prices (USD cols 0-5, EUR cols 8-13)
- `Packaging Masterdata` — packaging charges and pallets
- `Prices Database` — historical price list records

Import is idempotent — running it again updates existing records and adds new ones.

---

## Database location

The database is a single `.db` file. You can store it on SharePoint or a shared drive. To switch databases, use **Change Database** in the sidebar.

The app remembers the last opened database path between sessions.

---

## Email integration

- **macOS**: uses AppleScript to open a draft in Mail.app. You may need to grant automation permission the first time: System Settings → Privacy & Security → Automation → EPL Tool → Mail.
- **Windows**: uses Outlook COM via PowerShell. Outlook must be installed.

The email subject and body are customizable via the compose dialog (click **Email (N)** in Price Lists). Placeholders: `{customer}`, `{customer_full}`, `{version}`, `{effective}`.
