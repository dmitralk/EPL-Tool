import { ipcMain, dialog, app } from 'electron';
import { getDb, openDatabase, isOpen } from '../database';
import { saveDbPath } from '../index';
import fs from 'fs';

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', (_e, key: string) => {
    try {
      return (getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
  });

  ipcMain.handle('settings:get-admin-emails', () => {
    return getDb().prepare('SELECT * FROM admin_emails ORDER BY email_name').all();
  });

  ipcMain.handle('settings:update-admin-email', (_e, id: number, email: string) => {
    getDb().prepare('UPDATE admin_emails SET email = ? WHERE id = ?').run(email, id);
  });

  ipcMain.handle('db:get-path', () => {
    try {
      const result = getDb().prepare("SELECT value FROM app_settings WHERE key = 'db_path'").get() as { value: string } | undefined;
      return result?.value ?? null;
    } catch {
      return null;
    }
  });

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
      getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('db_path', filePath);
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
      openDatabase(result.filePath);
      getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('db_path', result.filePath);
      saveDbPath(result.filePath);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('settings:select-logo', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    });
    if (result.canceled) return null;
    const logoPath = result.filePaths[0];
    getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('logo_path', logoPath);
    return logoPath;
  });
}
