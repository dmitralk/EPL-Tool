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
*Read-only · data of 5 Nov 10:45 (Anna)*: when the data was published and by whom.

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

## Editing (admins in this version)

1. Click **Start editing** in the sidebar. The app takes a fresh copy, makes a backup in **EPL-Backups**, and a blue banner
   shows that you are editing.
2. Make your changes. They are saved on your PC and **published automatically** {{AUTO_PUBLISH_DELAY}} after your last
   change; **Publish now** publishes at once. The sidebar shows *Editing · published 10:47* once it is done.
3. Click **Finish editing** when you are done: the rest is published and the app goes back to read mode.

Closing the app while editing publishes first. If publishing is not possible (for example no network), you can **quit
anyway**: your changes stay on your PC and the app offers **Publish now** or **Discard** the next time it starts.

Users and Viewers stay read-only in this version (see [Roles & permissions](help:roles)); editing for Users comes with the
next version, which also makes sure only one person edits at a time.

## When two people edit at the same time

Only one person should edit at a time. If somebody else publishes while you are editing:

- a **red banner** warns you at once — click **Finish editing**;
- your publish is then **refused**: nothing is overwritten. Your copy is kept in the **EPL-Conflicts** folder next to the
  shared database, and the app goes back to read mode with the newer data;
- ask an admin to look at the kept copy and enter your changes again.

## Other messages

- **OneDrive conflict copy** (*EPL-Database-PCNAME.db* next to the database): OneDrive kept a second copy because two PCs
  changed the file. It may contain changes that were never published. Tell an admin.
- **The shared database file is damaged**: you keep working on your last good copy. An admin restores a backup in
  **Settings → Backups**; the restored version is published to everybody (see [Backups](help:backups)).

## Rules of use

- Don't move, rename or copy files in the shared folder, and don't open the database with other tools.
- Keep OneDrive running and signed in. If its icon shows a problem, fix that before editing.
- After editing, wait for *published* in the status line before you shut down the PC.
