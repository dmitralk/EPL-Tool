import { getDb } from '../database';
import { audit } from '../audit';
import { getRealUser } from '../currentUser';
import { getCustomerAccess, requireCustomerChange, withManagers } from '../customerAccess';
import { actor, handle } from './guard';
import type { CreatePriceListInput, PriceListFull, PriceListHeader } from '../../types';

function buildPriceListId(data: CreatePriceListInput): string {
  return `${data.customer_ref_sap}${data.effective.replace(/-/g, '')}${data.mailing_date.replace(/-/g, '')}${data.price_list_version}`;
}

function fetchFull(price_list_id: string): PriceListFull {
  const db = getDb();
  const header = db.prepare(`
    SELECT pl.*, c.customer_short_name, c.pricing_mode, u.display_name AS created_by_name
    FROM price_lists pl
    LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
    LEFT JOIN users u ON u.id = pl.created_by_user_id
    WHERE pl.price_list_id = ?
  `).get(price_list_id) as PriceListHeader | undefined;

  const entries = db
    .prepare('SELECT * FROM price_list_entries WHERE price_list_id = ? ORDER BY product_type, rip_code')
    .all(price_list_id) as PriceListFull['entries'];

  return header ? { ...withManagers(db, [header])[0], entries } : ({ entries } as unknown as PriceListFull);
}

export function registerPriceListHandlers() {
  handle('price-lists:list', 'viewer', (_e, filters?: { customer_ref_sap?: string; from?: string; to?: string }) => {
    const db = getDb();
    let sql = `
      SELECT pl.*, c.customer_short_name, c.pricing_mode, u.display_name AS created_by_name
      FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      LEFT JOIN users u ON u.id = pl.created_by_user_id
      WHERE (c.is_deleted IS NULL OR c.is_deleted = 0)
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
    return withManagers(db, db.prepare(sql).all(...params) as PriceListHeader[]);
  });

  handle('price-lists:get', 'viewer', (_e, price_list_id: string) => {
    return fetchFull(price_list_id);
  });

  handle('price-lists:create', 'editor', (_e, data: CreatePriceListInput) => {
    const db = getDb();
    const customer = requireCustomerChange(db, actor(), data.customer_ref_sap);
    const price_list_id = buildPriceListId(data);

    const duplicate = db.prepare(`
      SELECT 1 FROM price_lists
      WHERE price_list_id = ?
         OR (customer_ref_sap = ? AND effective = ? AND UPPER(TRIM(price_list_version)) = UPPER(TRIM(?)))
      LIMIT 1
    `).get(price_list_id, data.customer_ref_sap, data.effective, data.price_list_version);
    if (duplicate) {
      throw new Error(
        `A price list with application date ${data.effective} and version ${data.price_list_version} already exists for this customer. ` +
        'Please choose another date or version, or delete the existing price list.',
      );
    }

    db.transaction(() => {
      db.prepare(`
        INSERT INTO price_lists (
          price_list_id, customer_ref_sap, sap_plant, effective, mailing_date,
          price_list_version, comments_about_changes, price_type, discount_percent, created_by_user_id
        ) VALUES (
          @price_list_id, @customer_ref_sap, @sap_plant, @effective, @mailing_date,
          @price_list_version, @comments_about_changes, @price_type, @discount_percent, @created_by_user_id
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
        created_by_user_id: getRealUser()?.id ?? null,
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
      // Only the line fields come from the caller; the list id is always the server-computed one.
      for (const e of data.entries) {
        entryStmt.run({
          product_type: e.product_type, rip_code: e.rip_code, product_name: e.product_name,
          net_price: e.net_price, currency: e.currency, unit: e.unit, price_list_id,
        });
      }

      audit(db, {
        action: 'price_list.create', entityType: 'price_list', entityKey: price_list_id, customerRef: data.customer_ref_sap,
        summary: `Created price list ${data.price_list_version} for ${customer.customer_short_name} ` +
          `(effective ${data.effective}, ${data.entries.length} product${data.entries.length === 1 ? '' : 's'})`,
        details: { price_type: data.price_type, discount_percent: data.discount_percent ?? null, mailing_date: data.mailing_date },
      });
    })();

    return fetchFull(price_list_id);
  });

  handle('price-lists:delete', 'editor', (_e, price_list_id: string) => {
    const db = getDb();
    const header = db.prepare('SELECT customer_ref_sap, price_list_version, effective FROM price_lists WHERE price_list_id = ?')
      .get(price_list_id) as { customer_ref_sap: string; price_list_version: string; effective: string } | undefined;
    if (!header) throw new Error('Price list not found.');
    const me = actor();
    // A list whose customer row no longer exists (orphan) behaves as Managed by PBP: admins only.
    const customer = getCustomerAccess(db, header.customer_ref_sap)
      ? requireCustomerChange(db, me, header.customer_ref_sap)
      : null;
    if (!customer && me.role !== 'admin') throw new Error('Only admins can delete price lists of customers that no longer exist.');
    const customerName = customer?.customer_short_name ?? header.customer_ref_sap;
    db.transaction(() => {
      const owner = db.prepare(`
        SELECT c.customer_ref_sap, c.last_price_list_id
        FROM price_lists pl JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
        WHERE pl.price_list_id = ?
      `).get(price_list_id) as { customer_ref_sap: string; last_price_list_id: string | null } | undefined;

      db.prepare('DELETE FROM price_list_entries WHERE price_list_id = ?').run(price_list_id);
      db.prepare('DELETE FROM price_lists WHERE price_list_id = ?').run(price_list_id);

      // If the customer pointed at the deleted list, fall back to their latest remaining one (or clear).
      if (owner && owner.last_price_list_id === price_list_id) {
        const prev = db.prepare(`
          SELECT price_list_id, price_list_version, effective, mailing_date
          FROM price_lists WHERE customer_ref_sap = ?
          ORDER BY effective IS NULL, effective DESC, created_at DESC
          LIMIT 1
        `).get(owner.customer_ref_sap) as
          { price_list_id: string; price_list_version: string; effective: string | null; mailing_date: string | null } | undefined;

        db.prepare(`
          UPDATE customers SET
            last_price_list_version = @version,
            last_price_list_id = @price_list_id,
            effective = @effective,
            mailing_date = @mailing_date
          WHERE customer_ref_sap = @ref
        `).run({
          version: prev?.price_list_version ?? null,
          price_list_id: prev?.price_list_id ?? null,
          effective: prev?.effective ?? null,
          mailing_date: prev?.mailing_date ?? null,
          ref: owner.customer_ref_sap,
        });
      }

      audit(db, {
        action: 'price_list.delete', entityType: 'price_list', entityKey: price_list_id, customerRef: header.customer_ref_sap,
        summary: `Deleted price list ${header.price_list_version} of ${customerName} (effective ${header.effective})`,
      });
    })();
  });

  handle('price-lists:stats', 'viewer', () => {
    const db = getDb();
    const total = (db.prepare(`
      SELECT COUNT(*) as n FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      WHERE (c.is_deleted IS NULL OR c.is_deleted = 0)
    `).get() as { n: number }).n;
    const thisYear = (db.prepare(`
      SELECT COUNT(*) as n FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      WHERE (c.is_deleted IS NULL OR c.is_deleted = 0)
      AND strftime('%Y', pl.effective) = strftime('%Y', 'now')
    `).get() as { n: number }).n;
    const last = db.prepare(`
      SELECT pl.*, c.customer_short_name
      FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      WHERE (c.is_deleted IS NULL OR c.is_deleted = 0)
      ORDER BY pl.created_at DESC LIMIT 1
    `).get();
    return { total, thisYear, last };
  });
}
