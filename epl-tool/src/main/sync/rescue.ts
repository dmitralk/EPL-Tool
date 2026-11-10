import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../database';
import { getCustomerAccess } from '../customerAccess';
import { createPriceList, duplicatePriceListMessage, findDuplicatePriceList } from '../priceLists';
import { customerChangeError } from '../../shared/permissions';
import type { CentralStore } from './centralStore';
import { localConflictsDir } from './paths';
import type {
  AppUser, ConflictAnalysis, ConflictChange, ConflictCopyInfo, ConflictPriceList, ConflictRow, ConflictTableDiff,
  CreatePriceListInput, ReapplyResult, SyncPublishInfo,
} from '../../types';

// The rescue tool (multi-user study §5.7, dev-plan Phase D decision 8): copies of unpublished work — EPL-Conflicts/ (refused
// publish, lost edit slot), OneDrive conflict copies of the shared database, and copies kept on this PC when the shared
// folder could not take them. A copy is always read through a temporary copy on this PC (the shared folder is never opened
// with SQLite) and compared with the open database: price lists to re-apply, activity that isn't in the shared database, and
// the rows that differ.

const MAX_ROWS = 50;            // rows listed per table and kind (the counts are complete)
const MAX_ACTIVITY = 200;
const MAX_VALUE = 120;          // characters shown per value (e.g. the logo is a long data URL)

interface OpenCopy {
  info: Omit<ConflictCopyInfo, 'error' | 'basedOn' | 'lastChange'>;
  db: Database.Database;
  dispose(): void;
}

const isLocalCopy = (store: CentralStore, file: string) =>
  path.resolve(path.dirname(file)).toLowerCase() === path.resolve(localConflictsDir()).toLowerCase() &&
  path.basename(file).toLowerCase().startsWith(`${path.parse(store.dbPath).name.toLowerCase()}_`) &&
  file.toLowerCase().endsWith('.db');

async function localCopies(store: CentralStore): Promise<string[]> {
  try {
    const dir = localConflictsDir();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => path.join(dir, e.name)).filter(f => isLocalCopy(store, f)).sort();
  } catch {
    return [];
  }
}

// Every copy to review, with its source.
async function allCopies(store: CentralStore): Promise<{ file: string; source: ConflictCopyInfo['source'] }[]> {
  return [
    ...(await store.listConflictsFolder()).map(file => ({ file, source: 'conflicts' as const })),
    ...(await store.findConflictCopies()).map(file => ({ file, source: 'onedrive' as const })),
    ...(await localCopies(store)).map(file => ({ file, source: 'local' as const })),
  ];
}

export async function countConflictCopies(store: CentralStore): Promise<number> {
  return (await allCopies(store)).length;
}

function removeTemp(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

// Opens a conflict copy through a temporary copy on this PC; refuses files that are not conflict copies of this database.
async function openCopy(store: CentralStore, file: string): Promise<OpenCopy> {
  const target = path.resolve(String(file ?? '')).toLowerCase();
  const found = (await allCopies(store)).find(c => path.resolve(c.file).toLowerCase() === target);
  if (!found) throw new Error('This file is not a conflict copy of the shared database.');
  const stat = await fsp.stat(found.file);
  const tmp = path.join(os.tmpdir(), `epl-rescue-${crypto.randomBytes(6).toString('hex')}.db`);
  if (found.source === 'local') await fsp.copyFile(found.file, tmp);
  else await store.copyConflictCopy(found.file, tmp);
  let db: Database.Database;
  try {
    db = new Database(tmp, { readonly: true, fileMustExist: true });
  } catch (e) {
    removeTemp(tmp);
    throw e;
  }
  return {
    info: { file: found.file, name: path.basename(found.file), source: found.source, size: stat.size, modifiedAt: stat.mtime.toISOString() },
    db,
    dispose() {
      try { db.close(); } catch { /* ignore */ }
      removeTemp(tmp);
    },
  };
}

const hasTable = (db: Database.Database, name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

const columnsOf = (db: Database.Database, table: string) =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name));

function publishInfoOf(db: Database.Database): SyncPublishInfo | null {
  if (!hasTable(db, 'sync_meta')) return null;
  const m = db.prepare('SELECT generation, published_by, published_at FROM sync_meta WHERE id = 1').get() as
    { generation: number; published_by: string | null; published_at: string | null } | undefined;
  return m ? { generation: m.generation, publishedBy: m.published_by, publishedAt: m.published_at } : null;
}

function readableError(db: Database.Database): string | null {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION) return 'This copy was made by a newer EPL Tool: update EPL Tool to review it.';
  if (!hasTable(db, 'price_lists') || !hasTable(db, 'customers')) return 'This file is not an EPL Tool database.';
  const check = db.pragma('quick_check', { simple: true });
  return check === 'ok' ? null : 'This copy is damaged (it failed the integrity check).';
}

function describe(copy: OpenCopy): ConflictCopyInfo {
  const error = readableError(copy.db);
  if (error) return { ...copy.info, error, basedOn: null, lastChange: null };
  const last = hasTable(copy.db, 'audit_log')
    ? copy.db.prepare("SELECT at, user_label, summary FROM audit_log WHERE action <> 'sync.publish' ORDER BY id DESC LIMIT 1")
      .get() as { at: string; user_label: string; summary: string } | undefined
    : undefined;
  return {
    ...copy.info, error: null, basedOn: publishInfoOf(copy.db),
    lastChange: last ? { at: last.at, by: last.user_label, summary: last.summary } : null,
  };
}

export async function listConflictCopies(store: CentralStore): Promise<ConflictCopyInfo[]> {
  const out: ConflictCopyInfo[] = [];
  for (const c of await allCopies(store)) {
    let copy: OpenCopy | null = null;
    try {
      copy = await openCopy(store, c.file);
      out.push(describe(copy));
    } catch (e) {
      const stat = await fsp.stat(c.file).catch(() => null);
      out.push({
        file: c.file, name: path.basename(c.file), source: c.source, size: stat?.size ?? 0,
        modifiedAt: (stat?.mtime ?? new Date(0)).toISOString(), error: `This copy can't be read: ${(e as Error).message}`,
        basedOn: null, lastChange: null,
      });
    } finally {
      copy?.dispose();
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

// ── Review ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface CopyPriceList {
  price_list_id: string;
  customer_ref_sap: string;
  sap_plant: string | null;
  effective: string;
  mailing_date: string;
  price_list_version: string;
  comments_about_changes: string | null;
  price_type: CreatePriceListInput['price_type'];
  discount_percent: number | null;
  created_at: string | null;
  created_by: string | null;
  entries: number;
}

function copyPriceLists(db: Database.Database): CopyPriceList[] {
  const byUser = columnsOf(db, 'price_lists').has('created_by_user_id') && hasTable(db, 'users');
  return db.prepare(`
    SELECT pl.price_list_id, pl.customer_ref_sap, pl.sap_plant, pl.effective, pl.mailing_date, pl.price_list_version,
           pl.comments_about_changes, pl.price_type, pl.discount_percent, pl.created_at,
           ${byUser ? 'u.display_name' : 'NULL'} AS created_by,
           (SELECT COUNT(*) FROM price_list_entries e WHERE e.price_list_id = pl.price_list_id) AS entries
    FROM price_lists pl
    ${byUser ? 'LEFT JOIN users u ON u.id = pl.created_by_user_id' : ''}
    ORDER BY pl.created_at, pl.price_list_id
  `).all() as CopyPriceList[];
}

// Why this list can't be re-applied into the open database by this person (null = it can).
function reapplyBlock(cur: Database.Database, user: AppUser | null, pl: CopyPriceList): string | null {
  const customer = getCustomerAccess(cur, pl.customer_ref_sap);
  if (!customer) return `Customer ${pl.customer_ref_sap} is not in the shared database.`;
  if (findDuplicatePriceList(cur, pl)) return duplicatePriceListMessage(pl);
  if (!user) return 'You are not on the user list.';
  return customerChangeError(user, customer, customer.customer_short_name);
}

interface TableSpec {
  table: string;
  label: string;
  key: string[];
  name?: string;                // shown next to the key
  ignore?: string[];
  select?: string;
}

// Tables compared row by row (price lists have their own section). Customer fields that follow the price lists are left out.
const TABLES: TableSpec[] = [
  { table: 'customers', label: 'Customers', key: ['customer_ref_sap'], name: 'customer_short_name',
    ignore: ['id', 'last_price_list_version', 'last_price_list_id', 'effective', 'mailing_date'] },
  { table: 'customer_managers', label: 'Customer managers', key: ['customer_ref_sap', 'manager'],
    select: `SELECT m.customer_ref_sap, COALESCE(u.email, u.account, CAST(m.user_id AS TEXT)) AS manager
             FROM customer_managers m LEFT JOIN users u ON u.id = m.user_id` },
  { table: 'users', label: 'Users', key: ['user'], name: 'display_name',
    select: 'SELECT LOWER(COALESCE(email, account)) AS user, display_name, email, account, role, is_active FROM users' },
  { table: 'products', label: 'Products', key: ['rip_code'], name: 'product_name', ignore: ['id'] },
  { table: 'standard_epl_versions', label: 'Standard EPL versions', key: ['version_id'], name: 'version_name' },
  { table: 'standard_epl', label: 'Standard EPL prices', key: ['version_id', 'currency', 'rip_code'], name: 'product_name', ignore: ['id'] },
  { table: 'packaging', label: 'Packaging charges', key: ['packaging_version', 'product_type', 'packaging_name'], ignore: ['id'] },
  { table: 'admin_emails', label: 'PBP emails', key: ['email_name'], ignore: ['id'] },
  { table: 'currencies', label: 'Currencies', key: ['code'], ignore: ['id'] },
  { table: 'units', label: 'Units', key: ['name'], ignore: ['id'] },
  { table: 'fx_rates', label: 'Default FX rates', key: ['currency_code'] },
  { table: 'app_settings', label: 'Settings (logo, …)', key: ['key'] },
];

function shown(v: unknown): unknown {
  if (typeof v === 'string' && v.length > MAX_VALUE) return `${v.slice(0, MAX_VALUE - 1)}…`;
  return v ?? null;
}

type Row = Record<string, unknown>;

function diffTable(src: Database.Database, cur: Database.Database, spec: TableSpec): ConflictTableDiff | null {
  if (!hasTable(src, spec.table) || !hasTable(cur, spec.table)) return null;
  const sql = spec.select ?? `SELECT * FROM ${spec.table}`;
  const a = src.prepare(sql).all() as Row[];
  const b = cur.prepare(sql).all() as Row[];
  const colsA = new Set(a.length ? Object.keys(a[0]) : spec.select ? [] : [...columnsOf(src, spec.table)]);
  const colsB = new Set(b.length ? Object.keys(b[0]) : spec.select ? [] : [...columnsOf(cur, spec.table)]);
  const fields = [...colsA].filter(c => colsB.has(c) && !spec.key.includes(c) && !(spec.ignore ?? []).includes(c));
  const keyOf = (r: Row) => spec.key.map(k => String(r[k] ?? '')).join(' · ');
  const labelOf = (r: Row) => (spec.name && r[spec.name] ? `${keyOf(r)} — ${r[spec.name]}` : keyOf(r));
  const mapA = new Map(a.map(r => [keyOf(r), r]));
  const mapB = new Map(b.map(r => [keyOf(r), r]));
  const added: ConflictRow[] = [];
  const removed: ConflictRow[] = [];
  const changed: ConflictChange[] = [];
  for (const [k, r] of mapA) {
    const other = mapB.get(k);
    if (!other) {
      added.push({ key: k, label: labelOf(r) });
      continue;
    }
    const diffs = fields.filter(f => JSON.stringify(r[f] ?? null) !== JSON.stringify(other[f] ?? null))
      .map(f => ({ field: f, copy: shown(r[f]), shared: shown(other[f]) }));
    if (diffs.length) changed.push({ key: k, label: labelOf(r), fields: diffs });
  }
  for (const [k, r] of mapB) if (!mapA.has(k)) removed.push({ key: k, label: labelOf(r) });
  if (!added.length && !removed.length && !changed.length) return null;
  return {
    table: spec.table, label: spec.label, addedCount: added.length, removedCount: removed.length, changedCount: changed.length,
    added: added.slice(0, MAX_ROWS), removed: removed.slice(0, MAX_ROWS), changed: changed.slice(0, MAX_ROWS),
  };
}

// Activity entries in the copy that the shared database doesn't have: what was done in the copy (the shared database's
// own newer entries are not listed). Publishing stamps are left out.
function lostActivity(src: Database.Database, cur: Database.Database): { list: ConflictAnalysis['activity']; count: number } {
  if (!hasTable(src, 'audit_log') || !hasTable(cur, 'audit_log')) return { list: [], count: 0 };
  type Entry = { at: string; user_label: string; action: string; entity_key: string | null; summary: string };
  const sig = (e: Entry) => `${e.at}|${e.action}|${e.entity_key ?? ''}|${e.summary}`;
  const known = new Set((cur.prepare('SELECT at, action, entity_key, summary FROM audit_log').all() as Entry[]).map(sig));
  const lost = (src.prepare("SELECT at, user_label, action, entity_key, summary FROM audit_log WHERE action <> 'sync.publish' ORDER BY id")
    .all() as Entry[]).filter(e => !known.has(sig(e)));
  return {
    list: lost.slice(-MAX_ACTIVITY).map(e => ({ at: e.at, by: e.user_label, action: e.action, summary: e.summary })),
    count: lost.length,
  };
}

export async function analyzeConflictCopy(
  store: CentralStore, file: string, cur: Database.Database, user: AppUser | null,
): Promise<ConflictAnalysis> {
  const copy = await openCopy(store, file);
  try {
    const info = describe(copy);
    if (info.error) throw new Error(info.error);
    const src = copy.db;
    const curIds = new Set(cur.prepare('SELECT price_list_id FROM price_lists').pluck().all() as string[]);
    const lists = copyPriceLists(src);
    const srcIds = new Set(lists.map(l => l.price_list_id));
    const names = new Map((cur.prepare('SELECT customer_ref_sap, customer_short_name FROM customers').all() as
      { customer_ref_sap: string; customer_short_name: string }[]).map(c => [c.customer_ref_sap, c.customer_short_name]));
    const priceLists: ConflictPriceList[] = lists.filter(l => !curIds.has(l.price_list_id)).map(l => ({
      price_list_id: l.price_list_id, customer_ref_sap: l.customer_ref_sap, customer_name: names.get(l.customer_ref_sap) ?? null,
      price_list_version: l.price_list_version, effective: l.effective, mailing_date: l.mailing_date, price_type: l.price_type,
      entries: l.entries, created_at: l.created_at, created_by: l.created_by, blocked: reapplyBlock(cur, user, l),
    }));
    const activity = lostActivity(src, cur);
    return {
      copy: info,
      shared: publishInfoOf(cur),
      priceLists,
      priceListsOnlyInShared: [...curIds].filter(id => !srcIds.has(id)).length,
      activity: activity.list,
      activityCount: activity.count,
      tables: TABLES.map(t => diffTable(src, cur, t)).filter((t): t is ConflictTableDiff => t !== null),
    };
  } finally {
    copy.dispose();
  }
}

// ── Re-apply, archive ───────────────────────────────────────────────────────────────────────────────────────────────

// Re-applies the chosen price lists of a copy into the open (working) database, each through the normal creation with its
// checks; one result per list. beforeWrite runs once the copy is on this PC, right before the first change.
export async function reapplyPriceLists(
  store: CentralStore, file: string, ids: string[], cur: () => Database.Database, user: () => AppUser,
  beforeWrite: () => Promise<void>,
): Promise<ReapplyResult[]> {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!wanted.length) return [];
  const copy = await openCopy(store, file);
  try {
    const error = readableError(copy.db);
    if (error) throw new Error(error);
    const lists = new Map(copyPriceLists(copy.db).map(l => [l.price_list_id, l]));
    const entriesOf = copy.db.prepare(`
      SELECT product_type, rip_code, product_name, net_price, currency, unit FROM price_list_entries
      WHERE price_list_id = ? ORDER BY id
    `);
    await beforeWrite();
    const db = cur();
    const me = user();
    return wanted.map(id => {
      const pl = lists.get(id);
      if (!pl) return { price_list_id: id, ok: false, error: 'This price list is not in the copy.' };
      try {
        const data: CreatePriceListInput = {
          customer_ref_sap: pl.customer_ref_sap, sap_plant: pl.sap_plant ?? '', effective: pl.effective,
          mailing_date: pl.mailing_date, price_list_version: pl.price_list_version,
          comments_about_changes: pl.comments_about_changes ?? '', price_type: pl.price_type, discount_percent: pl.discount_percent,
          entries: entriesOf.all(id) as CreatePriceListInput['entries'],
        };
        createPriceList(db, me, data, { reappliedFrom: { file: copy.info.name, createdAt: pl.created_at, createdBy: pl.created_by } });
        return { price_list_id: id, ok: true, error: null };
      } catch (e) {
        return { price_list_id: id, ok: false, error: (e as Error).message };
      }
    });
  } finally {
    copy.dispose();
  }
}

// Moves a reviewed copy to the archive/ folder next to it (EPL-Conflicts/archive/, or on this PC); nothing is deleted.
export async function archiveConflictCopy(store: CentralStore, file: string): Promise<string> {
  const target = path.resolve(String(file ?? '')).toLowerCase();
  const found = (await allCopies(store)).find(c => path.resolve(c.file).toLowerCase() === target);
  if (!found) throw new Error('This file is not a conflict copy of the shared database.');
  if (found.source !== 'local') return store.archiveConflictCopy(found.file);
  const dir = path.join(localConflictsDir(), 'archive');
  await fsp.mkdir(dir, { recursive: true });
  const { name, ext } = path.parse(found.file);
  let dest = path.join(dir, `${name}${ext}`);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${name}-${i}${ext}`);
  await fsp.rename(found.file, dest);
  return dest;
}
