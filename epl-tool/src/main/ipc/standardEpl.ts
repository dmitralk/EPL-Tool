import { ipcMain } from 'electron';
import { getDb, getLatestPublishedEplVersionId } from '../database';
import type { StandardEplRow, CombinedEplRow, StandardEplVersion } from '../../types';

function getDraftVersion(db: ReturnType<typeof getDb>): StandardEplVersion | undefined {
  return db.prepare(
    `SELECT * FROM standard_epl_versions WHERE status='draft' LIMIT 1`
  ).get() as StandardEplVersion | undefined;
}

export function registerStandardEplHandlers() {
  ipcMain.handle('standard-epl:list-versions', () => {
    return getDb().prepare(`
      SELECT v.*,
        (SELECT COUNT(*) FROM standard_epl WHERE version_id = v.version_id) AS row_count
      FROM standard_epl_versions v
      ORDER BY
        CASE WHEN v.status = 'draft' THEN 0 ELSE 1 END,
        v.published_at DESC, v.version_id DESC
    `).all() as (StandardEplVersion & { row_count: number })[];
  });

  ipcMain.handle('standard-epl:list', (_e, currency?: 'USD' | 'EUR', versionId?: number) => {
    const db = getDb();
    const vid = versionId ?? getLatestPublishedEplVersionId();
    if (currency) {
      return db
        .prepare('SELECT * FROM standard_epl WHERE currency = ? AND version_id = ? ORDER BY product_type, rip_code')
        .all(currency, vid) as StandardEplRow[];
    }
    return db
      .prepare('SELECT * FROM standard_epl WHERE version_id = ? ORDER BY currency, product_type, rip_code')
      .all(vid) as StandardEplRow[];
  });

  ipcMain.handle('standard-epl:list-combined', (_e, versionId?: number) => {
    const db = getDb();
    const vid = versionId ?? getLatestPublishedEplVersionId();
    return db.prepare(`
      SELECT
        p.id, p.rip_code, p.product_type, p.product_name, p.plant,
        usd.id as usd_id, usd.net_price as usd_price, usd.unit as usd_unit,
        eur.id as eur_id, eur.net_price as eur_price, eur.unit as eur_unit
      FROM products p
      LEFT JOIN standard_epl usd ON usd.rip_code = p.rip_code AND usd.currency = 'USD' AND usd.version_id = ?
      LEFT JOIN standard_epl eur ON eur.rip_code = p.rip_code AND eur.currency = 'EUR' AND eur.version_id = ?
      WHERE usd.id IS NOT NULL OR eur.id IS NOT NULL
      ORDER BY p.product_type, p.rip_code
    `).all(vid, vid) as CombinedEplRow[];
  });

  ipcMain.handle('standard-epl:update-price', (_e, id: number, net_price: number) => {
    const db = getDb();
    const row = db.prepare(`
      SELECT v.status FROM standard_epl e
      JOIN standard_epl_versions v ON e.version_id = v.version_id
      WHERE e.id = ?
    `).get(id) as { status: string } | undefined;
    if (!row) throw new Error('Row not found');
    if (row.status !== 'draft') throw new Error('Cannot edit a published version');
    db.prepare('UPDATE standard_epl SET net_price = ? WHERE id = ?').run(net_price, id);
  });

  ipcMain.handle('standard-epl:upsert', (_e, data: {
    version_id: number;
    rip_code: string; product_type: string; product_name: string;
    currency: 'USD' | 'EUR'; net_price: number; unit: string;
  }) => {
    const db = getDb();
    const version = db.prepare('SELECT status FROM standard_epl_versions WHERE version_id = ?')
      .get(data.version_id) as { status: string } | undefined;
    if (!version) throw new Error('Version not found');
    if (version.status !== 'draft') throw new Error('Cannot edit a published version');
    db.prepare(`
      INSERT INTO standard_epl (version_id, currency, product_type, rip_code, product_name, net_price, unit)
      VALUES (@version_id, @currency, @product_type, @rip_code, @product_name, @net_price, @unit)
      ON CONFLICT (version_id, currency, rip_code) DO UPDATE SET
        net_price = excluded.net_price,
        unit = excluded.unit,
        product_name = excluded.product_name,
        product_type = excluded.product_type
    `).run(data);
  });

  ipcMain.handle('standard-epl:create-draft', (_e, {
    sourceVersionId, versionName, notes,
  }: { sourceVersionId: number; versionName: string; notes?: string }) => {
    const db = getDb();
    const existing = getDraftVersion(db);
    if (existing) throw new Error('A draft already exists. Discard it before creating a new one.');

    const { lastInsertRowid } = db.prepare(
      `INSERT INTO standard_epl_versions (version_name, status, notes) VALUES (?, 'draft', ?)`
    ).run(versionName, notes ?? null);
    const newVersionId = lastInsertRowid as number;

    db.prepare(`
      INSERT INTO standard_epl (version_id, currency, product_type, rip_code, product_name, net_price, unit)
      SELECT ?, currency, product_type, rip_code, product_name, net_price, unit
      FROM standard_epl WHERE version_id = ?
    `).run(newVersionId, sourceVersionId);

    return db.prepare('SELECT * FROM standard_epl_versions WHERE version_id = ?')
      .get(newVersionId) as StandardEplVersion;
  });

  ipcMain.handle('standard-epl:publish-draft', (_e, {
    effectiveFrom, notes, versionName,
  }: { effectiveFrom: string; notes?: string; versionName?: string }) => {
    const db = getDb();
    const draft = getDraftVersion(db);
    if (!draft) throw new Error('No draft to publish');
    if (!effectiveFrom) throw new Error('Effective date is required');

    db.prepare(`
      UPDATE standard_epl_versions
      SET status = 'published',
          effective_from = ?,
          published_at = datetime('now'),
          notes = ?,
          version_name = ?
      WHERE version_id = ?
    `).run(
      effectiveFrom,
      notes !== undefined ? notes : draft.notes,
      versionName !== undefined ? versionName : draft.version_name,
      draft.version_id,
    );

    return db.prepare('SELECT * FROM standard_epl_versions WHERE version_id = ?')
      .get(draft.version_id) as StandardEplVersion;
  });

  ipcMain.handle('standard-epl:delete-draft', () => {
    const db = getDb();
    const draft = getDraftVersion(db);
    if (!draft) throw new Error('No draft to discard');

    db.transaction(() => {
      db.prepare('DELETE FROM standard_epl WHERE version_id = ?').run(draft.version_id);
      db.prepare('DELETE FROM standard_epl_versions WHERE version_id = ?').run(draft.version_id);
    })();
  });

  ipcMain.handle('standard-epl:update-draft-meta', (_e, {
    versionName, notes,
  }: { versionName?: string; notes?: string }) => {
    const db = getDb();
    const draft = getDraftVersion(db);
    if (!draft) throw new Error('No draft exists');

    if (versionName !== undefined) {
      db.prepare('UPDATE standard_epl_versions SET version_name = ? WHERE version_id = ?')
        .run(versionName, draft.version_id);
    }
    if (notes !== undefined) {
      db.prepare('UPDATE standard_epl_versions SET notes = ? WHERE version_id = ?')
        .run(notes, draft.version_id);
    }
  });

  ipcMain.handle('standard-epl:delete-row', (_e, {
    versionId, ripCode,
  }: { versionId: number; ripCode: string }) => {
    const db = getDb();
    const version = db.prepare('SELECT status FROM standard_epl_versions WHERE version_id = ?')
      .get(versionId) as { status: string } | undefined;
    if (!version) throw new Error('Version not found');
    if (version.status !== 'draft') throw new Error('Cannot delete rows from a published version');

    db.prepare('DELETE FROM standard_epl WHERE version_id = ? AND rip_code = ?')
      .run(versionId, ripCode);
  });
}
