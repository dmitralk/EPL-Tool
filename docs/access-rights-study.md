# EPL Tool — User access rights study

*Status: decisions recorded (§9) · Phases A + B done, released as v0.6.1 on 6 Nov 2026 · based on EPL Tool v0.5.2*
*Related: [multi-user-study.md](./multi-user-study.md) (several users sharing one database) · [dev-plan.md](./dev-plan.md)
(combined development plan)*

---

## 1. Summary

**Who is using the tool — automatic, no passwords.**

- When the app starts, it reads the user's **Windows account** (e.g. `J0123456`) and **company email**.
- It looks the person up in a **user list** stored in the shared database, which only admins can change.
- Anyone who is not on the list sees a **"No access"** screen with the admins' names and a **Request access** button. The button
  opens an email to the admins with the details filled in.

**Three roles.**

| Role | In short |
|---|---|
| **Admin** | Everything (the PBP team). |
| **User** | Sees everything. Works on price lists, emails and master data of customers that are **Open** or that they **manage**. Can create customers and automatically manages them. |
| **Viewer** | Sees everything and can export to Excel and open email drafts. Cannot change anything. |

**A pricing management mode on every customer.**

| Mode | Who can change this customer's price lists, emails and master data |
|---|---|
| **Open** | Every admin and user |
| **Managed by PBP** | Admins only |
| **Managed by named users** (one or several) | Those users and admins |

All existing customers start as *Managed by PBP*.

**Rules are checked in the background process, not only on screen.** The background process is the part of the app that reads
and writes the database. Every action is checked there before anything is written. The screens hide or lock buttons the user
can't use and show why ("Managed by PBP — view only").

**Every change is recorded** in an activity log that everybody can read: who, when, what changed.

**Built-in help.** A new **Help** section in the app explains roles, pricing modes, editing the shared database (timeouts
included) and other practical information (§3.5).

**What this is and isn't.** These rules stop mistakes and keep the team disciplined; they are not hard security. Someone who has
**Edit** rights on the SharePoint folder could still open the database file with another tool. That matches the trust level you
described (a small group that knows what it is doing, no confidential data), and the activity log, the backups and SharePoint's
own version history show who changed what (§8).

**Effort:** about 7–8.5 developer days including the Help section, part of the combined plan in [dev-plan.md](./dev-plan.md).

---

## 2. Part 1 — Identifying users

### 2.1 Options

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **Windows account + company email** *(chosen)* | When the app starts it reads the Windows account name and the company email from Windows (`whoami /upn`). If that fails, it uses the email of the OneDrive account. | Nothing to type or forget. Corporate IDs are unique. The email is the same one used by SharePoint and Outlook. | Relies on the Windows login. A skilled user could fake it, but the same person could edit the database file directly anyway. |
| Windows account + personal PIN | Same, plus a PIN | Protects against someone using an unlocked PC | More friction. PINs stored in a file everybody can copy. Admins would have to reset forgotten PINs. |
| Separate login + password | User list with passwords in the database | Works without Windows | Stored passwords can be copied with the file, so there is little real protection. Forgotten passwords, more friction. |
| Microsoft sign-in (Entra ID) | Real Microsoft sign-in token | Strongest | Needs an IT app registration. **Excluded (no IT involvement).** |

**Tested on this machine:**

- the Windows account is available
- the company email from Windows is available
- the OneDrive account email is available, and it is the same as the email from Windows

### 2.2 How users are recognised

- **The user list** (shared database): display name, company email, Windows account, role, active yes/no. Users are never deleted,
  only **deactivated**, so the history keeps names.
- **An admin adds a user by email** (the Windows account is optional). The first time that person opens the tool, the app
  recognises them by email and saves their Windows account; after that it recognises them by account.
- **The sidebar shows who is using the tool**, e.g. *"Anna Martin · User"*.
- **The "No access" screen** appears for unknown and deactivated users:
  > *Your account J0123456 (anna.martin@totalenergies.com) does not have access to EPL Tool.
  > Ask an admin: Dmitri …, … — [Request access]*

  *Request access* opens an email draft to all active admins, with the person's name, account and email filled in.
- **First admins:** the upgrade that creates the user list makes **the person running it (you) the first admin**. Then you add
  the other PBP admins in **Settings → Users**. Admin names and emails are entered in the app, not written into the code.
  The app never lets anyone remove or demote the last active admin. If no admin is left, the fix is a manual change to the
  database file.
- **SharePoint access is a separate step.** The app cannot grant SharePoint access, because that would need the Graph API and
  IT. So the **Users** screen shows a reminder whenever a user is added or their role changes:
  > *Also give this person access to the SharePoint folder: **Edit** for Admins and Users, **Read** for Viewers. The app
  > cannot do this for you.*

  It also has an **Open shared folder** button, which opens the synced folder in Explorer; there, the OneDrive menu *Manage
  access* is available.

---

## 3. Part 2 — What each user may do

### 3.1 Pricing management mode (per customer)

- A new **Pricing management** row on the customer page replaces the free-text "Managed by" field:
  - *Open*
  - *Managed by PBP*
  - *Managed by: Anna Martin, Ben Durand*
- The customer list shows the mode as a badge and gets a **"My customers"** filter.
- **The old free-text "Managed by" field (`price_list_managed_by`) is removed** (decided: whichever is simpler):
  - no logic uses it
  - all its values are "PBP", which is the same as the new default
  - the Excel import that filled it is gone

  Migration 7 drops the column, and the customer page shows the new **Pricing management** row instead.
- **If every manager of a customer is deactivated**, the customer behaves as *Managed by PBP* until an admin reassigns it. The
  Users screen warns about this when someone is deactivated.

### 3.2 Permission matrix

"✓ own" means: only for customers that are **Open**, or that the user **manages**.

| Action | Admin | User | Viewer | Not registered |
|---|---|---|---|---|
| Open the tool and view everything (customers, price lists, EPL, products, packaging, analysis, emails, settings) | ✓ | ✓ | ✓ | ✗ "No access" screen |
| Export price lists / EPL / packaging to Excel and open email drafts (any customer) | ✓ | ✓ | ✓ | ✗ |
| Choose the database location on their own PC; their own email template | ✓ | ✓ | ✓ | database location only |
| Create price lists (single wizard or mass update) | ✓ | ✓ own | ✗ | ✗ |
| Delete price lists | ✓ | ✓ own | ✗ | ✗ |
| Change customer email addresses (customer page or Emails tab) | ✓ | ✓ own | ✗ | ✗ |
| Change customer master data (names, SAP type, currency, packaging, region, country, comments, SPOC) | ✓ | ✓ own | ✗ | ✗ |
| Create a new customer | ✓ | ✓ (and becomes its manager) | ✗ | ✗ |
| Hide a customer | ✓ | ✓ if they manage it | ✗ | ✗ |
| Restore or permanently delete hidden customers | ✓ | ✗ | ✗ | ✗ |
| Change the pricing mode / managers | ✓ | see §3.3 | ✗ | ✗ |
| Standard EPL (versions, drafts, prices, publish) | ✓ | view + export | view + export | ✗ |
| Products, packaging, currencies, units, PBP emails, logo, **default** FX rates | ✓ | view | view | ✗ |
| Try own FX rates on the Analysis screen for the current session (not saved) | ✓ | ✓ | ✓ | ✗ |
| Back up now, restore a backup | ✓ | ✗ | ✗ | ✗ |
| Historical price-list import (v0.8.1, §3.7) | ✓ | ✓ own | ✗ | ✗ |
| Manage users | ✓ | ✗ | ✗ | ✗ |
| View the activity log | ✓ | ✓ | ✓ | ✗ |
| Read the in-app Help | ✓ | ✓ | ✓ | short version on the "No access" screen |
| *Start editing* (multi-user edit slot) | ✓ | ✓ from v0.8 (v0.7: ✗, decided 9 Nov 2026) | ✗ | ✗ |

With a shared database (v0.7+), every change above also needs **edit mode**: the app works on a read-only copy until an
admin clicks *Start editing*. Refusals then say *"Read-only — click Start editing to make changes."* (admins) or *"Read-only —
only admins can change the shared database in this version."* (Users), after the role check.

### 3.3 Changing the mode and managers — accepted (no objection on 5 Nov)

| Who | Can do |
|---|---|
| **Admin** | Anything: any mode, any managers. |
| **Manager** of a *Managed by users* customer | Add or remove co-managers (e.g. cover for holidays; at least one manager must remain). Switch the customer to *Open*. Hand it over to *Managed by PBP*, with a warning that they will lose edit rights. |
| **Any user** on an *Open* customer | Can work on it (§3.2), but **cannot change its mode**. Otherwise anyone could take over an open customer; an admin decides. |
| **User who creates a customer** | The customer starts as *Managed by* that user, who can add co-managers straight away. |
| **Admin who creates a customer** | Chooses the mode in the dialog; the default is *Managed by PBP*. |

### 3.4 Screen by screen

The table below describes a **User** looking at a customer they **don't** manage, and Viewers in general.

| Screen | Behaviour |
|---|---|
| Sidebar | Shows the user's name and role (plus the multi-user status line later). |
| Dashboard / *New Price List* | Available to Admins and Users. Viewers don't see the button. |
| Single wizard, Step 1 | The customer dropdown lists only customers the user may price. |
| Mass update, Step 1 | Customers the user can't price are greyed out with a lock and a reason (*"Managed by PBP"*) and can't be selected. |
| Price Lists / Price List detail | Delete only where allowed. Export and Email for everybody. The detail page shows *"Created by Anna Martin on 5 Nov"*. |
| Customers | New **New Customer** button (Admins and Users). Mode badge per customer, "My customers" filter. |
| Customer detail | *Edit* and *Hide* only where allowed. New **Pricing management** card (mode + managers; editable according to §3.3). New **History** section showing this customer's activity. |
| Emails | Everybody sees all addresses. In the edit dialog only the user's own customers can be ticked; the others are shown locked. *Replace* and *Remove* change only the customers the user is allowed to change, e.g. *"Will update 4 of 7 customers — 3 are managed by others and stay unchanged."* |
| Analysis | Everything visible. The FX rates start from the **shared default rates** set by admins. Anybody can change them **for their own session**: not saved, reset when the app restarts, marked *"Your rates (this session)"*, with *Reset to defaults*. Admins also get **Save as default rates**. |
| Products, Standard EPL | Read-only for non-admins, but export and email still work. *New Version*, edit, publish and delete are hidden. |
| Settings | Everybody can see it. Non-admins can change only **their database location** and **their email template**; all other cards are greyed out with *"Admins only"*. The **PBP Emails** card (renamed from "Admin Email Addresses") gets add / edit / remove for admins. The old Excel import is gone. A new **Users** card (admins only, with the SharePoint reminder from §2.2) and an **Activity** link. Backup now and restore are admin only. |
| Help | New sidebar entry for everybody (§3.5). |

### 3.5 Email templates

Decided: **one template per user**. It is stored on the user's PC (`%APPDATA%\epl-tool\settings.json`) and saved on Send, as today.
Sending an email is allowed for viewers and in read-only mode, so it must not write to the shared database. The downside is that
the template doesn't follow the user to a second PC, which is acceptable. Until a user sends their first email, a built-in
default text is used.

### 3.6 In-app Help

A **Help** entry in the sidebar, available to every role, so users don't need these design documents. The full plan is in
[dev-plan.md](./dev-plan.md) §3.

- **Your access:** your name, role, the customers you manage, and the admins to contact.
- **Roles & permissions:** the matrix in §3.2, **generated from the same permission functions the app enforces**, so it can't
  get out of date.
- **Pricing management modes**, the activity log, PBP emails.
- **Shared database:** read mode, *Start editing*, waiting for the slot, auto-publish, **timeouts** (taken from the same
  constants the code uses), conflicts and the rescue tool, offline copy.
- Backups, email templates, FX rates (session vs default), the historical import, onboarding a new user (admins), FAQ and
  troubleshooting, and *What's new* in each version.

**Context links:** "?" links next to the relevant controls open the matching Help topic, for example on the Pricing management
card, the *Start editing* dialog and the FX rates popover.

### 3.7 Historical price-list import (v0.8.1)

The old one-off Excel import was **removed on 5 Nov 2026**. A new wizard (spec in [dev-plan.md](./dev-plan.md) Phase F) uploads
**only historical price lists for existing customers and products**; it never creates or changes customers, products, EPL or
packaging. Each price list goes through the same checks as the price-list wizard: rights, duplicate check, activity log.

---

## 4. Where the rules are checked

```
renderer (screens)                           main process (the only place that writes)
──────────────────                           ─────────────────────────────────────────
AuthContext  ←── auth:me ──────────────────  auth.ts: Windows identity → user list lookup
useCan(action, customer) ─┐                  ipc guard: every channel declares its rule
                          ├─ shared/permissions.ts (same pure functions on both sides)
lock badges, disabled UI ─┘                  handler: per-customer checks + audit entry (same transaction)
```

1. **`src/shared/permissions.ts`** — plain functions with no dependencies, used by **both** the main process and the screens,
   so they can never disagree. For example: `isAdmin(u)`, `canEditCustomer(u, c)`, `canManagePriceLists(u, c)`,
   `canChangeCustomerAccess(u, c, change)`, `canCreateCustomer(u)`, `canEditReferenceData(u)`.
2. **`src/main/auth.ts`** — works out who the person is at start-up (Windows account + email), matches them against the user list
   each time the database is opened or refreshed, and keeps the current user in memory. In development only, an environment
   variable can pretend to be another user, for testing.
3. **A check on every action (IPC guard).** Every channel is registered through one helper that names the rule it needs:
   `public`, `viewer`, `user`, `admin`, or a custom check. **Anything not explicitly allowed is refused.** A user who is not on the
   list can only use the `db:*` and `auth:*` channels. A refusal shows a clear message (*"Only admins can change products"*).
4. **Per-customer checks inside handlers**, for example:
   - `price-lists:create` checks the customer.
   - `price-lists:delete` looks up the price list's customer.
   - `emails:replace` / `emails:remove` / `emails:set-assignments` change only the allowed customers and report how many were
     skipped.
5. **`customers:update` is split and given an allow-list.**
   - **Done in Phase A (6 Nov 2026):** `customers:update` accepts only the master-data and email fields listed in
     [`shared/customerFields.ts`](../epl-tool/src/shared/customerFields.ts) and refuses anything else; `is_deleted` is only
     changed through hide / restore.
   - **Done in Phase B (6 Nov 2026):** `customers:set-access` changes the mode and managers; `price_list_managed_by` was
     dropped by Migration 7 and left the allow-list.
6. **The old Excel import has been removed (5 Nov 2026).** It replaced customer rows
   (`INSERT OR REPLACE INTO customers`), which would have reset the access mode and deleted the managers, and already reset
   *Supply Region* and *hidden*. The new historical import (§3.7) only creates price lists and never touches customers.
7. **Developer Tools.** **Done in Phase A (6 Nov 2026):** releases have **no menu bar** on Windows (macOS keeps only the
   app/Edit/Window menus), so the Developer Tools shortcuts are gone, and DevTools opened any other way are closed again
   ([`main/menu.ts`](../epl-tool/src/main/menu.ts)). Phase B adds the admin exception. The checks in the main process
   (point 3) remain the real protection.
8. **Activity log.** Every write handler adds an entry in the same database transaction as the change itself (§6).
9. **Screens.** An `AuthContext` loaded from `auth:me` holds the user, the role and the list of customers they manage. A
   `useCan()` hook, a `LockBadge` component and route guards (unknown user → `/no-access`) use the shared permission functions.
10. **Admin "Preview as…"** (Settings → Users): an admin can apply another user's permissions to see exactly what that user can do.
    A banner shows *"Previewing as Ben Durand (User) — Exit"*, and the activity log records actions as *"Dmitri (as Ben)"*. This
    lets you test the setup while you are still the only person using the tool.

---

## 5. Database changes

Planned as **Migration 7**, which also starts numbering the schema with `PRAGMA user_version` (see the multi-user study, §5.9):

```sql
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email        TEXT UNIQUE COLLATE NOCASE,
  account      TEXT UNIQUE COLLATE NOCASE,          -- Windows account, filled at first sign-in if empty
  role         TEXT NOT NULL CHECK (role IN ('admin','user','viewer')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  CHECK (email IS NOT NULL OR account IS NOT NULL)
);

ALTER TABLE customers ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'pbp'
  CHECK (pricing_mode IN ('open','pbp','managed'));          -- existing customers → 'pbp' (decided)
ALTER TABLE customers DROP COLUMN price_list_managed_by;      -- old free-text "Managed by" (decided: remove)

CREATE TABLE customer_managers (
  customer_ref_sap TEXT NOT NULL REFERENCES customers(customer_ref_sap) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (customer_ref_sap, user_id)
);

ALTER TABLE price_lists ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);  -- NULL for imported/old lists

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_id          INTEGER REFERENCES users(id),
  user_label       TEXT NOT NULL,          -- snapshot, e.g. "Anna Martin (J0123456)"
  action           TEXT NOT NULL,          -- e.g. 'price_list.create', 'customer.access'
  entity_type      TEXT,
  entity_key       TEXT,
  customer_ref_sap TEXT,                   -- for the per-customer History
  summary          TEXT NOT NULL,          -- human-readable one-liner
  details          TEXT                    -- JSON: changed fields old → new, counts, ids
);
CREATE INDEX idx_audit_at       ON audit_log(at);
CREATE INDEX idx_audit_customer ON audit_log(customer_ref_sap);

-- bootstrap: current Windows identity becomes the first admin (only when users is empty)
```

Notes:

- **No "last seen" column.** Recording each start-up would write to the shared database in read-only mode (multi-user study,
  §5.1).
- **`customers:delete-permanent`** removes the manager links automatically (`ON DELETE CASCADE`). Users can't be deleted, only
  deactivated, so references to them stay valid.

---

## 6. Activity log

- **What is recorded:**
  - customer create / update / hide / restore / delete / access change
  - price list create / delete
  - email assign / replace / remove
  - product create / update / delete
  - EPL draft create / update / publish / discard
  - packaging, currency and unit changes
  - settings, default FX rates, users, PBP emails
  - historical price-list import, backup restore
- **What each entry contains:** a one-line summary, plus the changed fields (old → new) or counts for bulk actions.
- **Where to see it** (visible to **everybody**, decided):
  - **Settings → Activity**: filter by user, action, customer and date; export to Excel.
  - **History** section on each customer page.
  - *"Created by …"* on the price list page.
- **Size:** a few KB per day of work, so it can be kept indefinitely.
- **Multi-user:** the log is part of the database, so it is published with the changes. Price lists re-applied by the rescue tool
  keep their original creator and get a *"re-applied after conflict"* entry.

---

## 7. How it fits with the multi-user design

- **Viewers never get the edit slot**, so they never write to SharePoint. Admins and Users go through *Start editing*.
- **Checks happen in a fixed order:** first the role and customer rights (*"This customer is managed by PBP"*), then the editing
  state (*"Read-only — click Start editing"*). A user is never asked to take the edit slot for something they aren't allowed to do.
- **The edit-slot claim shows the display name** from the user list (*"Anna Martin is editing"*).
- **Changes to the user list** (new user, new role, new manager) reach other PCs with the next publish/refresh, like any other
  data.
- **SharePoint permissions are an outer layer**, managed by you outside the app (decided; the app can't set them, so the Users
  screen reminds admins, §2.2): **Edit** for Admins and Users, **Read** for Viewers. Then a Viewer can't change the shared file
  even with another tool. SharePoint access is also the first gate: without access to the folder, the database can't even be
  reached.

---

## 8. Limits and how they are covered

| Risk | Covered by |
|---|---|
| A user with Edit rights on SharePoint changes the database file with another SQLite tool | Backups and SharePoint version history, which records **who uploaded each version**. Viewers get Read only on SharePoint. The group is trusted. |
| Someone calls the app's functions directly through Developer Tools | Every action is checked in the main process. Developer Tools are disabled in releases for non-admins. |
| Someone edits the local `settings.json` | It contains no rights; rights live in the shared database. |
| Someone fakes a Windows identity | Would need another Windows account on a corporate PC (admin rights). Out of scope. |
| The last admin leaves | The app always keeps at least one active admin; we recommend 2; the manual recovery is documented. |
| An import overwrites access settings | The old Excel import is removed; the new one only adds price lists (§3.7). |

---

## 9. Decisions

**Recorded (5 Nov 2026)**

| Topic | Decision |
|---|---|
| Identifying users | Windows account + company email, no password |
| Roles | Admin / User / Viewer |
| Unknown users | Blocked: "No access" screen with admin contacts and a *Request access* email |
| Managers per customer | One or several |
| Customer master data | Admins + the customer's managers. **Anyone (Admin/User) can create a customer and becomes its manager.** A *New Customer* screen will be added. |
| Export / email drafts for customers someone doesn't manage | Allowed (counts as viewing) |
| Existing customers after the upgrade | All *Managed by PBP* |
| Email templates | Per user (changes the earlier "shared" decision) |
| Activity log | Yes, **visible to everybody** |
| Default FX rates | Shared, set by admins. Anybody can use their own rates for the current session (not saved). |
| SharePoint permissions | Managed by you outside the app; the Users screen reminds admins (Edit for Admin/User, Read for Viewer) |
| Old "Managed by" text field | Removed (column dropped in Migration 7) |
| Admins | You plus the PBP admins you named, entered in Settings → Users at go-live (not written into the code) |
| "Admin Email Addresses" | Renamed **"PBP Emails"** (**done**, 5 Nov 2026) |
| Old Excel import | **Removed** (**done**, 5 Nov 2026); replaced in v0.8.1 by a historical price-list import for existing customers and products only (§3.7) |
| In-app documentation | New **Help** section (§3.6) |
| Mode/managers changes (§3.3), master data of *Open* customers by any User, hiding by Admins + managers | Accepted as proposed (no objection) |
| Historical import rights | Admins, plus Users for the customers they may change (same rule as creating a price list) |
| Session FX rates | Kept only while the app is open; forgotten when it closes |
| Restore on the "damaged database" screen (6 Nov 2026) | Allowed only if the current Windows identity is an active admin **in the backup** being restored; backups older than the user list are allowed |
| PBP copy / PBP common of new customers (6 Nov 2026) | Filled from Settings → PBP Emails when the customer is created |
| Who can be named manager (6 Nov 2026) | Active Users and Admins |
| Unused channels (6 Nov 2026) | Removed instead of guarded: `customers:delete`, `packaging:update-price`, `export:open-mail-with-attachment` |

All decisions are recorded; nothing is open. Phases A and B are built and were released as **v0.6.1** on 6 Nov 2026, after
the matrix was checked with *Preview as…* ([dev-plan.md](./dev-plan.md)). The in-app Help is shown as **Guides & Help**.
