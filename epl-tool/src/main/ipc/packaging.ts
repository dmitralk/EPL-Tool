import { getDb } from '../database';
import { audit, diffFields } from '../audit';
import { handle } from './guard';
import type { PackagingRow } from '../../types';

const DENIED = 'Only admins can change packaging.';

export function registerPackagingHandlers() {
  handle('packaging:list', 'viewer', (_e, packaging_version?: string) => {
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

  handle('packaging:list-versions', 'viewer', () => {
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

  handle('packaging:create-version', 'admin', (_e, name: string, cloneFrom?: string) => {
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
        audit(db, { action: 'packaging.version-create', entityType: 'packaging', entityKey: trimmed,
          summary: `Created packaging version ${trimmed} from ${cloneFrom} (${sourceRows.length} rows)` });
      })();
    } else {
      audit(db, { action: 'packaging.version-create', entityType: 'packaging', entityKey: trimmed,
        summary: `Created empty packaging version ${trimmed}` });
    }

    return { ok: true };
  }, DENIED);

  handle('packaging:delete-version', 'admin', (_e, version: string) => {
    const db = getDb();
    const inUse = (
      db.prepare('SELECT COUNT(*) AS n FROM customers WHERE packaging_version = ?').get(version) as { n: number }
    ).n;
    if (inUse > 0)
      return {
        ok: false,
        error: `Cannot delete — ${inUse} customer${inUse > 1 ? 's' : ''} use this version. Reassign them first.`,
      };
    db.transaction(() => {
      const n = db.prepare('DELETE FROM packaging WHERE packaging_version = ?').run(version).changes;
      audit(db, { action: 'packaging.version-delete', entityType: 'packaging', entityKey: version,
        summary: `Deleted packaging version ${version} (${n} rows)` });
    })();
    return { ok: true };
  }, DENIED);

  handle('packaging:add-row', 'admin', (_e, row: Omit<PackagingRow, 'id'>) => {
    const db = getDb();
    const id = db.transaction(() => {
      const result = db
        .prepare(
          'INSERT INTO packaging (packaging_version, product_type, packaging_name, price, currency, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(row.packaging_version, row.product_type, row.packaging_name, row.price, row.currency, row.unit, row.sort_order);
      audit(db, { action: 'packaging.row-add', entityType: 'packaging', entityKey: row.packaging_version,
        summary: `Packaging ${row.packaging_version}: added ${row.product_type} / ${row.packaging_name}` +
          (row.price === null ? ' (label)' : ` ${row.price} ${row.currency}`) });
      return result.lastInsertRowid;
    })();
    return db.prepare('SELECT * FROM packaging WHERE id = ?').get(id);
  }, DENIED);

  handle('packaging:update-row', 'admin', (_e, id: number, fields: Record<string, unknown>) => {
    const db = getDb();
    const allowed = ['product_type', 'packaging_name', 'price', 'currency', 'unit', 'sort_order'];
    const updates = Object.keys(fields).filter(k => allowed.includes(k));
    if (updates.length === 0) return;
    const before = db.prepare('SELECT * FROM packaging WHERE id = ?').get(id) as PackagingRow | undefined;
    if (!before) throw new Error('Packaging row not found.');
    const next = Object.fromEntries(updates.map(k => [k, fields[k] ?? null]));
    const changes = diffFields(before as unknown as Record<string, unknown>, next, updates);
    if (Object.keys(changes).length === 0) return;
    db.transaction(() => {
      db.prepare(`UPDATE packaging SET ${updates.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...updates.map(k => fields[k] ?? null), id);
      audit(db, { action: 'packaging.row-update', entityType: 'packaging', entityKey: before.packaging_version,
        summary: `Packaging ${before.packaging_version}: updated ${before.packaging_name} (${Object.keys(changes).join(', ')})`,
        details: changes });
    })();
  }, DENIED);

  handle('packaging:delete-row', 'admin', (_e, id: number) => {
    const db = getDb();
    const before = db.prepare('SELECT * FROM packaging WHERE id = ?').get(id) as PackagingRow | undefined;
    if (!before) return;
    db.transaction(() => {
      db.prepare('DELETE FROM packaging WHERE id = ?').run(id);
      audit(db, { action: 'packaging.row-delete', entityType: 'packaging', entityKey: before.packaging_version,
        summary: `Packaging ${before.packaging_version}: removed ${before.product_type} / ${before.packaging_name}` });
    })();
  }, DENIED);
}
