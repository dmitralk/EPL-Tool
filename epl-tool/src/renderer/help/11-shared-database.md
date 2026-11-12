# Shared database

The EPL Tool database is one file in a **SharePoint folder** that OneDrive syncs to every PC. EPL Tool never works on that
file directly: it **copies it to your PC** and works on the copy, so several people can use the app at the same time
without damaging the file.

## Connecting

- **The first time:** click **Change Database** in the sidebar → **Connect to shared database**, and choose the database file
  in the SharePoint folder synced to your PC. The next time the app starts, it connects by itself. Setting up a new PC is
  described in [Installing EPL Tool & first start](help:installing).
- Tip: in Windows Explorer, right-click the synced folder → **Always keep on this device**, so the file is always there.
- If you used EPL Tool before, the setup screen offers to connect to the database you opened last time.
- **Open a local database** (no sharing) is for test databases only. A database that has been published as shared can't be
  opened that way.

## Read mode (everybody)

The app starts **read-only**. The status line at the bottom of the sidebar shows which data you see, for example
*Read-only · data of 5 Nov 10:45 (Anna)*: when the data was published and by whom. While someone is editing, a second line
says who, for example *Anna is editing* (point at it to see since when, on which PC, and her last change).

- You can do everything that only reads data: look things up, Analysis, compare price lists, export to Excel, open email
  drafts.
- Buttons that would change something are hidden or locked with *Read-only — click Start editing to make changes*.
- Every {{CHECK_INTERVAL}} (and when you come back to the window) the app looks for newer data in the shared folder. New
  data appears **by itself**. If a dialog or a wizard is open, a banner offers **Refresh** instead, so nothing changes
  under your hands. **Refresh** in the sidebar looks right away.
- *Newer data … is still syncing to your computer*: someone published, but OneDrive hasn't downloaded the new file yet. It
  appears by itself; you don't need to do anything.
- **Offline copy**: when the shared folder can't be reached (no network, OneDrive stopped or signed out), you keep working
  on your last copy, read-only. The app reconnects by itself.
- *Update EPL Tool to make changes*: the data was published by a newer version of EPL Tool. You can still read and export;
  click **Install update** on the banner to make changes (see *Updates* below).

## Making changes

Admins and Users click **Start editing** to make changes (Users only change what their rights allow, see
[Roles & permissions](help:roles)); Viewers always stay read-only. **One person edits at a time**: whoever clicks
**Start editing** gets the *edit slot*, and their changes are published for everybody {{AUTO_PUBLISH_DELAY}} after their
last change. The others keep reading, see who is editing, and can wait for their turn.

Everything about editing — waiting and notifications, taking over an inactive session, the automatic release after
{{IDLE_RELEASE}} without changes, and what happens after a crash — is in [Editing the shared database](help:editing).

## Other messages

- **Conflict copies** (a number next to **Settings** in the sidebar): work that could not be published, kept by EPL Tool
  instead of overwriting someone else's changes, or a copy OneDrive made itself (*EPL-Database-PCNAME.db* next to the
  database). Nothing is lost: see [Conflict copies](help:conflict-copies).
- **The shared database file is damaged**: you keep working on your last good copy. An admin restores a backup in
  **Settings → Backups**; the restored version is published to everybody (see [Backups](help:backups)).

## Settings → Shared database

The **Shared database** card in **Settings** shows, for everybody:

- the status of your copy, and the shared database file;
- **Editing now**: who holds the edit slot, on which PC, since when, their last change and their last sign of life;
- **Last publish**: the generation (a number that grows with each publish), who published and when, with which version of
  EPL Tool;
- **To edit**: the version of EPL Tool needed to make changes, and the version running on your PC;
- **My copy**: where the copy on your PC is kept;
- **Editing sessions**: every session in `EPL-EditSlot` — *Editing*, *Reserving*, *Inactive* (may be taken over), *Taken
  over* or *Released* — and the force releases of the last {{CLEANUP_DAYS}};
- **Installer**: the version of EPL Tool published for everybody (see *Updates* below);
- buttons to open the shared folder, the backups and the conflict copies.

## Force release (admins)

An editing session normally ends by itself: **Finish editing**, the automatic release after {{IDLE_RELEASE}} without a
change, or a take-over once it has been inactive for {{TAKEOVER}}. But an **open dialog or wizard keeps the edit slot**
for as long as it is open — for example a price list wizard left open on a PC nobody is at. Then an admin can click
**Force release** next to that session in **Settings → Shared database**. Ask the person first if you can.

- EPL Tool shows what you are about to end (since when, last change, last sign of life) and asks to confirm.
- The edit slot is **free at once**; people waiting are told *Anna's edit slot was released by Dmitri*.
- The other EPL Tool stops editing as soon as the release reaches that PC (it checks every {{CHECK_INTERVAL}} while it is
  open): a red banner and a notification say *Dmitri released your edit slot at 11:02*, and changes that were not
  published yet are kept as a [conflict copy](help:conflict-copies) — never lost.
- That session can't get the slot back: the person clicks **Start editing** again when they need to.
- The release is recorded in the [activity log](help:activity) with the next publish (by anybody), under *Shared
  database*.

Your own session can't be force released: use **Finish editing** (or **Discard** for changes from an earlier run).

## Updates

When an admin publishes a new version of EPL Tool (**Publish an installer…** on the card), everybody with an older version
sees a blue banner within {{CHECK_INTERVAL}}: *EPL Tool 0.8.1 is available in the Installer folder…*

- **Install update** copies the setup to your PC, starts it and closes EPL Tool. If you are editing, your changes are
  published first. The new version starts when the installation is done (if it doesn't, start EPL Tool from the Start
  menu).
- **Open folder** opens the `Installer` folder, if you prefer to run the setup yourself.
- **×** hides the banner until EPL Tool is started again.
- When the data was published by a newer version, the banner is amber and stays: you can still read and export, but you
  need the update to make changes.

Installing and the first start are described in [Installing EPL Tool & first start](help:installing).

## What is in the shared folder

| File or folder | What it is |
|---|---|
| `EPL-Database.db` (or the name the admins gave it) | The database. Only the person editing replaces it, always as a whole file |
| `EPL-Database.manifest.json` | Who published last and when, and which version of EPL Tool is needed to make changes |
| `EPL-EditSlot` | One small file per editing session (who is editing, since when, last sign of life), and the force releases |
| `EPL-Backups` | Backups, one each time someone starts editing (see [Backups](help:backups)) |
| `EPL-Conflicts` | Work that could not be published (see [Conflict copies](help:conflict-copies)) |
| `Installer` | The setup of the current EPL Tool (the {{INSTALLERS_KEPT}} newest versions) and `latest.json`, which names it |

Don't change anything in this folder by hand: see the [Rules of use](help:rules-of-use).
