# What's new

## v0.8.0 — Shared editing (12 Nov 2026)

Several people can now make changes to the shared database, one at a time. See
[Editing the shared database](help:editing).

- **Admins and Users can edit** (Users only what their rights allow); Viewers stay read-only. **Start editing** reserves
  the *edit slot* for you, and everybody else sees *Anna is editing* in their sidebar.
- **Waiting for your turn:** when someone else is editing, click **Wait**. A Windows notification and a banner tell you
  as soon as the slot is free.
- **Take over** an editing session that has been inactive for {{TAKEOVER}} (PC asleep, app closed without finishing
  editing). Its unpublished changes are kept, never lost.
- **Editing ends by itself** after {{IDLE_RELEASE}} without a change, with a warning {{IDLE_WARNING}} before and
  **Keep editing**; an open dialog or wizard keeps the slot.
- **After a crash:** **Resume editing**, **Publish now** or **Discard** the changes that were not published.
- **Conflict copies** (Settings, with a count in the sidebar): review work that could not be published, **re-apply its
  price lists** and see what else was done in it; admins archive the reviewed copies. See
  [Conflict copies](help:conflict-copies).
- **Windows notifications** when the edit slot is free, when editing ended, and when changes could not be published.
- **Settings → Shared database:** who is editing, every editing session, the last publish, the version needed to edit
  and the version on your PC. Admins can **Force release** a session that keeps the slot (for example a dialog left open
  on an unattended PC); its unpublished changes are kept as a conflict copy. See [Shared database](help:shared-database).
- **Updates from the shared folder:** admins publish a new setup with **Publish an installer…**; everybody else gets a
  banner with **Install update** (publishes your changes first, starts the setup and closes EPL Tool).
- **New guides:** [Installing EPL Tool & first start](help:installing), [Rules of use](help:rules-of-use),
  [Onboarding a new user](help:onboarding) (admins, incl. going live) and [FAQ & troubleshooting](help:faq).
- **Update needed to edit:** once someone has published with this version, EPL Tool v0.7 can only read the data; install
  version {{MIN_EDIT_VERSION}} or later to make changes.

## v0.7.0 — Shared reading (9 Nov 2026)

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
