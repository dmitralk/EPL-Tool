import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import {
  bootstrapFirstAdmin, closeDatabase, getCurrentDbPath, getDb, getNewerSchema, getOpenCount, isOpen, openDatabase,
  SCHEMA_VERSION, totalChanges,
} from '../database';
import { createBackup, createPreRestoreCopy, fileStamp } from '../backup';
import { audit } from '../audit';
import { getResolvedIdentity } from '../auth';
import { getConnection, getSavedDbPath, saveDbPath, saveSharedConnection } from '../localSettings';
import { auditActor, getActor, getRealUser, stopPreview, userListEmpty } from '../currentUser';
import { canStartEditing, readOnlyMessage, type WriteBlock } from '../../shared/permissions';
import { AUTO_PUBLISH_SECONDS, CHANGE_CHECK_SECONDS, MIN_EDIT_APP_VERSION, compareVersions } from '../../shared/sync';
import {
  CentralError, SyncedFolderStore, describeDbFile, sha256File, type CentralStore, type DbFileInfo, type Manifest,
} from './centralStore';
import { isInSyncedFolder } from './oneDrive';
import { cacheDir, localDataDir, workDir } from './paths';
import type { AppUser, SyncPublishInfo, SyncStatus } from '../../types';

// The connection to the database (multi-user study §5, dev-plan Phase C):
//   local  — a database file opened directly, as before v0.7 (test databases, development)
//   shared — the central database in a synced SharePoint folder. The app works on a local copy: read mode (PRAGMA
//            query_only) by default, refreshed when someone publishes; edit mode (admins) works on a working copy that is
//            published back with the generation check.

// What the read copy in cache\ is a copy of (cache\cache.json).
interface CacheMeta {
  centralPath: string;
  sha256: string;               // of the central file when it was copied
  generation: number;
  schemaVersion: number;
  publishedBy: string | null;
  publishedAt: string | null;
  copiedAt: string;
  fileTime: string | null;      // modification time of the central file when it was copied
}

interface Shared {
  store: CentralStore;
  phase: 'connecting' | 'read' | 'edit';
  copy: CacheMeta | null;       // the open read copy
  offline: { since: string; reason: string } | null;
  syncing: SyncPublishInfo | null;
  pending: { info: DbFileInfo; fileTime: string | null } | null;  // newer copy in cache\incoming.db
  manifest: Manifest | null;    // last manifest seen
  lastProbe: string | null;     // size / time / manifest of the central file at the last complete check
  damagedCount: number;
  centralDamaged: boolean;
  conflictCopies: string[];
  lastCheckAt: string | null;
  error: string | null;
  conflict: { savedTo: string | null; at: string; message: string } | null;  // last refused publish
  recovery: Session | null;     // unpublished working copy left by a previous run
}

// Edit mode: the working copy in work\ and what the next publish must find in the shared folder.
interface EditState {
  since: string;
  workFile: string;
  baseGeneration: number;       // generation of the central file the next publish replaces
  baseSha: string;              // its exact content (sha256)
  publishedBy: string | null;   // of that central file (status line)
  publishedAt: string | null;
  baseline: number;             // totalChanges() when the copy last matched the shared file
  seen: number;                 // totalChanges() at the last look (a new change restarts the auto-publish delay)
  dirty: boolean;
  changedAt: string | null;
  publishing: Promise<PublishOutcome> | null;
  lastPublishedAt: string | null;
  lastPublishedGeneration: number | null;
  nextPublishAt: number | null;
  error: string | null;
  centralKey: string | null;    // probe of the central file when last compared
  centralChanged: string | null;
}

// work\session.json: lets the next start find unpublished changes (crash, or "Quit anyway").
interface Session {
  centralPath: string;
  account: string | null;
  startedAt: string;
  baseGeneration: number;
  baseSha: string;
  publishedBy: string | null;
  publishedAt: string | null;
  dirty: boolean;
  changedAt: string | null;
}

export type PublishOutcome =
  | { ok: true; published: boolean; generation: number }
  | { ok: false; error: string; conflict?: boolean; savedTo?: string | null };

// A shared file failing the integrity check this many times in a row is reported as damaged (a single failure is
// usually a copy caught in the middle of a OneDrive download).
const DAMAGED_REPORT_AFTER = 3;

let mode: 'none' | 'local' | 'shared' = 'none';
let shared: Shared | null = null;
let edit: EditState | null = null;
let legacySuggestion: { path: string } | null = null;
let connectError: string | null = null;
let checking: Promise<void> | null = null;
let starting = false;
let timer: NodeJS.Timeout | null = null;
let publishTimer: NodeJS.Timeout | null = null;
let timing = { checkMs: CHANGE_CHECK_SECONDS * 1000, publishMs: AUTO_PUBLISH_SECONDS * 1000 };
let timersOn = false;
const listeners = new Set<(status: SyncStatus) => void>();

const nowIso = () => new Date().toISOString();
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const cacheFileFor = (centralPath: string) => path.join(cacheDir(), path.basename(centralPath));
const cacheMetaPath = () => path.join(cacheDir(), 'cache.json');
const incomingPath = () => path.join(cacheDir(), 'incoming.db');
const workFileFor = (centralPath: string) => path.join(workDir(), path.basename(centralPath));
const sessionPath = () => path.join(workDir(), 'session.json');

function publishInfo(x: { generation: number; publishedBy: string | null; publishedAt: string | null }): SyncPublishInfo {
  return { generation: x.generation, publishedBy: x.publishedBy, publishedAt: x.publishedAt };
}

function readCacheMeta(centralPath: string): CacheMeta | null {
  try {
    const meta = JSON.parse(fs.readFileSync(cacheMetaPath(), 'utf-8')) as CacheMeta;
    if (meta && samePath(meta.centralPath, centralPath) && fs.existsSync(cacheFileFor(centralPath))) return meta;
  } catch {
    // no usable copy
  }
  return null;
}

function writeCacheMeta(meta: CacheMeta): void {
  const tmp = `${cacheMetaPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, cacheMetaPath());
}

async function removeQuietly(file: string): Promise<void> {
  try { await fsp.unlink(file); } catch { /* not there */ }
}

function openReadCopy(file: string): void {
  openDatabase(file, { skipBackup: true, readOnly: true, allowNewerSchema: true, bootstrap: false });
}

// Replaces the read copy with cache\incoming.db (already verified) and opens it read-only.
function installReadCopy(s: Shared, info: DbFileInfo, fileTime: string | null): void {
  closeDatabase();
  const file = cacheFileFor(s.store.dbPath);
  fs.renameSync(incomingPath(), file);
  const meta: CacheMeta = {
    centralPath: s.store.dbPath,
    sha256: info.sha256,
    generation: info.generation,
    schemaVersion: info.schemaVersion,
    publishedBy: info.publishedBy,
    publishedAt: info.publishedAt,
    copiedAt: nowIso(),
    fileTime,
  };
  writeCacheMeta(meta);
  openReadCopy(file);
  s.copy = meta;
  s.phase = 'read';
  s.pending = null;
  s.damagedCount = 0;
  s.centralDamaged = false;
  s.error = null;
}

function offlineReason(e: unknown): string {
  if (e instanceof CentralError && e.kind === 'missing') return 'The shared database file is not in the shared folder.';
  return "The shared folder can't be reached.";
}

function connectErrorMessage(e: unknown, centralPath: string): string {
  if (e instanceof CentralError) {
    if (e.kind === 'missing') return `${path.basename(centralPath)} was not found in ${path.dirname(centralPath)}.`;
    if (e.kind === 'unreachable') return `The shared folder can't be reached: ${path.dirname(centralPath)}.`;
    return `The shared database failed the integrity check. Ask an admin to restore a backup. (${e.message})`;
  }
  return (e as Error).message;
}

// Status → screens (ipc/sync.ts sends it to the window).
export function onStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const status = getStatus();
  for (const l of listeners) {
    try { l(status); } catch { /* a closed window */ }
  }
}

// ── Connecting ─────────────────────────────────────────────────────────────────────────────────────────────────────

function leaveCurrent(): void {
  if (shared?.phase === 'edit') throw new Error('Finish editing first: your changes are not published yet.');
  stopPreview();
  closeDatabase();
  shared = null;
  mode = 'none';
}

// Opens a database file directly (local mode, as before v0.7). A published shared database is refused: it must be used
// through Connect to shared database, never changed in place.
export async function openLocal(filePath: string, opts: { create?: boolean } = {}): Promise<void> {
  if (!opts.create && fs.existsSync(SyncedFolderStore.manifestPathFor(filePath))) {
    throw new Error('This is a shared database (it has a manifest file next to it). Use "Connect to shared database" ' +
      'instead of opening it directly.');
  }
  leaveCurrent();
  openDatabase(filePath, { create: opts.create });
  mode = 'local';
  legacySuggestion = null;
  connectError = null;
  saveDbPath(filePath);
  emit();
}

// Connects to the central database of a shared folder: a fresh copy when the folder can be reached, otherwise the last
// copy of the same database (offline). save = remember it for the next start.
export async function connectShared(centralPath: string, opts: { save?: boolean } = {}): Promise<void> {
  const target = path.resolve(centralPath);
  leaveCurrent();
  const store = new SyncedFolderStore(target);
  const previous = readCacheMeta(target);
  if (!previous) await fsp.rm(cacheDir(), { recursive: true, force: true });
  await fsp.mkdir(cacheDir(), { recursive: true });

  const s: Shared = {
    store, phase: 'connecting', copy: null, offline: null, syncing: null, pending: null, manifest: null, lastProbe: null,
    damagedCount: 0, centralDamaged: false, conflictCopies: [], lastCheckAt: null, error: null, conflict: null, recovery: null,
  };
  shared = s;
  mode = 'shared';
  connectError = null;
  emit();

  try {
    const probe = await store.probe();
    const info = await store.download(incomingPath());
    if (shared !== s) return;
    installReadCopy(s, info, probe.exists ? new Date(probe.mtimeMs).toISOString() : null);
    s.manifest = probe.manifest;
    s.syncing = probe.manifest && probe.manifest.generation > info.generation ? publishInfo(probe.manifest) : null;
    s.lastProbe = probeKey(probe.size, probe.mtimeMs, probe.manifest);
  } catch (e) {
    if (shared !== s) return;
    await removeQuietly(incomingPath());
    if (!previous) {
      shared = null;
      mode = 'none';
      connectError = connectErrorMessage(e, target);
      emit();
      throw new Error(connectError);
    }
    openReadCopy(cacheFileFor(target));
    s.copy = previous;
    s.phase = 'read';
    if (e instanceof CentralError && e.kind === 'damaged') {
      s.damagedCount = DAMAGED_REPORT_AFTER;
      s.centralDamaged = true;
      s.error = 'The shared database failed the integrity check: you are working on your last good copy.';
    } else {
      s.offline = { since: nowIso(), reason: offlineReason(e) };
    }
  }

  if (opts.save) saveSharedConnection(target);
  legacySuggestion = null;
  s.conflictCopies = await store.findConflictCopies();
  s.recovery = findUnpublishedSession(target);
  emit();
}

// ── Working copy files ─────────────────────────────────────────────────────────────────────────────────────────────

function readSession(): Session | null {
  try {
    const sess = JSON.parse(fs.readFileSync(sessionPath(), 'utf-8')) as Session;
    return sess && typeof sess.centralPath === 'string' ? sess : null;
  } catch {
    return null;
  }
}

function writeSession(e: EditState): void {
  if (!shared) return;
  const sess: Session = {
    centralPath: shared.store.dbPath,
    account: getResolvedIdentity()?.account ?? null,
    startedAt: e.since,
    baseGeneration: e.baseGeneration,
    baseSha: e.baseSha,
    publishedBy: e.publishedBy,
    publishedAt: e.publishedAt,
    dirty: e.dirty,
    changedAt: e.changedAt,
  };
  try {
    fs.mkdirSync(workDir(), { recursive: true });
    const tmp = `${sessionPath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sess, null, 2));
    fs.renameSync(tmp, sessionPath());
  } catch {
    // only needed after a crash; never block editing
  }
}

function clearWorkFiles(centralPath: string): void {
  for (const f of [sessionPath(), workFileFor(centralPath), `${workFileFor(centralPath)}-journal`]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

// Unpublished changes from a previous run of this person on this PC (crash, or "Quit anyway"), else null. A session
// without unpublished changes is simply cleaned up.
function findUnpublishedSession(centralPath: string): Session | null {
  const sess = readSession();
  if (!sess || !samePath(sess.centralPath, centralPath)) return null;
  const me = getResolvedIdentity()?.account ?? null;
  if (sess.account && me && sess.account.toLowerCase() !== me.toLowerCase()) return null;
  if (sess.dirty && fs.existsSync(workFileFor(centralPath))) return sess;
  clearWorkFiles(centralPath);
  return null;
}

// At start-up: reconnect the way this PC did last time. A database opened directly by v0.6 (no connection saved yet) that
// lies in a OneDrive/SharePoint folder is not opened: the setup screen offers to connect to it as shared (decided 9 Nov).
export async function startup(): Promise<void> {
  const conn = getConnection();
  try {
    if (conn?.mode === 'shared') {
      await connectShared(conn.path);
      return;
    }
    const localPath = conn?.path ?? getSavedDbPath();
    if (!localPath) return;
    if (!conn && fs.existsSync(localPath) && await isInSyncedFolder(localPath)) {
      legacySuggestion = { path: localPath };
      emit();
      return;
    }
    await openLocal(localPath);
  } catch {
    // shown on the setup screen (connect error / last open error)
  }
}

// ── Read mode: change detection ───────────────────────────────────────────────────────────────────────────────────

function probeKey(size: number, mtimeMs: number, manifest: Manifest | null): string {
  return `${size}|${mtimeMs}|${manifest ? `${manifest.generation}:${manifest.sha256}` : '-'}`;
}

// Looks at the shared folder (every CHANGE_CHECK_SECONDS, on Refresh, and when asked by the screens). A newer copy is
// downloaded and verified, then waits in `pending` until the screens apply it (at once when nothing is open).
export function checkNow(): Promise<void> {
  if (!checking) checking = runCheck().finally(() => { checking = null; });
  return checking;
}

async function runCheck(): Promise<void> {
  const s = shared;
  if (!s || s.phase === 'connecting') return;
  s.lastCheckAt = nowIso();
  const probe = await s.store.probe();
  if (shared !== s) return;
  if (!probe.reachable || !probe.exists) {
    if (!s.offline) {
      s.offline = { since: nowIso(), reason: probe.reachable ? 'The shared database file is not in the shared folder.' :
        "The shared folder can't be reached." };
    }
    emit();
    return;
  }
  const wasOffline = !!s.offline;
  s.offline = null;
  s.manifest = probe.manifest;
  s.conflictCopies = await s.store.findConflictCopies();
  const key = probeKey(probe.size, probe.mtimeMs, probe.manifest);
  if (s.phase === 'edit') {
    await watchWhileEditing(s, key);
    emit();
    return;
  }
  if (s.phase !== 'read' || (!wasOffline && key === s.lastProbe)) {
    emit();
    return;
  }

  let info: DbFileInfo;
  try {
    info = await s.store.download(incomingPath());
  } catch (e) {
    if (shared !== s) return;
    if (e instanceof CentralError && e.kind === 'damaged') {
      s.damagedCount++;
      if (s.damagedCount >= DAMAGED_REPORT_AFTER) {
        s.centralDamaged = true;
        s.error = 'The shared database failed the integrity check: you are working on your last good copy.';
      }
    } else {
      s.offline = { since: nowIso(), reason: offlineReason(e) };
    }
    emit();
    return;
  }
  if (shared !== s || s.phase !== 'read') {
    await removeQuietly(incomingPath());
    return;
  }
  s.damagedCount = 0;
  s.centralDamaged = false;
  s.error = null;
  // Newer data announced by the manifest but not yet synced to this PC: check again next time.
  const announced = probe.manifest && probe.manifest.generation > info.generation ? probe.manifest : null;
  s.syncing = announced ? publishInfo(announced) : null;
  s.lastProbe = announced ? null : key;
  if (info.sha256 === s.copy?.sha256) {
    await removeQuietly(incomingPath());
    s.pending = null;
  } else {
    s.pending = { info, fileTime: new Date(probe.mtimeMs).toISOString() };
  }
  emit();
}

// Swaps the downloaded newer copy in (the screens call this when nothing is open, or on Refresh).
export async function applyUpdate(): Promise<boolean> {
  if (checking) await checking;
  const s = shared;
  if (!s || s.phase !== 'read' || !s.pending || starting) return false;
  installReadCopy(s, s.pending.info, s.pending.fileTime);
  emit();
  return true;
}

export async function refresh(): Promise<void> {
  await checkNow();
  await applyUpdate();
}

// Delays can be shortened for the checks; the app uses the constants of shared/sync.ts.
export function startBackgroundChecks(t: Partial<typeof timing> = {}): void {
  timing = { ...timing, ...t };
  timersOn = true;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void checkNow(); }, timing.checkMs);
  timer.unref?.();
}

export function stopBackgroundChecks(): void {
  if (timer) clearInterval(timer);
  if (publishTimer) clearTimeout(publishTimer);
  timer = null;
  publishTimer = null;
  timersOn = false;
}

// While editing: warn as soon as someone else has published (the next publish would be refused), retry a failed publish.
async function watchWhileEditing(s: Shared, key: string): Promise<void> {
  const e = edit;
  if (!e) return;
  if (key !== e.centralKey) {
    e.centralKey = key;
    try {
      const centralSha = await sha256File(s.store.dbPath);
      e.centralChanged = centralSha === e.baseSha ? null :
        `${s.manifest?.publishedBy ?? 'Someone else'} published a newer version after you started editing. Your next ` +
        'publish will be refused: click Finish editing to keep your work in EPL-Conflicts/.';
    } catch {
      e.centralKey = null;   // being synced: look again next time
    }
  }
  if (timersOn && e.dirty && e.error && !e.publishing) void publishNow();
}

// ── Edit mode (multi-user study §5.5–5.7; admins in v0.7, no edit slot yet) ──────────────────────────────────────

// A change has to wait while a publish takes its snapshot of the working copy, else null.
export function waitForPublish(): Promise<void> | null {
  const p = edit?.publishing;
  return p ? p.then(() => undefined, () => undefined) : null;
}

// Runs a change made through a "writes" channel and notes it for the automatic publish.
export function afterWrite<T>(run: () => T): T {
  let result: T;
  try {
    result = run();
  } catch (e) {
    noteChanges();
    throw e;
  }
  if (result instanceof Promise) void result.then(noteChanges, noteChanges);
  else noteChanges();
  return result;
}

// Compares SQLite's change counter with the last publish: new changes mark the copy as changed and (re)start the
// auto-publish delay.
function noteChanges(): void {
  const e = edit;
  if (!e || !isOpen()) return;
  const n = totalChanges();
  if (n === e.seen) return;
  e.seen = n;
  if (n === e.baseline && !e.dirty) return;
  e.changedAt = nowIso();
  if (!e.dirty) {
    e.dirty = true;
    writeSession(e);
  }
  schedulePublish(e);
  emit();
}

function schedulePublish(e: EditState): void {
  e.nextPublishAt = Date.now() + timing.publishMs;
  if (!timersOn) return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    if (edit === e && e.dirty) void publishNow();
  }, timing.publishMs);
  publishTimer.unref?.();
}

// Oldest version allowed to edit after this publish; never above this app's own version (development builds).
function minEditVersion(): string {
  return compareVersions(MIN_EDIT_APP_VERSION, app.getVersion()) > 0 ? app.getVersion() : MIN_EDIT_APP_VERSION;
}

// Backup of a freshly downloaded copy (exactly what the shared file contained) in EPL-Backups/ next to the central file.
function backupCopy(file: string, centralPath: string): void {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    createBackup(copy, centralPath);
  } catch {
    // reported in Settings → Backups (last backup status); never blocks editing
  } finally {
    copy.close();
  }
}

// Start editing: fresh copy of the shared file → backup → working copy opened read-write. restoreFrom: start from a backup
// instead (restore while the shared file is damaged).
export async function startEditing(opts: { restoreFrom?: string } = {}): Promise<void> {
  const s = shared;
  if (starting) throw new Error('Editing is already being started.');
  if (!s || s.phase !== 'read') throw new Error(s?.phase === 'edit' ? 'You are already editing.' : 'Connect to the shared database first.');
  const user = getActor();
  const damagedRestore = !!opts.restoreFrom && s.centralDamaged;
  const blocked = startEditingBlocked(user);
  if (blocked && !(damagedRestore && canStartEditing(user))) throw new Error(blocked);
  if (s.recovery) throw new Error('You have unpublished changes from an earlier session: publish or discard them first.');
  starting = true;
  try {
    if (!(await s.store.canWrite())) {
      throw new Error('You have read-only access to the shared folder on SharePoint, so changes are not possible.');
    }
    const workFile = workFileFor(s.store.dbPath);
    await fsp.mkdir(workDir(), { recursive: true });
    clearWorkFiles(s.store.dbPath);
    let base: { generation: number; sha256: string; publishedBy: string | null; publishedAt: string | null };
    if (damagedRestore && opts.restoreFrom) {
      await fsp.copyFile(opts.restoreFrom, `${workFile}.tmp`);
      await fsp.rename(`${workFile}.tmp`, workFile);
      base = {
        generation: Math.max(s.manifest?.generation ?? 0, s.copy?.generation ?? 0),
        sha256: await sha256File(s.store.dbPath),
        publishedBy: s.copy?.publishedBy ?? null,
        publishedAt: s.copy?.publishedAt ?? null,
      };
    } else {
      const probe = await s.store.probe();
      const info = await s.store.download(workFile);
      if (probe.manifest && probe.manifest.generation > info.generation) {
        clearWorkFiles(s.store.dbPath);
        s.syncing = publishInfo(probe.manifest);
        emit();
        throw new Error('Newer data is still syncing to your computer. Try again in a minute.');
      }
      if (info.schemaVersion > SCHEMA_VERSION) {
        clearWorkFiles(s.store.dbPath);
        throw new Error('This database was published by a newer EPL Tool. Update EPL Tool to make changes.');
      }
      backupCopy(workFile, s.store.dbPath);
      base = info;
    }

    closeDatabase();
    try {
      openDatabase(workFile, { skipBackup: true, bootstrap: false });
    } catch (e) {
      clearWorkFiles(s.store.dbPath);
      openReadCopy(cacheFileFor(s.store.dbPath));
      throw e;
    }
    const n = totalChanges();
    edit = {
      since: nowIso(), workFile, baseGeneration: base.generation, baseSha: base.sha256,
      publishedBy: base.publishedBy, publishedAt: base.publishedAt, baseline: n, seen: n, dirty: false, changedAt: null,
      publishing: null, lastPublishedAt: null, lastPublishedGeneration: null, nextPublishAt: null, error: null,
      centralKey: null, centralChanged: null,
    };
    s.phase = 'edit';
    s.conflict = null;
    s.pending = null;
    await removeQuietly(incomingPath());
    writeSession(edit);
    // Decided 9 Nov 2026: the first admin of a database without users is created here, and the Windows account of someone
    // added by email only is recorded now (the look-up records it). Both are changes to publish.
    bootstrapFirstAdmin(getDb());
    getActor();
    noteChanges();
    emit();
  } finally {
    starting = false;
  }
}

interface Stamp {
  generation: number;
  by: string;
  account: string | null;
  at: string;                    // ISO UTC without milliseconds (same format as the activity log)
  appVersion: string;
  userId: number | null;
  label: string;
}

// generation + publisher in sync_meta and the sync.publish activity entry, in one transaction.
function applyStamp(db: Database.Database, st: Stamp): void {
  db.transaction(() => {
    db.prepare(`UPDATE sync_meta SET generation = ?, published_by = ?, published_by_account = ?, published_at = ?,
      published_app_version = ? WHERE id = 1`).run(st.generation, st.by, st.account, st.at, st.appVersion);
    db.prepare(`
      INSERT INTO audit_log (at, user_id, user_label, action, entity_type, entity_key, summary, details)
      VALUES (?, ?, ?, 'sync.publish', 'database', ?, ?, ?)
    `).run(st.at, st.userId, st.label, String(st.generation), `Published the shared database (generation ${st.generation})`,
      JSON.stringify({ generation: st.generation, appVersion: st.appVersion }));
  })();
}

// Publishes the working copy if it has changes (auto-publish, Publish now, Finish editing, quit).
export function publishNow(): Promise<PublishOutcome> {
  const e = edit;
  if (!e || shared?.phase !== 'edit') return Promise.resolve({ ok: false, error: 'You are not editing.' });
  if (!e.publishing) {
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = null;
    e.publishing = doPublish(e).finally(() => {
      e.publishing = null;
      emit();
    });
    emit();
  }
  return e.publishing;
}

async function doPublish(e: EditState): Promise<PublishOutcome> {
  const s = shared;
  if (!s) return { ok: false, error: 'Not connected to the shared database.' };
  noteChanges();
  if (!e.dirty) return { ok: true, published: false, generation: e.baseGeneration };

  const real = getRealUser();
  const { userId, label } = auditActor();
  const st: Stamp = {
    generation: e.baseGeneration + 1,
    by: real?.display_name ?? getResolvedIdentity()?.displayNameHint ?? 'Unknown',
    account: real?.account ?? getResolvedIdentity()?.account ?? null,
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    appVersion: app.getVersion(),
    userId,
    label,
  };
  const snapshot = path.join(workDir(), 'publish.db');
  await removeQuietly(snapshot);
  const changesAtSnapshot = totalChanges();
  let info: DbFileInfo;
  try {
    getDb().prepare('VACUUM INTO ?').run(snapshot);
    const snap = new Database(snapshot);
    try { applyStamp(snap, st); } finally { snap.close(); }
    info = await describeDbFile(snapshot);
  } catch (err) {
    await removeQuietly(snapshot);
    e.error = `Could not prepare the publish: ${(err as Error).message}`;
    return { ok: false, error: e.error };
  }

  let result: Awaited<ReturnType<CentralStore['publish']>>;
  try {
    result = await s.store.publish(snapshot, info, { generation: e.baseGeneration, sha256: e.baseSha },
      { appVersion: app.getVersion(), minAppVersion: minEditVersion() });
  } catch (err) {
    await removeQuietly(snapshot);
    e.error = `Could not publish: ${(err as Error).message}`;
    return { ok: false, error: e.error };
  }
  if (!result.ok) {
    await removeQuietly(snapshot);
    const savedTo = await keepRefusedCopy(s);
    return refused(s, e, result.conflict, savedTo);
  }
  await removeQuietly(snapshot);

  // Published: the same stamp in the working copy. Changes waited for the publish, so the counter only moves by the stamp.
  const before = totalChanges();
  applyStamp(getDb(), st);
  e.baseline = e.seen = totalChanges();
  e.dirty = before !== changesAtSnapshot;
  e.baseGeneration = st.generation;
  e.baseSha = info.sha256;
  e.publishedBy = st.by;
  e.publishedAt = st.at;
  e.lastPublishedAt = st.at;
  e.lastPublishedGeneration = st.generation;
  e.nextPublishAt = null;
  e.error = null;
  e.centralChanged = null;
  e.centralKey = null;
  s.manifest = result.manifest;
  s.lastProbe = null;
  writeSession(e);
  if (e.dirty) schedulePublish(e);
  return { ok: true, published: true, generation: st.generation };
}

// A refused publish keeps the working copy as it is (not stamped: its sync_meta still shows the generation it started
// from) in EPL-Conflicts/, or on this PC when the shared folder can't take it.
async function keepRefusedCopy(s: Shared): Promise<string | null> {
  const copy = path.join(workDir(), 'conflict.db');
  try {
    await removeQuietly(copy);
    getDb().prepare('VACUUM INTO ?').run(copy);
  } catch {
    return null;
  }
  const account = getResolvedIdentity()?.account ?? null;
  try {
    const saved = await s.store.saveConflictCopy(copy, account);
    await removeQuietly(copy);
    return saved;
  } catch {
    const localDir = path.join(localDataDir(), 'conflicts');
    try {
      await fsp.mkdir(localDir, { recursive: true });
      const dest = path.join(localDir, `${path.parse(s.store.dbPath).name}_${fileStamp()}.db`);
      await fsp.rename(copy, dest);
      return dest;
    } catch {
      return null;
    }
  }
}

// Decided 9 Nov 2026: after a refused publish the app goes back to read mode on the fresh data.
async function refused(s: Shared, e: EditState, message: string, savedTo: string | null): Promise<PublishOutcome> {
  const where = savedTo ? ` Your copy was saved as ${savedTo}.` : ' Your copy could not be saved.';
  s.conflict = { savedTo, at: nowIso(), message: `Your changes were not published: ${message}${where}` };
  await endEditing(s, e, false);
  return { ok: false, conflict: true, error: s.conflict.message, savedTo };
}

// Leaves edit mode. published = the working copy matches the shared file and becomes the read copy; otherwise it is
// discarded and a fresh read copy is taken (or the old one reopened when the folder can't be reached).
async function endEditing(s: Shared, e: EditState, published: boolean): Promise<void> {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  edit = null;
  closeDatabase();
  const cacheFile = cacheFileFor(s.store.dbPath);
  s.phase = 'read';
  s.lastProbe = null;
  await removeQuietly(incomingPath());
  if (published) {
    try {
      fs.renameSync(e.workFile, cacheFile);
    } catch {
      fs.copyFileSync(e.workFile, cacheFile);   // e.g. briefly held by a virus scanner
    }
    const stat = await fsp.stat(s.store.dbPath).catch(() => null);
    const meta: CacheMeta = {
      centralPath: s.store.dbPath, sha256: e.baseSha, generation: e.baseGeneration, schemaVersion: SCHEMA_VERSION,
      publishedBy: e.publishedBy, publishedAt: e.publishedAt, copiedAt: nowIso(),
      fileTime: stat ? new Date(stat.mtimeMs).toISOString() : null,
    };
    writeCacheMeta(meta);
    openReadCopy(cacheFile);
    s.copy = meta;
    s.damagedCount = 0;
    s.centralDamaged = false;
    s.error = null;
  } else {
    try {
      const probe = await s.store.probe();
      const info = await s.store.download(incomingPath());
      installReadCopy(s, info, probe.exists ? new Date(probe.mtimeMs).toISOString() : null);
    } catch {
      await removeQuietly(incomingPath());
      openReadCopy(cacheFile);
    }
  }
  clearWorkFiles(s.store.dbPath);
  emit();
}

// Finish editing = publish, then the working copy becomes the read copy. A publish error keeps edit mode (nothing lost).
export async function finishEditing(): Promise<PublishOutcome> {
  const s = shared;
  const e = edit;
  if (!s || !e || s.phase !== 'edit') return { ok: false, error: 'You are not editing.' };
  let r = await publishNow();
  for (let i = 0; r.ok && edit === e && e.dirty && i < 3; i++) r = await publishNow();
  if (r.ok && edit === e) await endEditing(s, e, true);
  return r;
}

// Unpublished changes from a previous run: publish them now (same generation check) or discard them.
export async function recoverUnpublished(action: 'publish' | 'discard'): Promise<PublishOutcome> {
  const s = shared;
  const sess = s?.recovery;
  if (!s || !sess || s.phase !== 'read') return { ok: false, error: 'There are no unpublished changes to recover.' };
  if (action === 'discard') {
    clearWorkFiles(s.store.dbPath);
    s.recovery = null;
    emit();
    return { ok: true, published: false, generation: s.copy?.generation ?? 0 };
  }
  const blocked = startEditingBlocked(getActor(), { recovering: true });
  if (blocked) return { ok: false, error: blocked };
  if (!(await s.store.canWrite())) {
    return { ok: false, error: 'You have read-only access to the shared folder on SharePoint, so changes are not possible.' };
  }
  const workFile = workFileFor(s.store.dbPath);
  closeDatabase();
  try {
    openDatabase(workFile, { skipBackup: true, bootstrap: false });
  } catch (err) {
    openReadCopy(cacheFileFor(s.store.dbPath));
    return { ok: false, error: `The unpublished copy can't be opened: ${(err as Error).message}` };
  }
  const e: EditState = {
    since: sess.startedAt, workFile, baseGeneration: sess.baseGeneration, baseSha: sess.baseSha,
    publishedBy: sess.publishedBy, publishedAt: sess.publishedAt, baseline: -1, seen: totalChanges(), dirty: true,
    changedAt: sess.changedAt, publishing: null, lastPublishedAt: null, lastPublishedGeneration: null, nextPublishAt: null,
    error: null, centralKey: null, centralChanged: null,
  };
  edit = e;
  s.phase = 'edit';
  s.recovery = null;
  const r = await publishNow();
  if (r.ok && edit === e) await endEditing(s, e, true);
  emit();
  return r;
}

// Restore in shared mode = the backup becomes the working copy and is published at once (the working copy, or the damaged
// shared file, is kept as the pre-restore copy). Needs edit mode, except when the shared file is damaged.
export async function restoreSharedBackup(backupPath: string): Promise<{ ok: boolean; error?: string; safetyCopy?: string | null }> {
  const s = shared;
  if (!s) return { ok: false, error: 'Not connected to the shared database.' };
  let startedHere = false;
  let safetyCopy: string | null;
  if (s.phase === 'read') {
    if (!s.centralDamaged) return { ok: false, error: writeBlockMessage(getActor()) ?? 'Click Start editing first.' };
    safetyCopy = createPreRestoreCopy(s.store.dbPath);
    await startEditing({ restoreFrom: backupPath });
    startedHere = true;
  } else {
    const e = edit;
    if (!e) return { ok: false, error: 'You are not editing.' };
    if (e.publishing) await e.publishing;
    if (edit !== e) return { ok: false, error: 'Editing ended before the restore (see the message about your changes).' };
    // Synchronous from here to the reopen, so no change can reach a closed database.
    closeDatabase();
    safetyCopy = createPreRestoreCopy(s.store.dbPath, e.workFile);
    fs.copyFileSync(backupPath, `${e.workFile}.tmp`);
    fs.renameSync(`${e.workFile}.tmp`, e.workFile);
    openDatabase(e.workFile, { skipBackup: true, bootstrap: false });
    e.seen = totalChanges();
  }
  const e = edit as EditState | null;
  if (!e) return { ok: false, error: 'You are not editing.', safetyCopy };
  const db = getDb();
  db.transaction(() => {
    audit(db, { action: 'backup.restore', entityType: 'backup', entityKey: path.basename(backupPath),
      summary: `Restored backup ${path.basename(backupPath)}` +
        (safetyCopy ? ` (previous copy kept as ${path.basename(safetyCopy)})` : '') });
  })();
  e.baseline = -1;
  noteChanges();
  const r = await publishNow();
  if (r.ok && startedHere && edit === e) await endEditing(s, e, true);
  emit();
  return r.ok ? { ok: true, safetyCopy } : { ok: false, error: r.error, safetyCopy };
}

export function dismissConflict(): void {
  if (shared) shared.conflict = null;
  emit();
}

// ── Rules used by the guard and the status ────────────────────────────────────────────────────────────────────────

export function isShared(): boolean {
  return mode === 'shared';
}

export function isEditing(): boolean {
  return shared?.phase === 'edit';
}

// The database the user thinks of: the local file, or the central database (not the local copy) in shared mode.
export function dataPath(): string | null {
  if (mode === 'shared' && shared) return shared.store.dbPath;
  return getCurrentDbPath();
}

function minAppVersionNeeded(): string | null {
  const min = shared?.manifest?.minAppVersion;
  return min && compareVersions(min, app.getVersion()) > 0 ? min : null;
}

function writeBlock(): WriteBlock | null {
  if (mode !== 'shared' || !shared) return null;
  if (shared.phase === 'edit') return null;
  if (shared.offline) return 'offline';
  if (getNewerSchema() !== null || minAppVersionNeeded()) return 'update';
  return 'read';
}

// Why a change is refused on the open copy, or null when changes are allowed. Checked by the guard for every channel that
// writes, after the role check.
export function writeBlockMessage(user: AppUser | null): string | null {
  const block = writeBlock();
  return block ? readOnlyMessage(user, block, minAppVersionNeeded()) : null;
}

function startEditingBlocked(user: AppUser | null, opts: { recovering?: boolean } = {}): string | null {
  const s = shared;
  if (!s || s.phase !== 'read') return s?.phase === 'edit' ? 'You are already editing.' : 'Connect to the shared database first.';
  if (!canStartEditing(user) && !userListEmpty()) return 'Only admins can change the shared database in this version.';
  if (s.offline) return 'The shared database can\'t be reached: you are working on an offline copy.';
  if (getNewerSchema() !== null || minAppVersionNeeded()) {
    return `This database was published by a newer EPL Tool. Update EPL Tool${minAppVersionNeeded() ? ` to ${minAppVersionNeeded()}` : ''} to make changes.`;
  }
  if (s.syncing) return 'Newer data is still syncing to your computer. Try again in a minute.';
  if (s.centralDamaged) return 'The shared database file is damaged. An admin can restore a backup (Settings → Backups).';
  if (s.recovery && !opts.recovering) return 'You have unpublished changes from an earlier session: publish or discard them first.';
  return null;
}

export function getStatus(): SyncStatus {
  const user = isOpen() ? getActor() : null;
  const s = shared;
  const e = s?.phase === 'edit' ? edit : null;
  const block = writeBlock();
  const newer = getNewerSchema();
  const minVersion = minAppVersionNeeded();
  const blocked = mode === 'shared' ? startEditingBlocked(user) : 'Not connected to a shared database.';
  const data = e
    ? { generation: e.baseGeneration, publishedBy: e.publishedBy, publishedAt: e.publishedAt, copiedAt: e.since, fileTime: null }
    : s?.copy ? { ...publishInfo(s.copy), copiedAt: s.copy.copiedAt, fileTime: s.copy.fileTime } : null;
  return {
    mode,
    phase: s?.phase ?? null,
    path: dataPath() ?? legacySuggestion?.path ?? null,
    openId: getOpenCount(),
    writable: isOpen() && block === null,
    writeBlock: block,
    data,
    offline: s?.offline ?? null,
    syncing: s?.syncing ?? null,
    pendingUpdate: s?.pending ? publishInfo(s.pending.info) : null,
    newerApp: newer !== null || minVersion
      ? { schemaVersion: newer ?? s?.manifest?.schemaVersion ?? 0, minAppVersion: minVersion ?? s?.manifest?.minAppVersion ?? null }
      : null,
    centralDamaged: s?.centralDamaged ?? false,
    conflictCopies: s?.conflictCopies ?? [],
    lastCheckAt: s?.lastCheckAt ?? null,
    error: s?.error ?? connectError,
    canStartEditing: mode === 'shared' && blocked === null,
    startEditingBlocked: mode === 'shared' ? blocked : null,
    edit: e ? {
      since: e.since,
      dirty: e.dirty,
      publishing: !!e.publishing,
      lastPublishedAt: e.lastPublishedAt,
      lastPublishedGeneration: e.lastPublishedGeneration,
      nextPublishAt: e.dirty && e.nextPublishAt ? new Date(e.nextPublishAt).toISOString() : null,
      error: e.error,
      centralChanged: e.centralChanged,
    } : null,
    conflict: s?.conflict ?? null,
    recovery: s?.recovery ? { since: s.recovery.startedAt, changedAt: s.recovery.changedAt } : null,
    legacySuggestion,
  };
}
