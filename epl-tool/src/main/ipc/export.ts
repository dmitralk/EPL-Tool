import { ipcMain, dialog } from 'electron';
import fs from 'fs';
import { getDb } from '../database';
import { buildPriceListXlsx } from '../export/buildPriceListXlsx';
import type { PriceListFull, Customer, PackagingRow } from '../../types';

export function registerExportHandlers() {
  ipcMain.handle('export:xlsx', async (_e, price_list_id: string) => {
    const db = getDb();

    const priceList = (() => {
      const header = db.prepare(`
        SELECT pl.*, c.customer_short_name
        FROM price_lists pl
        LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
        WHERE pl.price_list_id = ?
      `).get(price_list_id) as PriceListFull;

      header.entries = db
        .prepare('SELECT * FROM price_list_entries WHERE price_list_id = ? ORDER BY product_type, rip_code')
        .all(price_list_id) as PriceListFull['entries'];

      return header;
    })();

    const customer = db
      .prepare('SELECT * FROM customers WHERE customer_ref_sap = ?')
      .get(priceList.customer_ref_sap) as Customer;

    const packaging = db
      .prepare('SELECT * FROM packaging WHERE packaging_version = ? ORDER BY sort_order')
      .all(customer.packaging_version) as PackagingRow[];

    const adminEmailRow = db
      .prepare("SELECT email FROM admin_emails WHERE email_name LIKE '%Common%' OR email_name LIKE '%common%' LIMIT 1")
      .get() as { email: string } | undefined;
    const adminEmail = adminEmailRow?.email ?? '';

    const logoPath = (db
      .prepare("SELECT value FROM app_settings WHERE key = 'logo_path'")
      .get() as { value: string } | undefined)?.value ?? null;

    const suggestedName = `${customer.customer_short_name}-${priceList.effective}-${priceList.price_list_version}-LM-EPL.xlsx`;

    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });

    if (canceled || !filePath) return { saved: false };

    try {
      const buffer = await buildPriceListXlsx({ priceList, customer, packaging, logoPath, adminEmail });
      fs.writeFileSync(filePath, buffer);
      return { saved: true, path: filePath };
    } catch (err) {
      return { saved: false, error: (err as Error).message };
    }
  });
}
