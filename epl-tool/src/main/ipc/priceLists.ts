import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { CreatePriceListInput, PriceListFull, PriceListHeader } from '../../types';

function buildPriceListId(data: CreatePriceListInput): string {
  return `${data.customer_ref_sap}${data.effective.replace(/-/g, '')}${data.mailing_date.replace(/-/g, '')}${data.price_list_version}`;
}

function fetchFull(price_list_id: string): PriceListFull {
  const db = getDb();
  const header = db.prepare(`
    SELECT pl.*, c.customer_short_name
    FROM price_lists pl
    LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
    WHERE pl.price_list_id = ?
  `).get(price_list_id) as PriceListHeader;

  const entries = db
    .prepare('SELECT * FROM price_list_entries WHERE price_list_id = ? ORDER BY product_type, rip_code')
    .all(price_list_id) as PriceListFull['entries'];

  return { ...header, entries };
}

export function registerPriceListHandlers() {
  ipcMain.handle('price-lists:list', (_e, filters?: { customer_ref_sap?: string; from?: string; to?: string }) => {
    const db = getDb();
    let sql = `
      SELECT pl.*, c.customer_short_name
      FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      WHERE 1=1
    `;
    const params: string[] = [];
    if (filters?.customer_ref_sap) {
      sql += ' AND pl.customer_ref_sap = ?';
      params.push(filters.customer_ref_sap);
    }
    if (filters?.from) {
      sql += ' AND pl.effective >= ?';
      params.push(filters.from);
    }
    if (filters?.to) {
      sql += ' AND pl.effective <= ?';
      params.push(filters.to);
    }
    sql += ' ORDER BY pl.created_at DESC';
    return db.prepare(sql).all(...params) as PriceListHeader[];
  });

  ipcMain.handle('price-lists:get', (_e, price_list_id: string) => {
    return fetchFull(price_list_id);
  });

  ipcMain.handle('price-lists:create', (_e, data: CreatePriceListInput) => {
    const db = getDb();
    const price_list_id = buildPriceListId(data);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO price_lists (
          price_list_id, customer_ref_sap, sap_plant, effective, mailing_date,
          price_list_version, comments_about_changes, price_type, discount_percent
        ) VALUES (
          @price_list_id, @customer_ref_sap, @sap_plant, @effective, @mailing_date,
          @price_list_version, @comments_about_changes, @price_type, @discount_percent
        )
      `).run({
        price_list_id,
        customer_ref_sap: data.customer_ref_sap,
        sap_plant: data.sap_plant || null,
        effective: data.effective,
        mailing_date: data.mailing_date,
        price_list_version: data.price_list_version,
        comments_about_changes: data.comments_about_changes || null,
        price_type: data.price_type,
        discount_percent: data.discount_percent ?? null,
      });

      // Update customer last price list info
      db.prepare(`
        UPDATE customers SET
          last_price_list_version = @version,
          last_price_list_id = @price_list_id,
          effective = @effective,
          mailing_date = @mailing_date
        WHERE customer_ref_sap = @ref
      `).run({
        version: data.price_list_version,
        price_list_id,
        effective: data.effective,
        mailing_date: data.mailing_date,
        ref: data.customer_ref_sap,
      });

      const entryStmt = db.prepare(`
        INSERT INTO price_list_entries (price_list_id, product_type, rip_code, product_name, net_price, currency, unit)
        VALUES (@price_list_id, @product_type, @rip_code, @product_name, @net_price, @currency, @unit)
      `);
      for (const entry of data.entries) {
        entryStmt.run({ price_list_id, ...entry });
      }
    })();

    return fetchFull(price_list_id);
  });

  ipcMain.handle('price-lists:delete', (_e, price_list_id: string) => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM price_list_entries WHERE price_list_id = ?').run(price_list_id);
      db.prepare('DELETE FROM price_lists WHERE price_list_id = ?').run(price_list_id);
    })();
  });

  ipcMain.handle('price-lists:stats', () => {
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) as n FROM price_lists').get() as { n: number }).n;
    const thisYear = (db.prepare(
      "SELECT COUNT(*) as n FROM price_lists WHERE strftime('%Y', effective) = strftime('%Y', 'now')"
    ).get() as { n: number }).n;
    const last = db.prepare(`
      SELECT pl.*, c.customer_short_name
      FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      ORDER BY pl.created_at DESC LIMIT 1
    `).get();
    return { total, thisYear, last };
  });
}
