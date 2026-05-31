import { ipcMain } from 'electron';
import { getDb } from '../database';

export function registerCurrencyHandlers() {
  ipcMain.handle('currencies:list', () => {
    return getDb().prepare('SELECT * FROM currencies ORDER BY is_main DESC, code ASC').all();
  });

  ipcMain.handle('currencies:create', (_e, code: string) => {
    const db = getDb();
    const normalised = code.trim().toUpperCase();
    const result = db.prepare('INSERT INTO currencies (code, is_main) VALUES (?, 0)').run(normalised);
    return db.prepare('SELECT * FROM currencies WHERE id = ?').get(result.lastInsertRowid);
  });

  ipcMain.handle('currencies:delete', (_e, id: number) => {
    const db = getDb();
    const row = db.prepare('SELECT code FROM currencies WHERE id = ?').get(id) as { code: string } | undefined;
    if (!row) return { ok: false, error: 'Currency not found.' };

    const inUse = (db.prepare('SELECT COUNT(*) as n FROM customers WHERE currency = ?').get(row.code) as { n: number }).n;
    if (inUse > 0) {
      return { ok: false, error: `Cannot delete ${row.code} — it is assigned to ${inUse} customer${inUse > 1 ? 's' : ''}. Update those customers first.` };
    }

    db.prepare('DELETE FROM currencies WHERE id = ?').run(id);
    return { ok: true };
  });
}
