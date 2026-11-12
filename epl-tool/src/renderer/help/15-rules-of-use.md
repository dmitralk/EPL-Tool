# Rules of use

The shared database is safe as long as everybody follows these few rules. EPL Tool checks a lot by itself (one editor at
a time, nothing overwritten), but it can't see what happens outside the app.

## Editing

- Click **Start editing** only when you are about to change something, and **Finish editing** as soon as you are done:
  while you hold the edit slot, nobody else can make changes.
- Don't leave a dialog or a wizard open when you walk away: it keeps the edit slot (no automatic release after
  {{IDLE_RELEASE}}), and an admin may have to force release your session.
- After editing, wait for *published* in the status line (or click **Finish editing**) before you shut down the PC or
  close the laptop lid.
- If EPL Tool shows *You have changes … that were not published* when it starts, deal with it first: **Resume
  editing**, **Publish now** or **Discard** (see [Editing the shared database](help:editing)).

## The shared folder

- Don't move, rename, copy or delete anything in the shared folder: the database, `EPL-Database.manifest.json`,
  `EPL-EditSlot`, `EPL-Backups`, `EPL-Conflicts` and `Installer` are managed by EPL Tool.
- Don't open the database with other tools (database browsers, Excel, scripts), not even to read it.
- Restoring a backup is done in **Settings → Backups** (admins), never by copying files.
- Conflict copies are reviewed in **Settings → Conflict copies**; admins archive them there. See
  [Conflict copies](help:conflict-copies).

## OneDrive

- Keep OneDrive running and signed in, and don't pause syncing while you edit. If the OneDrive icon shows a problem, fix
  that before you click **Start editing**.
- Keep the shared folder on your PC (**Always keep on this device**).

## Updates

- Install updates when the banner offers them (**Install update**). Once someone has published with a newer version,
  older versions can only read the data.

Looking things up, exporting to Excel and opening email drafts are always fine: they never change the shared database.
