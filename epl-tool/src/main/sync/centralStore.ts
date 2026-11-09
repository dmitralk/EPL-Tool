import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { escapeRegExp, fileStamp, isHealthy } from '../backup';

// All access to the shared folder goes through a CentralStore (multi-user study §5, §7). The app never opens the central
// database with SQLite: it only copies it (to read) and replaces it in one step (to publish). SyncedFolderStore works on the
// folder synced by the OneDrive client; another implementation (e.g. Microsoft Graph) could replace it later.

export const CONFLICTS_DIR_NAME = 'EPL-Conflicts';
const MANIFEST_SUFFIX = '.manifest.json';

// <name>.manifest.json next to the central database, rewritten by every publish.
export interface Manifest {
  format: 1;
  generation: number;
  sha256: string;
  size: number;
  publishedBy: string | null;
  publishedByAccount: string | null;
  publishedAt: string | null;       // ISO UTC
  schemaVersion: number;
  appVersion: string;               // app that published
  minAppVersion: string;            // oldest app version allowed to edit this database
}

// What a database file contains, read from a local copy (sync_meta = Migration 8; generation 0 before it).
export interface DbFileInfo {
  sha256: string;
  size: number;
  schemaVersion: number;
  generation: number;
  publishedBy: string | null;
  publishedByAccount: string | null;
  publishedAt: string | null;
  publishedAppVersion: string | null;
}

export interface CentralProbe {
  reachable: boolean;               // the shared folder can be read
  exists: boolean;                  // the database file is in it
  size: number;
  mtimeMs: number;
  manifest: Manifest | null;
}

// The central file the editor started from or last published.
export interface PublishExpectation {
  generation: number;
  sha256: string;
}

export type PublishResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; conflict: string };   // the central file changed meanwhile: nothing was written

export type CentralErrorKind = 'unreachable' | 'missing' | 'damaged';

export class CentralError extends Error {
  constructor(public readonly kind: CentralErrorKind, message: string) {
    super(message);
    this.name = 'CentralError';
  }
}

export interface CentralStore {
  readonly dbPath: string;
  readonly folder: string;
  readonly manifestPath: string;
  probe(): Promise<CentralProbe>;
  readManifest(): Promise<Manifest | null>;
  download(dest: string): Promise<DbFileInfo>;
  publish(snapshot: string, info: DbFileInfo, expected: PublishExpectation,
    meta: { appVersion: string; minAppVersion: string }): Promise<PublishResult>;
  saveConflictCopy(file: string, account: string | null): Promise<string>;
  findConflictCopies(): Promise<string[]>;
  canWrite(): Promise<boolean>;
}

// ── Helpers for local copies ───────────────────────────────────────────────────────────────────────────────────────

const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// OneDrive briefly holds files it is syncing: retry the file operation a few times.
async function retry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 400): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !RETRY_CODES.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await sleep(delayMs * i);
    }
  }
}

async function removeQuietly(file: string): Promise<void> {
  try { await fsp.unlink(file); } catch { /* not there */ }
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

interface SyncMetaRow {
  generation: number;
  published_by: string | null;
  published_by_account: string | null;
  published_at: string | null;
  published_app_version: string | null;
}

// Reads a LOCAL copy without changing it; throws CentralError('damaged') when it fails the integrity check.
// Only for files on this PC: a read-only open of a WAL-mode file leaves -wal/-shm files, which are removed here.
export function inspectDbFile(file: string): Omit<DbFileInfo, 'sha256' | 'size'> {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    if (!isHealthy(db)) throw new CentralError('damaged', 'The database copy failed the integrity check (PRAGMA quick_check).');
    const schemaVersion = db.pragma('user_version', { simple: true }) as number;
    const hasMeta = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_meta'").get();
    const meta = hasMeta ? db.prepare('SELECT * FROM sync_meta WHERE id = 1').get() as SyncMetaRow | undefined : undefined;
    return {
      schemaVersion,
      generation: meta?.generation ?? 0,
      publishedBy: meta?.published_by ?? null,
      publishedByAccount: meta?.published_by_account ?? null,
      publishedAt: meta?.published_at ?? null,
      publishedAppVersion: meta?.published_app_version ?? null,
    };
  } catch (e) {
    if (e instanceof CentralError) throw e;
    throw new CentralError('damaged', `The database copy can't be read: ${(e as Error).message}`);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
    for (const ext of ['-wal', '-shm']) {
      try { if (fs.existsSync(file + ext)) fs.unlinkSync(file + ext); } catch { /* ignore */ }
    }
  }
}

export async function describeDbFile(file: string): Promise<DbFileInfo> {
  const sha256 = await sha256File(file);
  const { size } = await fsp.stat(file);
  return { sha256, size, ...inspectDbFile(file) };
}

// ── OneDrive / SharePoint synced folder ───────────────────────────────────────────────────────────────────────────

export class SyncedFolderStore implements CentralStore {
  readonly dbPath: string;
  readonly folder: string;
  readonly manifestPath: string;
  private readonly baseName: string;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    this.folder = path.dirname(this.dbPath);
    this.baseName = path.parse(this.dbPath).name;
    this.manifestPath = path.join(this.folder, `${this.baseName}${MANIFEST_SUFFIX}`);
  }

  static manifestPathFor(dbPath: string): string {
    return path.join(path.dirname(path.resolve(dbPath)), `${path.parse(dbPath).name}${MANIFEST_SUFFIX}`);
  }

  async probe(): Promise<CentralProbe> {
    try {
      await fsp.access(this.folder);
    } catch {
      return { reachable: false, exists: false, size: 0, mtimeMs: 0, manifest: null };
    }
    let stat: fs.Stats | null = null;
    try { stat = await fsp.stat(this.dbPath); } catch { /* missing */ }
    return {
      reachable: true,
      exists: !!stat,
      size: stat?.size ?? 0,
      mtimeMs: stat?.mtimeMs ?? 0,
      manifest: await this.readManifest(),
    };
  }

  async readManifest(): Promise<Manifest | null> {
    try {
      const data = JSON.parse(await fsp.readFile(this.manifestPath, 'utf-8'));
      if (data && typeof data === 'object' && Number.isInteger(data.generation) && typeof data.sha256 === 'string') {
        return data as Manifest;
      }
    } catch {
      // missing, being synced or invalid: treated as no manifest
    }
    return null;
  }

  // Copies the central file to dest (via dest.download), verifies it and describes it. dest must not be open.
  async download(dest: string): Promise<DbFileInfo> {
    try {
      await fsp.stat(this.dbPath);
    } catch (e) {
      const folderThere = await fsp.access(this.folder).then(() => true, () => false);
      throw folderThere
        ? new CentralError('missing', `The shared database file was not found: ${this.dbPath}`)
        : new CentralError('unreachable', `The shared folder can't be reached: ${(e as Error).message}`);
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.download`;
    await removeQuietly(tmp);
    try {
      try {
        await retry(() => fsp.copyFile(this.dbPath, tmp));
      } catch (e) {
        throw new CentralError('unreachable', `The shared database could not be copied: ${(e as Error).message}`);
      }
      const info = await describeDbFile(tmp);
      await fsp.rename(tmp, dest);
      return info;
    } catch (e) {
      await removeQuietly(tmp);
      throw e;
    }
  }

  // Generation check, then the snapshot replaces the central file in one step (multi-user study §5.6).
  async publish(
    snapshot: string, info: DbFileInfo, expected: PublishExpectation, meta: { appVersion: string; minAppVersion: string },
  ): Promise<PublishResult> {
    const manifest = await this.readManifest();
    if (manifest && manifest.generation > expected.generation) {
      return { ok: false, conflict: `${manifest.publishedBy ?? 'Someone else'} published a newer version` +
        `${manifest.publishedAt ? ` (${manifest.publishedAt})` : ''} after you started editing.` };
    }
    let centralSha: string;
    try {
      centralSha = await sha256File(this.dbPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, conflict: 'The shared database file is no longer in the shared folder.' };
      }
      throw e;
    }
    if (centralSha !== expected.sha256) {
      return { ok: false, conflict: 'The shared database was changed by someone else after you started editing.' };
    }

    // OneDrive doesn't sync *.tmp files, so a half-copied file is never uploaded.
    const tmp = `${this.dbPath}.tmp`;
    try {
      await retry(() => fsp.copyFile(snapshot, tmp));
      if (await sha256File(tmp) !== info.sha256) throw new Error('The copy in the shared folder is incomplete.');
      await retry(() => fsp.rename(tmp, this.dbPath), 8);
    } catch (e) {
      await removeQuietly(tmp);
      throw e;
    }

    const next: Manifest = {
      format: 1,
      generation: info.generation,
      sha256: info.sha256,
      size: info.size,
      publishedBy: info.publishedBy,
      publishedByAccount: info.publishedByAccount,
      publishedAt: info.publishedAt,
      schemaVersion: info.schemaVersion,
      appVersion: meta.appVersion,
      minAppVersion: meta.minAppVersion,
    };
    const manifestTmp = `${this.manifestPath}.tmp`;
    await fsp.writeFile(manifestTmp, JSON.stringify(next, null, 2));
    await retry(() => fsp.rename(manifestTmp, this.manifestPath), 8);
    return { ok: true, manifest: next };
  }

  // A refused publish keeps the working copy in EPL-Conflicts/ next to the central database.
  async saveConflictCopy(file: string, account: string | null): Promise<string> {
    const dir = path.join(this.folder, CONFLICTS_DIR_NAME);
    await fsp.mkdir(dir, { recursive: true });
    const who = (account ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
    const dest = path.join(dir, `${this.baseName}_${fileStamp()}_${who}.db`);
    const tmp = `${dest}.tmp`;
    try {
      await retry(() => fsp.copyFile(file, tmp));
      await retry(() => fsp.rename(tmp, dest));
    } catch (e) {
      await removeQuietly(tmp);
      throw e;
    }
    return dest;
  }

  // OneDrive names its conflict copies "<name>-<computer>.db" (or "-<computer>-2.db", …) in the same folder.
  async findConflictCopies(): Promise<string[]> {
    const re = new RegExp(`^${escapeRegExp(this.baseName)}-.+\\.db$`, 'i');
    try {
      return (await fsp.readdir(this.folder)).filter(name => re.test(name)).sort().map(name => path.join(this.folder, name));
    } catch {
      return [];
    }
  }

  // People with Read permission on the SharePoint folder can't write: detected with a .tmp probe file (never synced).
  async canWrite(): Promise<boolean> {
    const probe = path.join(this.folder, `.epl-write-check-${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
      await fsp.writeFile(probe, '');
      await removeQuietly(probe);
      return true;
    } catch {
      return false;
    }
  }
}
