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
}
