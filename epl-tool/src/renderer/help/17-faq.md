# FAQ & troubleshooting

## Access

**I see a "No access" screen.** You are not on the user list of this database, or your access was deactivated. Click
**Request access** (an email draft to the admins with your details) and **Try again** once they have added you.

**Start editing says my access to the shared folder is read-only.** Your SharePoint permission on the folder is *Read*.
Admins and Users need **Edit**: ask an admin (it is set on SharePoint, not in EPL Tool).

**Buttons are locked with "Read-only — click Start editing to make changes".** That is normal: EPL Tool starts read-only.
Click **Start editing** (Admins and Users). Viewers always stay read-only. Some things are for admins only: see
[Roles & permissions](help:roles).

## Shared folder and OneDrive

**EPL Tool can't find the database, or says the shared folder can't be reached.** Check that OneDrive is running and
signed in with your company account, that the shared folder is synced (green tick), and that it is set to **Always keep
on this device**. Meanwhile EPL Tool works on an **offline copy** (read-only) and reconnects by itself.

**"Newer data … is still syncing to your computer" doesn't go away.** OneDrive hasn't downloaded the new file yet. Check
the OneDrive icon: it may be paused, signed out or showing an error. The data appears by itself once the file is there.

**A file like EPL-Database-PCNAME.db appeared next to the database.** OneDrive made a conflict copy. EPL Tool shows it
in **Settings → Conflict copies**: see [Conflict copies](help:conflict-copies). Don't delete it by hand.

## Editing

**Someone has been editing for a long time and I need to make a change.** Click **Start editing** → **Wait** to be told
when the slot is free, or ask them to click **Finish editing**. A session without a sign of life for {{TAKEOVER}} can be
taken over, and editing ends by itself after {{IDLE_RELEASE}} without a change — except while a dialog or wizard is
open; then an admin can **Force release** it in **Settings → Shared database**. See
[Editing the shared database](help:editing).

**My changes don't appear for the others.** They are published {{AUTO_PUBLISH_DELAY}} after your last change (or with
**Publish now** / **Finish editing**); the others get them within {{CHECK_INTERVAL}}. If the status line says *Editing ·
not published*, the banner explains why and EPL Tool tries again.

**EPL Tool says my changes were not published, or that my edit slot was released or taken over.** Nothing is lost: your
changes were kept as a [conflict copy](help:conflict-copies). Click **Start editing** and re-apply your price lists from
it.

## Installing and updates

**"Windows protected your PC" when running the setup.** The setup isn't signed: click **More info** → **Run anyway**. If
Windows blocks it completely, ask IT whether per-user apps may be installed.

**"Update EPL Tool to … to make changes".** Someone published with a newer version. Click **Install update** on the
banner (or **Open folder** and run the setup yourself). You can read and export meanwhile.

**Install update says the installer is not complete on this PC yet.** OneDrive is still downloading the setup: try again
in a minute.

**Which version do I have?** **Settings → Shared database** shows *This PC runs EPL Tool …*.

## Notifications and email

**I don't get Windows notifications (slot free, editing ended).** Check **Windows Settings → System → Notifications**:
notifications on, EPL Tool allowed, and *Do not disturb* / *Focus* off. The banners in EPL Tool say the same thing.

**The email draft doesn't open.** Email drafts need the Outlook desktop app, set up with your mailbox. The exported file is
saved in the folder you chose, so you can also attach it by hand.

## Other

**Where are my email template and my settings?** On your PC, in your Windows profile: they don't follow you to another
PC, and they are not in the shared database.

**The shared database file is damaged.** You keep working on your last good copy. An admin restores a backup in
**Settings → Backups** (see [Backups](help:backups)).

Something else? Every change is in the [activity log](help:activity); the **Shared database** card in Settings shows who
is editing and what was published last. Ask an admin, with a screenshot of the message.
