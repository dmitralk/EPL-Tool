import { ipcMain, dialog } from 'electron';
import { getDb, isOpen } from '../database';
import type { MigrationResult } from '../../types';
import * as XLSX from 'xlsx';

function excelDateToISO(serial: number | string | null | undefined): string | null {
  if (serial === null || serial === undefined || serial === '') return null;
  if (typeof serial === 'string') {
    // Already a date string
    const trimmed = serial.trim();
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) return trimmed;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  // Excel serial date
  const date = new Date((serial - 25569) * 86400 * 1000);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function safeFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/ /g, '');
  return s === '' ? null : s;
}

export function registerMigrationHandlers() {
  ipcMain.handle('migration:select-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select All_Prices.xlsx',
      properties: ['openFile'],
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('migration:import-excel', async (_e, filePath: string): Promise<MigrationResult> => {
    const counts = { customers: 0, products: 0, standardEpl: 0, packaging: 0, priceLists: 0, priceListEntries: 0, adminEmails: 0 };

    if (!isOpen()) {
      return { success: false, counts, error: 'No database is open. Open or create a database first (use "Change Database" in the sidebar).' };
    }

    try {
      const wb = XLSX.readFile(filePath, { cellDates: false });
      const db = getDb();

      const getSheet = (name: string) => wb.Sheets[name];

      // 1. Admin emails
      const adminSheet = getSheet('Admin');
      if (adminSheet) {
        const rows = XLSX.utils.sheet_to_json<string[]>(adminSheet, { header: 1 }) as unknown[][];
        const insertEmail = db.prepare('INSERT OR REPLACE INTO admin_emails (email_name, email) VALUES (?, ?)');
        for (const row of rows.slice(1)) {
          const name = clean(row[0]);
          const email = clean(row[1]);
          if (name && email) {
            insertEmail.run(name, email);
            counts.adminEmails++;
          }
        }
      }

      // 2. Customers
      const custSheet = getSheet('Customers Masterdata');
      if (custSheet) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(custSheet, { header: 1 }) as unknown[][];
        const insertCust = db.prepare(`
          INSERT OR REPLACE INTO customers (
            zone, country, customer_type, comment_on_business_model,
            customer_ref_type_sap, customer_ref_sap, customer_short_name, customer_full_name,
            currency, packaging_version, price_list_managed_by, customer_spoc,
            effective, mailing_date, last_price_list_version, last_price_list_id,
            email_to_customer, email_internal_copy, email_pbp_copy, email_pbp_common
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        for (const r of rows.slice(1)) {
          const ref = clean(r[5]);
          if (!ref) continue;
          insertCust.run(
            clean(r[0]), clean(r[1]), clean(r[2]), clean(r[3]),
            clean(r[4]), ref,
            clean(r[6]) ?? ref, clean(r[7]) ?? ref,
            clean(r[8]) ?? 'USD', clean(r[9]) ?? 'USD-Standard',
            clean(r[10]), clean(r[11]),
            excelDateToISO(r[12] as number), excelDateToISO(r[13] as number),
            clean(r[14]), clean(r[15]),
            clean(r[16]), clean(r[17]), clean(r[18]), clean(r[19]),
          );
          counts.customers++;
        }
      }

      // 3. Products
      const prodSheet = getSheet('Products Masterdata');
      if (prodSheet) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(prodSheet, { header: 1 }) as unknown[][];
        const insertProd = db.prepare('INSERT OR REPLACE INTO products (plant, product_type, rip_code, product_name) VALUES (?,?,?,?)');
        for (const r of rows.slice(1)) {
          const rip = clean(r[2]);
          if (!rip) continue;
          insertProd.run(clean(r[0]), clean(r[1]), rip, clean(r[3]));
          counts.products++;
        }
      }

      // 4. Standard EPL (USD cols 0-5, EUR cols 6-11)
      const eplSheet = getSheet('Standard EPL');
      if (eplSheet) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(eplSheet, { header: 1 }) as unknown[][];
        const insertEpl = db.prepare('INSERT OR REPLACE INTO standard_epl (currency, product_type, rip_code, product_name, net_price, unit) VALUES (?,?,?,?,?,?)');
        for (const r of rows.slice(1)) {
          // USD side
          const ripUsd = clean(r[1]);
          if (ripUsd) {
            const price = safeFloat(r[3]);
            if (price !== null) {
              insertEpl.run('USD', clean(r[0]), ripUsd, clean(r[2]), price, clean(r[5]) ?? '100 KG');
              counts.standardEpl++;
            }
          }
          // EUR side — cols 8-13 (cols 6-7 are empty separators between the two tables)
          const ripEur = clean(r[9]);
          if (ripEur) {
            const price = safeFloat(r[11]);
            if (price !== null) {
              insertEpl.run('EUR', clean(r[8]), ripEur, clean(r[10]), price, clean(r[13]) ?? '100 KG');
              counts.standardEpl++;
            }
          }
        }
      }

      // 5. Packaging
      const pkgSheet = getSheet('Packaging Masterdata');
      if (pkgSheet) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(pkgSheet, { header: 1 }) as unknown[][];
        const insertPkg = db.prepare('INSERT INTO packaging (packaging_version, product_type, packaging_name, price, currency, unit, sort_order) VALUES (?,?,?,?,?,?,?)');
        db.prepare('DELETE FROM packaging').run(); // reset before reimport
        let version = '';
        let sortOrder = 0;
        for (const r of rows) {
          const col0 = clean(r[0]);
          const col1 = clean(r[1]);
          const col2 = clean(r[2]);

          if (col0 && col0 !== 'Packagin Version' && col0 !== 'Packaging Version') {
            version = col0;
          }
          if (!version || (!col1 && !col2)) { sortOrder++; continue; }

          const price = safeFloat(r[3]);
          const currency = clean(r[4]) ?? version.includes('EUR') ? 'EUR' : 'USD';
          insertPkg.run(version, col1 ?? '', col2 ?? '', price, currency, clean(r[5]), sortOrder++);
          counts.packaging++;
        }
      }

      // 6. Prices Database
      const dbSheet = getSheet('Prices Database');
      if (dbSheet) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(dbSheet, { header: 1 }) as unknown[][];
        const insertPL = db.prepare(`
          INSERT OR REPLACE INTO price_lists (price_list_id, customer_ref_sap, sap_plant, effective, mailing_date, price_list_version, comments_about_changes, price_type, discount_percent)
          VALUES (?,?,?,?,?,?,?,?,?)
        `);
        const insertPLE = db.prepare(`
          INSERT INTO price_list_entries (price_list_id, product_type, rip_code, product_name, net_price, currency, unit)
          VALUES (?,?,?,?,?,?,?)
        `);

        // Detect column layout once from the header row.
        // 16-col layout: [0]=SAP Plant, [1]=Customer ref, [2]=Effective, [3]=Mailing date,
        //   [4]=Customer Short Name, [5]=Version, [6]=Comments, [7]=Price Type, [8]=Discount%,
        //   [9]=Price List ID, [10]=Product type, [11]=RIP, [12]=Product, [13]=Net price,
        //   [14]=Currency, [15]=Unit.
        // 15-col layout (no SAP Plant): same but shifted left by 1.
        const header = rows[0] as unknown[];
        const offset = String(header[0] ?? '').toLowerCase().includes('plant') ? 1 : 0;

        const seenPriceLists = new Set<string>();

        for (const r of rows.slice(1)) {
          // Skip blank/spacer rows — only process rows that have a rip code
          const rip = clean(r[offset + 10]);
          if (!rip) continue;

          const sap_plant = offset === 1 ? clean(r[0]) : null;
          const customer_ref_sap = clean(r[offset]);
          const effective = excelDateToISO(r[offset + 1] as number);
          const mailing_date = excelDateToISO(r[offset + 2] as number);
          const price_list_version = clean(r[offset + 4]) ?? 'V1';
          const comments = clean(r[offset + 5]);
          let price_type = clean(r[offset + 6]) ?? 'Net Price';
          let discount_pct_raw = r[offset + 7];
          const price_list_id = clean(r[offset + 8]);
          const prod_type = clean(r[offset + 9]);
          const prod_name = clean(r[offset + 11]);
          const net_price = safeFloat(r[offset + 12]);
          const currency = clean(r[offset + 13]);
          const unit = clean(r[offset + 14]);

          if (!customer_ref_sap || !price_list_id || net_price === null) continue;

          // Normalize price type
          if (clean(discount_pct_raw as unknown) === 'Net Price') {
            price_type = 'Net Price';
            discount_pct_raw = null;
          }
          const discount_percent = price_type === 'Discount' && discount_pct_raw !== null
            ? (safeFloat(discount_pct_raw as unknown) ?? 0) * 100
            : null;

          if (!seenPriceLists.has(price_list_id)) {
            seenPriceLists.add(price_list_id);
            // Clear existing entries so re-importing doesn't create duplicates
            db.prepare('DELETE FROM price_list_entries WHERE price_list_id = ?').run(price_list_id);
            insertPL.run(
              price_list_id, customer_ref_sap, sap_plant,
              effective, mailing_date,
              price_list_version, comments,
              price_type === 'Discount' ? 'Discount' : 'Net Price',
              discount_percent,
            );
            counts.priceLists++;
          }

          insertPLE.run(price_list_id, prod_type, rip, prod_name, net_price, currency, unit);
          counts.priceListEntries++;
        }
      }

      return { success: true, counts };
    } catch (err) {
      return { success: false, counts, error: (err as Error).message };
    }
  });
}
