# What's new

## v0.7.0 — Shared reading

The database can now be used by several people at the same time. See [Shared database](help:shared-database).

- **Connect to shared database** (Change Database): EPL Tool works on a copy on your PC and keeps it up to date. It starts
  **read-only**; new data published by someone else appears by itself (or with a *Refresh* banner while a dialog or wizard
  is open).
- **Status line** at the bottom of the sidebar: *Read-only · data of …*, *Editing*, *Offline copy*.
- **Start editing / Finish editing** for admins: changes are published automatically {{AUTO_PUBLISH_DELAY}} after the
  last change. Users and Viewers are read-only in this version.
- **Nothing is overwritten:** a publish on top of someone else's newer version is refused and your copy is kept in
  **EPL-Conflicts**; you are warned as soon as someone else publishes while you edit.
- **Offline copy** when SharePoint can't be reached; unpublished changes are offered again after a crash.
- **Backups** are now taken when an admin starts editing, not each time the app opens; a restore is published to
  everybody.
- **Local databases** (opened directly, no sharing) remain available for tests.

## v0.6.1 — Governance

First release with users and access rights (v0.6.0 was not released separately).

- **Users and roles.** EPL Tool recognises you by your Windows account and company email (no password). Admins manage
  the user list in **Settings → Users**; people who are not on it see a *No access* screen with a *Request access*
  button. See [Roles & permissions](help:roles).
- **Pricing management per customer:** *Open*, *Managed by PBP* or *Managed by* named users, with a *My customers*
  filter. All existing customers start as *Managed by PBP*; the old free-text "Managed by" field is gone. See
  [Pricing management modes](help:pricing-modes).
- **New Customer** for admins and users.
- **Activity log** (Settings → Activity) and a **History** section on every customer page; *Created by* on price lists.
- **FX rates:** admins set the shared defaults; anybody can try their own rates for the session.
- **PBP Emails:** admins can add and remove entries.
- **Preview as…** lets admins see the app exactly as another user does.
- **Guides & Help** (this section, in the sidebar above *Change Database*).
- Also from this version: the logo is stored in the database (an admin selects it once), email templates are saved per
  person on their own PC, and opening the database no longer changes the file.
