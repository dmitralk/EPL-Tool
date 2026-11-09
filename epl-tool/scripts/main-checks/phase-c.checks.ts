/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase C (v0.7 shared database): Migration 8 (sync_meta), the CentralStore that reads and writes the shared folder, and
// the app on two simulated PCs: this file forks itself into worker processes ("PC A", "PC B", …), each with its own
// userData (settings.json), %LOCALAPPDATA% (local copies) and Windows identity, all sharing one temp "central" folder.
// The orchestrator plays "someone else" by publishing new versions into the central folder with the CentralStore.
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { closeDatabase, openDatabase, SCHEMA_VERSION } from '../../src/main/database';
import { getIdentity, initIdentity } from '../../src/main/auth';
import {
  CentralError, SyncedFolderStore, describeDbFile, inspectDbFile, sha256File, type DbFileInfo,
} from '../../src/main/sync/centralStore';
import { isInSyncedFolder, isUnder } from '../../src/main/sync/oneDrive';
import { cacheDir, localDataDir, workDir } from '../../src/main/sync/paths';
import { MIN_EDIT_APP_VERSION } from '../../src/shared/sync';
import { SAMPLE_DBS, allowed, check, expectError, finish, run, sample, setupTemp, sha, sleep, userVersion } from './harness';
import {
  PEOPLE, Pc, backupsOf, centralQuery, corrupt, generationOf, ls, manifestOf, prepareCentral, publishAs, spocOf, worker,
  type Central,
} from './pcs';

async function expectCentralError(name: string, fn: () => Promise<unknown>, kind: string) {
  try {
    await fn();
    check(name, false, 'no error');
  } catch (e) {
    check(name, e instanceof CentralError && e.kind === kind, `${(e as any).kind}: ${(e as Error).message}`);
  }
}

// A snapshot as the publish code makes it: a copy with sync_meta stamped for the next generation.
async function stampedCopy(from: string, to: string, generation: number, by: string): Promise<DbFileInfo> {
  fs.copyFileSync(from, to);
  const d = new Database(to);
  d.pragma('journal_mode = DELETE');
  d.prepare(`UPDATE sync_meta SET generation = ?, published_by = ?, published_by_account = ?, published_at = ?,
    published_app_version = '0.7.0' WHERE id = 1`).run(generation, by, by.toLowerCase(), new Date().toISOString());
  d.close();
  return describeDbFile(to);
}

// ── Part 1: Migration 8 and the CentralStore (in this process) ──────────────────────────────────────────────────
async function storeChecks(tmp: string) {
  // ── Migration 8 on copies of both sample databases ──
  check('schema version is 8', SCHEMA_VERSION === 8, SCHEMA_VERSION);
  const prepared: Record<string, string> = {};
  for (const name of SAMPLE_DBS) {
    const copy = path.join(tmp, 'm8', name);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(sample(name), copy);
    openDatabase(copy, { skipBackup: true });
    closeDatabase();
    check(`[${name}] user_version = 8`, userVersion(copy) === 8, userVersion(copy));
    const d = new Database(copy, { readonly: true });
    const meta = d.prepare('SELECT * FROM sync_meta').all() as any[];
    d.close();
    check(`[${name}] sync_meta has one row, generation 0`, meta.length === 1 && meta[0].id === 1 && meta[0].generation === 0, meta);
    const before = sha(copy);
    openDatabase(copy, { skipBackup: true });
    closeDatabase();
    check(`[${name}] re-opening leaves the file byte-identical`, sha(copy) === before);
    const info = await describeDbFile(copy);
    check(`[${name}] describeDbFile: schema 8, generation 0, sha256`, info.schemaVersion === 8 && info.generation === 0 &&
      info.sha256 === before && info.publishedBy === null, info);
    prepared[name] = copy;
  }
  {
    const d = new Database(prepared[SAMPLE_DBS[0]]);
    let refused = false;
    try { d.prepare('INSERT INTO sync_meta (id, generation) VALUES (2, 0)').run(); } catch { refused = true; }
    d.close();
    check('sync_meta accepts only one row', refused);
  }

  // ── Local paths ──
  check('local copies live in %LOCALAPPDATA%\\<app folder>', localDataDir() === path.join(tmp, 'local', 'userData'), localDataDir());
  check('cache and work folders below it', cacheDir() === path.join(localDataDir(), 'cache') && workDir() === path.join(localDataDir(), 'work'));

  // ── Synced-folder detection ──
  const odRoot = path.join(tmp, 'OneDrive - Company');
  const env = { OneDriveCommercial: odRoot };
  check('a file in the OneDrive folder is synced', await isInSyncedFolder(path.join(odRoot, 'Team', 'EPL-Database.db'), env));
  check('a file elsewhere is not synced', !(await isInSyncedFolder(path.join(tmp, 'elsewhere', 'EPL-Database.db'), env)));
  check('isUnder is case-insensitive and needs a real child', isUnder('C:\\A\\b\\c.db', 'c:\\a') && !isUnder('C:\\A', 'C:\\A') &&
    !isUnder('C:\\AB\\c.db', 'C:\\A'));

  // ── inspect / describe ──
  const junk = path.join(tmp, 'junk.db');
  fs.writeFileSync(junk, 'this is not a database'.repeat(100));
  await expectCentralError('a non-database file is reported as damaged', async () => inspectDbFile(junk), 'damaged');

  // ── SyncedFolderStore ──
  const centralDir = path.join(tmp, 'central');
  fs.mkdirSync(centralDir);
  const central = path.join(centralDir, 'EPL-Database.db');
  fs.copyFileSync(prepared[SAMPLE_DBS[0]], central);
  const store = new SyncedFolderStore(central);
  check('manifest name follows the database name', store.manifestPath === path.join(centralDir, 'EPL-Database.manifest.json'));
  check('manifestPathFor matches', SyncedFolderStore.manifestPathFor(central) === store.manifestPath);

  let probe = await store.probe();
  check('probe: reachable, file there, no manifest yet', probe.reachable && probe.exists && probe.manifest === null &&
    probe.size === fs.statSync(central).size, probe);

  const centralSha0 = sha(central);
  const dl = path.join(tmp, 'pc', 'incoming.db');
  const info0 = await store.download(dl);
  check('download: identical copy, described', sha(dl) === centralSha0 && info0.sha256 === centralSha0 && info0.generation === 0 &&
    info0.schemaVersion === 8, info0);
  check('download leaves no temp file', !fs.existsSync(`${dl}.download`) && !fs.existsSync(`${dl}-wal`));
  check('download does not change the central file', sha(central) === centralSha0);
  check('nothing but the database in the central folder', ls(centralDir).join() === 'EPL-Database.db', ls(centralDir));

  // A WAL-mode file (like the samples before their first open) is copied and inspected without side files.
  const walCentralDir = path.join(tmp, 'central-wal');
  fs.mkdirSync(walCentralDir);
  fs.copyFileSync(sample(SAMPLE_DBS[0]), path.join(walCentralDir, 'EPL-Database.db'));
  const walInfo = await new SyncedFolderStore(path.join(walCentralDir, 'EPL-Database.db')).download(path.join(tmp, 'pc', 'wal.db'));
  check('WAL-mode file: downloaded, generation 0 (no sync_meta), no side files',
    walInfo.generation === 0 && ls(path.join(tmp, 'pc')).every(f => !/-(wal|shm)$/.test(f)) && ls(walCentralDir).length === 1,
    { walInfo, pc: ls(path.join(tmp, 'pc')) });

  // Publish: generation check first.
  const meta = { appVersion: '0.7.0', minAppVersion: '0.7.0' };
  const snap1 = await stampedCopy(dl, path.join(tmp, 'pc', 'publish1.db'), 1, 'Anna Admin');
  const wrongSha = await store.publish(path.join(tmp, 'pc', 'publish1.db'), snap1, { generation: 0, sha256: 'x'.repeat(64) }, meta);
  check('publish refused when the central file is not the expected one', !wrongSha.ok && /changed by someone else/.test((wrongSha as any).conflict), wrongSha);
  check('refused publish writes nothing', sha(central) === centralSha0 && ls(centralDir).join() === 'EPL-Database.db', ls(centralDir));

  const pub1 = await store.publish(path.join(tmp, 'pc', 'publish1.db'), snap1, { generation: 0, sha256: centralSha0 }, meta);
  check('publish accepted on top of the expected file', pub1.ok, pub1);
  check('central file = snapshot', sha(central) === snap1.sha256);
  const manifest1 = await store.readManifest();
  check('manifest: generation 1, sha256, publisher, schema, versions', !!manifest1 && manifest1.generation === 1 &&
    manifest1.sha256 === snap1.sha256 && manifest1.size === snap1.size && manifest1.publishedBy === 'Anna Admin' &&
    manifest1.schemaVersion === 8 && manifest1.appVersion === '0.7.0' && manifest1.minAppVersion === '0.7.0', manifest1);
  check('no temp files left in the central folder', ls(centralDir).join() === 'EPL-Database.db,EPL-Database.manifest.json', ls(centralDir));
  probe = await store.probe();
  check('probe sees the manifest', probe.manifest?.generation === 1);

  // Someone who started from generation 0 must not overwrite generation 1.
  const snapStale = await stampedCopy(dl, path.join(tmp, 'pc', 'publish-stale.db'), 1, 'Ben Admin');
  const stale = await store.publish(path.join(tmp, 'pc', 'publish-stale.db'), snapStale, { generation: 0, sha256: centralSha0 }, meta);
  check('publish refused: the manifest has a newer generation', !stale.ok && /Anna Admin published a newer version/.test((stale as any).conflict), stale);
  check('central file still generation 1', sha(central) === snap1.sha256);

  // The manifest hasn't arrived yet but the file has (OneDrive order): the content check still refuses.
  const manifestCopy = fs.readFileSync(store.manifestPath);
  fs.unlinkSync(store.manifestPath);
  const noManifest = await store.publish(path.join(tmp, 'pc', 'publish-stale.db'), snapStale, { generation: 0, sha256: centralSha0 }, meta);
  check('publish refused without manifest when the file changed', !noManifest.ok, noManifest);
  fs.writeFileSync(store.manifestPath, manifestCopy);

  // Next publish by the same editor, on top of their own generation 1.
  const snap2 = await stampedCopy(path.join(tmp, 'pc', 'publish1.db'), path.join(tmp, 'pc', 'publish2.db'), 2, 'Anna Admin');
  const pub2 = await store.publish(path.join(tmp, 'pc', 'publish2.db'), snap2, { generation: 1, sha256: snap1.sha256 }, meta);
  check('second publish on top of own generation', pub2.ok && (await store.readManifest())?.generation === 2, pub2);
  const dl2 = await store.download(path.join(tmp, 'pc', 'incoming2.db'));
  check('a reader downloads generation 2 with its publisher', dl2.generation === 2 && dl2.publishedBy === 'Anna Admin' &&
    dl2.sha256 === snap2.sha256, dl2);

  // Missing / unreachable / damaged central file.
  fs.renameSync(central, `${central}.away`);
  await expectCentralError('download: file missing', () => store.download(path.join(tmp, 'pc', 'x.db')), 'missing');
  const gone = await store.publish(path.join(tmp, 'pc', 'publish2.db'), snap2, { generation: 2, sha256: snap2.sha256 }, meta);
  check('publish refused when the central file is gone', !gone.ok && /no longer in the shared folder/.test((gone as any).conflict), gone);
  fs.renameSync(`${central}.away`, central);
  const unreachable = new SyncedFolderStore(path.join(tmp, 'no-such-folder', 'EPL-Database.db'));
  await expectCentralError('download: folder unreachable', () => unreachable.download(path.join(tmp, 'pc', 'x.db')), 'unreachable');
  check('probe: folder unreachable', !(await unreachable.probe()).reachable);
  check('canWrite: false for an unreachable folder', !(await unreachable.canWrite()));
  check('canWrite: true for the central folder, leaves nothing behind', (await store.canWrite()) &&
    ls(centralDir).join() === 'EPL-Database.db,EPL-Database.manifest.json', ls(centralDir));

  const damagedDir = path.join(tmp, 'central-damaged');
  fs.mkdirSync(damagedDir);
  const damaged = path.join(damagedDir, 'EPL-Database.db');
  fs.copyFileSync(central, damaged);
  {
    const fd = fs.openSync(damaged, 'r+');
    fs.writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 4096);
    fs.closeSync(fd);
  }
  const damagedDest = path.join(tmp, 'pc', 'damaged.db');
  await expectCentralError('download: damaged file', () => new SyncedFolderStore(damaged).download(damagedDest), 'damaged');
  check('a damaged download leaves no copy behind', !fs.existsSync(damagedDest) && !fs.existsSync(`${damagedDest}.download`));

  // Conflict copies.
  const saved = await store.saveConflictCopy(path.join(tmp, 'pc', 'publish2.db'), 'adm-a');
  check('conflict copy saved in EPL-Conflicts/', path.dirname(saved) === path.join(centralDir, 'EPL-Conflicts') &&
    /^EPL-Database_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_adm-a\.db$/.test(path.basename(saved)) &&
    (await sha256File(saved)) === snap2.sha256, saved);
  check('no temp file in EPL-Conflicts/', ls(path.dirname(saved)).every(f => !f.endsWith('.tmp')));
  fs.copyFileSync(central, path.join(centralDir, 'EPL-Database-LAPTOP-AB12.db'));
  fs.copyFileSync(central, path.join(centralDir, 'EPL-Database-LAPTOP-AB12-2.db'));
  const copies = (await store.findConflictCopies()).map(f => path.basename(f));
  check('OneDrive conflict copies are found (and nothing else)', copies.join() === 'EPL-Database-LAPTOP-AB12-2.db,EPL-Database-LAPTOP-AB12.db', copies);
}

// ── Part 2: the app on simulated PCs (pcs.ts) ────────────────────────────────────────────────────────────────────

async function readModeChecks(tmp: string, c: Central, pcs: Pc[]): Promise<{ A: Pc; B: Pc; ref: string }> {
  let expectedCentral = sha(c.central);
  const centralUnchanged = (label: string) =>
    check(`${label}: readers left the central file unchanged`, sha(c.central) === expectedCentral);
  const BEN = { name: 'Ben Admin', account: PEOPLE.ben.account };

  const A = new Pc('A', path.join(tmp, 'pcA'), PEOPLE.anna);
  const B = new Pc('B', path.join(tmp, 'pcB'), PEOPLE.uma);
  pcs.push(A, B);
  await A.start();
  await B.start();

  let sa = await A.startup();
  check('A: first start, nothing to reopen', sa.mode === 'none' && !sa.legacySuggestion, sa);

  // ── Connect: a verified local copy, read-only ──
  let r = await A.invoke('sync:connect', c.central);
  check('A connects to the shared database', r.ok, r);
  sa = await A.status();
  check('A: read mode on a local copy, generation 0', sa.mode === 'shared' && sa.phase === 'read' && !sa.writable &&
    sa.writeBlock === 'read' && sa.data?.generation === 0 && sa.path === c.central && !!sa.data?.fileTime, sa);
  check('A (admin) may start editing', sa.canStartEditing && sa.startEditingBlocked === null, sa);
  check('A: db:get-path is the central database', (await A.invoke('db:get-path')) === c.central);
  centralUnchanged('connect');
  check('connect writes nothing into the shared folder', ls(c.centralDir).join() === 'EPL-Database.db', ls(c.centralDir));
  check('A: the copy is in %LOCALAPPDATA%\\epl-tool\\cache', ls(A.cacheDir).join() === 'EPL-Database.db,cache.json', ls(A.cacheDir));
  const settingsA = JSON.parse(fs.readFileSync(A.settings, 'utf-8'));
  check('A: settings.json remembers the shared connection', settingsA.connection?.mode === 'shared' &&
    settingsA.connection?.path === c.central, settingsA);
  const uv = await A.sql('PRAGMA user_version');
  check('A: the local copy is migrated (schema 8), the central file is not', uv[0].user_version === 8 && userVersion(c.central) === 7, uv);
  const me = await A.invoke('auth:me');
  check('A: Anna is recognised as admin', me.user?.role === 'admin', me.user);

  // ── Read-only: the guard refuses changes, SQLite refuses anything that slips through ──
  const ref = (await A.sql('SELECT customer_ref_sap AS ref FROM customers WHERE is_deleted = 0 ORDER BY id LIMIT 1'))[0].ref;
  await expectError('A (admin) read mode: customer change refused', () => A.invoke('customers:update', ref, { customer_spoc: 'X' }),
    /^Read-only — click Start editing to make changes\.$/);
  await expectError('A (admin) read mode: unit refused', () => A.invoke('settings:create-unit', '1 T'), /^Read-only — click Start editing/);
  await expectError('A (admin) read mode: default FX rates refused',
    () => A.invoke('fx:set-defaults', [{ currency_code: 'EUR', rate_to_usd: 1.2 }]), /^Read-only/);
  await expectError('A (admin) read mode: Back up now refused', () => A.invoke('backup:create'), /^Read-only/);
  const raw = await A.rawWrite("UPDATE customers SET customer_spoc = 'X'");
  check('A: SQLite refuses a direct write on the copy (query_only)', !raw.ok && raw.code === 'SQLITE_READONLY', raw);
  check('A: reading works', (await A.invoke('customers:list')).length > 0);
  centralUnchanged('refusals');

  r = await B.invoke('sync:connect', c.central);
  check('B (Uma, user) connects', r.ok, r);
  let sb = await B.status();
  check('B (user): read mode; Users may start editing from v0.8', sb.phase === 'read' && sb.canStartEditing, sb);
  await expectError('B (user): a change is refused until Start editing', () => B.invoke('price-lists:create', {}),
    /^Read-only — click Start editing to make changes\.$/);

  await B.stop();
  await B.start(PEOPLE.vic);
  sb = await B.startup();
  check('B restarted as Vic (viewer): reconnects from settings.json', sb.mode === 'shared' && sb.phase === 'read', sb);
  await expectError('B (viewer): the role check comes first', () => B.invoke('customers:update', ref, { customer_spoc: 'X' }),
    /^Viewers can only view and export\.$/);

  await B.stop();
  await B.start(PEOPLE.eve);
  await B.startup();
  const eve = await B.invoke('auth:me');
  check('B as Eve (added by email only): recognised by email in read mode', eve.user?.email === PEOPLE.eve.email &&
    eve.user?.role === 'user', eve.user);
  const eveRow = await B.sql('SELECT account FROM users WHERE email = ?', [PEOPLE.eve.email]);
  check('B: her account is not recorded in read mode', eveRow[0]?.account === null, eveRow);
  centralUnchanged('Eve signs in');
  await B.stop();
  await B.start(PEOPLE.uma);
  await B.startup();

  // ── Someone publishes: detected, downloaded, applied ──
  await publishAs(c, BEN, d => d.prepare("UPDATE customers SET customer_spoc = 'Changed by Ben' WHERE customer_ref_sap = ?").run(ref));
  expectedCentral = sha(c.central);
  sa = await A.invoke('sync:check');
  check('A notices the new version: pending, generation 1 by Ben', sa.pendingUpdate?.generation === 1 &&
    sa.pendingUpdate?.publishedBy === 'Ben Admin' && sa.data?.generation === 0, sa);
  check('A: the open copy is unchanged until applied', (await A.invoke('customers:get', ref)).customer_spoc !== 'Changed by Ben');
  const openIdBefore = sa.openId;
  sa = await A.invoke('sync:apply-update');
  check("A applies it: generation 1, Ben's change, screens told to reload", sa.data?.generation === 1 &&
    sa.data?.publishedBy === 'Ben Admin' && !sa.pendingUpdate && sa.openId !== openIdBefore &&
    (await A.invoke('customers:get', ref)).customer_spoc === 'Changed by Ben', sa);
  sb = await B.invoke('sync:refresh');
  check('B: Refresh (check + apply) brings generation 1', sb.data?.generation === 1, sb);
  centralUnchanged('refresh');
  sa = await A.invoke('sync:check');
  check('A: nothing new → nothing pending, no download left behind', !sa.pendingUpdate && !!sa.lastCheckAt &&
    ls(A.cacheDir).join() === 'EPL-Database.db,cache.json', { sa, cache: ls(A.cacheDir) });

  // ── Newer data still syncing (the manifest arrived first) ──
  const manifestPath = path.join(c.centralDir, 'EPL-Database.manifest.json');
  const manifest = fs.readFileSync(manifestPath, 'utf-8');
  fs.writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest), generation: 5, sha256: 'f'.repeat(64) }));
  sa = await A.invoke('sync:check');
  check('A: manifest announces generation 5 → "still syncing", copy kept', sa.syncing?.generation === 5 &&
    sa.data?.generation === 1 && !sa.pendingUpdate, sa);
  check('A: Start editing waits for it', !sa.canStartEditing && /still syncing/.test(sa.startEditingBlocked ?? ''), sa.startEditingBlocked);
  fs.writeFileSync(manifestPath, manifest);
  sa = await A.invoke('sync:check');
  check('A: manifest in line again → not syncing', !sa.syncing && sa.canStartEditing, sa);

  // ── Offline ──
  fs.renameSync(c.centralDir, `${c.centralDir}-away`);
  sa = await A.invoke('sync:check');
  check('A: shared folder gone → offline copy', !!sa.offline && sa.writeBlock === 'offline' && !sa.canStartEditing, sa);
  check('A: reading works offline', (await A.invoke('customers:list')).length > 0);
  await expectError('A offline: changes refused with the offline message', () => A.invoke('settings:create-unit', '1 T'), /^Offline copy/);
  await B.stop();
  await B.start();
  sb = await B.startup();
  check('B starts while the folder is gone → offline from its last copy', sb.mode === 'shared' && !!sb.offline &&
    sb.data?.generation === 1, sb);
  const C = new Pc('C', path.join(tmp, 'pcC'), PEOPLE.vic);
  pcs.push(C);
  await C.start();
  r = await C.invoke('sync:connect', c.central);
  const sc = await C.status();
  check("C (no copy yet) can't connect while the folder is unreachable", !r.ok && /can't be reached/.test(r.error) &&
    sc.mode === 'none' && !!sc.error, { r, sc });
  fs.renameSync(`${c.centralDir}-away`, c.centralDir);
  sa = await A.invoke('sync:check');
  check('A: back online', !sa.offline && sa.writeBlock === 'read', sa);
  sb = await B.invoke('sync:check');
  check('B: back online', !sb.offline, sb);

  // ── Published by a newer app ──
  await publishAs(c, BEN, () => undefined, { schema: 99, minApp: '9.0.0' });
  expectedCentral = sha(c.central);
  sa = await A.invoke('sync:refresh');
  check('A: a copy from a newer app is read as it is', sa.data?.generation === 2 && sa.newerApp?.schemaVersion === 99 &&
    sa.newerApp?.minAppVersion === '9.0.0' && sa.writeBlock === 'update', sa);
  check('A: reading works on it', (await A.invoke('customers:list')).length > 0);
  await expectError('A: changes refused until the app is updated', () => A.invoke('settings:create-unit', '1 T'),
    /^Update EPL Tool to 9\.0\.0 to make changes\.$/);
  check('A: Start editing blocked (update needed)', !sa.canStartEditing && /newer EPL Tool/.test(sa.startEditingBlocked ?? ''), sa.startEditingBlocked);
  await publishAs(c, BEN, () => undefined, { from: c.base });
  expectedCentral = sha(c.central);
  sa = await A.invoke('sync:refresh');
  check('A: back to a version of this app', sa.data?.generation === 3 && !sa.newerApp && sa.writeBlock === 'read', sa);

  // ── Damaged shared file ──
  const good = fs.readFileSync(c.central);
  corrupt(c.central);
  for (let i = 0; i < 2; i++) sa = await A.invoke('sync:check');
  check('A: one or two failed copies are not reported yet', !sa.centralDamaged && sa.data?.generation === 3, sa);
  sa = await A.invoke('sync:check');
  check('A: damaged shared file reported after 3 tries; the last good copy stays open', sa.centralDamaged && !!sa.error &&
    sa.data?.generation === 3 && (await A.invoke('customers:list')).length > 0, sa);
  fs.writeFileSync(c.central, good);
  sa = await A.invoke('sync:check');
  check('A: repaired → back to normal', !sa.centralDamaged && !sa.error && !sa.pendingUpdate, sa);

  // ── OneDrive conflict copies ──
  const conflictCopy = path.join(c.centralDir, 'EPL-Database-LAPTOP-X.db');
  fs.copyFileSync(c.central, conflictCopy);
  sa = await A.invoke('sync:check');
  check('A: OneDrive conflict copy reported', sa.conflictCopies.length === 1 && sa.conflictCopies[0] === conflictCopy, sa.conflictCopies);
  fs.unlinkSync(conflictCopy);

  // ── Local mode ──
  r = await A.invoke('db:open', c.central);
  check('A: opening the shared database directly is refused', !r.ok && /This is a shared database/.test(r.error), r);
  check('A: … and A stays connected', (await A.status()).phase === 'read');
  const localDb = path.join(tmp, 'pcA', 'docs', 'Test.db');
  fs.mkdirSync(path.dirname(localDb), { recursive: true });
  fs.copyFileSync(c.base, localDb);
  r = await A.invoke('db:open', localDb);
  sa = await A.status();
  check('A: a local database opens directly and is writable', r.ok && sa.mode === 'local' && sa.writable && sa.path === localDb, { r, sa });
  check('A: local mode keeps the backup on open', ls(path.join(path.dirname(localDb), 'EPL-Backups')).length === 1);
  await allowed('A: local mode accepts changes', () => A.invoke('settings:create-unit', '1 T'));
  r = await A.invoke('sync:connect', c.central);
  sa = await A.status();
  check('A: back to the shared database (its copy kept)', r.ok && sa.phase === 'read' && sa.data?.generation === 3, sa);

  // ── Existing install (v0.6 settings.json with lastDbPath) ──
  const D = new Pc('D', path.join(tmp, 'pcD'), PEOPLE.anna, { OneDriveCommercial: c.centralDir });
  pcs.push(D);
  fs.mkdirSync(D.userData, { recursive: true });
  fs.writeFileSync(D.settings, JSON.stringify({ lastDbPath: c.central }));
  await D.start();
  let sd = await D.startup();
  check('D (v0.6, database in a synced folder): not opened, offered as shared', sd.mode === 'none' &&
    sd.legacySuggestion?.path === c.central, sd);
  await D.stop();
  fs.writeFileSync(D.settings, JSON.stringify({ lastDbPath: localDb }));
  await D.start();
  sd = await D.startup();
  check('D (v0.6, database not in a synced folder): reopened as a local database', sd.mode === 'local' && sd.path === localDb, sd);
  await D.stop();

  centralUnchanged('read mode overall');
  check('the shared folder holds only the database and its manifest',
    ls(c.centralDir).join() === 'EPL-Database.db,EPL-Database.manifest.json', ls(c.centralDir));
  return { A, B, ref };
}


async function editModeChecks(tmp: string, c: Central, pcs: Pc[], A: Pc, B: Pc, ref: string) {
  // ── Start editing ──
  let sa = await A.status();
  const genBefore = sa.data?.generation;
  const shaBefore = sha(c.central);
  let r = await A.invoke('sync:start-editing');
  sa = await A.status();
  check('A (admin) starts editing', r.ok && sa.phase === 'edit' && sa.writable && !sa.canStartEditing && !!sa.edit &&
    !sa.edit.dirty && sa.data?.generation === genBefore, { r, sa });
  check('Start editing: one backup in EPL-Backups/, nothing else written to the shared folder', backupsOf(c).length === 1 &&
    sha(c.central) === shaBefore, backupsOf(c));
  const startBackup = path.join(c.centralDir, 'EPL-Backups', backupsOf(c)[0]);
  check('the backup is the shared file as it was', generationOf(c, startBackup) === genBefore);
  check('A: working copy + session.json in %LOCALAPPDATA%\\epl-tool\\work', ls(A.workDir).join() === 'EPL-Database.db,session.json', ls(A.workDir));
  r = await A.invoke('sync:start-editing');
  check('Start editing twice is refused', !r.ok && /already editing/.test(r.error), r);
  r = await A.invoke('db:open', path.join(tmp, 'pcA', 'docs', 'Test.db'));
  check('A: switching database while editing is refused', !r.ok && /Finish editing first/.test(r.error), r);

  // ── A change, then Publish now ──
  await allowed('A edits a customer', () => A.invoke('customers:update', ref, { customer_spoc: 'Set by Anna' }));
  sa = await A.status();
  check('A: the change is noted, publish scheduled', !!sa.edit?.dirty && !!sa.edit?.nextPublishAt, sa.edit);
  check('A: session.json says unpublished changes', JSON.parse(fs.readFileSync(path.join(A.workDir, 'session.json'), 'utf-8')).dirty === true);
  check('nothing reaches the shared file before the publish', sha(c.central) === shaBefore);
  let p = await A.invoke('sync:publish');
  const gen1 = (genBefore ?? 0) + 1;
  check(`A publishes: generation ${gen1}`, p.ok && p.published && p.generation === gen1, p);
  const m1 = manifestOf(c);
  check('manifest: generation, sha256, Anna, minAppVersion', m1.generation === gen1 && m1.sha256 === sha(c.central) &&
    m1.publishedBy === 'Anna Admin' && m1.publishedByAccount === PEOPLE.anna.account && m1.minAppVersion === MIN_EDIT_APP_VERSION, m1);
  check("the shared file has Anna's change and generation", spocOf(c, ref) === 'Set by Anna' && generationOf(c) === gen1);
  const pubAudit = centralQuery(c, "SELECT * FROM audit_log WHERE action IN ('sync.publish', 'customer.update') ORDER BY id DESC LIMIT 2");
  check('activity log of the shared file: the change and the sync.publish entry', pubAudit[0]?.action === 'sync.publish' &&
    pubAudit[0]?.entity_key === String(gen1) && /Anna Admin/.test(pubAudit[0]?.user_label) && pubAudit[1]?.action === 'customer.update', pubAudit);
  const workAudit = await A.sql("SELECT entity_key FROM audit_log WHERE action = 'sync.publish' ORDER BY id DESC LIMIT 1");
  check('the working copy got the same stamp', workAudit[0]?.entity_key === String(gen1) &&
    (await A.sql('SELECT generation FROM sync_meta'))[0].generation === gen1);
  sa = await A.status();
  check('A: published, nothing pending', !sa.edit?.dirty && sa.edit?.lastPublishedGeneration === gen1 && sa.data?.generation === gen1, sa.edit);
  check('no temp files in the shared folder', ls(c.centralDir).every(f => !f.endsWith('.tmp')), ls(c.centralDir));
  p = await A.invoke('sync:publish');
  check('Publish now without changes publishes nothing', p.ok && !p.published && manifestOf(c).generation === gen1, p);

  const sb = await B.invoke('sync:refresh');
  check("B (reader) gets Anna's version", sb.data?.generation === gen1 && sb.data?.publishedBy === 'Anna Admin' &&
    (await B.invoke('customers:get', ref)).customer_spoc === 'Set by Anna', sb.data);

  // ── Changes wait while a publish takes its snapshot ──
  await allowed('A adds a unit', () => A.invoke('settings:create-unit', 'Unit 1'));
  const publishing = A.invoke('sync:publish');
  const waiting = A.invoke('settings:create-unit', 'Unit 2');
  const [p2] = await Promise.all([publishing, waiting]);
  sa = await A.status();
  const units = centralQuery(c, "SELECT name FROM units WHERE name LIKE 'Unit %' ORDER BY name").map(u => u.name);
  check('a change made during a publish waits and goes into the next one', p2.ok && p2.generation === gen1 + 1 &&
    units.join() === 'Unit 1' && !!sa.edit?.dirty, { p2, units, edit: sa.edit });

  // ── Finish editing ──
  const f = await A.invoke('sync:finish-editing');
  sa = await A.status();
  const gen3 = gen1 + 2;
  check('Finish editing publishes the rest and goes back to read mode', f.ok && sa.phase === 'read' && !sa.writable &&
    sa.data?.generation === gen3 && generationOf(c) === gen3, { f, sa });
  check('A: working copy and session removed; the read copy is the published version', ls(A.workDir).length === 0 &&
    JSON.parse(fs.readFileSync(path.join(A.cacheDir, 'cache.json'), 'utf-8')).sha256 === sha(c.central), ls(A.workDir));
  sa = await A.invoke('sync:check');
  check('A: next check finds nothing new', !sa.pendingUpdate, sa);
  await expectError('A: read-only again', () => A.invoke('settings:create-unit', 'Unit 3'), /^Read-only — click Start editing/);
  check('only one backup for the whole editing session', backupsOf(c).length === 1, backupsOf(c));

  // ── The edit slot: one editor at a time ──
  await B.stop();
  await B.start(PEOPLE.ben);
  await B.startup();
  r = await B.invoke('sync:start-editing');
  check('B (Ben, admin) starts editing', r.ok, r);
  r = await A.invoke('sync:start-editing');
  check('A has to wait: Ben holds the edit slot', !r.ok && r.waiting?.user === 'Ben Admin' && !!r.waiting?.since, r);
  sa = await A.invoke('sync:check');
  check("A's status knows Ben is editing", sa.slot?.holder?.user === 'Ben Admin' && !sa.slot.holder.mine, sa.slot);
  await allowed('B edits', () => B.invoke('customers:update', ref, { customer_spoc: 'Set by Ben' }));
  const fb = await B.invoke('sync:finish-editing');
  check('B finishes: published, slot released', fb.ok && (await B.status()).phase === 'read' &&
    ls(path.join(c.centralDir, 'EPL-EditSlot')).length === 0, fb);

  // ── A PC whose OneDrive was paused publishes behind the slot: the generation check refuses, nothing is overwritten ──
  await A.invoke('sync:refresh');
  const genBoth = generationOf(c);
  r = await A.invoke('sync:start-editing');
  check('A starts editing once the slot is free', r.ok, r);
  await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Set by Anna again' }));
  await publishAs(c, { name: 'Ben Admin', account: PEOPLE.ben.account },
    d => d.prepare("UPDATE customers SET customer_spoc = 'Set by Ben (paused OneDrive)' WHERE customer_ref_sap = ?").run(ref));
  const benSha = sha(c.central);
  sa = await A.invoke('sync:check');
  check('A is warned at once that someone else published', /Ben Admin published a newer version/.test(sa.edit?.centralChanged ?? ''), sa.edit);
  p = await A.invoke('sync:publish');
  sa = await A.status();
  check("A's publish is refused", !p.ok && p.conflict && /not published/.test(p.error), p);
  check("the shared file is still Ben's", sha(c.central) === benSha && spocOf(c, ref) === 'Set by Ben (paused OneDrive)');
  check("A's work is kept in EPL-Conflicts/", !!p.savedTo && path.dirname(p.savedTo) === path.join(c.centralDir, 'EPL-Conflicts') &&
    spocOf(c, ref, p.savedTo) === 'Set by Anna again', p.savedTo);
  check('the conflict copy is the working copy, not stamped as published', generationOf(c, p.savedTo) === genBoth &&
    centralQuery(c, "SELECT 1 FROM audit_log WHERE action = 'sync.publish' AND entity_key = ?", [String(genBoth + 1)], p.savedTo).length === 0);
  check("A is back in read mode on Ben's version, with the conflict shown, slot released", sa.phase === 'read' && !!sa.conflict &&
    sa.conflict.savedTo === p.savedTo && (await A.invoke('customers:get', ref)).customer_spoc === 'Set by Ben (paused OneDrive)' &&
    ls(path.join(c.centralDir, 'EPL-EditSlot')).length === 0, sa);
  sa = await A.invoke('sync:dismiss-conflict');
  check('A dismisses the conflict message', sa.conflict === null);

  // ── Auto-publish about a minute after the last change (shortened here) ──
  await A.timers({ checkMs: 60_000, publishMs: 400 });
  r = await A.invoke('sync:start-editing');
  const genAuto = generationOf(c) + 1;
  await A.invoke('customers:update', ref, { customer_spoc: 'Auto-published' });
  await sleep(150);
  await A.invoke('customers:update', ref, { customer_spoc: 'Auto-published 2' });
  await sleep(250);
  check('no publish while changes keep coming', generationOf(c) === genAuto - 1);
  await sleep(700);
  sa = await A.status();
  check('auto-publish after the delay', generationOf(c) === genAuto && spocOf(c, ref) === 'Auto-published 2' && !sa.edit?.dirty, sa.edit);
  await A.invoke('sync:finish-editing');

  // ── Crash with unpublished changes: offered at the next start ──
  await A.kill();
  await A.start();
  await A.startup();
  await A.invoke('sync:start-editing');
  await A.invoke('customers:update', ref, { customer_spoc: 'Before the crash' });
  const shaBeforeCrash = sha(c.central);
  await A.kill();
  check('a crash publishes nothing', sha(c.central) === shaBeforeCrash);
  await A.start();
  sa = await A.startup();
  check('A restarts: unpublished changes offered, Start editing blocked until decided', sa.phase === 'read' && !!sa.recovery &&
    !sa.canStartEditing && /unpublished changes/.test(sa.startEditingBlocked ?? ''), sa);
  p = await A.invoke('sync:recover', 'publish');
  sa = await A.status();
  check('Publish now: the changes are published with the generation check', p.ok && p.published && sa.phase === 'read' &&
    !sa.recovery && spocOf(c, ref) === 'Before the crash', { p, sa });
  await A.invoke('sync:start-editing');
  await A.invoke('customers:update', ref, { customer_spoc: 'Thrown away' });
  await A.kill();
  await A.start();
  sa = await A.startup();
  p = await A.invoke('sync:recover', 'discard');
  sa = await A.status();
  check('Discard: the changes are dropped, nothing published', p.ok && !sa.recovery && spocOf(c, ref) === 'Before the crash' &&
    ls(A.workDir).length === 0, sa);

  // ── Restore in shared mode ──
  r = await A.invoke('backup:restore', startBackup);
  check('restore in read mode is refused', !r.ok && /Read-only — click Start editing/.test(r.error), r);
  await A.invoke('sync:start-editing');
  const genRestore = generationOf(c) + 1;
  r = await A.invoke('backup:restore', startBackup);
  sa = await A.status();
  check('restore while editing: the backup is published at once', r.ok && generationOf(c) === genRestore &&
    spocOf(c, ref) === spocOf(c, ref, startBackup) && sa.phase === 'edit' && !sa.edit?.dirty, { r, sa: sa.edit });
  check('restore: pre-restore copy kept, activity entry published', !!r.safetyCopy && fs.existsSync(r.safetyCopy) &&
    centralQuery(c, "SELECT 1 FROM audit_log WHERE action = 'backup.restore'").length === 1, r);
  await A.invoke('sync:finish-editing');

  const good = fs.readFileSync(c.central);
  corrupt(c.central);
  for (let i = 0; i < 3; i++) sa = await A.invoke('sync:check');
  check('A: shared file damaged → Start editing blocked', sa.centralDamaged && !sa.canStartEditing, sa);
  const genDamaged = manifestOf(c).generation + 1;
  r = await A.invoke('backup:restore', startBackup);
  sa = await A.status();
  check('restore of a damaged shared file works from read mode (admin)', r.ok && sa.phase === 'read' && !sa.centralDamaged &&
    generationOf(c) === genDamaged && spocOf(c, ref) === spocOf(c, ref, startBackup), { r, sa });
  check('the damaged file is kept as a pre-restore copy', !!r.safetyCopy && fs.statSync(r.safetyCopy).size === good.length, r);

  // ── An admin added by email only: account recorded at Start editing ──
  const F = new Pc('F', path.join(tmp, 'pcF'), PEOPLE.fay);
  pcs.push(F);
  await F.start();
  await F.invoke('sync:connect', c.central);
  check('F (Fay, admin added by email): no account recorded in read mode',
    (await F.sql('SELECT account FROM users WHERE email = ?', [PEOPLE.fay.email]))[0].account === null);
  await F.invoke('sync:start-editing');
  const fp = await F.invoke('sync:finish-editing');
  check('F: Start editing records her account, published', fp.ok && fp.published &&
    centralQuery(c, 'SELECT account FROM users WHERE email = ?', [PEOPLE.fay.email])[0].account === PEOPLE.fay.account, fp);

  // ── A shared database without users: the first person to start editing becomes its admin ──
  const bootDir = path.join(tmp, 'shared', 'EPL-NoUsers');
  fs.mkdirSync(bootDir, { recursive: true });
  const bootDb = path.join(bootDir, 'EPL-Database.db');
  fs.copyFileSync(sample(SAMPLE_DBS[1]), bootDb);
  const bootSha = sha(bootDb);
  const E = new Pc('E', path.join(tmp, 'pcE'), PEOPLE.boot);
  pcs.push(E);
  await E.start();
  r = await E.invoke('sync:connect', bootDb);
  let se = await E.status();
  const meE = await E.invoke('auth:me');
  check('E: database without users opens read-only, nobody bootstrapped', r.ok && se.phase === 'read' && !meE.user &&
    sha(bootDb) === bootSha, { r, user: meE.user });
  check('E: Start editing allowed (to create the first admin)', se.canStartEditing, se.startEditingBlocked);
  await allowed('E starts editing', async () => {
    const x = await E.invoke('sync:start-editing');
    if (!x.ok) throw new Error(x.error);
  });
  const meE2 = await E.invoke('auth:me');
  const fe = await E.invoke('sync:finish-editing');
  const users = centralQuery(c, 'SELECT account, role FROM users', [], bootDb);
  const bootAudit = centralQuery(c, "SELECT action FROM audit_log WHERE action IN ('user.bootstrap', 'sync.publish')", [], bootDb);
  se = await E.status();
  check('E becomes the first admin, published', meE2.user?.role === 'admin' && fe.ok && users.length === 1 &&
    users[0].account === PEOPLE.boot.account && bootAudit.length === 2 && se.phase === 'read', { users, bootAudit, fe });
}

async function twoPcChecks(tmp: string) {
  const c = prepareCentral(tmp);
  const pcs: Pc[] = [];
  try {
    const { A, B, ref } = await readModeChecks(tmp, c, pcs);
    await editModeChecks(tmp, c, pcs, A, B, ref);
  } finally {
    for (const pc of pcs) await pc.stop();
  }
}

if (process.env.EPL_PC) {
  worker();
} else {
  run(async () => {
    const tmp = setupTemp('epl-check-c-');
    process.env.LOCALAPPDATA = path.join(tmp, 'local');
    delete process.env.EPL_DEV_ACCOUNT;
    delete process.env.EPL_DEV_EMAIL;
    process.env.EPL_DEV_ACCOUNT = PEOPLE.anna.account;
    process.env.EPL_DEV_EMAIL = PEOPLE.anna.email;
    initIdentity({ allowOverride: true });
    await getIdentity();
    console.log(`schema ${SCHEMA_VERSION}`);
    await storeChecks(tmp);
    await twoPcChecks(tmp);
    finish(tmp);
  });
}
