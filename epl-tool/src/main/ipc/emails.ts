import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { EmailAssignmentChange, EmailUsage } from '../../types';

// Customer and internal emails stay stored as ';'-separated strings on the customers row;
// this module only indexes and bulk-edits them.
type Field = 'email_to_customer' | 'email_internal_copy';
const FIELDS: Field[] = ['email_to_customer', 'email_internal_copy'];
const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

interface EmailRow {
  customer_ref_sap: string;
  customer_short_name: string;
  is_deleted: number;
  email_to_customer: string | null;
  email_internal_copy: string | null;
}

function splitEmails(v: string | null): string[] {
  if (!v) return [];
  return v.split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);
}

function joinEmails(list: string[]): string | null {
  return list.length ? list.join(';') : null;
}

const norm = (e: string) => e.trim().toLowerCase();

function loadRows(): EmailRow[] {
  return getDb().prepare(`
    SELECT customer_ref_sap, customer_short_name, is_deleted, email_to_customer, email_internal_copy
    FROM customers ORDER BY customer_short_name
  `).all() as EmailRow[];
}

// Applies `fn` to every customer's fields containing `target` (incl. hidden customers); returns changed-customer count.
function transformAll(target: string, fn: (list: string[]) => string[]): number {
  const db = getDb();
  const upd = db.prepare('UPDATE customers SET email_to_customer = ?, email_internal_copy = ? WHERE customer_ref_sap = ?');
  let changed = 0;
  db.transaction(() => {
    for (const r of loadRows()) {
      const next = FIELDS.map(f => {
        const list = splitEmails(r[f]);
        return list.some(e => norm(e) === target) ? joinEmails(fn(list)) : r[f];
      });
      if (next[0] !== r.email_to_customer || next[1] !== r.email_internal_copy) {
        upd.run(next[0], next[1], r.customer_ref_sap);
        changed++;
      }
    }
  })();
  return changed;
}

function dedupe(list: string[]): string[] {
  const out: string[] = [];
  for (const e of list) if (!out.some(x => norm(x) === norm(e))) out.push(e);
  return out;
}

export function registerEmailHandlers() {
  ipcMain.handle('emails:list', () => {
    const map = new Map<string, EmailUsage>();
    for (const r of loadRows()) {
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

  ipcMain.handle('emails:set-assignments', (_e, email: string, changes: EmailAssignmentChange[]) => {
    const value = String(email ?? '').trim();
    if (!EMAIL_RE.test(value)) return { ok: false, error: 'Invalid email address.' };
    const db = getDb();
    const get = db.prepare('SELECT email_to_customer, email_internal_copy FROM customers WHERE customer_ref_sap = ?');
    const upd = db.prepare('UPDATE customers SET email_to_customer = ?, email_internal_copy = ? WHERE customer_ref_sap = ?');
    const apply = (cur: string | null, want: boolean): string | null => {
      const list = splitEmails(cur);
      const has = list.some(e => norm(e) === norm(value));
      if (want && !has) return joinEmails([...list, value]);
      if (!want && has) return joinEmails(list.filter(e => norm(e) !== norm(value)));
      return cur;
    };
    let updated = 0;
    db.transaction(() => {
      for (const ch of changes) {
        const row = get.get(ch.customer_ref_sap) as Pick<EmailRow, Field> | undefined;
        if (!row) continue;
        const to = apply(row.email_to_customer, ch.to);
        const internal = apply(row.email_internal_copy, ch.internal);
        if (to !== row.email_to_customer || internal !== row.email_internal_copy) {
          upd.run(to, internal, ch.customer_ref_sap);
          updated++;
        }
      }
    })();
    return { ok: true, updated };
  });

  ipcMain.handle('emails:replace', (_e, oldEmail: string, newEmail: string) => {
    const from = norm(String(oldEmail ?? ''));
    const to = String(newEmail ?? '').trim();
    if (!from) return { ok: false, error: 'Missing current email.' };
    if (!EMAIL_RE.test(to)) return { ok: false, error: 'Invalid email address.' };
    const updated = transformAll(from, list => dedupe(list.map(e => (norm(e) === from ? to : e))));
    return { ok: true, updated };
  });

  ipcMain.handle('emails:remove', (_e, email: string) => {
    const target = norm(String(email ?? ''));
    if (!target) return { ok: false, error: 'Missing email.' };
    const updated = transformAll(target, list => list.filter(e => norm(e) !== target));
    return { ok: true, updated };
  });
}
