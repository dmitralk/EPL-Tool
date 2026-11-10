# Conflict copies

A **conflict copy** is a copy of the database holding work that could not be published. EPL Tool keeps it instead of
overwriting someone else's changes, so nothing is lost. Conflict copies are rare: one person edits at a time and changes
are published {{AUTO_PUBLISH_DELAY}} after each change (see [Editing the shared database](help:editing)). EPL Tool never
merges a copy by itself: you decide what to bring back.

## Where they come from

| Shown as | What it is |
|---|---|
| **EPL-Conflicts** | Unpublished changes kept in the *EPL-Conflicts* folder next to the shared database: a publish was refused because someone else had published in between, editing ended because someone took over, or changes from an earlier session could no longer be published |
| **OneDrive copy** | A copy OneDrive made by itself next to the database (*EPL-Database-PCNAME.db*) because two PCs changed the file, for example when a laptop was shut down before OneDrive had uploaded a publish. Everybody sees a banner with **Review** |
| **On this PC** | Like *EPL-Conflicts*, but kept on your PC because the shared folder couldn't be reached at that moment |

When EPL Tool keeps a copy of your work, a red banner (and a Windows notification) tells you, with a link to
**Conflict copies**.

## Settings → Conflict copies

The number next to **Settings** in the sidebar is the number of copies to review. **Settings → Conflict copies** lists
each copy with when it was saved, the published data it started from and the last change made in it. **Review** compares
it with the shared database, in three parts:

- **Price lists only in this copy**: price lists created in the copy that the shared database doesn't have. Tick them and
  click **Re-apply selected**: they are created again in the shared database with the same checks as a new price list —
  your rights on the customer, and no other list for that customer with the same date and version. A list that can't be
  re-applied says why (for example the customer is missing, or such a list already exists). Re-applying needs edit
  mode: **Start editing to re-apply**. A re-applied list keeps its original creation time, and the
  [activity log](help:activity) records *Re-applied price list … from* the copy.
- **What was done in this copy**: the activity entries that the shared database doesn't have, which tell you what to
  redo by hand if it still matters (customer changes, products, Standard EPL, …).
- **Other differences with the shared database**: for each table, the rows that differ, with the values in the copy and
  in the shared database. Either side may have changed them, so check before you redo anything.

Everybody can review a copy; re-applying follows the rules for creating price lists (see
[Roles & permissions](help:roles)).

## Archiving

When a copy has been dealt with, an **admin** clicks **Archive**: the copy moves to an *archive* folder next to it
(nothing is deleted) and is no longer listed or counted.
