import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import { closeDatabase, getCurrentDbPath, getNewerSchema, getOpenCount, isOpen, openDatabase } from '../database';
import { getConnection, getSavedDbPath, saveDbPath, saveSharedConnection } from '../localSettings';
import { getActor, stopPreview, userListEmpty } from '../currentUser';
import { canStartEditing, readOnlyMessage, type WriteBlock } from '../../shared/permissions';
import { CHANGE_CHECK_SECONDS, compareVersions } from '../../shared/sync';
import { CentralError, SyncedFolderStore, type CentralStore, type DbFileInfo, type Manifest } from './centralStore';
import { isInSyncedFolder } from './oneDrive';
import { cacheDir } from './paths';
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
}

// A shared file failing the integrity check this many times in a row is reported as damaged (a single failure is
// usually a copy caught in the middle of a OneDrive download).
const DAMAGED_REPORT_AFTER = 3;

let mode: 'none' | 'local' | 'shared' = 'none';
let shared: Shared | null = null;
let legacySuggestion: { path: string } | null = null;
let connectError: string | null = null;
let checking: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;
const listeners = new Set<(status: SyncStatus) => void>();

const nowIso = () => new Date().toISOString();
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const cacheFileFor = (centralPath: string) => path.join(cacheDir(), path.basename(centralPath));
const cacheMetaPath = () => path.join(cacheDir(), 'cache.json');
const incomingPath = () => path.join(cacheDir(), 'incoming.db');

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
    damagedCount: 0, centralDamaged: false, conflictCopies: [], lastCheckAt: null, error: null,
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
  emit();
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
  if (!s || s.phase !== 'read' || !s.pending) return false;
  installReadCopy(s, s.pending.info, s.pending.fileTime);
  emit();
  return true;
}

export async function refresh(): Promise<void> {
  await checkNow();
  await applyUpdate();
}

export function startBackgroundChecks(): void {
  if (timer) return;
  timer = setInterval(() => { void checkNow(); }, CHANGE_CHECK_SECONDS * 1000);
  timer.unref?.();
}

export function stopBackgroundChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// ── Rules used by the guard and the status ────────────────────────────────────────────────────────────────────────

// A change has to wait while a publish takes its snapshot of the working copy (edit mode), else null.
export function waitForPublish(): Promise<void> | null {
  return null;
}

// Runs a change made through a "writes" channel (edit mode notes it for the automatic publish).
export function afterWrite<T>(run: () => T): T {
  return run();
}
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

function startEditingBlocked(user: AppUser | null): string | null {
  const s = shared;
  if (!s || s.phase !== 'read') return 'Connect to the shared database first.';
  if (!canStartEditing(user) && !userListEmpty()) return 'Only admins can change the shared database in this version.';
  if (s.offline) return 'The shared database can\'t be reached: you are working on an offline copy.';
  if (getNewerSchema() !== null || minAppVersionNeeded()) {
    return `This database was published by a newer EPL Tool. Update EPL Tool${minAppVersionNeeded() ? ` to ${minAppVersionNeeded()}` : ''} to make changes.`;
  }
  if (s.syncing) return 'Newer data is still syncing to your computer. Try again in a minute.';
  if (s.centralDamaged) return 'The shared database file is damaged. An admin can restore a backup (Settings → Backups).';
  return null;
}

export function getStatus(): SyncStatus {
  const user = isOpen() ? getActor() : null;
  const s = shared;
  const block = writeBlock();
  const newer = getNewerSchema();
  const minVersion = minAppVersionNeeded();
  const blocked = mode === 'shared' ? startEditingBlocked(user) : 'Not connected to a shared database.';
  return {
    mode,
    phase: s?.phase ?? null,
    path: dataPath() ?? legacySuggestion?.path ?? null,
    openId: getOpenCount(),
    writable: isOpen() && block === null,
    writeBlock: block,
    data: s?.copy ? { ...publishInfo(s.copy), copiedAt: s.copy.copiedAt, fileTime: s.copy.fileTime } : null,
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
    edit: null,
    conflict: null,
    recovery: null,
    legacySuggestion,
  };
}
