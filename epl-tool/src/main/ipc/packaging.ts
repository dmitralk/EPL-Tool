import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { PackagingRow } from '../../types';

export function registerPackagingHandlers() {
  ipcMain.handle('packaging:list', (_e, packaging_version?: string) => {
    const db = getDb();
    if (packaging_version) {
      return db
        .prepare('SELECT * FROM packaging WHERE packaging_version = ? ORDER BY sort_order')
        .all(packaging_version) as PackagingRow[];
    }
    return db
      .prepare('SELECT * FROM packaging ORDER BY packaging_version, sort_order')
      .all() as PackagingRow[];
  });

  ipcMain.handle('packaging:update-price', (_e, id: number, price: number) => {
    getDb().prepare('UPDATE packaging SET price = ? WHERE id = ?').run(price, id);
  });

  ipcMain.handle('packaging:list-versions', () => {
    return getDb().prepare(`
      SELECT
        p.packaging_version AS version,
        MIN(p.currency) AS currency,
        COUNT(*) AS row_count,
        (SELECT COUNT(*) FROM customers WHERE packaging_version = p.packaging_version) AS customer_count
      FROM packaging p
      GROUP BY p.packaging_version
      ORDER BY p.packaging_version
    `).all();
  });

  ipcMain.handle('packaging:create-version', (_e, name: string, cloneFrom?: string) => {
    const db = getDb();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: 'Name is required.' };

    const exists = db.prepare('SELECT 1 FROM packaging WHERE packaging_version = ?').get(trimmed);
    if (exists) return { ok: false, error: `Version "${trimmed}" already exists.` };

    if (cloneFrom) {
      const sourceRows = db
        .prepare('SELECT * FROM packaging WHERE packaging_version = ? ORDER BY sort_order')
        .all(cloneFrom) as PackagingRow[];
      if (sourceRows.length === 0)
        return { ok: false, error: `Source version "${cloneFrom}" not found or empty.` };

      const insert = db.prepare(
        'INSERT INTO packaging (packaging_version, product_type, packaging_name, price, currency, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      db.transaction(() => {
        for (const row of sourceRows) {
          insert.run(trimmed, row.product_type, row.packaging_name, row.price, row.currency, row.unit, row.sort_order);
        }
      })();
    }

    return { ok: true };
  });

  ipcMain.handle('packaging:delete-version', (_e, version: string) => {
    const db = getDb();
    const inUse = (
      db.prepare('SELECT COUNT(*) AS n FROM customers WHERE packaging_version = ?').get(version) as { n: number }
    ).n;
    if (inUse > 0)
      return {
        ok: false,
        error: `Cannot delete — ${inUse} customer${inUse > 1 ? 's' : ''} use this version. Reassign them first.`,
      };
    db.prepare('DELETE FROM packaging WHERE packaging_version = ?').run(version);
    return { ok: true };
  });

  ipcMain.handle('packaging:add-row', (_e, row: Omit<PackagingRow, 'id'>) => {
    const db = getDb();
    const result = db
      .prepare(
        'INSERT INTO packaging (packaging_version, product_type, packaging_name, price, currency, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(row.packaging_version, row.product_type, row.packaging_name, row.price, row.currency, row.unit, row.sort_order);
    return db.prepare('SELECT * FROM packaging WHERE id = ?').get(result.lastInsertRowid);
  });

  ipcMain.handle('packaging:update-row', (_e, id: number, fields: Record<string, unknown>) => {
    const db = getDb();
    const allowed = ['product_type', 'packaging_name', 'price', 'currency', 'unit', 'sort_order'];
    const updates = Object.keys(fields).filter(k => allowed.includes(k));
    if (updates.length === 0) return;
    const sql = `UPDATE packaging SET ${updates.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...updates.map(k => fields[k] ?? null), id);
  });

  ipcMain.handle('packaging:delete-row', (_e, id: number) => {
    getDb().prepare('DELETE FROM packaging WHERE id = ?').run(id);
  });
}
