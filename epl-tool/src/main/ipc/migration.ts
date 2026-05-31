import { ipcMain, dialog } from 'electron';
import { getDb, isOpen } from '../database';
import type { MigrationResult, ImportPreview, ImportOptions, SheetPreview } from '../../types';
import * as XLSX from 'xlsx';

function excelDateToISO(serial: number | string | null | undefined): string | null {
  if (serial === null || serial === undefined || serial === '') return null;
  if (typeof serial === 'string') {
    const trimmed = serial.trim();
    if (trimmed.match(/^\d{4}-\d{2}-\d{2}$/)) return trimmed;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
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
  const s = String(v).trim().replace(/ /g, '');
  return s === '' ? null : s;
}

// Like clean() but preserves internal spaces — use for human-readable names/labels.
function trimOnly(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function emptySheet(): SheetPreview {
  return { available: false, count: 0, skipped: 0, notes: [], samples: [] };
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

  // Read-only scan — no DB writes
  ipcMain.handle('migration:preview-excel', async (_e, filePath: string): Promise<ImportPreview> => {
    const result: ImportPreview = {
      success: true,
      adminEmails: emptySheet(),
      customers: emptySheet(),
      products: emptySheet(),
      standardEpl: emptySheet(),
      packaging: emptySheet(),
      priceLists: emptySheet(),
    };

    try {
      const wb = XLSX.readFile(filePath, { cellDates: false });
      const getSheet = (name: string) => wb.Sheets[name];

      // 1. Admin emails
      const adminSheet = getSheet('Admin');
      if (adminSheet) {
        result.adminEmails.available = true;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(adminSheet, { header: 1 }) as unknown[][];
        for (const row of rows.slice(1)) {
          const name = String(row[0] ?? '').trim() || null;  // preserve spaces in display name
          const email = clean(row[1]);
          if (name && email) {
            result.adminEmails.count++;
            if (result.adminEmails.samples.length < 3) result.adminEmails.samples.push(name);
          } else {
            result.adminEmails.skipped++;
          }
        }
      }

      // 2. Customers
      const custSheet = getSheet('Customers Masterdata');
      if (custSheet) {
        result.customers.available = true;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(custSheet, { header: 1 }) as unknown[][];
        for (const r of rows.slice(1)) {
          const ref = clean(r[5]);
          if (ref) {
            result.customers.count++;
            if (result.customers.samples.length < 3) {
              result.customers.samples.push(trimOnly(r[6]) ?? ref);
            }
          } else {
            result.customers.skipped++;
          }
        }
        if (result.customers.skipped > 0) {
          result.customers.notes.push(`${result.customers.skipped} rows skipped — missing SAP ref`);
        }
      }

      // 3. Products
      const prodSheet = getSheet('Products Masterdata');
      if (prodSheet) {
        result.products.available = true;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(prodSheet, { header: 1 }) as unknown[][];
        for (const r of rows.slice(1)) {
          const rip = clean(r[2]);
          if (rip) {
            result.products.count++;
            if (result.products.samples.length < 3) {
              result.products.samples.push(trimOnly(r[3]) ?? rip);
            }
          } else {
            result.products.skipped++;
          }
        }
      }

      // 4. Standard EPL (USD cols 0-5, EUR cols 8-13)
      const eplSheet = getSheet('Standard EPL');
      if (eplSheet) {
        result.standardEpl.available = true;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(eplSheet, { header: 1 }) as unknown[][];
        let usdCount = 0, eurCount = 0;
        for (const r of rows.slice(1)) {
          if (clean(r[1]) && safeFloat(r[3]) !== null) usdCount++;
          if (clean(r[9]) && safeFloat(r[11]) !== null) eurCount++;
        }
        result.standardEpl.count = usdCount + eurCount;
        result.standardEpl.notes.push(`USD: ${usdCount} rows`, `EUR: ${eurCount} rows`);
      }

      // 5. Packaging
      const pkgSheet = getSheet('Packaging Masterdata');
      if (pkgSheet) {
        result.packaging.available = true;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(pkgSheet, { header: 1 }) as unknown[][];
        const versions: string[] = [];
        let version = '';
        for (const r of rows) {
          const col0 = clean(r[0]);     // space-stripped for header detection
          const col1 = trimOnly(r[1]);  // product_type — preserve spaces
          const col2 = trimOnly(r[2]);  // packaging_name — preserve spaces
          if (col0 && col0 !== 'PackaginVersion' && col0 !== 'PackagingVersion') {
            version = trimOnly(r[0]) ?? col0;
            if (!versions.includes(version)) versions.push(version);
          }
          if (!version || (!col1 && !col2)) continue;
          result.packaging.count++;
        }
        const versionLabel = versions.length <= 3
          ? versions.join(', ')
          : `${versions.slice(0, 3).join(', ')} +${versions.length - 3} more`;
        result.packaging.notes.push(`${versions.length} version${versions.length !== 1 ? 's' : ''}: ${versionLabel}`);
        result.packaging.notes.push('Existing packaging data will be fully replaced on import');
      }

      // 6. Price Lists
      const dbSheet = getSheet('Prices Database');
      if (dbSheet) {
        result.priceLists.available = true;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(dbSheet, { header: 1 }) as unknown[][];
        const header = rows[0] as unknown[];
        const offset = String(header[0] ?? '').toLowerCase().includes('plant') ? 1 : 0;

        const seenIds = new Set<string>();
        const seenCustomers = new Set<string>();
        let minDate = '9999-12-31', maxDate = '0000-01-01';
        let entryCount = 0;

        for (const r of rows.slice(1)) {
          const rip = clean(r[offset + 10]);
          if (!rip) continue;
          const customerRef = clean(r[offset]);
          const priceListId = clean(r[offset + 8]);
          const netPrice = safeFloat(r[offset + 12]);
          if (!customerRef || !priceListId || netPrice === null) continue;

          if (!seenIds.has(priceListId)) {
            seenIds.add(priceListId);
            seenCustomers.add(customerRef);
            const effective = excelDateToISO(r[offset + 1] as number);
            if (effective) {
              if (effective < minDate) minDate = effective;
              if (effective > maxDate) maxDate = effective;
            }
          }
          entryCount++;
        }

        result.priceLists.count = seenIds.size;
        result.priceLists.notes.push(`${seenIds.size} price lists · ${entryCount.toLocaleString()} entries`);
        result.priceLists.notes.push(`${seenCustomers.size} customers`);
        if (minDate !== '9999-12-31' && maxDate !== '0000-01-01') {
          result.priceLists.notes.push(`Date range: ${minDate} → ${maxDate}`);
        }
      }

      return result;
    } catch (err) {
      return { ...result, success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('migration:import-excel', async (_e, filePath: string, options?: ImportOptions): Promise<MigrationResult> => {
    const opts: ImportOptions = options ?? {
      adminEmails: true, customers: true, products: true,
      standardEpl: true, packaging: true, priceLists: true,
    };

    const counts = { customers: 0, products: 0, standardEpl: 0, packaging: 0, priceLists: 0, priceListEntries: 0, adminEmails: 0 };

    if (!isOpen()) {
      return { success: false, counts, error: 'No database is open. Open or create a database first (use "Change Database" in the sidebar).' };
    }

    try {
      const wb = XLSX.readFile(filePath, { cellDates: false });
      const db = getDb();
      const getSheet = (name: string) => wb.Sheets[name];

      // 1. Admin emails
      if (opts.adminEmails) {
        const adminSheet = getSheet('Admin');
        if (adminSheet) {
          const rows = XLSX.utils.sheet_to_json<string[]>(adminSheet, { header: 1 }) as unknown[][];
          // Collect valid rows first, then delete-all + re-insert to clear any stale records
          const emailRows: [string, string][] = [];
          for (const row of rows.slice(1)) {
            const name = String(row[0] ?? '').trim() || null;  // preserve spaces in display name
            const email = clean(row[1]);
            if (name && email) emailRows.push([name, email]);
          }
          if (emailRows.length > 0) {
            db.prepare('DELETE FROM admin_emails').run();
            const insertEmail = db.prepare('INSERT INTO admin_emails (email_name, email) VALUES (?, ?)');
            for (const [name, email] of emailRows) {
              insertEmail.run(name, email);
              counts.adminEmails++;
            }
          }
        }
      }

      // 2. Customers
      if (opts.customers) {
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
              clean(r[0]), trimOnly(r[1]), trimOnly(r[2]), trimOnly(r[3]),
              clean(r[4]), ref,
              trimOnly(r[6]) ?? ref, trimOnly(r[7]) ?? ref,
              clean(r[8]) ?? 'USD', clean(r[9]) ?? 'USD-Standard',
              trimOnly(r[10]), trimOnly(r[11]),
              excelDateToISO(r[12] as number), excelDateToISO(r[13] as number),
              clean(r[14]), clean(r[15]),
              clean(r[16]), clean(r[17]), clean(r[18]), clean(r[19]),
            );
            counts.customers++;
          }
        }
      }

      // 3. Products
      if (opts.products) {
        const prodSheet = getSheet('Products Masterdata');
        if (prodSheet) {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(prodSheet, { header: 1 }) as unknown[][];
          const insertProd = db.prepare('INSERT OR REPLACE INTO products (plant, product_type, rip_code, product_name) VALUES (?,?,?,?)');
          for (const r of rows.slice(1)) {
            const rip = clean(r[2]);
            if (!rip) continue;
            insertProd.run(clean(r[0]), trimOnly(r[1]), rip, trimOnly(r[3]));
            counts.products++;
          }
        }
      }

      // 4. Standard EPL (USD cols 0-5, EUR cols 8-13)
      if (opts.standardEpl) {
        const eplSheet = getSheet('Standard EPL');
        if (eplSheet) {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(eplSheet, { header: 1 }) as unknown[][];
          const insertEpl = db.prepare('INSERT OR REPLACE INTO standard_epl (currency, product_type, rip_code, product_name, net_price, unit) VALUES (?,?,?,?,?,?)');
          for (const r of rows.slice(1)) {
            const ripUsd = clean(r[1]);
            if (ripUsd) {
              const price = safeFloat(r[3]);
              if (price !== null) {
                insertEpl.run('USD', trimOnly(r[0]), ripUsd, trimOnly(r[2]), price, trimOnly(r[5]) ?? '100 KG');
                counts.standardEpl++;
              }
            }
            const ripEur = clean(r[9]);
            if (ripEur) {
              const price = safeFloat(r[11]);
              if (price !== null) {
                insertEpl.run('EUR', trimOnly(r[8]), ripEur, trimOnly(r[10]), price, trimOnly(r[13]) ?? '100 KG');
                counts.standardEpl++;
              }
            }
          }
        }
      }

      // 5. Packaging
      if (opts.packaging) {
        const pkgSheet = getSheet('Packaging Masterdata');
        if (pkgSheet) {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(pkgSheet, { header: 1 }) as unknown[][];
          const insertPkg = db.prepare('INSERT INTO packaging (packaging_version, product_type, packaging_name, price, currency, unit, sort_order) VALUES (?,?,?,?,?,?,?)');
          db.prepare('DELETE FROM packaging').run();
          let version = '';
          let sortOrder = 0;
          for (const r of rows) {
            const col0 = clean(r[0]);     // space-stripped for header detection
            const col1 = trimOnly(r[1]);  // product_type — preserve spaces
            const col2 = trimOnly(r[2]);  // packaging_name — preserve spaces
            if (col0 && col0 !== 'PackaginVersion' && col0 !== 'PackagingVersion') {
              version = trimOnly(r[0]) ?? col0;
            }
            if (!version || (!col1 && !col2)) { sortOrder++; continue; }
            const price = safeFloat(r[3]);
            const currency = clean(r[4]) ?? (version.includes('EUR') ? 'EUR' : 'USD');
            insertPkg.run(version, col1 ?? '', col2 ?? '', price, currency, clean(r[5]), sortOrder++);
            counts.packaging++;
          }
        }
      }

      // 6. Price Lists
      if (opts.priceLists) {
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

          const header = rows[0] as unknown[];
          const offset = String(header[0] ?? '').toLowerCase().includes('plant') ? 1 : 0;
          const seenPriceLists = new Set<string>();

          for (const r of rows.slice(1)) {
            const rip = clean(r[offset + 10]);
            if (!rip) continue;

            const sap_plant = offset === 1 ? clean(r[0]) : null;
            const customer_ref_sap = clean(r[offset]);
            const effective = excelDateToISO(r[offset + 1] as number);
            const mailing_date = excelDateToISO(r[offset + 2] as number);
            const price_list_version = clean(r[offset + 4]) ?? 'V1';
            const comments = trimOnly(r[offset + 5]);
            let price_type = clean(r[offset + 6]) ?? 'Net Price';
            let discount_pct_raw = r[offset + 7];
            const price_list_id = clean(r[offset + 8]);
            const prod_type = trimOnly(r[offset + 9]);
            const prod_name = trimOnly(r[offset + 11]);
            const net_price = safeFloat(r[offset + 12]);
            const currency = clean(r[offset + 13]);
            const unit = trimOnly(r[offset + 14]);

            if (!customer_ref_sap || !price_list_id || net_price === null) continue;

            if (clean(discount_pct_raw as unknown) === 'Net Price') {
              price_type = 'Net Price';
              discount_pct_raw = null;
            }
            const discount_percent = price_type === 'Discount' && discount_pct_raw !== null
              ? (safeFloat(discount_pct_raw as unknown) ?? 0) * 100
              : null;

            if (!seenPriceLists.has(price_list_id)) {
              seenPriceLists.add(price_list_id);
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
      }

      return { success: true, counts };
    } catch (err) {
      return { success: false, counts, error: (err as Error).message };
    }
  });
}
