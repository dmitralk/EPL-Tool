import { dialog } from 'electron';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { getDb } from '../database';
import { handle } from './guard';
import type { AuditEntry, AuditFilters, AuditListResult } from '../../types';

const DEFAULT_LIMIT = 500;
const EXPORT_LIMIT = 100_000;

function where(f: AuditFilters): { sql: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (f.userId !== undefined && f.userId !== null) { parts.push('user_id = ?'); params.push(Number(f.userId)); }
  if (f.action) {
    if (f.action.endsWith('.')) { parts.push('action LIKE ?'); params.push(`${f.action}%`); }
    else { parts.push('action = ?'); params.push(f.action); }
  }
  if (f.customerRef) { parts.push('customer_ref_sap = ?'); params.push(f.customerRef); }
  if (f.from) { parts.push('at >= ?'); params.push(`${f.from}T00:00:00Z`); }
  if (f.to) { parts.push('at <= ?'); params.push(`${f.to}T23:59:59Z`); }
  if (f.search) {
    parts.push('(summary LIKE ? OR user_label LIKE ? OR entity_key LIKE ?)');
    const like = `%${f.search}%`;
    params.push(like, like, like);
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

function query(f: AuditFilters, limit: number): AuditEntry[] {
  const w = where(f);
  return getDb().prepare(`SELECT * FROM audit_log ${w.sql} ORDER BY at DESC, id DESC LIMIT ?`).all(...w.params, limit) as AuditEntry[];
}

// The activity log is visible to every user (access-rights study §6).
export function registerAuditHandlers() {
  handle('audit:list', 'viewer', (_e, filters?: AuditFilters): AuditListResult => {
    const db = getDb();
    const f = filters ?? {};
    const w = where(f);
    const limit = Math.min(Math.max(Number(f.limit) || DEFAULT_LIMIT, 1), 5000);
    return {
      entries: query(f, limit),
      total: (db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${w.sql}`).get(...w.params) as { n: number }).n,
      users: db.prepare(`
        SELECT user_id, MAX(user_label) AS user_label FROM audit_log GROUP BY user_id ORDER BY user_label
      `).all() as { user_id: number | null; user_label: string }[],
      actions: (db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all() as { action: string }[]).map(r => r.action),
    };
  });

  handle('audit:export-xlsx', 'viewer', async (_e, filters?: AuditFilters) => {
    const today = new Date().toISOString().slice(0, 10);
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `EPL-Activity-${today}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { saved: false };
    try {
      const rows = query(filters ?? {}, EXPORT_LIMIT);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Activity');
      ws.columns = [
        { header: 'When (UTC)', key: 'at', width: 20 },
        { header: 'User', key: 'user_label', width: 32 },
        { header: 'Action', key: 'action', width: 22 },
        { header: 'Customer', key: 'customer_ref_sap', width: 16 },
        { header: 'Summary', key: 'summary', width: 80 },
        { header: 'Details', key: 'details', width: 60 },
      ];
      const header = ws.getRow(1);
      header.font = { bold: true };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      for (const r of rows) {
        const row = ws.addRow({ ...r, at: new Date(r.at) });
        row.getCell(1).numFmt = 'yyyy-mm-dd hh:mm:ss';
      }
      ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
      const buffer = await wb.xlsx.writeBuffer();
      fs.writeFileSync(filePath, buffer as unknown as Buffer);
      return { saved: true, path: filePath, count: rows.length };
    } catch (err) {
      return { saved: false, error: (err as Error).message };
    }
  });
}
