/* eslint-disable @typescript-eslint/no-explicit-any */
// Simulated PCs for the main-process checks (phase-c, phase-d, phase-e): each check file forks itself into worker processes ("PC A",
// "PC B", …) that run the real IPC handlers with their own userData, %LOCALAPPDATA% and Windows identity, sharing one temp
// "central" folder. The orchestrator plays "someone else" by publishing new versions with the CentralStore.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fork, type ChildProcess } from 'child_process';
import Database from 'better-sqlite3';
import { closeDatabase, getDb, openDatabase, SCHEMA_VERSION } from '../../src/main/database';
import { getIdentity, initIdentity } from '../../src/main/auth';
import { SyncedFolderStore, describeDbFile, type DbFileInfo } from '../../src/main/sync/centralStore';
import { newSlotId, type SlotClaim, type SlotRelease } from '../../src/main/sync/editSlot';
import { configureTimings, getStatus, heartbeatNow, onNotice, startBackgroundChecks, startup, type SyncNotice } from '../../src/main/sync/sync';
import { MIN_EDIT_APP_VERSION } from '../../src/shared/sync';
import { registerAllIpcHandlers } from '../../src/main/ipc/index';
import { SAMPLE_DBS, invoke, sample, stub, userVersion } from './harness';

export const ls = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

export interface Person { account: string; email: string }
export const PEOPLE = {
  anna: { account: 'adm-a', email: 'anna.admin@example.com' },   // admin (first admin of the prepared database)
  ben: { account: 'adm-b', email: 'ben.admin@example.com' },     // admin
  uma: { account: 'usr-u', email: 'uma.user@example.com' },      // user
  vic: { account: 'vw-v', email: 'vic.viewer@example.com' },     // viewer
  eve: { account: 'usr-e', email: 'eve.email@example.com' },     // user added by email only
  fay: { account: 'adm-f', email: 'fay.admin@example.com' },     // admin added by email only
  boot: { account: 'boot-x', email: 'boot.strap@example.com' },  // nobody's user yet (database without users)
};

// Worker side: a "PC" running the real IPC handlers, driven by messages from the orchestrator. It reports the version
// of the coming release (package.json is bumped at release time) and its own computer name (EPL_MACHINE). Timings are short
// (EPL_TIMINGS = JSON) so a claim's waiting window doesn't take 45 s; the background timers only run when a check starts
// them ('timers').
export function worker(): void {
  const machine = process.env.EPL_MACHINE;
  if (machine) (os as { hostname: () => string }).hostname = () => machine;
  stub.__state.appVersion = process.env.EPL_APP_VERSION ?? MIN_EDIT_APP_VERSION;
  configureTimings({ slotWaitMs: 150, ...(process.env.EPL_TIMINGS ? JSON.parse(process.env.EPL_TIMINGS) : {}) });
  initIdentity({ allowOverride: true });
  registerAllIpcHandlers();
  const notices: SyncNotice[] = [];          // what the app would show as Windows notifications
  onNotice(n => notices.push(n));
  process.on('disconnect', () => process.exit(0));
  process.on('message', async (m: { id: number; op: string; args: any[] }) => {
    const reply = (x: object) => process.send?.({ id: m.id, ...x });
    try {
      let result: unknown;
      if (m.op === 'invoke') result = await invoke(m.args[0], ...m.args.slice(1));
      else if (m.op === 'startup') { await getIdentity(); await startup(); result = getStatus(); }
      else if (m.op === 'sql') result = getDb().prepare(m.args[0]).all(...(m.args[1] ?? []));
      else if (m.op === 'raw-write') result = getDb().prepare(m.args[0]).run();
      else if (m.op === 'timers') startBackgroundChecks(m.args[0]);
      else if (m.op === 'configure') configureTimings(m.args[0]);
      else if (m.op === 'heartbeat') { await heartbeatNow(); result = getStatus(); }
      else if (m.op === 'notices') result = notices.splice(0);
      else if (m.op === 'stub') {
        Object.assign(stub.__state, m.args[0] ?? {});
        const st = stub.__state;
        result = { isPackaged: st.isPackaged, appVersion: st.appVersion, openedPaths: st.openedPaths, quitCalls: st.quitCalls };
      }
      else if (m.op === 'exit') { reply({ ok: true }); process.exit(0); }
      reply({ ok: true, result });
    } catch (e) {
      reply({ ok: false, error: (e as Error).message, code: (e as any).code });
    }
  });
  process.send?.({ ready: true });
}

export class Pc {
  private child: ChildProcess | null = null;
  private seq = 0;
  private readonly waiting = new Map<number, (m: any) => void>();

  constructor(readonly name: string, readonly dir: string, public who: Person, readonly extraEnv: Record<string, string> = {}) {}

  get userData() { return path.join(this.dir, 'userData'); }
  get settings() { return path.join(this.userData, 'settings.json'); }
  get local() { return path.join(this.dir, 'local'); }
  get cacheDir() { return path.join(this.local, 'userData', 'cache'); }
  get workDir() { return path.join(this.local, 'userData', 'work'); }

  async start(who: Person = this.who): Promise<void> {
    this.who = who;
    fs.mkdirSync(this.userData, { recursive: true });
    fs.mkdirSync(this.local, { recursive: true });
    // Windows environment names are case-insensitive: drop the PC's own value before overriding.
    const env: NodeJS.ProcessEnv = { ...process.env };
    const overrides: Record<string, string> = {
      EPL_PC: this.name, EPL_MACHINE: `PC-${this.name}`, TEST_USERDATA: this.userData, LOCALAPPDATA: this.local,
      EPL_DEV_ACCOUNT: who.account, EPL_DEV_EMAIL: who.email, ...this.extraEnv,
    };
    for (const [key, value] of Object.entries(overrides)) {
      for (const k of Object.keys(env)) if (k.toLowerCase() === key.toLowerCase()) delete env[k];
      env[key] = value;
    }
    const child = fork(process.argv[1], [], { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.child = child;
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.on('message', (m: any) => {
        if (m?.ready) resolve();
        else this.waiting.get(m?.id)?.(m);
      });
    });
  }

  private send(op: string, ...args: any[]): Promise<any> {
    if (!this.child) return Promise.resolve({ ok: false, error: `PC ${this.name} is not running` });
    const id = ++this.seq;
    return new Promise(resolve => {
      this.waiting.set(id, m => { this.waiting.delete(id); resolve(m); });
      this.child?.send({ id, op, args });
    });
  }

  private async ok(op: string, ...args: any[]): Promise<any> {
    const r = await this.send(op, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }

  invoke(channel: string, ...args: any[]) { return this.ok('invoke', channel, ...args); }
  status() { return this.invoke('sync:status'); }
  startup() { return this.ok('startup'); }
  sql(query: string, params?: any[]) { return this.ok('sql', query, params); }
  rawWrite(query: string) { return this.send('raw-write', query); }
  timers(t: Record<string, number>) { return this.ok('timers', t); }
  configure(t: Record<string, number>) { return this.ok('configure', t); }
  heartbeat() { return this.ok('heartbeat'); }
  // The notifications shown since the last call (then forgotten).
  notices(): Promise<SyncNotice[]> { return this.ok('notices'); }
  // Sets fields of the Electron stub on this PC (e.g. isPackaged, nextOpen, appVersion) and returns what it recorded
  // (paths opened with shell.openPath, app.quit calls).
  stub(set: Record<string, unknown> = {}): Promise<{ isPackaged: boolean; appVersion: string; openedPaths: string[]; quitCalls: number }> {
    return this.ok('stub', set);
  }

  // A crash: no chance to publish.
  async kill(): Promise<void> {
    const c = this.child;
    if (!c) return;
    const exited = new Promise(r => c.once('exit', r));
    c.kill();
    await exited;
    this.child = null;
  }

  async stop(): Promise<void> {
    const c = this.child;
    if (!c) return;
    const exited = new Promise(r => c.once('exit', r));
    void this.send('exit');
    await exited;
    this.child = null;
  }
}

export interface Central { centralDir: string; central: string; base: string; orch: string }

// A v0.6.1-like shared database (schema 7, a user list, no sync_meta yet) in tmp\central, plus a schema 8 copy ("base").
export function prepareCentral(tmp: string): Central {
  const prep = path.join(tmp, 'prep', 'EPL-Database.db');
  fs.mkdirSync(path.dirname(prep), { recursive: true });
  fs.copyFileSync(sample(SAMPLE_DBS[0]), prep);
  openDatabase(prep, { skipBackup: true });          // the orchestrator is Anna: she becomes the first admin
  const db = getDb();
  const add = db.prepare('INSERT INTO users (display_name, email, account, role) VALUES (?, ?, ?, ?)');
  add.run('Ben Admin', PEOPLE.ben.email, PEOPLE.ben.account, 'admin');
  add.run('Uma User', PEOPLE.uma.email, PEOPLE.uma.account, 'user');
  add.run('Vic Viewer', PEOPLE.vic.email, PEOPLE.vic.account, 'viewer');
  add.run('Eve Email', PEOPLE.eve.email, null, 'user');
  add.run('Fay Admin', PEOPLE.fay.email, null, 'admin');
  closeDatabase();
  const base = path.join(tmp, 'prep', 'base8.db');
  fs.copyFileSync(prep, base);
  const d = new Database(prep);
  d.exec('DROP TABLE sync_meta');
  d.pragma('user_version = 7');
  d.close();
  const centralDir = path.join(tmp, 'shared', 'EPL-Central');
  fs.mkdirSync(centralDir, { recursive: true });
  const central = path.join(centralDir, 'EPL-Database.db');
  fs.copyFileSync(prep, central);
  const orch = path.join(tmp, 'orchestrator');
  fs.mkdirSync(orch);
  return { centralDir, central, base, orch };
}

// "Someone else" publishes a new version, as the app does: copy, change, stamp the next generation, generation check.
export let pubSeq = 0;
export async function publishAs(
  c: Central, by: { name: string; account: string }, change: (d: Database.Database) => void,
  opts: { from?: string; schema?: number; minApp?: string } = {},
): Promise<DbFileInfo> {
  const cur = path.join(c.orch, `current-${++pubSeq}.db`);
  fs.copyFileSync(c.central, cur);
  const curInfo = await describeDbFile(cur);
  const work = path.join(c.orch, `publish-${pubSeq}.db`);
  fs.copyFileSync(opts.from ?? cur, work);
  if (userVersion(work) < SCHEMA_VERSION) {
    openDatabase(work, { skipBackup: true, bootstrap: false });
    closeDatabase();
  }
  const d = new Database(work);
  change(d);
  d.prepare(`UPDATE sync_meta SET generation = ?, published_by = ?, published_by_account = ?, published_at = ?,
    published_app_version = '0.7.0' WHERE id = 1`).run(curInfo.generation + 1, by.name, by.account, new Date().toISOString());
  if (opts.schema) d.pragma(`user_version = ${opts.schema}`);
  d.close();
  const info = await describeDbFile(work);
  const r = await new SyncedFolderStore(c.central).publish(work, info, { generation: curInfo.generation, sha256: curInfo.sha256 },
    { appVersion: '0.7.0', minAppVersion: opts.minApp ?? '0.7.0' });
  if (!r.ok) throw new Error(`orchestrator publish refused: ${r.conflict}`);
  return info;
}

export function corrupt(file: string): void {
  const fd = fs.openSync(file, 'r+');
  fs.writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, 4096);
  fs.closeSync(fd);
}

// Reads the central file through a copy (the checks don't open the shared file with SQLite either).
export let querySeq = 0;
export function centralQuery(c: Central, query: string, params: any[] = [], file = c.central): any[] {
  const copy = path.join(c.orch, `query-${++querySeq}.db`);
  fs.copyFileSync(file, copy);
  const d = new Database(copy, { readonly: true });
  try {
    return d.prepare(query).all(...params);
  } finally {
    d.close();
  }
}

export const spocOf = (c: Central, ref: string, file?: string) =>
  centralQuery(c, 'SELECT customer_spoc AS s FROM customers WHERE customer_ref_sap = ?', [ref], file)[0]?.s;
export const generationOf = (c: Central, file?: string) =>
  centralQuery(c, 'SELECT generation AS g FROM sync_meta', [], file)[0]?.g;
export const manifestOf = (c: Central) => JSON.parse(fs.readFileSync(path.join(c.centralDir, 'EPL-Database.manifest.json'), 'utf-8'));
export const backupsOf = (c: Central) => ls(path.join(c.centralDir, 'EPL-Backups'));
export const conflictsOf = (c: Central) => ls(path.join(c.centralDir, 'EPL-Conflicts'));

// The edit slot as the shared folder holds it.
export const slotDirOf = (c: Central) => path.join(c.centralDir, 'EPL-EditSlot');
const isReleaseFile = (f: string) => f.endsWith('.release.json');
export const claimsOf = (c: Central): SlotClaim[] => ls(slotDirOf(c)).filter(f => f.endsWith('.json') && !isReleaseFile(f))
  .map(f => JSON.parse(fs.readFileSync(path.join(slotDirOf(c), f), 'utf-8')));
export const releasesOf = (c: Central): SlotRelease[] => ls(slotDirOf(c)).filter(isReleaseFile)
  .map(f => JSON.parse(fs.readFileSync(path.join(slotDirOf(c), f), 'utf-8')));

// A release record as an admin's PC would have written it (Force release, Phase E).
export async function writeReleaseAs(
  c: Central, by: { name: string; account: string; machine: string },
  of: Pick<SlotClaim, 'slotId' | 'user' | 'account' | 'machine'>, at: Date, extra: Partial<SlotRelease> = {},
): Promise<SlotRelease> {
  const release: SlotRelease = {
    format: 1, kind: 'release', db: path.basename(c.central).toLowerCase(), slotId: of.slotId,
    released: { user: of.user, account: of.account, machine: of.machine },
    user: by.name, account: by.account, machine: by.machine, at: at.toISOString(), ...extra,
  };
  await new SyncedFolderStore(c.central).writeRelease(release);
  return release;
}

// A claim file as another PC would have written it (OneDrive delivers it some time later).
export async function writeClaimAs(
  c: Central, who: { name: string; account: string; machine: string }, t: { claimedAt: Date; heartbeatAt: Date },
  extra: Partial<SlotClaim> = {},
): Promise<SlotClaim> {
  const claim: SlotClaim = {
    format: 1, slotId: newSlotId(), db: path.basename(c.central).toLowerCase(), user: who.name, account: who.account,
    machine: who.machine, claimedAt: t.claimedAt.toISOString(), heartbeatAt: t.heartbeatAt.toISOString(), lastChangeAt: null,
    state: 'holding', appVersion: MIN_EDIT_APP_VERSION, ...extra,
  };
  await new SyncedFolderStore(c.central).writeClaim(claim);
  return claim;
}

// Rewrites a claim file, e.g. to make it look as if its PC stopped sending heartbeats long ago.
export function ageClaim(c: Central, slotId: string, minutesAgo: number): void {
  const file = path.join(slotDirOf(c), `${slotId}.json`);
  const claim = JSON.parse(fs.readFileSync(file, 'utf-8')) as SlotClaim;
  claim.heartbeatAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  fs.writeFileSync(file, JSON.stringify(claim, null, 2));
}
