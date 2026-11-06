import { ipcMain } from 'electron';
import { getPref, setPref } from '../localSettings';
import { isPrefKey, MAX_PREF_LENGTH } from '../../shared/prefs';

// Local, per-user preferences: reading or saving them never touches the database.
export function registerPrefsHandlers() {
  ipcMain.handle('prefs:get', (_e, key: unknown) => {
    if (!isPrefKey(key)) throw new Error(`Unknown preference: ${String(key)}`);
    return getPref(key);
  });

  ipcMain.handle('prefs:set', (_e, key: unknown, value: unknown) => {
    if (!isPrefKey(key)) throw new Error(`Unknown preference: ${String(key)}`);
    if (typeof value !== 'string' || value.length > MAX_PREF_LENGTH) throw new Error('Invalid preference value.');
    setPref(key, value);
  });
}
