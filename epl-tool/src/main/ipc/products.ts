import { ipcMain } from 'electron';
import { getDb } from '../database';
import type { Product } from '../../types';

export function registerProductHandlers() {
  ipcMain.handle('products:list', () => {
    return getDb()
      .prepare('SELECT * FROM products ORDER BY product_type, rip_code')
      .all() as Product[];
  });

  ipcMain.handle('products:create', (_e, data: Omit<Product, 'id'>) => {
    const db = getDb();
    const result = db
      .prepare('INSERT INTO products (plant, product_type, rip_code, product_name) VALUES (@plant, @product_type, @rip_code, @product_name)')
      .run(data);
    return db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  });

  ipcMain.handle('products:update', (_e, id: number, data: Partial<Product>) => {
    const db = getDb();
    const fields = Object.keys(data).filter(k => k !== 'id').map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE products SET ${fields} WHERE id = @id`).run({ ...data, id });
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product;
    if ('product_name' in data || 'product_type' in data) {
      db.prepare('UPDATE standard_epl SET product_name = ?, product_type = ? WHERE rip_code = ?')
        .run(updated.product_name, updated.product_type, updated.rip_code);
    }
    return updated;
  });

  ipcMain.handle('products:delete', (_e, id: number) => {
    const db = getDb();
    const product = db.prepare('SELECT rip_code FROM products WHERE id = ?').get(id) as Product | undefined;
    if (product) {
      db.prepare('DELETE FROM standard_epl WHERE rip_code = ?').run(product.rip_code);
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  });
}
