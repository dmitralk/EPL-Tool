import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { BackupInfo, BackupStatus } from '../types';

export const BACKUP_DIR_NAME = 'EPL-Backups';
const KEEP = 20;

let lastStatus: BackupStatus | null = null;

export function getLastBackupStatus(): BackupStatus | null {
  return lastStatus;
}

export function backupDirFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), BACKUP_DIR_NAME);
}

export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function backupNameRe(dbPath: string): RegExp {
  const base = escapeRegExp(path.parse(dbPath).name);
  return new RegExp(`^${base}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(_pre-restore)?\\.db$`);
}

export function isBackupOf(dbPath: string, filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return path.dirname(resolved) === path.resolve(backupDirFor(dbPath)) && backupNameRe(dbPath).test(path.basename(resolved));
}

export function isHealthy(db: Database.Database): boolean {
  const rows = db.pragma('quick_check') as { quick_check: string }[];
  return rows.length === 1 && rows[0].quick_check === 'ok';
}

export function isFileHealthy(filePath: string): boolean {
  const check = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return isHealthy(check);
  } finally {
    check.close();
  }
}

export function listBackups(dbPath: string): BackupInfo[] {
  const dir = backupDirFor(dbPath);
  if (!fs.existsSync(dir)) return [];
  const re = backupNameRe(dbPath);
  return fs.readdirSync(dir)
    .filter(name => re.test(name))
    .map(name => {
      const full = path.join(dir, name);
      const [, y, mo, d, h, mi, s] = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_pre-restore)?\.db$/.exec(name)!.map(Number);
      return {
        name,
        path: full,
        size: fs.statSync(full).size,
        created_at: new Date(y, mo - 1, d, h, mi, s).toISOString(),
        pre_restore: name.includes('_pre-restore'),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function pruneBackups(dbPath: string): void {
  for (const b of listBackups(dbPath).slice(KEEP)) {
    try { fs.unlinkSync(b.path); } catch { /* locked by sync client — retry next time */ }
  }
}

// Consistent snapshot via VACUUM INTO, verified, then renamed so the sync client only sees a complete file.
export function createBackup(db: Database.Database, dbPath: string): string {
  const dir = backupDirFor(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const final = path.join(dir, `${path.parse(dbPath).name}_${fileStamp()}.db`);
  const tmp = `${final}.partial`;
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    db.prepare('VACUUM INTO ?').run(tmp);
    if (!isFileHealthy(tmp)) throw new Error('Backup copy failed integrity check');
    fs.renameSync(tmp, final);
    lastStatus = { at: new Date().toISOString(), path: final };
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
    lastStatus = { at: new Date().toISOString(), error: (err as Error).message };
    throw err;
  }
  pruneBackups(dbPath);
  return final;
}

// Raw file copy of the (closed, possibly damaged) database, kept so a restore can be undone. source: the file to keep when it
// is not dbPath itself (the working copy of a shared database).
export function createPreRestoreCopy(dbPath: string, source = dbPath): string | null {
  if (!fs.existsSync(source)) return null;
  const dir = backupDirFor(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${path.parse(dbPath).name}_${fileStamp()}_pre-restore.db`);
  fs.copyFileSync(source, dest);
  return dest;
}
