import type Database from 'better-sqlite3';
import { getDb } from '../database';
import { audit } from '../audit';
import { managersByCustomer } from '../customerAccess';
import { canChangeCustomer } from '../../shared/permissions';
import { actor, handle } from './guard';
import type { AppUser, EmailAssignmentChange, EmailBulkResult, EmailUsage, PricingMode } from '../../types';

// Customer and internal emails stay stored as ';'-separated strings on the customers row;
// this module only indexes and bulk-edits them. Changes only touch customers the user may change.
type Field = 'email_to_customer' | 'email_internal_copy';
const FIELDS: Field[] = ['email_to_customer', 'email_internal_copy'];
const FIELD_LABEL: Record<Field, string> = { email_to_customer: 'To', email_internal_copy: 'Internal copy' };
const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

interface EmailRow {
  customer_ref_sap: string;
  customer_short_name: string;
  is_deleted: number;
  email_to_customer: string | null;
  email_internal_copy: string | null;
  pricing_mode: PricingMode;
  manager_ids: number[];
  manager_names: string[];
}

function splitEmails(v: string | null): string[] {
  if (!v) return [];
  return v.split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);
}

function joinEmails(list: string[]): string | null {
  return list.length ? list.join(';') : null;
}

const norm = (e: string) => e.trim().toLowerCase();

function loadRows(db: Database.Database): EmailRow[] {
  const managers = managersByCustomer(db);
  return (db.prepare(`
    SELECT customer_ref_sap, customer_short_name, is_deleted, email_to_customer, email_internal_copy, pricing_mode
    FROM customers ORDER BY customer_short_name
  `).all() as Omit<EmailRow, 'manager_ids' | 'manager_names'>[]).map(r => ({
    ...r,
    manager_ids: managers.get(r.customer_ref_sap)?.ids ?? [],
    manager_names: managers.get(r.customer_ref_sap)?.names ?? [],
  }));
}

function describeChange(r: EmailRow, next: (string | null)[]): string {
  return FIELDS.map((f, i) => (next[i] !== r[f] ? `${FIELD_LABEL[f]}: ${r[f] ?? '—'} → ${next[i] ?? '—'}` : null))
    .filter(Boolean).join('; ');
}

// Applies `fn` to the fields containing `target` (incl. hidden customers) of the customers the user may change.
function transformAll(user: AppUser, target: string, fn: (list: string[]) => string[], action: string, verb: string): EmailBulkResult {
  const db = getDb();
  const upd = db.prepare('UPDATE customers SET email_to_customer = ?, email_internal_copy = ? WHERE customer_ref_sap = ?');
  let updated = 0;
  const skipped: EmailBulkResult['skipped'] = [];
  db.transaction(() => {
    for (const r of loadRows(db)) {
      if (!FIELDS.some(f => splitEmails(r[f]).some(e => norm(e) === target))) continue;
      if (!canChangeCustomer(user, r)) {
        skipped.push({ customer_ref_sap: r.customer_ref_sap, customer_short_name: r.customer_short_name });
        continue;
      }
      const next = FIELDS.map(f => {
        const list = splitEmails(r[f]);
        return list.some(e => norm(e) === target) ? joinEmails(fn(list)) : r[f];
      });
      if (next[0] !== r.email_to_customer || next[1] !== r.email_internal_copy) {
        upd.run(next[0], next[1], r.customer_ref_sap);
        audit(db, { action, entityType: 'customer', entityKey: r.customer_ref_sap, customerRef: r.customer_ref_sap,
          summary: `${verb} for ${r.customer_short_name} (${describeChange(r, next)})` });
        updated++;
      }
    }
  })();
  return { ok: true, updated, skipped };
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const e of list) if (!out.some(x => norm(x) === norm(e))) out.push(e);
  return out;
}

export function registerEmailHandlers() {
  handle('emails:list', 'viewer', () => {
    const map = new Map<string, EmailUsage>();
    for (const r of loadRows(getDb())) {
      for (const f of FIELDS) {
        for (const e of splitEmails(r[f])) {
          let usage = map.get(norm(e));
          if (!usage) {
            usage = { email: e, customers: [] };
            map.set(norm(e), usage);
          }
          let link = usage.customers.find(c => c.customer_ref_sap === r.customer_ref_sap);
          if (!link) {
            link = {
              customer_ref_sap: r.customer_ref_sap,
              customer_short_name: r.customer_short_name,
              is_deleted: r.is_deleted === 1,
              to: false,
              internal: false,
              pricing_mode: r.pricing_mode,
              manager_ids: r.manager_ids,
              manager_names: r.manager_names,
            };
            usage.customers.push(link);
          }
          if (f === 'email_to_customer') link.to = true;
          else link.internal = true;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  });

  handle('emails:set-assignments', 'editor', (_e, email: string, changes: EmailAssignmentChange[]): EmailBulkResult => {
    const value = String(email ?? '').trim();
    if (!EMAIL_RE.test(value)) return { ok: false, error: 'Invalid email address.' };
    const user = actor();
    const db = getDb();
    const rows = new Map(loadRows(db).map(r => [r.customer_ref_sap, r]));
    const upd = db.prepare('UPDATE customers SET email_to_customer = ?, email_internal_copy = ? WHERE customer_ref_sap = ?');
    const apply = (cur: string | null, want: boolean): string | null => {
      const list = splitEmails(cur);
      const has = list.some(e => norm(e) === norm(value));
      if (want && !has) return joinEmails([...list, value]);
      if (!want && has) return joinEmails(list.filter(e => norm(e) !== norm(value)));
      return cur;
    };
    let updated = 0;
    const skipped: EmailBulkResult['skipped'] = [];
    db.transaction(() => {
      for (const ch of changes) {
        const row = rows.get(ch.customer_ref_sap);
        if (!row) continue;
        const to = apply(row.email_to_customer, ch.to);
        const internal = apply(row.email_internal_copy, ch.internal);
        if (to === row.email_to_customer && internal === row.email_internal_copy) continue;
        if (!canChangeCustomer(user, row)) {
          skipped.push({ customer_ref_sap: row.customer_ref_sap, customer_short_name: row.customer_short_name });
          continue;
        }
        upd.run(to, internal, ch.customer_ref_sap);
        audit(db, { action: 'email.assign', entityType: 'customer', entityKey: row.customer_ref_sap, customerRef: row.customer_ref_sap,
          summary: `Changed ${value} for ${row.customer_short_name} (${describeChange(row, [to, internal])})` });
        updated++;
      }
    })();
    return { ok: true, updated, skipped };
  });

  handle('emails:replace', 'editor', (_e, oldEmail: string, newEmail: string): EmailBulkResult => {
    const from = norm(String(oldEmail ?? ''));
    const to = String(newEmail ?? '').trim();
    if (!from) return { ok: false, error: 'Missing current email.' };
    if (!EMAIL_RE.test(to)) return { ok: false, error: 'Invalid email address.' };
    return transformAll(actor(), from, list => dedupe(list.map(e => (norm(e) === from ? to : e))),
      'email.replace', `Replaced ${from} with ${to}`);
  });

  handle('emails:remove', 'editor', (_e, email: string): EmailBulkResult => {
    const target = norm(String(email ?? ''));
    if (!target) return { ok: false, error: 'Missing email.' };
    return transformAll(actor(), target, list => list.filter(e => norm(e) !== target), 'email.remove', `Removed ${target}`);
  });
}
