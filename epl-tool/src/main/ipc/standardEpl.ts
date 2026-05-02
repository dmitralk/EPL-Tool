import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { StandardEplRow, CombinedEplRow } from '../../types';

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

  ipcMain.handle('standard-epl:list-combined', () => {
    return getDb().prepare(`
      SELECT
        p.id, p.rip_code, p.product_type, p.product_name, p.plant,
        usd.id as usd_id, usd.net_price as usd_price, usd.unit as usd_unit,
        eur.id as eur_id, eur.net_price as eur_price, eur.unit as eur_unit
      FROM products p
      LEFT JOIN standard_epl usd ON usd.rip_code = p.rip_code AND usd.currency = 'USD'
      LEFT JOIN standard_epl eur ON eur.rip_code = p.rip_code AND eur.currency = 'EUR'
      ORDER BY p.product_type, p.rip_code
    `).all() as CombinedEplRow[];
  });

  ipcMain.handle('standard-epl:update-price', (_e, id: number, net_price: number) => {
    getDb().prepare('UPDATE standard_epl SET net_price = ? WHERE id = ?').run(net_price, id);
  });

  ipcMain.handle('standard-epl:upsert', (_e, data: { rip_code: string; product_type: string; product_name: string; currency: 'USD' | 'EUR'; net_price: number; unit: string }) => {
    getDb().prepare(`
      INSERT INTO standard_epl (currency, product_type, rip_code, product_name, net_price, unit)
      VALUES (@currency, @product_type, @rip_code, @product_name, @net_price, @unit)
      ON CONFLICT (currency, rip_code) DO UPDATE SET
        net_price = excluded.net_price,
        unit = excluded.unit,
        product_name = excluded.product_name,
        product_type = excluded.product_type
    `).run(data);
  });
}
