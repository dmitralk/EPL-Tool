import { BrowserWindow, dialog } from 'electron';
import { getIdentity } from '../auth';
import { applyUpdate, checkNow, connectShared, getStatus, onStatus, refresh } from '../sync/sync';
import { handle } from './guard';

// Shared database (Phase C). The status is public like db:*: the setup and no-access screens need it too.
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
}
