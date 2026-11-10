# Backups

Backups are kept in the **EPL-Backups** folder next to the database file (so on SharePoint when the database is on
SharePoint). Each one is checked before it is kept, and the 20 most recent are kept.

- **Shared database:** a backup is taken automatically each time someone clicks **Start editing** (and before a restore),
  of the version they start from. Opening the app or reading never writes anything to SharePoint.
- **Local database** (opened directly): a backup is taken each time the database is opened.
- **Back up now** and **Restore** (Settings → Backups) are for **admins** — with a shared database, while editing.
  Everybody can see the list and open the folder.
- **Restore** first saves the current file as a *pre-restore* copy in the same folder, so a restore can be undone. With a
  shared database the restored version is **published to everybody at once**.
- If the **shared** database file is damaged, everybody keeps working on their last good copy, and an admin can restore a
  backup from Settings → Backups without clicking Start editing first.
- If a **local** database is **damaged**, the app doesn't open it and offers to restore a backup on the start screen.
  Because nobody can be looked up in a damaged file, the restore is allowed if you are an active admin **in the backup**
  (or if the backup is older than the user list).

The restore itself is recorded in the [activity log](help:activity) of the restored database.
