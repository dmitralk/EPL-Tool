import { ipcMain, dialog } from 'electron';
import { getDb, openDatabase, isOpen, getCurrentDbPath } from '../database';
import { saveDbPath } from '../localSettings';
import { getLegacyLogoPath, getLogoDataUrl, logoFileToDataUrl, saveLogo } from '../logo';
import type { LogoInfo, SelectLogoResult } from '../../types';

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get-admin-emails', () => {
    return getDb().prepare('SELECT * FROM admin_emails ORDER BY email_name').all();
  });

  ipcMain.handle('settings:update-admin-email', (_e, id: number, email: string) => {
    getDb().prepare('UPDATE admin_emails SET email = ? WHERE id = ?').run(email, id);
  });

  // The path is per PC, so it is never stored in the (shared) database.
  ipcMain.handle('db:get-path', () => getCurrentDbPath());

  ipcMain.handle('db:is-open', () => isOpen());

  ipcMain.handle('db:select-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('db:open', (_e, filePath: string) => {
    try {
      openDatabase(filePath);
      saveDbPath(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('db:create', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create New Database',
      defaultPath: 'EPL-Database.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };

    try {
      openDatabase(result.filePath, { create: true });
      saveDbPath(result.filePath);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('settings:get-units', () => {
    return getDb().prepare('SELECT * FROM units ORDER BY name').all();
  });

  ipcMain.handle('settings:create-unit', (_e, name: string) => {
    const db = getDb();
    const result = db.prepare('INSERT INTO units (name) VALUES (?)').run(name.trim());
    return db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid);
  });

  ipcMain.handle('settings:delete-unit', (_e, id: number) => {
    getDb().prepare('DELETE FROM units WHERE id = ?').run(id);
  });

  ipcMain.handle('settings:get-logo', (): LogoInfo => {
    const db = getDb();
    const dataUrl = getLogoDataUrl(db);
    return { dataUrl, legacyPath: dataUrl ? null : getLegacyLogoPath(db) };
  });

  ipcMain.handle('settings:select-logo', async (): Promise<SelectLogoResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const dataUrl = logoFileToDataUrl(result.filePaths[0]);
      saveLogo(getDb(), dataUrl);
      return { ok: true, dataUrl };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
