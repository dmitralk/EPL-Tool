# Onboarding a new user

For admins: what to do when a colleague starts using EPL Tool, and — once — when the team moves to the shared database.

## For each new colleague

1. **Start editing**, then **Settings → Users → Add user**: their company email, display name and role (Admin, User or
   Viewer; see [Roles & permissions](help:roles)). For a User, make them a manager of their customers on each customer page
   (**Pricing management**), or set those customers to *Open* (see [Pricing management modes](help:pricing-modes)).
   **Preview as…** shows the app exactly as they will see it. **Finish editing** publishes the new user list.
2. **SharePoint** (outside EPL Tool): give them access to the shared folder — **Edit** for Admins and Users, **Read** for
   Viewers. EPL Tool can't do this for you; the Users screen reminds you and opens the shared folder.
3. **Send them** the link to the SharePoint folder and the checklist below.
4. **First start together**: for Admins and Users, one **Start editing** → **Finish editing** cycle, to check their
   SharePoint rights.

### Checklist to send

1. Open the SharePoint folder from the link, click **Sync**, wait for the green tick, then right-click the synced folder →
   **Always keep on this device**.
2. In the synced folder, open **Installer** and run the EPL Tool setup (no admin rights needed). If Windows says *Windows
   protected your PC*: **More info** → **Run anyway**.
3. In EPL Tool: **Connect to shared database** → choose the database file in the synced folder.
4. Check that the sidebar shows *Read-only · data of …* with your name at the bottom. *No access*? Click **Request
   access**.
5. Read *Rules of use* in **Guides & Help** (sidebar).
6. Email drafts need the Outlook desktop app.

The same steps, with more detail, are in [Installing EPL Tool & first start](help:installing).

## Publishing a new version of EPL Tool

1. Download the setup of the new version from the release page, for example *EPL.Tool-0.8.1.Setup.exe*.
2. **Settings → Shared database → Publish an installer…**, choose the setup and confirm the version EPL Tool read from
   the file name.
3. EPL Tool copies it to the `Installer` folder next to the shared database (the {{INSTALLERS_KEPT}} newest versions are
   kept). Everybody with an older version sees *Install update* within {{CHECK_INTERVAL}}.

An older version can't replace a newer one. Publishing the same version again replaces its file (for example after a copy
that went wrong).

## Going live (once)

When the team moves to the shared database:

1. Install the new version of EPL Tool on your PC and open the current database once, so that it is updated.
2. In **Settings → Users**, add the other admins and the users, and set the customers' pricing modes and managers. Check
   with **Preview as…**.
3. Create the shared folder on SharePoint and **move** the database there (give it a new name if you like, so that old
   versions of EPL Tool can't find it). Then **Change Database → Connect to shared database** and choose it.
4. Set the SharePoint permissions on that folder: **Edit** for Admins and Users, **Read** for Viewers.
5. **Publish an installer…** (see above), so that colleagues find the setup in `Installer`.
6. Ask everybody to uninstall old versions and to remove old copies of the database from their PCs.
7. Onboard the colleagues as above, starting with one pilot.
8. During the first weeks, keep an eye on the [activity log](help:activity), the **Shared database** card and the
   [conflict copies](help:conflict-copies).
