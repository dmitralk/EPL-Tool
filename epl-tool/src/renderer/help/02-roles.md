# Roles & permissions

Every person on the user list has one of three roles:

{{ROLES}}

## Who may do what

The table below is generated from the same rules the app enforces, so it is always up to date.
**✓ own** means: only for customers that are **Open**, or that the person **manages** (see
[Pricing management modes](help:pricing-modes)).

{{PERMISSION_MATRIX}}

## How the rules are applied

- Buttons you can't use are hidden or shown with a lock and the reason, e.g. *Managed by PBP — view only*.
- With the shared database, every change also needs **edit mode**: Admins and Users click **Start editing** first, one
  person at a time (see [Editing the shared database](help:editing)). Until then the app is read-only.
- The rules are checked again in the background process before anything is written, so a change you are not allowed
  to make is always refused with a clear message.
- Nothing is deleted when a person leaves: admins **deactivate** users, so their name stays in the history.
- There is always at least one active admin; the app refuses to remove or demote the last one.

## SharePoint access

The database lives in a SharePoint folder. Access to that folder is managed by the admins **outside the app**:
**Edit** for Admins and Users, **Read** for Viewers. Without access to the folder you can't reach the database at all.
