import type Database from 'better-sqlite3';
import { audit } from './audit';
import { getRealUser } from './currentUser';
import { requireCustomerChange } from './customerAccess';
import type { AppUser, CreatePriceListInput } from '../types';

// Creating a price list, used by price-lists:create (wizards) and by the rescue tool (re-applying a price list from a
// conflict copy, Phase D): the same per-customer rule, duplicate guard, customer update and activity entry.

export function buildPriceListId(data: Pick<CreatePriceListInput, 'customer_ref_sap' | 'effective' | 'mailing_date' | 'price_list_version'>): string {
  return `${data.customer_ref_sap}${data.effective.replace(/-/g, '')}${data.mailing_date.replace(/-/g, '')}${data.price_list_version}`;
}

// Same customer + application date + version (or the same generated id), else null.
export function findDuplicatePriceList(
  db: Database.Database, data: Pick<CreatePriceListInput, 'customer_ref_sap' | 'effective' | 'mailing_date' | 'price_list_version'>,
): string | null {
  const row = db.prepare(`
    SELECT price_list_id FROM price_lists
    WHERE price_list_id = ?
       OR (customer_ref_sap = ? AND effective = ? AND UPPER(TRIM(price_list_version)) = UPPER(TRIM(?)))
    LIMIT 1
  `).get(buildPriceListId(data), data.customer_ref_sap, data.effective, data.price_list_version) as { price_list_id: string } | undefined;
  return row?.price_list_id ?? null;
}

export function duplicatePriceListMessage(data: Pick<CreatePriceListInput, 'effective' | 'price_list_version'>): string {
  return `A price list with application date ${data.effective} and version ${data.price_list_version} already exists for this ` +
    'customer. Please choose another date or version, or delete the existing price list.';
}

// A price list taken over from a conflict copy: where it comes from, and when / by whom it was first created.
export interface ReappliedFrom {
  file: string;                  // file name of the conflict copy
  createdAt: string | null;      // created_at in the copy (kept, so the list sorts where it belongs)
  createdBy: string | null;      // display name of its creator in the copy
}

// Creates the price list (one transaction) and returns its id. Throws the user-facing refusal (rights, duplicate).
export function createPriceList(
  db: Database.Database, user: AppUser, data: CreatePriceListInput, opts: { reappliedFrom?: ReappliedFrom } = {},
): string {
  const customer = requireCustomerChange(db, user, data.customer_ref_sap);
  if (!Array.isArray(data.entries)) throw new Error('The price list has no products.');
  if (findDuplicatePriceList(db, data)) throw new Error(duplicatePriceListMessage(data));
  const price_list_id = buildPriceListId(data);
  const from = opts.reappliedFrom;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO price_lists (
        price_list_id, customer_ref_sap, sap_plant, effective, mailing_date,
        price_list_version, comments_about_changes, price_type, discount_percent, created_by_user_id, created_at
      ) VALUES (
        @price_list_id, @customer_ref_sap, @sap_plant, @effective, @mailing_date,
        @price_list_version, @comments_about_changes, @price_type, @discount_percent, @created_by_user_id,
        COALESCE(@created_at, datetime('now'))
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
      created_at: from?.createdAt ?? null,
    });

    // The customer's "last price list": the new one; a re-applied (older) list only when it is the latest by the usual rule.
    const latest = from
      ? db.prepare(`
          SELECT price_list_id, price_list_version, effective, mailing_date FROM price_lists WHERE customer_ref_sap = ?
          ORDER BY effective IS NULL, effective DESC, created_at DESC LIMIT 1
        `).get(data.customer_ref_sap) as { price_list_id: string; price_list_version: string; effective: string; mailing_date: string }
      : { price_list_id, price_list_version: data.price_list_version, effective: data.effective, mailing_date: data.mailing_date };
    db.prepare(`
      UPDATE customers SET
        last_price_list_version = @version,
        last_price_list_id = @price_list_id,
        effective = @effective,
        mailing_date = @mailing_date
      WHERE customer_ref_sap = @ref
    `).run({
      version: latest.price_list_version,
      price_list_id: latest.price_list_id,
      effective: latest.effective,
      mailing_date: latest.mailing_date,
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

    const products = `${data.entries.length} product${data.entries.length === 1 ? '' : 's'}`;
    audit(db, {
      action: 'price_list.create', entityType: 'price_list', entityKey: price_list_id, customerRef: data.customer_ref_sap,
      summary: from
        ? `Re-applied price list ${data.price_list_version} for ${customer.customer_short_name} from ${from.file} ` +
          `(effective ${data.effective}, ${products}${from.createdBy ? `, first created by ${from.createdBy}` : ''})`
        : `Created price list ${data.price_list_version} for ${customer.customer_short_name} ` +
          `(effective ${data.effective}, ${products})`,
      details: {
        price_type: data.price_type, discount_percent: data.discount_percent ?? null, mailing_date: data.mailing_date,
        ...(from ? { reapplied_from: from.file, first_created_at: from.createdAt, first_created_by: from.createdBy } : {}),
      },
    });
  })();

  return price_list_id;
}
