import fs from 'fs';
import path from 'path';
import { ipcMain, shell } from 'electron';
import { closeDatabase, getCurrentDbPath, getDb, getLastOpenError, openDatabase } from '../database';
import {
  backupDirFor, createBackup, createPreRestoreCopy, getLastBackupStatus, isBackupOf, isFileHealthy, listBackups, pruneBackups,
} from '../backup';
import type { BackupListResult } from '../../types';

// Backups belong to the open database, or to the one that just failed to open (so it can be restored).
function targetDbPath(): string | null {
  return getCurrentDbPath() ?? getLastOpenError()?.path ?? null;
}

export function registerBackupHandlers() {
  ipcMain.handle('db:last-open-error', () => getLastOpenError());

  ipcMain.handle('backup:list', (): BackupListResult => {
    const target = targetDbPath();
    if (!target) return { folder: null, backups: [], last: null };
    return { folder: backupDirFor(target), backups: listBackups(target), last: getLastBackupStatus() };
  });

  ipcMain.handle('backup:create', () => {
    const target = getCurrentDbPath();
    if (!target) return { ok: false, error: 'No database is open.' };
    try {
      return { ok: true, path: createBackup(getDb(), target) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('backup:open-folder', async () => {
    const target = targetDbPath();
    if (!target) return { ok: false, error: 'No database selected.' };
    const dir = backupDirFor(target);
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle('backup:restore', (_e, backupPath: string) => {
    const target = targetDbPath();
    if (!target) return { ok: false, error: 'No database selected.' };
    if (!isBackupOf(target, backupPath) || !fs.existsSync(backupPath)) {
      return { ok: false, error: 'Invalid backup file.' };
    }
    try {
      if (!isFileHealthy(backupPath)) return { ok: false, error: 'This backup failed the integrity check.' };

      closeDatabase();
      const safetyCopy = createPreRestoreCopy(target);
      const tmp = `${target}.restoring`;
      fs.copyFileSync(path.resolve(backupPath), tmp);
      for (const ext of ['-wal', '-shm', '-journal']) {
        if (fs.existsSync(target + ext)) fs.unlinkSync(target + ext);
      }
      fs.renameSync(tmp, target);
      openDatabase(target, { skipBackup: true });
      pruneBackups(target);
      return { ok: true, safetyCopy };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
