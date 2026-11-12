# Editing the shared database

Everybody can read the shared database at the same time, but **only one person edits at a time**: whoever clicks
**Start editing** holds the **edit slot** until they click **Finish editing**. Admins and Users can edit (Users only what
their rights allow, see [Roles & permissions](help:roles)); Viewers always stay read-only. How reading works is in
[Shared database](help:shared-database).

## Start editing

1. Click **Start editing** at the bottom of the sidebar.
2. *Reserving the edit slot…* — EPL Tool leaves a note in the shared folder that you want to edit, then waits about
   {{SLOT_WAIT}} so that OneDrive can bring in the note of anyone who clicked at the same moment. If two people asked, the
   one who asked first gets the slot and the other one waits. **Cancel** gives up the reservation.
3. *Getting a fresh copy…* — EPL Tool copies the latest data, keeps a backup of it in **EPL-Backups**, and a blue banner
   shows that you are editing.

Start editing is not possible while you are working on an offline copy, while newer data is still syncing to your PC (try
again in a minute), when the data was published by a newer version of EPL Tool (install the update first), or when your
access to the SharePoint folder is read-only.

## While you edit

- Your changes are saved on your PC and **published automatically** {{AUTO_PUBLISH_DELAY}} after your last change. The
  status line shows *Editing · changes to publish*, then *Editing · published 10:47*. **Publish now** on the blue banner
  publishes at once.
- Everybody else sees *Anna is editing* (with your name) in their sidebar, and gets your published changes within
  {{CHECK_INTERVAL}}.
- Every {{HEARTBEAT}} EPL Tool leaves a sign of life in the shared folder, so the others know that your session is
  active.
- Click **Finish editing** when you are done: the rest is published, the edit slot is free again (anybody waiting is
  told) and the app goes back to read mode.
- **Change Database** is not available while you edit: finish editing first.

## When someone else is editing

**Start editing** then shows who holds the slot, for example *Anna (PC-1234) has been editing since 10:02 (last change
10:41)*.

- **Wait**: a grey banner shows that you are waiting, and EPL Tool looks every {{CHECK_INTERVAL}}. When the slot is free
  you get a **Windows notification** and a banner *The edit slot is free* with **Start editing**. Nobody gets the slot
  automatically: the first person to click **Start editing** gets it. **Stop waiting** ends the wait.
- **Cancel**: nothing happens, you keep reading.
- In a hurry? The status line tells you who is editing: ask them to click **Finish editing**. If they are away and their
  session is kept by a dialog left open, an admin can **Force release** it (see
  [Shared database](help:shared-database)).

## Taking over an inactive session

When the EPL Tool of the person editing has given no sign of life for {{TAKEOVER}} — closed without finishing editing,
the PC asleep or switched off, no network — anybody who may edit can take over. **Start editing** asks first: *Take over
the edit slot?* with **Take over** and **Wait**. While you are waiting, the banner tells you too: *Anna's editing session
has been inactive since 10:41: you can take over*.

- Taking over is safe. Anna's changes were published {{AUTO_PUBLISH_DELAY}} after each change, so there is usually
  nothing left; if there is, it is kept as a [conflict copy](help:conflict-copies) when her EPL Tool wakes up — never
  overwritten, never lost.
- A session that was taken over doesn't get the slot back: Anna's EPL Tool shows *Ben took over the edit slot* (with
  your name), and she clicks **Start editing** again when she needs to.

## Automatic release after {{IDLE_RELEASE}}

So that a forgotten session doesn't block the others, editing ends by itself after **{{IDLE_RELEASE}} without a
change**: EPL Tool publishes your changes, frees the edit slot and goes back to read mode.

- {{IDLE_WARNING}} before, an amber banner warns you: *No changes for almost {{IDLE_RELEASE}}: at 11:15 EPL Tool
  publishes your changes and ends editing*. **Keep editing** starts the count again; **Finish editing** ends now.
- An **open dialog or wizard** (for example halfway through a new price list) keeps the slot: the count starts again
  when it closes. Don't leave one open when you walk away: an admin may have to force release your session.
- Afterwards a grey banner and a Windows notification tell you that editing ended; **Start editing** on the banner
  starts again.
- If publishing isn't possible at that moment (for example no network), you keep the slot and EPL Tool tries again a
  little later.

## Closing EPL Tool, and after a crash

- **Closing the app while editing** publishes first and frees the slot. If publishing isn't possible (for example no
  network), you can **Quit anyway**: your changes stay on your PC.
- **The next time EPL Tool starts** (also after a crash or a power cut), an amber banner says *You have changes from
  10:41 that were not published*:
  - **Resume editing**: you are back in edit mode with those changes. This goes through the edit slot like Start
    editing: if someone else is editing you wait, or take over an inactive session; your changes stay on your PC
    meanwhile.
  - **Publish now**: the same, then the changes are published and editing ends.
  - **Discard**: the changes are deleted from your PC (EPL Tool asks first; this can't be undone).
- If someone else published in the meantime, those changes can no longer be published as they are: EPL Tool keeps them at
  once as a [conflict copy](help:conflict-copies) and stays in read mode with the latest data.

## When editing ends unexpectedly

Nothing is ever overwritten. In the rare cases below, a red banner and a Windows notification tell you what happened,
your unpublished changes are kept as a [conflict copy](help:conflict-copies), and the app goes back to read mode with
the latest data:

- *Ben took over the edit slot*: your EPL Tool gave no sign of life for more than {{TAKEOVER}} (for example the laptop
  was asleep) and someone took over.
- *Your editing session ended: this PC gave no sign of life for too long*: the same, but nobody has taken over yet.
  Someone could have, so editing doesn't simply carry on.
- *Dmitri released your edit slot at 11:02*: an admin ended your session with **Force release** (Settings → Shared
  database), for example because a dialog was left open while you were away.
- *Your changes were not published*: someone else published while you were editing. This is very rare: it happens when
  OneDrive was paused or offline on one of the two PCs. As soon as EPL Tool notices, a red banner warns you: click
  **Finish editing**.

Click **Start editing** to carry on with the latest data, and re-apply your price lists from the conflict copy.

## Timings

| What | When |
|---|---|
| Reserving the edit slot | about {{SLOT_WAIT}} |
| Publishing your changes | {{AUTO_PUBLISH_DELAY}} after your last change |
| Looking for new data, or for a free slot while you wait | every {{CHECK_INTERVAL}} |
| Sign of life while you edit | every {{HEARTBEAT}} |
| An editing session is inactive (others may take over) | after {{TAKEOVER}} without a sign of life |
| Editing ends by itself | after {{IDLE_RELEASE}} without a change (warning {{IDLE_WARNING}} before) |
