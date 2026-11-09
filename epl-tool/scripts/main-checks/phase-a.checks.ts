/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase A (v0.6 foundations): schema numbering, a re-open that doesn't touch the file, refusing newer schemas, the
// customers:update allow-list, the logo stored in the database, per-user email templates, Windows identity.
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { registerAllIpcHandlers } from '../../src/main/ipc/index';
import { closeDatabase, getDb, getLastOpenError, openDatabase, SCHEMA_VERSION } from '../../src/main/database';
import { detectIdentity, oneDriveEmail } from '../../src/main/auth';
import {
  SAMPLE_DBS, check, expectError, finish, handlers, invoke, run, sample, setupTemp, sha, sleep, stub, userVersion,
} from './harness';

const NEW_IN_LATER_MIGRATIONS = ['users', 'customer_managers', 'audit_log', 'customers', 'price_lists', 'sqlite_sequence', 'sync_meta'];

function dump(db: Database.Database): Record<string, string> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  const out: Record<string, string> = {};
  for (const { name } of tables) out[name] = JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all());
  return out;
}

run(async () => {
  const tmp = setupTemp('epl-check-a-');
  const settingsFile = path.join(stub.__state.userData, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ lastDbPath: 'C:/old/path.db', somethingElse: 1 }));
  registerAllIpcHandlers();
  console.log(`schema ${SCHEMA_VERSION}`);

  check('settings:get / settings:set channels removed', !handlers.has('settings:get') && !handlers.has('settings:set'));
  check('auth:whoami / prefs:* / settings:get-logo registered',
    ['auth:whoami', 'prefs:get', 'prefs:set', 'settings:get-logo'].every(c => handlers.has(c)));

  // 1. Existing databases: opening migrates without changing other data; a second open writes nothing.
  for (const name of SAMPLE_DBS) {
    const copy = path.join(tmp, name);
    fs.copyFileSync(sample(name), copy);
    const raw = new Database(copy, { readonly: true });
    const before = dump(raw);
    raw.close();
    const r = await invoke('db:open', copy);
    check(`[${name}] db:open ok`, r.ok === true, r);
    const after = dump(getDb());
    const changed = Object.keys({ ...before, ...after }).filter(t => !NEW_IN_LATER_MIGRATIONS.includes(t) && before[t] !== after[t]);
    check(`[${name}] no other table content changed by open`, changed.length === 0, changed);
    check(`[${name}] db:get-path returns the open path`, (await invoke('db:get-path')) === copy);
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    check(`[${name}] settings.json lastDbPath updated, other keys kept`, s.lastDbPath === copy && s.somethingElse === 1, s);
    closeDatabase();
    check(`[${name}] user_version = ${SCHEMA_VERSION} after open`, userVersion(copy) === SCHEMA_VERSION, userVersion(copy));
    const h1 = sha(copy);
    const m1 = fs.statSync(copy).mtimeMs;
    await sleep(1100);
    openDatabase(copy, { skipBackup: true });
    closeDatabase();
    check(`[${name}] re-open leaves the file byte-identical and mtime unchanged`, sha(copy) === h1 && fs.statSync(copy).mtimeMs === m1);
  }

  // 2. A database from a newer app version is refused without being touched.
  const newer = path.join(tmp, 'newer.db');
  fs.copyFileSync(sample(SAMPLE_DBS[0]), newer);
  { const d = new Database(newer); d.pragma('journal_mode = DELETE'); d.pragma('user_version = 99'); d.close(); }
  const hN = sha(newer);
  const rN = await invoke('db:open', newer);
  check('newer schema refused with update message', rN.ok === false && /newer version of EPL Tool/.test(rN.error), rN);
  check('newer schema: lastOpenError.corrupt is false', getLastOpenError()?.corrupt === false, getLastOpenError());
  check('newer schema: file untouched', sha(newer) === hN && userVersion(newer) === 99);

  // 3. A new database is created at the current schema, with the seeds.
  const fresh = path.join(tmp, 'fresh.db');
  openDatabase(fresh, { create: true });
  const cols = (getDb().prepare("SELECT sql FROM sqlite_master WHERE name='customers'").get() as any).sql as string;
  const units = (getDb().prepare('SELECT name FROM units ORDER BY name').all() as any[]).map(r => r.name).join(',');
  const curr = (getDb().prepare('SELECT code, is_main FROM currencies ORDER BY code').all() as any[]).map(r => `${r.code}:${r.is_main}`).join(',');
  getDb().prepare("DELETE FROM units WHERE name = '100 L'").run();
  closeDatabase();
  openDatabase(fresh, { skipBackup: true });
  const units2 = (getDb().prepare('SELECT count(*) n FROM units').get() as any).n;
  closeDatabase();
  check('fresh DB seeded units + main currencies', units === '100 KG,100 L' && curr === 'EUR:1,USD:1', { units, curr });
  check('deleted seed unit re-added on open (unchanged behaviour)', units2 === 2, units2);
  check('fresh DB stamped current schema', userVersion(fresh) === SCHEMA_VERSION);
  check('fresh DB has region + is_deleted columns', cols.includes('main_supply_region') && cols.includes('is_deleted'));

  // 4. user_version set inside a failed transaction is rolled back (the numbered migration runner relies on it).
  {
    const d = new Database(path.join(tmp, 'tx.db'));
    d.pragma('user_version = 6');
    try {
      d.transaction(() => { d.exec('CREATE TABLE x (a)'); d.pragma('user_version = 7'); throw new Error('boom'); })();
    } catch { /* expected */ }
    const v = d.pragma('user_version', { simple: true });
    const x = d.prepare("SELECT count(*) n FROM sqlite_master WHERE name='x'").get() as any;
    d.close();
    check('failed migration rolls back user_version and DDL', v === 6 && x.n === 0, { v, x });
  }

  // 5. customers:update allow-list (the first-admin bootstrap makes the current Windows user an admin).
  const work = path.join(tmp, 'work', 'EPL-Database.db');
  fs.mkdirSync(path.dirname(work));
  fs.copyFileSync(sample(SAMPLE_DBS[0]), work);
  await invoke('db:open', work);
  const cust = getDb().prepare('SELECT * FROM customers ORDER BY id LIMIT 1').get() as any;
  const ref = cust.customer_ref_sap;
  await expectError('update rejects is_deleted', () => invoke('customers:update', ref, { is_deleted: 1 }), /can't be changed here: is_deleted/);
  await expectError('update rejects customer_ref_sap / id', () => invoke('customers:update', ref, { id: 5, customer_ref_sap: 'X' }), /id, customer_ref_sap/);
  await expectError('update rejects last_price_list_id', () => invoke('customers:update', ref, { last_price_list_id: 'X' }), /last_price_list_id/);
  await expectError('update rejects empty short name', () => invoke('customers:update', ref, { customer_short_name: '  ' }), /Short name is required/);
  await expectError('update rejects non-string value', () => invoke('customers:update', ref, { country: 123 }), /Invalid value for country/);
  await expectError('update rejects unknown customer', () => invoke('customers:update', 'NO-SUCH-REF', { country: 'X' }), /Customer NO-SUCH-REF not found/);
  await expectError('update rejects non-object', () => invoke('customers:update', ref, ['x']), /Invalid customer update/);
  const upd = await invoke('customers:update', ref, { country: 'TESTLAND', email_internal_copy: null });
  const others = Object.keys(cust).filter(k => !['country', 'email_internal_copy'].includes(k) && cust[k] !== upd[k]);
  check('allowed update applies and leaves other fields', upd.country === 'TESTLAND' && upd.email_internal_copy === null && others.length === 0, others);
  check('empty update returns the customer', (await invoke('customers:update', ref, {})).customer_ref_sap === ref);

  // 6. Logo stored in the DB; legacy path dropped; exports from a copy on "another PC" contain the image.
  const png = path.join(tmp, 'logo.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const txt = path.join(tmp, 'logo.txt');
  fs.writeFileSync(txt, 'x');
  const big = path.join(tmp, 'big.png');
  fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 1));
  stub.__state.nextOpen = txt;
  check('select-logo rejects non-image', /PNG, JPEG or GIF/.test((await invoke('settings:select-logo')).error ?? ''));
  stub.__state.nextOpen = big;
  check('select-logo rejects > 1 MB', /smaller than 1 MB/.test((await invoke('settings:select-logo')).error ?? ''));
  stub.__state.nextOpen = png;
  const sel = await invoke('settings:select-logo');
  check('select-logo stores a PNG data URL', sel.ok === true && sel.dataUrl.startsWith('data:image/png;base64,'), sel);
  const logoAfter = await invoke('settings:get-logo');
  const legacyRow = getDb().prepare("SELECT count(*) n FROM app_settings WHERE key='logo_path'").get() as any;
  check('get-logo returns data URL, legacy path removed', logoAfter.dataUrl === sel.dataUrl && logoAfter.legacyPath === null && legacyRow.n === 0);
  closeDatabase();
  fs.unlinkSync(png);
  const otherPc = path.join(tmp, 'otherPC', 'EPL-Database.db');
  fs.mkdirSync(path.dirname(otherPc));
  fs.copyFileSync(work, otherPc);
  openDatabase(otherPc, { skipBackup: true });
  const pl = getDb().prepare(`
    SELECT pl.price_list_id FROM price_lists pl JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
    ORDER BY pl.created_at DESC LIMIT 1
  `).get() as any;
  const outDir = path.join(tmp, 'exports');
  fs.mkdirSync(outDir);
  stub.__state.nextOpen = outDir;
  const hBefore = sha(otherPc);
  const ex = await invoke('export:xlsx-bulk', [pl.price_list_id]);
  check('export on other PC succeeded', !!ex.results?.[0]?.filename && !ex.results[0].error, ex);
  check('export does not change the database file', sha(otherPc) === hBefore);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(outDir, ex.results[0].filename));
  const media = (wb as any).model.media ?? [];
  check('exported workbook contains the logo image anchored on the sheet',
    media.length === 1 && media[0].extension === 'png' && wb.worksheets[0].getImages().length === 1, { media: media.length });

  // 7. Per-user email templates live in settings.json, not in the DB.
  const hPrefs = sha(otherPc);
  await invoke('prefs:set', 'emailSubjectTemplate', 'Hello {customer}');
  check('prefs:get returns saved template', (await invoke('prefs:get', 'emailSubjectTemplate')) === 'Hello {customer}');
  check('prefs:get unset key → null', (await invoke('prefs:get', 'emailBodyTemplate')) === null);
  const s2 = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  check('settings.json keeps lastDbPath next to prefs', s2.prefs?.emailSubjectTemplate === 'Hello {customer}' && typeof s2.lastDbPath === 'string', s2);
  await expectError('prefs:set refuses lastDbPath', () => invoke('prefs:set', 'lastDbPath', 'x'), /Unknown preference/);
  await expectError('prefs:get refuses unknown key', () => invoke('prefs:get', 'foo'), /Unknown preference/);
  await expectError('prefs:set refuses non-string', () => invoke('prefs:set', 'emailBodyTemplate', 5), /Invalid preference value/);
  check('saving a template does not change the database file', sha(otherPc) === hPrefs);
  closeDatabase();

  // 8. Identity (UPN and OneDrive only exist on Windows work PCs).
  const id = await detectIdentity({ allowOverride: false });
  check('identity: Windows account = os user', id.account === os.userInfo().username, id);
  if (process.platform === 'win32' && id.email) {
    check('identity: email from whoami /upn', id.emailSource === 'upn' && /@/.test(id.email), id);
    const od = await oneDriveEmail();
    check('identity: OneDrive fallback finds the same work email (or none)', od === null || od === id.email, od);
  } else {
    console.log('      (UPN / OneDrive identity checks skipped: no work email on this machine)');
  }
  const ov = await detectIdentity({ allowOverride: true, env: { EPL_DEV_EMAIL: 'Test.User-Name@Example.com' } });
  check('dev override (email only) → account null, hint derived',
    ov.overridden && ov.account === null && ov.email === 'test.user-name@example.com' && ov.displayNameHint === 'Test User-Name', ov);
  const ov2 = await detectIdentity({ allowOverride: false, env: { EPL_DEV_ACCOUNT: 'X1', EPL_DEV_EMAIL: 'a@b.com' } });
  check('override ignored when not allowed (packaged)', !ov2.overridden && ov2.account === id.account, ov2);
  const who = await invoke('auth:whoami');
  check('auth:whoami returns identity', who.account === id.account && who.email === id.email);

  finish(tmp);
});
