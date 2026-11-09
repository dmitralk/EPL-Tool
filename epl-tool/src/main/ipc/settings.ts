import { dialog, shell } from 'electron';
import path from 'path';
import { getDb, isOpen } from '../database';
import { getIdentity } from '../auth';
import { audit } from '../audit';
import { getLegacyLogoPath, getLogoDataUrl, logoFileToDataUrl, saveLogo } from '../logo';
import { dataPath, openLocal } from '../sync/sync';
import { handle } from './guard';
import type { AdminEmail, LogoInfo, SelectLogoResult } from '../../types';

const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

// A database file opened directly (local mode). Opening may bootstrap the first admin (Migration 7), which needs the
// Windows identity.
async function open(filePath: string, opts: { create?: boolean } = {}) {
  await getIdentity();
  await openLocal(filePath, opts);
}

export function registerSettingsHandlers() {
  handle('settings:get-admin-emails', 'viewer', () => {
    return getDb().prepare('SELECT * FROM admin_emails ORDER BY email_name').all();
  });

  handle('settings:update-admin-email', 'admin', (_e, id: number, email: string) => {
    const db = getDb();
    const value = String(email ?? '').trim();
    if (!EMAIL_RE.test(value)) throw new Error('Invalid email address.');
    const before = db.prepare('SELECT * FROM admin_emails WHERE id = ?').get(id) as AdminEmail | undefined;
    if (!before) throw new Error('PBP email not found.');
    db.transaction(() => {
      db.prepare('UPDATE admin_emails SET email = ? WHERE id = ?').run(value, id);
      audit(db, { action: 'pbp_email.update', entityType: 'pbp_email', entityKey: before.email_name,
        summary: `PBP email ${before.email_name}: ${before.email} → ${value}` });
    })();
  }, 'Only admins can change PBP emails.');

  handle('settings:create-admin-email', 'admin', (_e, emailName: string, email: string) => {
    const db = getDb();
    const name = String(emailName ?? '').trim();
    const value = String(email ?? '').trim();
    if (!name) throw new Error('Name is required.');
    if (!EMAIL_RE.test(value)) throw new Error('Invalid email address.');
    if (db.prepare('SELECT 1 FROM admin_emails WHERE email_name = ? COLLATE NOCASE').get(name)) {
      throw new Error(`A PBP email named "${name}" already exists.`);
    }
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO admin_emails (email_name, email) VALUES (?, ?)').run(name, value);
      audit(db, { action: 'pbp_email.create', entityType: 'pbp_email', entityKey: name, summary: `Added PBP email ${name}: ${value}` });
      return result.lastInsertRowid;
    })();
    return db.prepare('SELECT * FROM admin_emails WHERE id = ?').get(id);
  }, 'Only admins can change PBP emails.');

  handle('settings:delete-admin-email', 'admin', (_e, id: number) => {
    const db = getDb();
    const before = db.prepare('SELECT * FROM admin_emails WHERE id = ?').get(id) as AdminEmail | undefined;
    if (!before) return;
    db.transaction(() => {
      db.prepare('DELETE FROM admin_emails WHERE id = ?').run(id);
      audit(db, { action: 'pbp_email.delete', entityType: 'pbp_email', entityKey: before.email_name,
        summary: `Removed PBP email ${before.email_name} (${before.email})` });
    })();
  }, 'Only admins can change PBP emails.');

  // The path is per PC, so it is never stored in the (shared) database. Shared mode: the central database, not the copy.
  handle('db:get-path', 'public', () => dataPath());

  // Folder of the shared database in Explorer (OneDrive's "Manage access" lives there).
  handle('db:open-folder', 'viewer', async () => {
    const current = dataPath();
    if (!current) return { ok: false, error: 'No database is open.' };
    const error = await shell.openPath(path.dirname(current));
    return error ? { ok: false, error } : { ok: true };
  });

  handle('db:is-open', 'public', () => isOpen());

  handle('db:select-file', 'public', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('db:open', 'public', async (_e, filePath: string) => {
    try {
      await open(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  handle('db:create', 'public', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create New Database',
      defaultPath: 'EPL-Database.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };

    try {
      await open(result.filePath, { create: true });
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  handle('settings:get-units', 'viewer', () => {
    return getDb().prepare('SELECT * FROM units ORDER BY name').all();
  });

  handle('settings:create-unit', 'admin', (_e, name: string) => {
    const db = getDb();
    const value = name.trim();
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO units (name) VALUES (?)').run(value);
      audit(db, { action: 'unit.create', entityType: 'unit', entityKey: value, summary: `Added unit ${value}` });
      return result.lastInsertRowid;
    })();
    return db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  }, 'Only admins can change units.');

  handle('settings:delete-unit', 'admin', (_e, id: number) => {
    const db = getDb();
    const unit = db.prepare('SELECT name FROM units WHERE id = ?').get(id) as { name: string } | undefined;
    if (!unit) return;
    db.transaction(() => {
      db.prepare('DELETE FROM units WHERE id = ?').run(id);
      audit(db, { action: 'unit.delete', entityType: 'unit', entityKey: unit.name, summary: `Removed unit ${unit.name}` });
    })();
  }, 'Only admins can change units.');

  handle('settings:get-logo', 'viewer', (): LogoInfo => {
    const db = getDb();
    const dataUrl = getLogoDataUrl(db);
    return { dataUrl, legacyPath: dataUrl ? null : getLegacyLogoPath(db) };
  });

  handle('settings:select-logo', 'admin', async (): Promise<SelectLogoResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const dataUrl = logoFileToDataUrl(result.filePaths[0]);
      const db = getDb();
      db.transaction(() => {
        saveLogo(db, dataUrl);
        audit(db, { action: 'settings.logo', entityType: 'settings', entityKey: 'logo', summary: 'Changed the company logo' });
      })();
      return { ok: true, dataUrl };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, 'Only admins can change the logo.');
}
