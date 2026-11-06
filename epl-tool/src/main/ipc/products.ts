import { getDb } from '../database';
import { audit, diffFields } from '../audit';
import { handle } from './guard';
import type { Product } from '../../types';

const DENIED = 'Only admins can change products.';
const EDITABLE = ['plant', 'product_type', 'product_name'] as const;

export function registerProductHandlers() {
  handle('products:list', 'viewer', () => {
    return getDb()
      .prepare('SELECT * FROM products ORDER BY product_type, rip_code')
      .all() as Product[];
  });

  handle('products:create', 'admin', (_e, data: Omit<Product, 'id'>) => {
    const db = getDb();
    const id = db.transaction(() => {
      const result = db
        .prepare('INSERT INTO products (plant, product_type, rip_code, product_name) VALUES (@plant, @product_type, @rip_code, @product_name)')
        .run({ plant: data.plant ?? null, product_type: data.product_type, rip_code: data.rip_code, product_name: data.product_name });
      audit(db, { action: 'product.create', entityType: 'product', entityKey: data.rip_code,
        summary: `Added product ${data.rip_code} — ${data.product_name} (${data.product_type})` });
      return result.lastInsertRowid;
    })();
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  }, DENIED);

  handle('products:update', 'admin', (_e, id: number, data: Partial<Product>) => {
    const db = getDb();
    const rejected = Object.keys(data).filter(k => !(EDITABLE as readonly string[]).includes(k));
    if (rejected.length) throw new Error(`These product fields can't be changed: ${rejected.join(', ')}.`);
    const before = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
    if (!before) throw new Error('Product not found.');
    const keys = Object.keys(data);
    const changes = diffFields(before as unknown as Record<string, unknown>, data as Record<string, unknown>, keys);
    if (Object.keys(changes).length) {
      db.transaction(() => {
        db.prepare(`UPDATE products SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...data, id });
        const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product;
        if ('product_name' in changes || 'product_type' in changes) {
          db.prepare('UPDATE standard_epl SET product_name = ?, product_type = ? WHERE rip_code = ?')
            .run(updated.product_name, updated.product_type, updated.rip_code);
        }
        audit(db, { action: 'product.update', entityType: 'product', entityKey: before.rip_code,
          summary: `Updated product ${before.rip_code}: ${Object.keys(changes).join(', ')}`, details: changes });
      })();
    }
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product;
  }, DENIED);

  handle('products:delete', 'admin', (_e, id: number) => {
    const db = getDb();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
    if (!product) return;
    db.transaction(() => {
      db.prepare('DELETE FROM standard_epl WHERE rip_code = ?').run(product.rip_code);
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
      audit(db, { action: 'product.delete', entityType: 'product', entityKey: product.rip_code,
        summary: `Deleted product ${product.rip_code} — ${product.product_name} (and its Standard EPL prices)` });
    })();
  }, DENIED);
}
