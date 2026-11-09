/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase C (v0.7 shared database): Migration 8 (sync_meta) and the CentralStore that reads and writes the shared folder.
// The shared folder is a temp "central" folder; the app's local copies live in a temp %LOCALAPPDATA%.
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
import { SAMPLE_DBS, check, finish, run, sample, setupTemp, sha, userVersion } from './harness';

const ls = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

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

run(async () => {
  const tmp = setupTemp('epl-check-c-');
  process.env.LOCALAPPDATA = path.join(tmp, 'local');
  delete process.env.EPL_DEV_ACCOUNT;
  delete process.env.EPL_DEV_EMAIL;
  process.env.EPL_DEV_ACCOUNT = 'adm-a';
  process.env.EPL_DEV_EMAIL = 'anna.admin@example.com';
  initIdentity({ allowOverride: true });
  await getIdentity();
  console.log(`schema ${SCHEMA_VERSION}`);

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

  finish(tmp);
});
