import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { StandardEplRow } from '../../types';

export function registerStandardEplHandlers() {
  ipcMain.handle('standard-epl:list', (_e, currency?: 'USD' | 'EUR') => {
    const db = getDb();
    if (currency) {
      return db
        .prepare('SELECT * FROM standard_epl WHERE currency = ? ORDER BY product_type, rip_code')
        .all(currency) as StandardEplRow[];
    }
    return db
      .prepare('SELECT * FROM standard_epl ORDER BY currency, product_type, rip_code')
      .all() as StandardEplRow[];
  });

  ipcMain.handle('standard-epl:update-price', (_e, id: number, net_price: number) => {
    getDb().prepare('UPDATE standard_epl SET net_price = ? WHERE id = ?').run(net_price, id);
  });
}
