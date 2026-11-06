import { getPref, setPref } from '../localSettings';
import { isPrefKey, MAX_PREF_LENGTH } from '../../shared/prefs';
import { handle } from './guard';

// Local, per-user preferences: reading or saving them never touches the database.
export function registerPrefsHandlers() {
  handle('prefs:get', 'viewer', (_e, key: unknown) => {
    if (!isPrefKey(key)) throw new Error(`Unknown preference: ${String(key)}`);
    return getPref(key);
  });

  handle('prefs:set', 'viewer', (_e, key: unknown, value: unknown) => {
    if (!isPrefKey(key)) throw new Error(`Unknown preference: ${String(key)}`);
    if (typeof value !== 'string' || value.length > MAX_PREF_LENGTH) throw new Error('Invalid preference value.');
    setPref(key, value);
  });
}
