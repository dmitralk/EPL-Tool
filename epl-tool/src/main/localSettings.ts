import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { PrefKey } from '../shared/prefs';

// Per-PC file (%APPDATA%\epl-tool\settings.json). Holds nothing that grants rights; rights live in the database.
interface LocalSettings {
  lastDbPath?: string;
  prefs?: Partial<Record<PrefKey, string>>;
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings(): LocalSettings {
  try {
    const file = settingsPath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) return data as LocalSettings;
    }
  } catch {
    // unreadable or invalid file: start from empty settings
  }
  return {};
}

function writeSettings(data: LocalSettings): void {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function getSavedDbPath(): string | null {
  const value = readSettings().lastDbPath;
  return typeof value === 'string' && value ? value : null;
}

export function saveDbPath(dbPath: string): void {
  try {
    writeSettings({ ...readSettings(), lastDbPath: dbPath });
  } catch {
    // not fatal: the user will pick the database again next time
  }
}

export function getPref(key: PrefKey): string | null {
  const value = readSettings().prefs?.[key];
  return typeof value === 'string' ? value : null;
}

export function setPref(key: PrefKey, value: string): void {
  const data = readSettings();
  writeSettings({ ...data, prefs: { ...data.prefs, [key]: value } });
}
