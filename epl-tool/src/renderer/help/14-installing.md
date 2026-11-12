# Installing EPL Tool & first start

EPL Tool installs for you only: **no admin rights** are needed, and nothing has to be configured. These steps take about
ten minutes on a new PC. Admins: the steps to send to a new colleague are in
[Onboarding a new user](help:onboarding).

## Before you start

- An admin has added you to the user list (by your company email) and has given you access to the shared SharePoint
  folder: **Edit** for Admins and Users, **Read** for Viewers.
- OneDrive is running and signed in with your company account.
- For email drafts: the Outlook desktop app is set up on your PC.

## 1. Sync the shared folder

1. Open the SharePoint folder (the link from your admin) in the browser and click **Sync** (or **Add shortcut to My
   files**). Wait until OneDrive shows the green tick.
2. In Windows Explorer, right-click the synced folder → **Always keep on this device**, so the database is always on
   your PC.

## 2. Install

1. In the synced folder, open **Installer** and run the setup, for example *EPL Tool-0.8.0 Setup.exe*.
2. If Windows shows *Windows protected your PC*: click **More info** → **Run anyway** (the setup isn't signed).
3. EPL Tool starts by itself when the installation is done. Next time, start it from the Start menu or the desktop
   shortcut.

## 3. First start

1. The setup screen opens: click **Connect to shared database** and choose the database file (for example
   *EPL-Database.db*) in the synced folder. If you used EPL Tool before, the screen offers the database you opened last
   time.
2. EPL Tool copies the database to your PC (*Connecting…*) and starts **read-only**. The sidebar shows *Read-only · data
   of …*, and your name and role at the bottom.
3. A *No access* screen means you are not on the user list yet: click **Request access** (an email draft to the admins),
   then **Try again** once they have added you.
4. Admins and Users: try **Start editing** → **Finish editing** once, ideally together with an admin the first time. If
   Start editing says your access to the folder is read-only, ask an admin for **Edit** rights on SharePoint.

From then on, EPL Tool connects by itself when it starts. How the shared database works is in
[Shared database](help:shared-database); the [Rules of use](help:rules-of-use) are short — please read them.

## Updates

When an admin publishes a new version, a banner says *EPL Tool … is available*: click **Install update**. EPL Tool
publishes your changes first if you are editing, starts the setup and closes; the new version starts when the
installation is done. The version on your PC is shown in **Settings → Shared database** (*This PC runs EPL Tool …*). See
*Updates* in [Shared database](help:shared-database).

## Uninstalling

**Windows Settings → Apps → EPL Tool → Uninstall.** The shared database and its folder are not touched. Your personal
settings (the database you connect to, your email template) stay in your Windows profile until you delete them.
