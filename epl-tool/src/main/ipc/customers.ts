import type Database from 'better-sqlite3';
import { getDb } from '../database';
import { audit, diffFields } from '../audit';
import {
  getCustomerAccess, getCustomerWithManagers, requireCustomerChange, requireCustomerHide, withManagers,
} from '../customerAccess';
import { accessChangeError, PRICING_MODES, pricingModeLabel } from '../../shared/permissions';
import {
  CUSTOMER_EDITABLE_FIELDS, CUSTOMER_REQUIRED_FIELDS, isCustomerEditableField, type CustomerEditableField,
} from '../../shared/customerFields';
import { actor, handle } from './guard';
import type { Customer, PricingMode } from '../../types';

const REGIONS = ['ASIA', 'EUROPE', 'AMERICA'];

// Validates allow-listed field values; returns them typed.
function validateFields(changes: Record<string, unknown>, requireAll: boolean): Partial<Record<CustomerEditableField, string | null>> {
  const rejected = Object.keys(changes).filter(k => !isCustomerEditableField(k));
  if (rejected.length) throw new Error(`These customer fields can't be changed here: ${rejected.join(', ')}.`);
  const out: Partial<Record<CustomerEditableField, string | null>> = {};
  for (const k of Object.keys(changes) as CustomerEditableField[]) {
    const value = changes[k];
    if (value !== null && typeof value !== 'string') throw new Error(`Invalid value for ${k}.`);
    out[k] = value;
  }
  for (const [k, label] of Object.entries(CUSTOMER_REQUIRED_FIELDS) as [CustomerEditableField, string][]) {
    if ((requireAll || k in out) && !(typeof out[k] === 'string' && out[k]!.trim())) throw new Error(`${label} is required.`);
  }
  if (out.main_supply_region && !REGIONS.includes(out.main_supply_region)) throw new Error('Invalid supply region.');
  return out;
}

function checkReferences(db: Database.Database, fields: Partial<Record<CustomerEditableField, string | null>>) {
  if (fields.currency && !db.prepare('SELECT 1 FROM currencies WHERE code = ?').get(fields.currency)) {
    throw new Error(`Unknown currency ${fields.currency}. Add it in Settings → Currencies first.`);
  }
  if (fields.packaging_version && !db.prepare('SELECT 1 FROM packaging WHERE packaging_version = ?').get(fields.packaging_version)) {
    throw new Error(`Unknown packaging version ${fields.packaging_version}.`);
  }
}

// Managers must be active Admins or Users; people who already manage the customer may stay.
function validateManagers(db: Database.Database, ids: number[], keep: readonly number[] = []): number[] {
  const unique = [...new Set(ids.map(Number))];
  for (const id of unique) {
    if (keep.includes(id)) continue;
    const u = db.prepare('SELECT display_name, role, is_active FROM users WHERE id = ?').get(id) as
      { display_name: string; role: string; is_active: number } | undefined;
    if (!u) throw new Error('Unknown user selected as manager.');
    if (!u.is_active || u.role === 'viewer') throw new Error(`${u.display_name} can't manage customers (only active Admins and Users).`);
  }
  return unique;
}

function setManagers(db: Database.Database, ref: string, ids: number[]) {
  db.prepare('DELETE FROM customer_managers WHERE customer_ref_sap = ?').run(ref);
  const ins = db.prepare('INSERT INTO customer_managers (customer_ref_sap, user_id) VALUES (?, ?)');
  for (const id of ids) ins.run(ref, id);
}

function managerNames(db: Database.Database, ids: number[]): string[] {
  return ids.map(id => (db.prepare('SELECT display_name FROM users WHERE id = ?').get(id) as { display_name: string } | undefined)?.display_name ?? `#${id}`);
}

function pbpEmail(db: Database.Database, match: 'costing' | 'common'): string | null {
  const row = db.prepare('SELECT email FROM admin_emails WHERE LOWER(email_name) LIKE ? ORDER BY id LIMIT 1')
    .get(`%${match}%`) as { email: string } | undefined;
  return row?.email ?? null;
}

export function registerCustomerHandlers() {
  handle('customers:list', 'viewer', () => {
    const db = getDb();
    return withManagers(db, db.prepare('SELECT * FROM customers WHERE is_deleted = 0 ORDER BY customer_short_name').all() as Customer[]);
  });

  handle('customers:list-deleted', 'viewer', () => {
    const db = getDb();
    return withManagers(db, db.prepare('SELECT * FROM customers WHERE is_deleted = 1 ORDER BY customer_short_name').all() as Customer[]);
  });

  handle('customers:get', 'viewer', (_e, customer_ref_sap: string) => getCustomerWithManagers(getDb(), customer_ref_sap));

  handle('customers:soft-delete', 'editor', (_e, customer_ref_sap: string) => {
    const db = getDb();
    const c = requireCustomerHide(db, actor(), customer_ref_sap);
    db.transaction(() => {
      db.prepare('UPDATE customers SET is_deleted = 1 WHERE customer_ref_sap = ?').run(customer_ref_sap);
      audit(db, { action: 'customer.hide', entityType: 'customer', entityKey: customer_ref_sap, customerRef: customer_ref_sap,
        summary: `Hid customer ${c.customer_short_name}` });
    })();
  });

  handle('customers:restore', 'admin', (_e, customer_ref_sap: string) => {
    const db = getDb();
    const c = getCustomerAccess(db, customer_ref_sap);
    if (!c) throw new Error('Customer not found.');
    db.transaction(() => {
      db.prepare('UPDATE customers SET is_deleted = 0 WHERE customer_ref_sap = ?').run(customer_ref_sap);
      audit(db, { action: 'customer.restore', entityType: 'customer', entityKey: customer_ref_sap, customerRef: customer_ref_sap,
        summary: `Restored customer ${c.customer_short_name}` });
    })();
  }, 'Only admins can restore hidden customers.');

  handle('customers:delete-permanent', 'admin', (_e, customer_ref_sap: string) => {
    const db = getDb();
    const c = getCustomerAccess(db, customer_ref_sap);
    if (!c) throw new Error('Customer not found.');
    db.transaction(() => {
      const lists = db.prepare('SELECT price_list_id FROM price_lists WHERE customer_ref_sap = ?').all(customer_ref_sap) as { price_list_id: string }[];
      const deleteEntries = db.prepare('DELETE FROM price_list_entries WHERE price_list_id = ?');
      for (const { price_list_id } of lists) deleteEntries.run(price_list_id);
      db.prepare('DELETE FROM price_lists WHERE customer_ref_sap = ?').run(customer_ref_sap);
      db.prepare('DELETE FROM customers WHERE customer_ref_sap = ?').run(customer_ref_sap);
      audit(db, { action: 'customer.delete', entityType: 'customer', entityKey: customer_ref_sap, customerRef: customer_ref_sap,
        summary: `Permanently deleted customer ${c.customer_short_name} and ${lists.length} price list${lists.length === 1 ? '' : 's'}`,
        details: { price_lists: lists.map(l => l.price_list_id) } });
    })();
  }, 'Only admins can permanently delete customers.');

  // Admins and Users. A User's new customer is managed by them; an admin picks the mode (default: Managed by PBP).
  handle('customers:create', 'editor', (_e, data: unknown) => {
    const db = getDb();
    const me = actor();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid customer.');
    const { customer_ref_sap: rawRef, pricing_mode: rawMode, manager_ids: rawManagers, ...rest } = data as Record<string, unknown>;
    const ref = typeof rawRef === 'string' ? rawRef.trim() : '';
    if (!ref) throw new Error('Customer Ref SAP is required.');
    if (db.prepare('SELECT 1 FROM customers WHERE customer_ref_sap = ? COLLATE NOCASE').get(ref)) {
      throw new Error(`A customer with SAP ref ${ref} already exists (it may be hidden: see Settings → Hidden Customers).`);
    }
    const fields = validateFields(rest, true);
    checkReferences(db, fields);

    let mode: PricingMode = 'managed';
    let managers = [me.id];
    if (me.role === 'admin') {
      mode = (rawMode ?? 'pbp') as PricingMode;
      if (!PRICING_MODES.includes(mode)) throw new Error('Unknown pricing mode.');
      managers = mode === 'managed' ? validateManagers(db, Array.isArray(rawManagers) ? rawManagers as number[] : []) : [];
      if (mode === 'managed' && managers.length === 0) throw new Error('A customer managed by named users needs at least one manager.');
    }

    const row: Record<string, unknown> = {
      customer_ref_sap: ref,
      ...Object.fromEntries(CUSTOMER_EDITABLE_FIELDS.map(k => [k, fields[k] ?? null])),
      email_pbp_copy: pbpEmail(db, 'costing'),
      email_pbp_common: pbpEmail(db, 'common'),
      pricing_mode: mode,
    };
    const cols = Object.keys(row);
    db.transaction(() => {
      db.prepare(`INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(k => `@${k}`).join(', ')})`).run(row);
      setManagers(db, ref, managers);
      const access = pricingModeLabel({ pricing_mode: mode, manager_ids: managers, manager_names: managerNames(db, managers) });
      audit(db, { action: 'customer.create', entityType: 'customer', entityKey: ref, customerRef: ref,
        summary: `Created customer ${fields.customer_short_name} (${ref}) — ${access}`, details: { ...row, manager_ids: managers } });
    })();
    return getCustomerWithManagers(db, ref);
  }, 'Viewers can only view and export.');

  handle('customers:update', 'editor', (_e, customer_ref_sap: string, data: unknown) => {
    const db = getDb();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid customer update.');
    const fields = validateFields(data as Record<string, unknown>, false);
    const c = requireCustomerChange(db, actor(), customer_ref_sap);
    checkReferences(db, fields);
    const keys = Object.keys(fields);
    if (keys.length) {
      const before = db.prepare('SELECT * FROM customers WHERE customer_ref_sap = ?').get(customer_ref_sap) as Record<string, unknown>;
      const changes = diffFields(before, fields, keys);
      if (Object.keys(changes).length) {
        db.transaction(() => {
          db.prepare(`UPDATE customers SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE customer_ref_sap = @__ref`)
            .run({ ...fields, __ref: customer_ref_sap });
          audit(db, { action: 'customer.update', entityType: 'customer', entityKey: customer_ref_sap, customerRef: customer_ref_sap,
            summary: `Updated ${c.customer_short_name}: ${Object.keys(changes).join(', ')}`, details: changes });
        })();
      }
    }
    return getCustomerWithManagers(db, customer_ref_sap);
  });

  // Pricing mode and managers (study §3.3): admins anything; managers of a managed customer can add/remove co-managers,
  // open it or hand it to PBP; nobody else.
  handle('customers:set-access', 'editor', (_e, customer_ref_sap: string, next: { pricing_mode: PricingMode; manager_ids?: number[] }) => {
    const db = getDb();
    const me = actor();
    const c = getCustomerAccess(db, customer_ref_sap);
    if (!c) throw new Error('Customer not found.');
    const mode = next?.pricing_mode;
    const requested = mode === 'managed' && Array.isArray(next.manager_ids) ? [...new Set(next.manager_ids.map(Number))] : [];
    const error = accessChangeError(me, c, { pricing_mode: mode, manager_ids: requested });
    if (error) throw new Error(error);
    const managers = validateManagers(db, requested, c.manager_ids);
    const from = pricingModeLabel(c);
    const to = pricingModeLabel({ pricing_mode: mode, manager_ids: managers, manager_names: managerNames(db, managers) });
    if (mode === c.pricing_mode && managers.length === c.manager_ids.length && managers.every(id => c.manager_ids.includes(id))) {
      return getCustomerWithManagers(db, customer_ref_sap);
    }
    db.transaction(() => {
      db.prepare('UPDATE customers SET pricing_mode = ? WHERE customer_ref_sap = ?').run(mode, customer_ref_sap);
      setManagers(db, customer_ref_sap, managers);
      audit(db, { action: 'customer.access', entityType: 'customer', entityKey: customer_ref_sap, customerRef: customer_ref_sap,
        summary: `Pricing management of ${c.customer_short_name}: ${from} → ${to}`,
        details: { from: { pricing_mode: c.pricing_mode, manager_ids: c.manager_ids }, to: { pricing_mode: mode, manager_ids: managers } } });
    })();
    return getCustomerWithManagers(db, customer_ref_sap);
  });
}
