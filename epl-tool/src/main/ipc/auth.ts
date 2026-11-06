import { ipcMain } from 'electron';
import { getIdentity } from '../auth';

export function registerAuthHandlers() {
  ipcMain.handle('auth:whoami', () => getIdentity());
}
