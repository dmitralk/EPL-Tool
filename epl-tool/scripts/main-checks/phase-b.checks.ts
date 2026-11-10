/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase B (v0.6 access rights): Migration 7 + first-admin bootstrap, the IPC guard, Admin / User / Viewer / unknown /
// deactivated rules, Preview as…, email skip-reporting, activity log entries, restore from the damaged-database screen.
// People are simulated with the development identity override (EPL_DEV_ACCOUNT / EPL_DEV_EMAIL).
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { registerAllIpcHandlers } from '../../src/main/ipc/index';
import { declaredChannels } from '../../src/main/ipc/guard';
import { closeDatabase, getDb, openDatabase, SCHEMA_VERSION } from '../../src/main/database';
import { getIdentity, initIdentity } from '../../src/main/auth';
import {
  SAMPLE_DBS, allowed, check, expectError, finish, handlers, invoke, run, sample, setupTemp, sha, stub,
} from './harness';

async function signInAs(account: string | null, email: string | null) {
  delete process.env.EPL_DEV_ACCOUNT;
  delete process.env.EPL_DEV_EMAIL;
  if (account) process.env.EPL_DEV_ACCOUNT = account;
  if (email) process.env.EPL_DEV_EMAIL = email;
  initIdentity({ allowOverride: !!(account || email) });
  return getIdentity();
}

const lastAudit = () => getDb().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get() as any;

const priceList = (ref: string, version: string) => ({
  customer_ref_sap: ref, sap_plant: '', effective: '2031-01-01', mailing_date: '2030-12-01', price_list_version: version,
  comments_about_changes: '', price_type: 'Net Price', discount_percent: null,
  entries: [{ product_type: 'T', rip_code: 'R1', product_name: 'P', net_price: 1, currency: 'USD', unit: '100 L' }],
});

run(async () => {
  const tmp = setupTemp('epl-check-b-');
  registerAllIpcHandlers();
  console.log(`schema ${SCHEMA_VERSION}`);

  // ── Guard ──
  const decl = declaredChannels();
  check('every registered channel has a rule', [...handlers.keys()].every(c => decl.has(c)) && decl.size === handlers.size, decl.size);
  let threw = false;
  try { stub.ipcMain.handle('x:y', () => 1); } catch { threw = true; }
  check('direct ipcMain.handle is refused', threw);
  for (const gone of ['customers:delete', 'packaging:update-price', 'export:open-mail-with-attachment', 'fx:set', 'settings:get', 'settings:set']) {
    check(`removed channel ${gone}`, !handlers.has(gone));
  }
  const publicOnes = [...decl].filter(([, r]) => r.rule === 'public').map(([c]) => c).sort();
  check('public channels are only db:*, auth:*, sync:* and backup recovery',
    publicOnes.every(c => /^(db|auth|sync):/.test(c) || ['backup:list', 'backup:open-folder', 'backup:restore'].includes(c)), publicOnes);
  // Exceptions: channels that don't change the database (moving a reviewed conflict copy to EPL-Conflicts/archive/).
  const NOT_WRITING_ON_PURPOSE = ['conflicts:archive'];
  const notWriting = [...decl].filter(([c, r]) => (r.rule === 'editor' || r.rule === 'admin') && !r.writes &&
    !NOT_WRITING_ON_PURPOSE.includes(c)).map(([c]) => c);
  check('every editor/admin channel is refused on a read-only copy (writes flag)', notWriting.length === 0, notWriting);

  // ── Migration 7 on copies of both sample databases ──
  const realId = await signInAs(null, null);
  for (const name of SAMPLE_DBS) {
    const copy = path.join(tmp, 'm7', name);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(sample(name), copy);
    const raw = new Database(copy, { readonly: true });
    const rawVersion = raw.pragma('user_version', { simple: true }) as number;
    const custBefore = raw.prepare('SELECT * FROM customers ORDER BY id').all() as any[];
    const plBefore = raw.prepare('SELECT * FROM price_lists ORDER BY id').all() as any[];
    const otherTables = ['products', 'standard_epl', 'standard_epl_versions', 'packaging', 'price_list_entries', 'admin_emails', 'units', 'currencies', 'fx_rates'];
    const othersBefore = Object.fromEntries(otherTables.map(t => [t, JSON.stringify(raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())]));
    raw.close();
    if (rawVersion >= 7) console.log(`      [${name}] already at schema ${rawVersion}: migration checks are about later steps only`);
    const r = await invoke('db:open', copy);
    check(`[${name}] opens`, r.ok, r);
    const db = getDb();
    check(`[${name}] user_version = ${SCHEMA_VERSION}`, db.pragma('user_version', { simple: true }) === SCHEMA_VERSION);
    const custAfter = db.prepare('SELECT * FROM customers ORDER BY id').all() as any[];
    const cols = (db.prepare('PRAGMA table_info(customers)').all() as any[]).map(c => c.name);
    check(`[${name}] price_list_managed_by dropped, pricing_mode added`, !cols.includes('price_list_managed_by') && cols.includes('pricing_mode'));
    if (rawVersion < 7) {
      check(`[${name}] all ${custAfter.length} customers are Managed by PBP`, custAfter.every(c => c.pricing_mode === 'pbp'));
      const sameCust = custBefore.every((c, i) => Object.keys(c).filter(k => k !== 'price_list_managed_by').every(k => c[k] === custAfter[i][k]));
      check(`[${name}] customer data otherwise unchanged`, sameCust && custBefore.length === custAfter.length);
      const plAfter = db.prepare('SELECT * FROM price_lists ORDER BY id').all() as any[];
      check(`[${name}] price lists unchanged, created_by NULL`, plBefore.length === plAfter.length &&
        plAfter.every((p, i) => p.created_by_user_id === null && Object.keys(plBefore[i]).every(k => plBefore[i][k] === p[k])));
      const users = db.prepare('SELECT * FROM users').all() as any[];
      check(`[${name}] bootstrap: current Windows user is the only (admin) user`, users.length === 1 && users[0].role === 'admin' &&
        users[0].account === realId.account && users[0].email === realId.email, users);
      check(`[${name}] bootstrap is in the activity log`, lastAudit()?.action === 'user.bootstrap');
    }
    const othersChanged = otherTables.filter(t => othersBefore[t] !== JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    check(`[${name}] other tables unchanged`, othersChanged.length === 0, othersChanged);
    check(`[${name}] FK check clean`, (db.pragma('foreign_key_check') as any[]).length === 0);
    closeDatabase();
    const h = sha(copy);
    openDatabase(copy, { skipBackup: true });
    closeDatabase();
    check(`[${name}] re-open leaves the file byte-identical`, sha(copy) === h);
  }

  // ── Working copy for the rules ──
  const work = path.join(tmp, 'work', 'EPL-Database.db');
  fs.mkdirSync(path.dirname(work), { recursive: true });
  fs.copyFileSync(sample(SAMPLE_DBS[0]), work);
  await invoke('db:open', work);
  const me = await invoke('auth:me');
  check('auth:me: real admin, not previewing', me.user?.role === 'admin' && !me.previewing && me.admins.length === 1, me);
  const [A, B, C] = getDb().prepare(`
    SELECT customer_ref_sap, customer_short_name, currency FROM customers WHERE is_deleted = 0 ORDER BY id LIMIT 3
  `).all() as any[];
  if (!C) throw new Error('The sample database needs at least 3 active customers for these checks.');
  const anna = await invoke('users:create', { display_name: 'Anna Test', email: 'anna.test@example.com', account: 'TA001', role: 'user' });
  const ben = await invoke('users:create', { display_name: 'Ben Test', email: 'ben.test@example.com', role: 'user' });
  const vic = await invoke('users:create', { display_name: 'Vic Viewer', email: 'vic.viewer@example.com', role: 'viewer' });
  await expectError('duplicate email refused', () => invoke('users:create', { display_name: 'X', email: 'ANNA.TEST@example.com', role: 'user' }), /already has the email/);
  await expectError('viewer cannot manage a customer', () => invoke('customers:set-access', A.customer_ref_sap, { pricing_mode: 'managed', manager_ids: [vic.id] }), /can't manage customers/);
  await allowed('admin: A managed by Anna', () => invoke('customers:set-access', A.customer_ref_sap, { pricing_mode: 'managed', manager_ids: [anna.id] }));
  await allowed('admin: B open', () => invoke('customers:set-access', B.customer_ref_sap, { pricing_mode: 'open', manager_ids: [] }));
  check('access change audited for the customer', lastAudit().action === 'customer.access' && lastAudit().customer_ref_sap === B.customer_ref_sap);
  const custA = await invoke('customers:get', A.customer_ref_sap);
  check('customers:get returns managers', custA.pricing_mode === 'managed' && custA.manager_ids[0] === anna.id && custA.manager_names[0] === 'Anna Test');
  await expectError('last admin cannot be demoted', () => invoke('users:update', me.user.id, { role: 'user' }), /at least one active admin/);
  await expectError('last admin cannot be deactivated', () => invoke('users:update', me.user.id, { is_active: 0 }), /at least one active admin/);
  getDb().prepare("UPDATE customers SET email_to_customer = 'shared.x@example.com' WHERE customer_ref_sap IN (?, ?)").run(A.customer_ref_sap, C.customer_ref_sap);

  // ── As Anna (User): manages A, B is Open, C is Managed by PBP ──
  await signInAs('TA001', 'anna.test@example.com');
  const annaMe = await invoke('auth:me');
  check('Anna recognised, manages A', annaMe.user?.id === anna.id && annaMe.managedCustomerRefs.includes(A.customer_ref_sap));
  const beforeId = (getDb().prepare('SELECT MAX(id) m FROM audit_log').get() as any).m;
  const created = await allowed('Anna creates a price list for A (manages it)', () => invoke('price-lists:create', priceList(A.customer_ref_sap, 'TEST-A')));
  check('created_by = Anna; audited', created?.created_by_name === 'Anna Test' && lastAudit().action === 'price_list.create' && lastAudit().user_label === 'Anna Test (TA001)');
  await allowed('Anna creates a price list for B (Open)', () => invoke('price-lists:create', priceList(B.customer_ref_sap, 'TEST-B')));
  await expectError('Anna refused for C (PBP)', () => invoke('price-lists:create', priceList(C.customer_ref_sap, 'TEST-C')), /managed by PBP: only admins/);
  const cList = getDb().prepare('SELECT price_list_id FROM price_lists WHERE customer_ref_sap = ? LIMIT 1').get(C.customer_ref_sap) as any;
  if (cList) {
    const cCount = () => (getDb().prepare('SELECT COUNT(*) n FROM price_list_entries WHERE price_list_id = ?').get(cList.price_list_id) as any).n;
    const before = cCount();
    const crafted = priceList(B.customer_ref_sap, 'TEST-CRAFTED');
    (crafted.entries[0] as any).price_list_id = cList.price_list_id;
    await allowed('crafted entry price_list_id is ignored (list on B created)', () => invoke('price-lists:create', crafted));
    check('no line was injected into a PBP customer\'s list', cCount() === before, { before, after: cCount() });
  }
  getDb().prepare(`INSERT INTO price_lists (price_list_id, customer_ref_sap, effective, mailing_date, price_list_version, price_type)
    VALUES ('ORPHAN-1', 'NO-SUCH-CUSTOMER', '2020-01-01', '2020-01-01', 'V1', 'Net Price')`).run();
  await expectError('Anna cannot delete an orphaned list', () => invoke('price-lists:delete', 'ORPHAN-1'), /Only admins can delete price lists of customers that no longer exist/);
  await allowed('Anna updates A master data', () => invoke('customers:update', A.customer_ref_sap, { country: 'Testland' }));
  await expectError('Anna cannot update C', () => invoke('customers:update', C.customer_ref_sap, { country: 'X' }), /managed by PBP/);
  await expectError('Anna cannot hide B (open, not manager)', () => invoke('customers:soft-delete', B.customer_ref_sap), /Only admins and the managers/);
  await expectError('Anna cannot change B mode (open)', () => invoke('customers:set-access', B.customer_ref_sap, { pricing_mode: 'managed', manager_ids: [anna.id] }), /Open customer/);
  await allowed('Anna adds Ben as co-manager of A', () => invoke('customers:set-access', A.customer_ref_sap, { pricing_mode: 'managed', manager_ids: [anna.id, ben.id] }));
  await expectError('Anna cannot remove all managers', () => invoke('customers:set-access', A.customer_ref_sap, { pricing_mode: 'managed', manager_ids: [] }), /at least one manager/);
  await expectError('Anna cannot restore customers', () => invoke('customers:restore', C.customer_ref_sap), /Only admins can restore/);
  await expectError('Anna cannot change products', () => invoke('products:create', { plant: null, product_type: 'X', rip_code: 'X', product_name: 'X' }), /Only admins can change products/);
  await expectError('Anna cannot set default FX', () => invoke('fx:set-defaults', [{ currency_code: 'EUR', rate_to_usd: 2 }]), /default FX/);
  await expectError('Anna cannot manage users', () => invoke('users:create', { display_name: 'Z', email: 'z@x.com', role: 'user' }), /Only admins can manage users/);
  await expectError('Anna cannot create EPL drafts', () => invoke('standard-epl:create-draft', { sourceVersionId: 1, versionName: 'x' }), /Standard EPL/);
  await expectError('Anna cannot back up', () => invoke('backup:create'), /Only admins can back up/);
  const rep = await invoke('emails:replace', 'shared.x@example.com', 'shared.y@example.com');
  check('Anna replaces an email: A changed, C skipped', rep.updated === 1 && rep.skipped.length === 1 && rep.skipped[0].customer_ref_sap === C.customer_ref_sap, rep);
  const set = await invoke('emails:set-assignments', 'new.z@example.com', [
    { customer_ref_sap: A.customer_ref_sap, to: false, internal: true }, { customer_ref_sap: C.customer_ref_sap, to: false, internal: true }]);
  check('Anna assigns an email: A only, C reported', set.updated === 1 && set.skipped.length === 1, set);
  const packagingVersion = (getDb().prepare('SELECT packaging_version FROM packaging LIMIT 1').get() as any).packaging_version;
  const newCust = await allowed('Anna creates a customer', () => invoke('customers:create', {
    customer_ref_sap: 'TEST-NEW-1', customer_short_name: 'Test New', customer_full_name: 'Test New Ltd', currency: A.currency,
    packaging_version: packagingVersion, pricing_mode: 'open' }));
  check('new customer is managed by Anna (mode input ignored) with PBP emails filled',
    newCust?.pricing_mode === 'managed' && newCust.manager_ids.join() === String(anna.id) && newCust.email_pbp_common !== null, newCust);
  await expectError('duplicate SAP ref refused', () => invoke('customers:create', {
    customer_ref_sap: 'test-new-1', customer_short_name: 'a', customer_full_name: 'b', currency: 'USD', packaging_version: packagingVersion }), /already exists/);
  await allowed('Anna hides her new customer', () => invoke('customers:soft-delete', 'TEST-NEW-1'));
  const annaActions = (getDb().prepare('SELECT action FROM audit_log WHERE id > ? ORDER BY id').all(beforeId) as any[]).map(r => r.action);
  const expectedAnna = ['price_list.create', 'price_list.create', ...(cList ? ['price_list.create'] : []),
    'customer.update', 'customer.access', 'email.replace', 'email.assign', 'customer.create', 'customer.hide'];
  check('every Anna change is audited', annaActions.join() === expectedAnna.join(), annaActions);
  await allowed('Anna deletes her price list on A', () => invoke('price-lists:delete', created?.price_list_id));

  // ── As Vic (Viewer) ──
  await signInAs(null, 'vic.viewer@example.com');
  await allowed('Vic lists customers', () => invoke('customers:list'));
  await allowed('Vic reads the activity log', () => invoke('audit:list', { customerRef: A.customer_ref_sap }));
  await allowed('Vic saves his email template (local)', () => invoke('prefs:set', 'emailSubjectTemplate', 'Hi'));
  await expectError('Vic cannot create price lists', () => invoke('price-lists:create', priceList(B.customer_ref_sap, 'TEST-V')), /Viewers can only view and export/);
  await expectError('Vic cannot change emails', () => invoke('emails:remove', 'shared.y@example.com'), /Viewers can only view/);
  await expectError('Vic cannot create customers', () => invoke('customers:create', {}), /Viewers can only view/);
  const outDir = path.join(tmp, 'exports');
  fs.mkdirSync(outDir);
  stub.__state.nextOpen = outDir;
  const vicPl = getDb().prepare('SELECT pl.price_list_id FROM price_lists pl JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap LIMIT 1').get() as any;
  const ex = await allowed('Vic exports a price list', () => invoke('export:xlsx-bulk', [vicPl.price_list_id]));
  check('export produced a file', !!ex?.results?.[0]?.filename && !ex.results[0].error, ex);
  check('email-only user: account not invented when the Windows account is unknown',
    (getDb().prepare('SELECT account FROM users WHERE id = ?').get(vic.id) as any).account === null);

  // ── A user added by email signs in with a Windows account ──
  await signInAs('TB002', 'ben.test@example.com');
  const benMe = await invoke('auth:me');
  check('Ben recognised by email; account recorded + audited', benMe.user?.id === ben.id &&
    (getDb().prepare('SELECT account FROM users WHERE id = ?').get(ben.id) as any).account === 'TB002' &&
    !!getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'user.link-account' AND user_id = ?").get(ben.id));

  // ── Unknown person ──
  await signInAs('TX999', 'nobody@example.com');
  const nobody = await invoke('auth:me');
  check('unknown: auth:me has no user, lists admins', nobody.user === null && nobody.dbOpen && nobody.admins.length === 1, nobody);
  await expectError('unknown: customers:list refused', () => invoke('customers:list'), /do not have access/);
  await expectError('unknown: prefs refused', () => invoke('prefs:get', 'emailBodyTemplate'), /do not have access/);
  await allowed('unknown: db:is-open allowed', () => invoke('db:is-open'));
  await allowed('unknown: request access opens a draft', () => invoke('auth:request-access'));
  const mail = stub.__state.opened[stub.__state.opened.length - 1] as string;
  check('request-access mail goes to admins with identity', /^mailto:.+@.+\?subject=/.test(mail) && mail.includes('TX999'));

  // ── Admin: preview, deactivate, orphan delete, create, default FX, audit filters ──
  await signInAs(null, null);
  await allowed('admin previews as Vic', () => invoke('auth:preview-start', vic.id));
  const pv = await invoke('auth:me');
  check('preview: effective user is Vic', pv.previewing && pv.user.id === vic.id && pv.realUser.role === 'admin');
  await expectError('preview as Vic: products refused', () => invoke('products:delete', 1), /Only admins can change products/);
  await invoke('auth:preview-stop');
  await allowed('admin previews as Anna', () => invoke('auth:preview-start', anna.id));
  await allowed('preview as Anna: B price list allowed', () => invoke('price-lists:create', priceList(B.customer_ref_sap, 'TEST-PV')));
  check('preview action logged as "<admin> as Anna"', / as Anna Test$/.test(lastAudit().user_label) && lastAudit().user_id === me.user.id, lastAudit().user_label);
  await expectError('preview as Anna: C refused', () => invoke('price-lists:create', priceList(C.customer_ref_sap, 'TEST-PV2')), /managed by PBP/);
  await invoke('auth:preview-stop');
  await allowed('admin deactivates Anna', () => invoke('users:update', anna.id, { is_active: 0 }));
  await signInAs('TA001', 'anna.test@example.com');
  await expectError('deactivated Anna has no access', () => invoke('customers:list'), /do not have access/);
  await signInAs(null, null);
  await allowed('admin deletes an orphaned list', () => invoke('price-lists:delete', 'ORPHAN-1'));
  check('orphan delete audited', lastAudit().action === 'price_list.delete' && /NO-SUCH-CUSTOMER/.test(lastAudit().summary), lastAudit().summary);
  const cr = await allowed('admin creates an Open customer', () => invoke('customers:create', {
    customer_ref_sap: 'TEST-NEW-2', customer_short_name: 'Open Co', customer_full_name: 'Open Co Ltd', currency: A.currency,
    packaging_version: packagingVersion, pricing_mode: 'open' }));
  check('admin chooses the mode', cr?.pricing_mode === 'open');
  await allowed('admin saves default FX', () => invoke('fx:set-defaults', [{ currency_code: 'EUR', rate_to_usd: 1.11 }]));
  check('FX default audited', lastAudit().action === 'fx.default' && /EUR .* 1\.11/.test(lastAudit().summary), lastAudit().summary);
  const act = await invoke('audit:list', { customerRef: A.customer_ref_sap });
  check('customer History has entries', act.total >= 4 && act.entries.every((e: any) => e.customer_ref_sap === A.customer_ref_sap), act.total);
  const act2 = await invoke('audit:list', { action: 'price_list.' });
  check('action prefix filter', act2.entries.length >= 3 && act2.entries.every((e: any) => e.action.startsWith('price_list.')));

  // ── Restore from the damaged-database screen: decided by the backup's own user list ──
  closeDatabase();
  await invoke('db:open', work);                 // the startup backup now contains the user list
  closeDatabase();
  const backupDir = path.join(path.dirname(work), 'EPL-Backups');
  const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort();
  const backup = path.join(backupDir, backups[backups.length - 1]);
  const buf = fs.readFileSync(work);
  buf.fill(0x41, 4096, 4096 * 6);
  fs.writeFileSync(work, buf);
  const bad = await invoke('db:open', work);
  check('damaged database refused', bad.ok === false, bad);
  await signInAs('TB002', 'ben.test@example.com');
  const r1 = await invoke('backup:restore', backup);
  check('non-admin cannot restore on the damaged-DB screen', r1.ok === false && /not an active admin in this backup/.test(r1.error), r1);
  await signInAs(null, null);
  const r2 = await invoke('backup:restore', backup);
  check('admin (per the backup) restores', r2.ok === true, r2);
  check('restore is audited in the restored DB', lastAudit().action === 'backup.restore');
  closeDatabase();

  finish(tmp);
});
