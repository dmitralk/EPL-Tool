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
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  });

  ipcMain.handle('products:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
  });
}
