import { getDb } from '../database';
import { audit } from '../audit';
import { handle } from './guard';

const DENIED = 'Only admins can change currencies.';

export function registerCurrencyHandlers() {
  handle('currencies:list', 'viewer', () => {
    return getDb().prepare('SELECT * FROM currencies ORDER BY is_main DESC, code ASC').all();
  });

  handle('currencies:create', 'admin', (_e, code: string) => {
    const db = getDb();
    const normalised = code.trim().toUpperCase();
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO currencies (code, is_main) VALUES (?, 0)').run(normalised);
      audit(db, { action: 'currency.create', entityType: 'currency', entityKey: normalised, summary: `Added currency ${normalised}` });
      return result.lastInsertRowid;
    })();
    return db.prepare('SELECT * FROM currencies WHERE id = ?').get(id);
  }, DENIED);

  handle('currencies:delete', 'admin', (_e, id: number) => {
    const db = getDb();
    const row = db.prepare('SELECT code, is_main FROM currencies WHERE id = ?').get(id) as { code: string; is_main: number } | undefined;
    if (!row) return { ok: false, error: 'Currency not found.' };
    if (row.is_main) return { ok: false, error: `${row.code} is a main currency and can't be removed.` };

    const inUse = (db.prepare('SELECT COUNT(*) as n FROM customers WHERE currency = ?').get(row.code) as { n: number }).n;
    if (inUse > 0) {
      return { ok: false, error: `Cannot delete ${row.code} — it is assigned to ${inUse} customer${inUse > 1 ? 's' : ''}. Update those customers first.` };
    }

    db.transaction(() => {
      db.prepare('DELETE FROM currencies WHERE id = ?').run(id);
      audit(db, { action: 'currency.delete', entityType: 'currency', entityKey: row.code, summary: `Removed currency ${row.code}` });
    })();
    return { ok: true };
  }, DENIED);
}
