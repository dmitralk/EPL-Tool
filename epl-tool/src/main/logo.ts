import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

// The logo lives inside the database (app_settings.logo_data_url) so every PC exports the same image.
// The old per-PC file path (app_settings.logo_path) is no longer used for exports.
export const LOGO_KEY = 'logo_data_url';
export const LEGACY_LOGO_PATH_KEY = 'logo_path';
export const MAX_LOGO_BYTES = 1024 * 1024;

const MIME_BY_EXT: Record<string, 'png' | 'jpeg' | 'gif'> = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif' };
const DATA_URL_RE = /^data:image\/(png|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

export interface LogoImage {
  base64: string;
  extension: 'png' | 'jpeg' | 'gif';
}

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function getLogoDataUrl(db: Database.Database): string | null {
  const value = getSetting(db, LOGO_KEY);
  return value && DATA_URL_RE.test(value) ? value : null;
}

export function getLegacyLogoPath(db: Database.Database): string | null {
  return getSetting(db, LEGACY_LOGO_PATH_KEY);
}

export function getLogoImage(db: Database.Database): LogoImage | null {
  const m = getLogoDataUrl(db)?.match(DATA_URL_RE);
  return m ? { base64: m[2], extension: m[1] as LogoImage['extension'] } : null;
}

export function logoFileToDataUrl(filePath: string): string {
  const extension = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  if (!extension) throw new Error('The logo must be a PNG, JPEG or GIF image.');
  const size = fs.statSync(filePath).size;
  if (size === 0) throw new Error('The selected file is empty.');
  if (size > MAX_LOGO_BYTES) throw new Error('The logo must be smaller than 1 MB.');
  return `data:image/${extension};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

export function saveLogo(db: Database.Database, dataUrl: string): void {
  if (!DATA_URL_RE.test(dataUrl)) throw new Error('Invalid logo image.');
  db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(LOGO_KEY, dataUrl);
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(LEGACY_LOGO_PATH_KEY);
  })();
}
