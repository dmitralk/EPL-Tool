import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import Database from 'better-sqlite3';
import { closeDatabase, getCurrentDbPath, getDb, getLastOpenError, isOpen, openDatabase } from '../database';
import {
  backupDirFor, createBackup, createPreRestoreCopy, getLastBackupStatus, isBackupOf, isFileHealthy, listBackups, pruneBackups,
} from '../backup';
import { getIdentity } from '../auth';
import { stopPreview } from '../currentUser';
import { audit } from '../audit';
import { handle, requireRule } from './guard';
import type { BackupListResult } from '../../types';

const RESTORE_DENIED = 'Only admins can restore a backup.';

// Backups belong to the open database, or to the one that just failed to open (so it can be restored).
function targetDbPath(): string | null {
  return getCurrentDbPath() ?? getLastOpenError()?.path ?? null;
}

// With a damaged database nobody can be looked up in it, so the backup's own user list decides
// (backups from before the user list existed are allowed).
async function requireAdminInBackup(backupPath: string): Promise<void> {
  const id = await getIdentity();
  const b = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    if (!b.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) return;
    const admin = b.prepare(`
      SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1
        AND ((? IS NOT NULL AND account = ? COLLATE NOCASE) OR (? IS NOT NULL AND email = ? COLLATE NOCASE))
    `).get(id.account, id.account, id.email, id.email);
    if (!admin) throw new Error(`${RESTORE_DENIED} You are not an active admin in this backup.`);
  } finally {
    b.close();
  }
}

export function registerBackupHandlers() {
  handle('db:last-open-error', 'public', () => getLastOpenError());

  handle('backup:list', 'public', (): BackupListResult => {
    const target = targetDbPath();
    if (!target) return { folder: null, backups: [], last: null };
    return { folder: backupDirFor(target), backups: listBackups(target), last: getLastBackupStatus() };
  });

  handle('backup:create', 'admin', () => {
    const target = getCurrentDbPath();
    if (!target) return { ok: false, error: 'No database is open.' };
    try {
      return { ok: true, path: createBackup(getDb(), target) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, 'Only admins can back up the database.');

  handle('backup:open-folder', 'public', async () => {
    const target = targetDbPath();
    if (!target) return { ok: false, error: 'No database selected.' };
    const dir = backupDirFor(target);
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return error ? { ok: false, error } : { ok: true };
  });

  handle('backup:restore', 'public', async (_e, backupPath: string) => {
    const target = targetDbPath();
    if (!target) return { ok: false, error: 'No database selected.' };
    if (!isBackupOf(target, backupPath) || !fs.existsSync(backupPath)) {
      return { ok: false, error: 'Invalid backup file.' };
    }
    try {
      if (isOpen()) requireRule('admin', RESTORE_DENIED);
      if (!isFileHealthy(backupPath)) return { ok: false, error: 'This backup failed the integrity check.' };
      if (!isOpen()) await requireAdminInBackup(backupPath);

      closeDatabase();
      stopPreview();
      const safetyCopy = createPreRestoreCopy(target);
      const tmp = `${target}.restoring`;
      fs.copyFileSync(path.resolve(backupPath), tmp);
      for (const ext of ['-wal', '-shm', '-journal']) {
        if (fs.existsSync(target + ext)) fs.unlinkSync(target + ext);
      }
      fs.renameSync(tmp, target);
      openDatabase(target, { skipBackup: true });
      pruneBackups(target);
      const db = getDb();
      db.transaction(() => {
        audit(db, { action: 'backup.restore', entityType: 'backup', entityKey: path.basename(backupPath),
          summary: `Restored backup ${path.basename(backupPath)}` +
            (safetyCopy ? ` (previous file kept as ${path.basename(safetyCopy)})` : '') });
      })();
      return { ok: true, safetyCopy };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
