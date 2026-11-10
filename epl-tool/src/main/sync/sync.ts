import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import {
  bootstrapFirstAdmin, closeDatabase, getCurrentDbPath, getDb, getNewerSchema, getOpenCount, isOpen, openDatabase,
  SCHEMA_VERSION, totalChanges, userLabel,
} from '../database';
import { createBackup, createPreRestoreCopy, fileStamp } from '../backup';
import { audit } from '../audit';
import { getResolvedIdentity } from '../auth';
import { getConnection, getSavedDbPath, saveDbPath, saveSharedConnection } from '../localSettings';
import { auditActor, getActor, getRealUser, stopPreview, userListEmpty } from '../currentUser';
import { canStartEditing, readOnlyMessage, type WriteBlock } from '../../shared/permissions';
import {
  AUTO_PUBLISH_SECONDS, CHANGE_CHECK_SECONDS, CLAIM_CLEANUP_DAYS, IDLE_RELEASE_MINUTES, IDLE_WARNING_MINUTES,
  MIN_EDIT_APP_VERSION, SLOT_HEARTBEAT_SECONDS, SLOT_TAKEOVER_MINUTES, SLOT_WAIT_SECONDS, compareVersions,
} from '../../shared/sync';
import {
  CentralError, SyncedFolderStore, describeDbFile, sha256File, type CentralStore, type DbFileInfo, type Manifest,
} from './centralStore';
import {
  holderOf, inactiveHolderOf, isActive, isStale, isStaleRelease, newSlotId, releaseOf, takenOverBy, type SlotClaim,
  type SlotRelease,
} from './editSlot';
import { isInSyncedFolder } from './oneDrive';
import { cacheDir, localConflictsDir, workDir } from './paths';
import { countConflictCopies } from './rescue';
import type { AppUser, SlotPerson, SlotSession, SyncDetails, SyncPublishInfo, SyncStatus } from '../../types';

// The connection to the database (multi-user study §5, dev-plan Phases C–D):
//   local  — a database file opened directly, as before v0.7 (test databases, development)
//   shared — the central database in a synced SharePoint folder. The app works on a local copy: read mode (PRAGMA
//            query_only) by default, refreshed when someone publishes; edit mode (Admins and Users, one at a time through
//            the edit slot) works on a working copy that is published back with the generation check.

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
  conflictCount: number;        // copies to review in the rescue tool (EPL-Conflicts/, OneDrive copies, kept on this PC)
  lastCheckAt: string | null;
  error: string | null;
  conflict: { savedTo: string | null; at: string; message: string } | null;  // last refused publish / lost slot
  recovery: Session | null;     // unpublished working copy left by a previous run
  claims: SlotClaim[];          // edit slot claims seen at the last check
  releases: SlotRelease[];      // sessions released by an admin (Force release), seen at the last check
  waiting: { since: string; heldBy: { slotId: string; user: string } | null } | null;  // told when the slot is free
  released: { at: string; message: string } | null;  // the slot was released after the idle time
}

// Edit mode: the working copy in work\ and what the next publish must find in the shared folder.
interface EditState {
  since: string;
  workFile: string;
  slot: SlotClaim;              // my claim (holding)
  lastBeat: number;             // when my claim was last written (ms): a longer gap than the take-over time = slot lost
  activeAt: number;             // last change, end of a dialog/wizard, or Keep editing (ms): the idle release counts from it
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
  slotId: string | null;
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

// Start editing: started, or someone else holds the slot (wait), or an inactive session can be taken over (ask first).
export type StartEditingResult =
  | { ok: true }
  | { ok: false; waiting: SlotPerson }
  | { ok: false; takeOver: SlotPerson }
  | { ok: false; cancelled: true };

// Resume editing / Publish now on unpublished changes from a previous run.
export type RecoverResult = PublishOutcome | StartEditingResult;

// Something the person should hear about even when EPL Tool is in the background: shown as a Windows notification by
// main/notify.ts (recorded by the checks). The screens show the same events as banners.
export interface SyncNotice {
  kind: 'slot-free' | 'released' | 'refused' | 'slot-lost';
  title: string;
  body: string;
}

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
let claiming: { claim: SlotClaim; until: number; cancelled: boolean } | null = null;
let timer: NodeJS.Timeout | null = null;
let publishTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let busyNow = false;            // a dialog or wizard is open on the screens (reported by them)
const MINUTE = 60_000;
let timing = {
  checkMs: CHANGE_CHECK_SECONDS * 1000,
  publishMs: AUTO_PUBLISH_SECONDS * 1000,
  heartbeatMs: SLOT_HEARTBEAT_SECONDS * 1000,
  slotWaitMs: SLOT_WAIT_SECONDS * 1000,
  takeoverMs: SLOT_TAKEOVER_MINUTES * MINUTE,
  idleMs: IDLE_RELEASE_MINUTES * MINUTE,
  idleWarnMs: IDLE_WARNING_MINUTES * MINUTE,
  cleanupMs: CLAIM_CLEANUP_DAYS * 24 * 60 * MINUTE,
};
let timersOn = false;
const listeners = new Set<(status: SyncStatus) => void>();
const noticeListeners = new Set<(notice: SyncNotice) => void>();

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

// Status → screens (ipc/sync.ts sends it to the window). Only real changes are pushed (not the time of each 30 s check),
// so the screens don't re-render for nothing.
let lastEmitted = '';

export function onStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const status = getStatus();
  const key = JSON.stringify({ ...status, lastCheckAt: null });
  if (key === lastEmitted) return;
  lastEmitted = key;
  for (const l of listeners) {
    try { l(status); } catch { /* a closed window */ }
  }
}

export function onNotice(listener: (notice: SyncNotice) => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

function notice(n: SyncNotice): void {
  for (const l of noticeListeners) {
    try { l(n); } catch { /* never let a notification break anything */ }
  }
}

const timeOf = (iso: string | null | undefined) => {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

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
    damagedCount: 0, centralDamaged: false, conflictCopies: [], conflictCount: 0, lastCheckAt: null, error: null, conflict: null,
    recovery: null, claims: [], releases: [], waiting: null, released: null,
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
  await updateConflictCount(s);
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
    slotId: e.slot.slotId,
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
  await updateConflictCount(s);
  await readClaims(s);
  watchSlotForWaiter(s);
  const key = probeKey(probe.size, probe.mtimeMs, probe.manifest);
  if (s.phase === 'edit') {
    if (edit && verifySlot(edit, s.claims, s.releases) === 'lost') {
      await slotLost(s, edit);
      return;
    }
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
export function configureTimings(t: Partial<typeof timing>): void {
  timing = { ...timing, ...t };
}

export function startBackgroundChecks(t: Partial<typeof timing> = {}): void {
  configureTimings(t);
  timersOn = true;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void checkNow(); }, timing.checkMs);
  timer.unref?.();
  if (edit) {
    startHeartbeat();
    scheduleIdle();
  }
}

export function stopBackgroundChecks(): void {
  if (timer) clearInterval(timer);
  if (publishTimer) clearTimeout(publishTimer);
  if (idleTimer) clearTimeout(idleTimer);
  stopHeartbeat();
  timer = null;
  publishTimer = null;
  idleTimer = null;
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

// ── Edit slot (multi-user study §5.5, dev-plan Phase D) ──────────────────────────────────────────────────────────

const sleep = (msec: number) => new Promise(r => setTimeout(r, msec));

function me(): { user: string; account: string | null; machine: string } {
  const real = isOpen() ? getRealUser() : null;
  const id = getResolvedIdentity();
  return {
    user: real?.display_name ?? id?.displayNameHint ?? id?.account ?? 'Unknown',
    account: real?.account ?? id?.account ?? null,
    machine: os.hostname(),
  };
}

// A claim left by this person on this PC in an earlier session (crash, "Quit anyway"): mine to delete.
function isMyOldClaim(c: SlotClaim, keep: string | null): boolean {
  if (c.slotId === keep) return false;
  const who = me();
  return !!who.account && (c.account ?? '').toLowerCase() === who.account.toLowerCase() && c.machine === who.machine;
}

function personOf(c: SlotClaim): SlotPerson {
  return {
    user: c.user, account: c.account, machine: c.machine, since: c.claimedAt, lastChangeAt: c.lastChangeAt,
    heartbeatAt: c.heartbeatAt,
    mine: c.slotId === edit?.slot.slotId || c.slotId === claiming?.claim.slotId || c.slotId === shared?.recovery?.slotId,
  };
}

// Reads the claims and the release records (status line, waiting, slot checks) and deletes other people's files nobody will
// renew (7 days). When the folder can't be read, the last lists are kept.
async function readClaims(s: Shared): Promise<SlotClaim[]> {
  try {
    const now = Date.now();
    const claims = await s.store.listClaims();
    for (const c of claims.filter(x => isStale(x, now, timing.cleanupMs))) {
      await s.store.deleteClaim(c.slotId).catch(() => undefined);
    }
    s.claims = claims.filter(x => !isStale(x, now, timing.cleanupMs));
  } catch {
    // not readable right now
  }
  await readReleases(s);
  return s.claims;
}

async function readReleases(s: Shared): Promise<SlotRelease[]> {
  try {
    const now = Date.now();
    const releases = await s.store.listReleases();
    for (const r of releases.filter(x => isStaleRelease(x, now, timing.cleanupMs))) {
      await s.store.deleteRelease(r.slotId).catch(() => undefined);
    }
    s.releases = releases.filter(x => !isStaleRelease(x, now, timing.cleanupMs));
  } catch {
    // not readable right now
  }
  return s.releases;
}

function newClaim(s: Shared): SlotClaim {
  const who = me();
  const now = nowIso();
  return {
    format: 1, slotId: newSlotId(), db: path.basename(s.store.dbPath).toLowerCase(), user: who.user, account: who.account,
    machine: who.machine, claimedAt: now, heartbeatAt: now, lastChangeAt: null, state: 'claiming', appVersion: app.getVersion(),
  };
}

// Claims the slot: someone active → waiting; only an inactive session → take-over question (unless confirmed); otherwise
// my claim, the waiting window (OneDrive carries competing claims), a second look: the earliest active claim wins.
// keepSlotId: my claim from an earlier session (recovery), reused when it still holds the slot.
async function acquireSlot(
  s: Shared, opts: { takeOver?: boolean; keepSlotId?: string | null } = {},
): Promise<SlotClaim | StartEditingResult> {
  const keep = opts.keepSlotId ?? null;
  const claims = await s.store.listClaims();
  const releases = await readReleases(s);
  for (const c of claims.filter(x => isMyOldClaim(x, keep))) await s.store.deleteClaim(c.slotId);
  const current = claims.filter(x => !isMyOldClaim(x, keep));
  s.claims = current.filter(c => !isStale(c, Date.now(), timing.cleanupMs));
  const now = Date.now();
  const kept = keep ? current.find(c => c.slotId === keep) : undefined;
  if (kept) {
    if (holderOf(current, releases, now, timing.takeoverMs)?.slotId === kept.slotId) return kept;
    await s.store.deleteClaim(kept.slotId);
  }
  const others = current.filter(c => c.slotId !== keep);
  const holder = holderOf(others, releases, now, timing.takeoverMs);
  if (holder) return { ok: false, waiting: personOf(holder) };
  const inactive = inactiveHolderOf(others, releases, now, timing.takeoverMs);
  if (inactive && !opts.takeOver) return { ok: false, takeOver: personOf(inactive) };
  // Taking over ends every inactive session for good (recorded in my claim, their files removed once the slot is mine).
  const ended = opts.takeOver ? others.filter(c => !isActive(c, now, timing.takeoverMs)).map(c => c.slotId) : [];

  const claim: SlotClaim = { ...newClaim(s), ...(ended.length ? { takesOver: ended } : {}) };
  await s.store.writeClaim(claim);
  claiming = { claim, until: Date.now() + timing.slotWaitMs, cancelled: false };
  emit();
  while (claiming && !claiming.cancelled && Date.now() < claiming.until) {
    await sleep(Math.min(250, Math.max(1, claiming.until - Date.now())));
  }
  const cancelled = !claiming || claiming.cancelled;
  claiming = null;
  if (cancelled) {
    await s.store.deleteClaim(claim.slotId).catch(() => undefined);
    emit();
    return { ok: false, cancelled: true };
  }
  const after = (await s.store.listClaims()).filter(x => !isMyOldClaim(x, claim.slotId));
  const winner = holderOf(after, await readReleases(s), Date.now(), timing.takeoverMs);
  if (winner?.slotId === claim.slotId) {
    for (const id of ended) await s.store.deleteClaim(id).catch(() => undefined);
    return claim;
  }
  await s.store.deleteClaim(claim.slotId).catch(() => undefined);
  emit();
  if (winner) return { ok: false, waiting: personOf(winner) };
  throw new Error('The edit slot could not be reserved (the shared folder did not keep the claim). Please try again.');
}

// Cancels a claim during its waiting window.
export function cancelClaim(): void {
  if (claiming) claiming.cancelled = true;
}

// Force release (decided 10 Nov 2026, admins; the guard checks the role): ends someone else's editing session — also an
// active one, e.g. a dialog left open keeps the slot for good. A release record of my own in EPL-EditSlot/: that session
// never holds the slot again, and its app gives up at its next check (unpublished work → EPL-Conflicts/). The activity log
// gets the entry at the next publish (see logReleases).
export async function forceRelease(slotId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = shared;
  if (mode !== 'shared' || !s) return { ok: false, error: 'Not connected to the shared database.' };
  const id = String(slotId ?? '');
  if (id === edit?.slot.slotId || id === claiming?.claim.slotId || id === s.recovery?.slotId) {
    return { ok: false, error: 'This is your own editing session: use Finish editing (or Discard) instead.' };
  }
  await readClaims(s);
  const c = s.claims.find(x => x.slotId === id);
  if (!c || takenOverBy(s.claims, id) || releaseOf(s.releases, id)) {
    return { ok: false, error: 'This editing session has already ended.' };
  }
  if (!(await s.store.canWrite())) {
    return { ok: false, error: 'You have read-only access to the shared folder on SharePoint, so changes are not possible.' };
  }
  const who = me();
  await s.store.writeRelease({
    format: 1, kind: 'release', db: path.basename(s.store.dbPath).toLowerCase(), slotId: id,
    released: { user: c.user, account: c.account, machine: c.machine },
    user: who.user, account: who.account, machine: who.machine, at: nowIso(),
  });
  await readClaims(s);
  watchSlotForWaiter(s);
  emit();
  return { ok: true };
}

// Settings → Shared database card: the sessions in EPL-EditSlot/, the release records and the last publish.
export async function getDetails(): Promise<SyncDetails | null> {
  const s = shared;
  if (mode !== 'shared' || !s) return null;
  await readClaims(s);
  const now = Date.now();
  const holder = holderOf(s.claims, s.releases, now, timing.takeoverMs);
  const sessions: SlotSession[] = [...s.claims].sort((a, b) => a.claimedAt.localeCompare(b.claimedAt)).map(c => {
    const release = releaseOf(s.releases, c.slotId);
    const taker = takenOverBy(s.claims, c.slotId);
    const state: SlotSession['state'] = release ? 'released' : taker ? 'taken-over'
      : !isActive(c, now, timing.takeoverMs) ? 'inactive' : c.state === 'claiming' ? 'reserving' : 'editing';
    return {
      ...personOf(c), slotId: c.slotId, state, holder: holder?.slotId === c.slotId, appVersion: c.appVersion,
      endedBy: release?.user ?? taker?.user ?? null,
    };
  });
  const m = (await s.store.readManifest().catch(() => null)) ?? s.manifest;
  return {
    dbPath: s.store.dbPath,
    folder: s.store.folder,
    localCopy: s.phase === 'edit' && edit ? edit.workFile : s.copy ? cacheFileFor(s.store.dbPath) : null,
    manifest: m ? {
      generation: m.generation, publishedBy: m.publishedBy, publishedAt: m.publishedAt, appVersion: m.appVersion,
      minAppVersion: m.minAppVersion, schemaVersion: m.schemaVersion,
    } : null,
    sessions,
    releases: [...s.releases].sort((a, b) => b.at.localeCompare(a.at)).map(r => ({
      slotId: r.slotId, user: r.released.user, machine: r.released.machine, by: r.user, at: r.at,
    })),
  };
}

// Do I still hold the slot? Lost when my claim is gone, someone took my session over, an admin released it, another claim
// holds it, or my own heartbeat gap was longer than the take-over time (laptop asleep: others may have taken over — an
// expired claim is never revived).
function verifySlot(e: EditState, claims: readonly SlotClaim[], releases: readonly SlotRelease[]): 'ok' | 'lost' {
  const now = Date.now();
  if (now - e.lastBeat > timing.takeoverMs) return 'lost';
  if (!claims.some(c => c.slotId === e.slot.slotId)) return 'lost';
  if (takenOverBy(claims, e.slot.slotId)) return 'lost';
  if (releaseOf(releases, e.slot.slotId)) return 'lost';
  const holder = holderOf(claims, releases, now, timing.takeoverMs);
  return holder && holder.slotId !== e.slot.slotId ? 'lost' : 'ok';
}

// Rewrites my claim (every SLOT_HEARTBEAT_SECONDS while editing), after checking that I still hold the slot.
export async function heartbeatNow(): Promise<void> {
  const s = shared;
  const e = edit;
  if (!s || !e || s.phase !== 'edit') return;
  const claims = await readClaims(s);
  if (edit !== e) return;
  if (verifySlot(e, claims, s.releases) === 'lost') {
    await slotLost(s, e);
    return;
  }
  e.slot = { ...e.slot, state: 'holding', heartbeatAt: nowIso(), lastChangeAt: e.changedAt };
  try {
    await s.store.writeClaim(e.slot);
    e.lastBeat = Date.now();
  } catch {
    // the shared folder can't be written right now: next time
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  if (!timersOn) return;
  heartbeatTimer = setInterval(() => { void heartbeatNow(); }, timing.heartbeatMs);
  heartbeatTimer.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Someone else holds the slot now, an admin released my session, or my session expired: unpublished work goes to
// EPL-Conflicts/, back to read mode.
async function slotLost(s: Shared, e: EditState): Promise<void> {
  if (edit !== e) return;
  noteChanges();
  const release = releaseOf(s.releases, e.slot.slotId);
  const holder = takenOverBy(s.claims, e.slot.slotId) ?? holderOf(s.claims, s.releases, Date.now(), timing.takeoverMs);
  const by = holder && holder.slotId !== e.slot.slotId ? holder.user : null;
  const savedTo = e.dirty ? await keepRefusedCopy(s) : null;
  const what = release ? `${release.user} released your edit slot at ${timeOf(release.at)}`
    : by ? `${by} took over the edit slot` : 'Your editing session ended: this PC gave no sign of life for too long';
  const work = !e.dirty ? '' : savedTo ? ` Your unpublished changes were saved as ${savedTo}.` : ' Your unpublished changes could not be saved.';
  s.conflict = { savedTo, at: nowIso(), message: `${what}.${work}` };
  notice({
    kind: 'slot-lost', title: 'EPL Tool: editing ended',
    body: `${what}.${!e.dirty ? '' : savedTo ? ' Your unpublished changes were saved in EPL-Conflicts.' : ' Your unpublished changes could not be saved.'}`,
  });
  await endEditing(s, e, false);
}

// ── Waiting for the edit slot (decision 3 of 9 Nov 2026: told when it is free, never given it automatically) ───────

// Wait: from now on every check looks whether the slot became free. Waiting lasts until Start editing works or Stop waiting.
export async function waitForSlot(): Promise<void> {
  const s = shared;
  if (!s || s.phase !== 'read') return;
  await readClaims(s);
  const holder = holderOf(s.claims, s.releases, Date.now(), timing.takeoverMs);
  s.waiting = { since: s.waiting?.since ?? nowIso(), heldBy: holder ? { slotId: holder.slotId, user: holder.user } : null };
  emit();
}

export function stopWaiting(): void {
  if (shared) shared.waiting = null;
  emit();
}

// At every check: a waiting person is told once each time the slot goes from taken to free (or to an inactive session
// they may take over). The screens show "The edit slot is free" for as long as it is.
function watchSlotForWaiter(s: Shared): void {
  const w = s.waiting;
  if (!w || s.phase !== 'read') return;
  const now = Date.now();
  const holder = holderOf(s.claims, s.releases, now, timing.takeoverMs);
  if (holder) {
    w.heldBy = { slotId: holder.slotId, user: holder.user };
    return;
  }
  if (!w.heldBy) return;
  const was = w.heldBy;
  w.heldBy = null;
  const release = releaseOf(s.releases, was.slotId);
  const inactive = inactiveHolderOf(s.claims, s.releases, now, timing.takeoverMs);
  notice({
    kind: 'slot-free', title: 'EPL Tool: the edit slot is free',
    body: inactive
      ? `${inactive.user}'s editing session has been inactive since ${timeOf(inactive.heartbeatAt)}. Click Start editing to take over.`
      : release
        ? `${was.user}'s edit slot was released by ${release.user}. Click Start editing to make your changes.`
        : `${was.user} has finished editing. Click Start editing to make your changes.`,
  });
}

// ── Releasing an idle edit slot (decision 4 of 9 Nov 2026) ─────────────────────────────────────────────────────────

// The screens report whether a dialog or wizard is open: no release while one is, and the idle time restarts when it closes.
export function setBusy(busy: boolean): void {
  if (busy === busyNow) return;
  busyNow = busy;
  if (!busy && edit) edit.activeAt = Date.now();
  scheduleIdle();
  emit();
}

// [Keep editing] on the warning before the release.
export function keepEditing(): void {
  if (!edit) return;
  edit.activeAt = Date.now();
  scheduleIdle();
  emit();
}

// When the slot will be released, shown during the warning before it (null otherwise).
function releaseWarning(e: EditState): string | null {
  if (!timersOn || busyNow) return null;
  const at = e.activeAt + timing.idleMs;
  return Date.now() >= at - timing.idleWarnMs ? new Date(at).toISOString() : null;
}

// One timer: to the warning, then to the release.
function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const e = edit;
  if (!e || !timersOn || busyNow) return;
  const releaseAt = e.activeAt + timing.idleMs;
  const warnAt = releaseAt - timing.idleWarnMs;
  const now = Date.now();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    void idleTick(e);
  }, Math.max(0, (now < warnAt ? warnAt : releaseAt) - now));
  idleTimer.unref?.();
}

async function idleTick(e: EditState): Promise<void> {
  if (edit !== e || busyNow) return;
  if (Date.now() < e.activeAt + timing.idleMs) {
    emit();                       // the warning (edit.releaseAt in the status)
    scheduleIdle();
    return;
  }
  const s = shared;
  if (!s) return;
  const hadChanges = e.dirty;
  const r = await finishEditing();
  if (r.ok && edit !== e) {
    const message = `The edit slot was released after ${IDLE_RELEASE_MINUTES} minutes without changes, so others can edit` +
      (hadChanges ? ': your last changes were published.' : '.');
    s.released = { at: nowIso(), message };
    notice({ kind: 'released', title: 'EPL Tool: editing ended', body: `${message} Click Start editing to make more changes.` });
    emit();
  } else if (edit === e && timersOn && !idleTimer) {
    // Not published (e.g. the shared folder can't be reached): the slot is kept and the release tried again later.
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void idleTick(e);
    }, timing.checkMs);
    idleTimer.unref?.();
  }
}

export function dismissReleased(): void {
  if (shared) shared.released = null;
  emit();
}

// ── Edit mode (multi-user study §5.5–5.7) ─────────────────────────────────────────────────────────────────────────

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
  e.activeAt = Date.now();
  scheduleIdle();
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

// Start editing: the edit slot → fresh copy of the shared file → backup → working copy opened read-write. restoreFrom: start
// from a backup instead (restore while the shared file is damaged). takeOver: the person confirmed taking over an inactive
// session.
export async function startEditing(opts: { restoreFrom?: string; takeOver?: boolean } = {}): Promise<StartEditingResult> {
  const s = shared;
  if (starting) throw new Error('Editing is already being started.');
  if (!s || s.phase !== 'read') throw new Error(s?.phase === 'edit' ? 'You are already editing.' : 'Connect to the shared database first.');
  const user = getActor();
  const damagedRestore = !!opts.restoreFrom && s.centralDamaged;
  const blocked = startEditingBlocked(user);
  if (blocked && !(damagedRestore && canStartEditing(user))) throw new Error(blocked);
  if (s.recovery) throw new Error('You have unpublished changes from an earlier session: publish or discard them first.');
  starting = true;
  let claim: SlotClaim | null = null;
  try {
    if (!(await s.store.canWrite())) {
      throw new Error('You have read-only access to the shared folder on SharePoint, so changes are not possible.');
    }
    const got = await acquireSlot(s, { takeOver: opts.takeOver });
    if (!('slotId' in got)) return got;
    claim = got;
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
    const holding: SlotClaim = { ...claim, state: 'holding', heartbeatAt: nowIso() };
    await s.store.writeClaim(holding);
    const n = totalChanges();
    edit = {
      since: nowIso(), workFile, slot: holding, lastBeat: Date.now(), activeAt: Date.now(), baseGeneration: base.generation,
      baseSha: base.sha256, publishedBy: base.publishedBy, publishedAt: base.publishedAt, baseline: n, seen: n, dirty: false,
      changedAt: null, publishing: null, lastPublishedAt: null, lastPublishedGeneration: null, nextPublishAt: null, error: null,
      centralKey: null, centralChanged: null,
    };
    claim = null;
    s.phase = 'edit';
    s.conflict = null;
    s.pending = null;
    s.waiting = null;
    s.released = null;
    await removeQuietly(incomingPath());
    writeSession(edit);
    startHeartbeat();
    scheduleIdle();
    // Decided 9 Nov 2026: the first admin of a database without users is created here, and the Windows account of someone
    // added by email only is recorded now (the look-up records it). Both are changes to publish.
    bootstrapFirstAdmin(getDb());
    getActor();
    noteChanges();
    await readClaims(s);
    emit();
    return { ok: true };
  } catch (err) {
    if (claim) await s.store.deleteClaim(claim.slotId).catch(() => undefined);
    if (!edit && isOpen() && getCurrentDbPath() !== cacheFileFor(s.store.dbPath)) {
      closeDatabase();
      clearWorkFiles(s.store.dbPath);
      openReadCopy(cacheFileFor(s.store.dbPath));
    }
    throw err;
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
  releases: SlotRelease[];       // force releases seen in the shared folder (recorded once in the activity log)
}

const isoNoMs = (iso: string) => iso.replace(/\.\d{3}Z$/, 'Z');

// generation + publisher in sync_meta and the sync.publish activity entry, in one transaction.
function applyStamp(db: Database.Database, st: Stamp): void {
  db.transaction(() => {
    db.prepare(`UPDATE sync_meta SET generation = ?, published_by = ?, published_by_account = ?, published_at = ?,
      published_app_version = ? WHERE id = 1`).run(st.generation, st.by, st.account, st.at, st.appVersion);
    logReleases(db, st.releases);
    db.prepare(`
      INSERT INTO audit_log (at, user_id, user_label, action, entity_type, entity_key, summary, details)
      VALUES (?, ?, ?, 'sync.publish', 'database', ?, ?, ?)
    `).run(st.at, st.userId, st.label, String(st.generation), `Published the shared database (generation ${st.generation})`,
      JSON.stringify({ generation: st.generation, appVersion: st.appVersion }));
  })();
}

// A force release is made in read mode, so it can't be written to the database then (decided 10 Nov 2026): every publish
// records the releases the activity log doesn't have yet, attributed to the admin, at the time of the release.
function logReleases(db: Database.Database, releases: readonly SlotRelease[]): void {
  if (!releases.length) return;
  const known = db.prepare("SELECT 1 FROM audit_log WHERE action = 'sync.force-release' AND entity_key = ?");
  const userOf = db.prepare('SELECT id FROM users WHERE account = ?');
  const insert = db.prepare(`
    INSERT INTO audit_log (at, user_id, user_label, action, entity_type, entity_key, summary, details)
    VALUES (?, ?, ?, 'sync.force-release', 'edit-slot', ?, ?, ?)
  `);
  for (const r of [...releases].sort((a, b) => a.at.localeCompare(b.at))) {
    if (known.get(r.slotId)) continue;
    const user = r.account ? userOf.get(r.account) as { id: number } | undefined : undefined;
    insert.run(isoNoMs(r.at), user?.id ?? null, userLabel(r.user, r.account), r.slotId,
      `Released ${r.released.user}'s edit slot (${r.released.machine})`,
      JSON.stringify({ released: r.released, machine: r.machine }));
  }
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

  // Study §5.6 step 1: do I still hold the slot?
  if (verifySlot(e, await readClaims(s), s.releases) === 'lost') {
    await slotLost(s, e);
    return { ok: false, conflict: true, error: s.conflict?.message ?? 'The edit slot was lost.', savedTo: s.conflict?.savedTo ?? null };
  }

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
    releases: [...s.releases],
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
    await updateConflictCount(s);
    return saved;
  } catch {
    const localDir = localConflictsDir();
    try {
      await fsp.mkdir(localDir, { recursive: true });
      const dest = path.join(localDir, `${path.parse(s.store.dbPath).name}_${fileStamp()}.db`);
      await fsp.rename(copy, dest);
      await updateConflictCount(s);
      return dest;
    } catch {
      return null;
    }
  }
}

async function updateConflictCount(s: Shared): Promise<void> {
  try {
    s.conflictCount = await countConflictCopies(s.store);
  } catch {
    // counted again at the next check
  }
}

// After a copy was archived: the count (and the OneDrive conflict-copy banner) follow at once.
export async function refreshConflictCopies(): Promise<void> {
  const s = shared;
  if (!s) return;
  s.conflictCopies = await s.store.findConflictCopies();
  await updateConflictCount(s);
  emit();
}

// The shared folder of the connected database (the rescue tool reads conflict copies through it), or null.
export function getSharedStore(): CentralStore | null {
  return mode === 'shared' && shared ? shared.store : null;
}

// Decided 9 Nov 2026: after a refused publish the app goes back to read mode on the fresh data.
async function refused(s: Shared, e: EditState, message: string, savedTo: string | null): Promise<PublishOutcome> {
  const where = savedTo ? ` Your copy was saved as ${savedTo}.` : ' Your copy could not be saved.';
  s.conflict = { savedTo, at: nowIso(), message: `Your changes were not published: ${message}${where}` };
  notice({
    kind: 'refused', title: 'EPL Tool: your changes were not published',
    body: `${message}${savedTo ? ' Your copy was saved in EPL-Conflicts.' : ' Your copy could not be saved.'}`,
  });
  await endEditing(s, e, false);
  return { ok: false, conflict: true, error: s.conflict.message, savedTo };
}

// Leaves edit mode. published = the working copy matches the shared file and becomes the read copy; otherwise it is
// discarded and a fresh read copy is taken (or the old one reopened when the folder can't be reached).
async function endEditing(s: Shared, e: EditState, published: boolean): Promise<void> {
  if (publishTimer) clearTimeout(publishTimer);
  if (idleTimer) clearTimeout(idleTimer);
  publishTimer = null;
  idleTimer = null;
  stopHeartbeat();
  edit = null;
  closeDatabase();
  // My claim is mine to delete; the slot is free for the next person.
  await s.store.deleteClaim(e.slot.slotId).catch(() => undefined);
  s.claims = s.claims.filter(c => c.slotId !== e.slot.slotId);
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

// Unpublished changes from a previous run (crash, or "Quit anyway"): resume editing them, publish them now, or discard them.
// Resume and Publish now go through the edit slot like Start editing (waiting / take-over answers; the changes stay
// offered meanwhile). The shared file must still be the one the changes started from: if someone published since, the copy
// goes to EPL-Conflicts/ at once — the refusal its publish would get — so nobody goes on editing a copy that can't be
// published.
export async function recoverUnpublished(
  action: 'resume' | 'publish' | 'discard', opts: { takeOver?: boolean } = {},
): Promise<RecoverResult> {
  const s = shared;
  const sess = s?.recovery;
  if (!s || !sess || s.phase !== 'read') return { ok: false, error: 'There are no unpublished changes to recover.' };
  if (action === 'discard') {
    clearWorkFiles(s.store.dbPath);
    s.recovery = null;
    emit();
    return { ok: true, published: false, generation: s.copy?.generation ?? 0 };
  }
  if (starting) return { ok: false, error: 'Editing is already being started.' };
  const blocked = startEditingBlocked(getActor(), { recovering: true });
  if (blocked) return { ok: false, error: blocked };
  if (!(await s.store.canWrite())) {
    return { ok: false, error: 'You have read-only access to the shared folder on SharePoint, so changes are not possible.' };
  }
  starting = true;
  try {
    // The edit slot first (my claim from that session is reused if it still holds the slot).
    const got = await acquireSlot(s, { keepSlotId: sess.slotId, takeOver: opts.takeOver });
    if (!('slotId' in got)) return got;
    const workFile = workFileFor(s.store.dbPath);
    closeDatabase();
    try {
      openDatabase(workFile, { skipBackup: true, bootstrap: false });
    } catch (err) {
      await s.store.deleteClaim(got.slotId).catch(() => undefined);
      openReadCopy(cacheFileFor(s.store.dbPath));
      return { ok: false, error: `The unpublished copy can't be opened: ${(err as Error).message}` };
    }
    const holding: SlotClaim = { ...got, state: 'holding', heartbeatAt: nowIso() };
    await s.store.writeClaim(holding).catch(() => undefined);
    const e: EditState = {
      since: sess.startedAt, workFile, slot: holding, lastBeat: Date.now(), activeAt: Date.now(),
      baseGeneration: sess.baseGeneration,
      baseSha: sess.baseSha, publishedBy: sess.publishedBy, publishedAt: sess.publishedAt, baseline: -1, seen: totalChanges(),
      dirty: true, changedAt: sess.changedAt, publishing: null, lastPublishedAt: null, lastPublishedGeneration: null,
      nextPublishAt: null, error: null, centralKey: null, centralChanged: null,
    };
    edit = e;
    s.phase = 'edit';
    s.recovery = null;
    s.waiting = null;
    s.released = null;
    writeSession(e);
    startHeartbeat();
    scheduleIdle();
    const moved = await centralMovedOn(s, e);
    if (moved) return await refused(s, e, moved, await keepRefusedCopy(s));
    if (action === 'resume') {
      schedulePublish(e);
      emit();
      return { ok: true };
    }
    const r = await publishNow();
    if (r.ok && edit === e) await endEditing(s, e, true);
    emit();
    return r;
  } finally {
    starting = false;
  }
}

// Has someone published since the working copy's base? Then its publish would be refused (the same check, made early).
async function centralMovedOn(s: Shared, e: EditState): Promise<string | null> {
  const manifest = await s.store.readManifest();
  if (manifest && manifest.generation > e.baseGeneration) {
    const when = manifest.publishedAt
      ? ` on ${new Date(manifest.publishedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
      : '';
    return `${manifest.publishedBy ?? 'Someone else'} published a newer version${when} after these changes were made.`;
  }
  try {
    if (await sha256File(s.store.dbPath) !== e.baseSha) {
      return 'The shared database was changed by someone else after these changes were made.';
    }
  } catch {
    // can't be read right now: the publish checks again
  }
  return null;
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
    const started = await startEditing({ restoreFrom: backupPath, takeOver: true });
    if (!started.ok) {
      const who = 'waiting' in started ? started.waiting.user : null;
      return { ok: false, error: who ? `${who} is editing right now: try again when the edit slot is free.` : 'Restore cancelled.' };
    }
    safetyCopy = createPreRestoreCopy(s.store.dbPath);
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
  if (!canStartEditing(user) && !userListEmpty()) return 'Viewers can only view and export.';
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
      releaseAt: releaseWarning(e),
    } : null,
    conflict: s?.conflict ?? null,
    released: s?.released ?? null,
    recovery: s?.recovery ? { since: s.recovery.startedAt, changedAt: s.recovery.changedAt } : null,
    slot: {
      holder: e ? personOf(e.slot) : s ? (() => {
        const h = holderOf(s.claims, s.releases, Date.now(), timing.takeoverMs);
        return h ? personOf(h) : null;
      })() : null,
      inactive: !e && s ? (() => {
        const i = inactiveHolderOf(s.claims, s.releases, Date.now(), timing.takeoverMs);
        return i && !personOf(i).mine ? personOf(i) : null;
      })() : null,
      claimingUntil: claiming ? new Date(claiming.until).toISOString() : null,
      waitingSince: s?.phase === 'read' ? s.waiting?.since ?? null : null,
    },
    legacySuggestion,
    conflictCount: s?.conflictCount ?? 0,
  };
}
