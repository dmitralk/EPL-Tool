import type Database from 'better-sqlite3';
import { customerChangeError, hideCustomerError, type PermCustomer } from '../shared/permissions';
import type { AppUser, Customer, PricingMode } from '../types';

export interface CustomerAccessRow extends PermCustomer {
  customer_ref_sap: string;
  customer_short_name: string;
  is_deleted: number;
  manager_ids: number[];
  manager_names: string[];
}

// customer_ref_sap → managers (ids + names), for attaching to customer rows.
export function managersByCustomer(db: Database.Database): Map<string, { ids: number[]; names: string[] }> {
  const rows = db.prepare(`
    SELECT m.customer_ref_sap, u.id, u.display_name
    FROM customer_managers m JOIN users u ON u.id = m.user_id
    ORDER BY u.display_name
  `).all() as { customer_ref_sap: string; id: number; display_name: string }[];
  const map = new Map<string, { ids: number[]; names: string[] }>();
  for (const r of rows) {
    const entry = map.get(r.customer_ref_sap) ?? { ids: [], names: [] };
    entry.ids.push(r.id);
    entry.names.push(r.display_name);
    map.set(r.customer_ref_sap, entry);
  }
  return map;
}

type RawCustomer = Omit<Customer, 'manager_ids' | 'manager_names'>;

export function withManagers<T extends { customer_ref_sap: string }>(
  db: Database.Database, rows: T[],
): (T & { manager_ids: number[]; manager_names: string[] })[] {
  const map = managersByCustomer(db);
  return rows.map(r => ({ ...r, manager_ids: map.get(r.customer_ref_sap)?.ids ?? [], manager_names: map.get(r.customer_ref_sap)?.names ?? [] }));
}

export function getCustomerWithManagers(db: Database.Database, ref: string): Customer | undefined {
  const row = db.prepare('SELECT * FROM customers WHERE customer_ref_sap = ?').get(ref) as RawCustomer | undefined;
  return row ? withManagers(db, [row])[0] : undefined;
}

export function getCustomerAccess(db: Database.Database, ref: string): CustomerAccessRow | undefined {
  const row = db.prepare(`
    SELECT customer_ref_sap, customer_short_name, is_deleted, pricing_mode FROM customers WHERE customer_ref_sap = ?
  `).get(ref) as { customer_ref_sap: string; customer_short_name: string; is_deleted: number; pricing_mode: PricingMode } | undefined;
  return row ? withManagers(db, [row])[0] : undefined;
}

// Throws the clear refusal unless the user may change this customer (price lists, emails, master data).
export function requireCustomerChange(db: Database.Database, user: AppUser, ref: string): CustomerAccessRow {
  const c = getCustomerAccess(db, ref);
  if (!c) throw new Error(`Customer ${ref} not found.`);
  const error = customerChangeError(user, c, c.customer_short_name);
  if (error) throw new Error(error);
  return c;
}

export function requireCustomerHide(db: Database.Database, user: AppUser, ref: string): CustomerAccessRow {
  const c = getCustomerAccess(db, ref);
  if (!c) throw new Error(`Customer ${ref} not found.`);
  const error = hideCustomerError(user, c, c.customer_short_name);
  if (error) throw new Error(error);
  return c;
}
