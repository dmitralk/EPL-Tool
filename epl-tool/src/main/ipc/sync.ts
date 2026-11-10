import { BrowserWindow, dialog } from 'electron';
import { getIdentity } from '../auth';
import {
  applyUpdate, cancelClaim, checkNow, connectShared, dismissConflict, dismissReleased, finishEditing, getStatus, keepEditing,
  onStatus, publishNow, recoverUnpublished, refresh, setBusy, startEditing, stopWaiting, waitForSlot,
} from '../sync/sync';
import { handle } from './guard';

// Shared database (Phases C–D). The channels are public like db:*: the setup and no-access screens need the status, and the
// edit actions check the rights themselves (Start editing: Admins and Users, or anybody on a database without users).
export function registerSyncHandlers() {
  onStatus(status => {
    for (const win of BrowserWindow.getAllWindows?.() ?? []) {
      if (!win.isDestroyed()) win.webContents.send('sync:status', status);
    }
  });

  handle('sync:status', 'public', () => getStatus());

  handle('sync:select-central', 'public', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose the shared database (in the synced SharePoint folder)',
      properties: ['openFile'],
      filters: [{ name: 'EPL database', extensions: ['db'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Opening a copy never writes the shared file, but the identity is needed to find the person in the user list.
  handle('sync:connect', 'public', async (_e, centralPath: string) => {
    try {
      await getIdentity();
      await connectShared(String(centralPath ?? ''), { save: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  handle('sync:check', 'public', async () => {
    await checkNow();
    return getStatus();
  });

  handle('sync:apply-update', 'public', async () => {
    await applyUpdate();
    return getStatus();
  });

  handle('sync:refresh', 'public', async () => {
    await refresh();
    return getStatus();
  });

  // Start editing: { ok: true } · { waiting: holder } · { takeOver: inactive session } · { cancelled } · { error }.
  handle('sync:start-editing', 'public', async (_e, opts?: { takeOver?: boolean }) => {
    try {
      await getIdentity();
      return await startEditing({ takeOver: !!opts?.takeOver });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  handle('sync:cancel-claim', 'public', () => {
    cancelClaim();
    return getStatus();
  });

  // Waiting for the edit slot: the app tells when it is free (notification + banner); it never claims it automatically.
  handle('sync:wait-for-slot', 'public', async () => {
    await waitForSlot();
    return getStatus();
  });

  handle('sync:stop-waiting', 'public', () => {
    stopWaiting();
    return getStatus();
  });

  // The screens report open dialogs and wizards: the edit slot is not released while one is open.
  handle('sync:set-busy', 'public', (_e, busy: boolean) => {
    setBusy(!!busy);
  });

  handle('sync:keep-editing', 'public', () => {
    keepEditing();
    return getStatus();
  });

  handle('sync:dismiss-released', 'public', () => {
    dismissReleased();
    return getStatus();
  });

  handle('sync:publish', 'public', () => publishNow());

  handle('sync:finish-editing', 'public', () => finishEditing());

  // Unpublished changes from a previous run: resume, publish now (both through the edit slot) or discard.
  handle('sync:recover', 'public', async (_e, action: 'resume' | 'publish' | 'discard', opts?: { takeOver?: boolean }) => {
    try {
      await getIdentity();
      return await recoverUnpublished(action === 'resume' || action === 'publish' ? action : 'discard', { takeOver: !!opts?.takeOver });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  handle('sync:dismiss-conflict', 'public', () => {
    dismissConflict();
    return getStatus();
  });
}
