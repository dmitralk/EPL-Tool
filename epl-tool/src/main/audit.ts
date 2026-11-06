import type Database from 'better-sqlite3';
import { auditActor } from './currentUser';

export interface AuditInput {
  action: string;                  // e.g. 'customer.update', 'price_list.create'
  summary: string;                 // one human-readable line
  entityType?: string;
  entityKey?: string | number | null;
  customerRef?: string | null;     // shown in that customer's History
  details?: unknown;               // stored as JSON
}

// Call inside the same transaction as the change it describes, so the log and the data can't disagree.
export function audit(db: Database.Database, entry: AuditInput): void {
  const { userId, label } = auditActor();
  db.prepare(`
    INSERT INTO audit_log (user_id, user_label, action, entity_type, entity_key, customer_ref_sap, summary, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    label,
    entry.action,
    entry.entityType ?? null,
    entry.entityKey === undefined || entry.entityKey === null ? null : String(entry.entityKey),
    entry.customerRef ?? null,
    entry.summary,
    entry.details === undefined ? null : JSON.stringify(entry.details),
  );
}

// { field: [old, new] } for the fields that differ.
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of keys) {
    if ((before[k] ?? null) !== (after[k] ?? null)) out[k] = [before[k] ?? null, after[k] ?? null];
  }
  return out;
}
