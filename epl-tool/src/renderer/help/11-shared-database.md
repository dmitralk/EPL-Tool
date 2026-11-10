# Shared database

The EPL Tool database is one file in a **SharePoint folder** that OneDrive syncs to every PC. EPL Tool never works on that
file directly: it **copies it to your PC** and works on the copy, so several people can use the app at the same time
without damaging the file.

## Connecting

- **The first time:** click **Change Database** in the sidebar → **Connect to shared database**, and choose the database file
  in the SharePoint folder synced to your PC. The next time the app starts, it connects by itself.
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
  install the new version to make changes.

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

## What is in the shared folder

| File or folder | What it is |
|---|---|
| `EPL-Database.db` (or the name the admins gave it) | The database. Only the person editing replaces it, always as a whole file |
| `EPL-Database.manifest.json` | Who published last and when, and which version of EPL Tool is needed to make changes |
| `EPL-EditSlot` | One small file per editing session: who is editing, since when, and their last sign of life |
| `EPL-Backups` | Backups, one each time someone starts editing (see [Backups](help:backups)) |
| `EPL-Conflicts` | Work that could not be published (see [Conflict copies](help:conflict-copies)) |

## Rules of use

- Click **Start editing** only when you are about to change something, and **Finish editing** when you are done.
- Don't move, rename or copy files in the shared folder, and don't open the database with other tools.
- Keep OneDrive running and signed in. If its icon shows a problem, fix that before editing.
- After editing, wait for *published* in the status line (or click **Finish editing**) before you shut down the PC.
