import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { Customer } from '../../types';

export function registerCustomerHandlers() {
  ipcMain.handle('customers:list', () => {
    return getDb()
      .prepare('SELECT * FROM customers ORDER BY customer_short_name')
      .all() as Customer[];
  });

  ipcMain.handle('customers:get', (_e, customer_ref_sap: string) => {
    return getDb()
      .prepare('SELECT * FROM customers WHERE customer_ref_sap = ?')
      .get(customer_ref_sap) as Customer | undefined;
  });

  ipcMain.handle('customers:create', (_e, data: Omit<Customer, 'id'>) => {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO customers (
        zone, country, customer_type, comment_on_business_model,
        customer_ref_type_sap, customer_ref_sap, customer_short_name, customer_full_name,
        currency, packaging_version, price_list_managed_by, customer_spoc,
        effective, mailing_date, last_price_list_version, last_price_list_id,
        email_to_customer, email_internal_copy, email_pbp_copy, email_pbp_common
      ) VALUES (
        @zone, @country, @customer_type, @comment_on_business_model,
        @customer_ref_type_sap, @customer_ref_sap, @customer_short_name, @customer_full_name,
        @currency, @packaging_version, @price_list_managed_by, @customer_spoc,
        @effective, @mailing_date, @last_price_list_version, @last_price_list_id,
        @email_to_customer, @email_internal_copy, @email_pbp_copy, @email_pbp_common
      )
    `);
    const result = stmt.run(data);
    return db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  });

  ipcMain.handle('customers:update', (_e, customer_ref_sap: string, data: Partial<Customer>) => {
    const db = getDb();
    const fields = Object.keys(data)
      .filter(k => k !== 'id' && k !== 'customer_ref_sap')
      .map(k => `${k} = @${k}`)
      .join(', ');
    db.prepare(`UPDATE customers SET ${fields} WHERE customer_ref_sap = @customer_ref_sap`)
      .run({ ...data, customer_ref_sap });
    return db.prepare('SELECT * FROM customers WHERE customer_ref_sap = ?').get(customer_ref_sap);
  });

  ipcMain.handle('customers:delete', (_e, customer_ref_sap: string) => {
    getDb().prepare('DELETE FROM customers WHERE customer_ref_sap = ?').run(customer_ref_sap);
  });
}
