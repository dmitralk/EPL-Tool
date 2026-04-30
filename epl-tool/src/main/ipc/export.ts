import { ipcMain, dialog, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../database';
import { buildPriceListXlsx } from '../export/buildPriceListXlsx';
import type { PriceListFull, Customer, PackagingRow } from '../../types';

const execFileAsync = promisify(execFile);

function fetchExportData(db: ReturnType<typeof getDb>, price_list_id: string) {
  const priceList = (() => {
    const header = db.prepare(`
      SELECT pl.*, c.customer_short_name
      FROM price_lists pl
      LEFT JOIN customers c ON c.customer_ref_sap = pl.customer_ref_sap
      WHERE pl.price_list_id = ?
    `).get(price_list_id) as PriceListFull;

    header.entries = db
      .prepare('SELECT * FROM price_list_entries WHERE price_list_id = ? ORDER BY product_type, rip_code')
      .all(price_list_id) as PriceListFull['entries'];

    return header;
  })();

  const customer = db
    .prepare('SELECT * FROM customers WHERE customer_ref_sap = ?')
    .get(priceList.customer_ref_sap) as Customer;

  const packaging = db
    .prepare('SELECT * FROM packaging WHERE packaging_version = ? ORDER BY sort_order')
    .all(customer.packaging_version) as PackagingRow[];

  const adminEmailRow = db
    .prepare("SELECT email FROM admin_emails WHERE email_name LIKE '%Common%' OR email_name LIKE '%common%' LIMIT 1")
    .get() as { email: string } | undefined;
  const adminEmail = adminEmailRow?.email ?? '';

  const logoPath = (db
    .prepare("SELECT value FROM app_settings WHERE key = 'logo_path'")
    .get() as { value: string } | undefined)?.value ?? null;

  return { priceList, customer, packaging, adminEmail, logoPath };
}

function suggestFilename(customer: Customer, priceList: PriceListFull): string {
  return `${customer.customer_short_name}-${priceList.effective}-${priceList.price_list_version}-LM-EPL.xlsx`;
}

export function registerExportHandlers() {
  ipcMain.handle('export:xlsx', async (_e, price_list_id: string) => {
    const db = getDb();
    const data = fetchExportData(db, price_list_id);
    const suggestedName = suggestFilename(data.customer, data.priceList);

    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });

    if (canceled || !filePath) return { saved: false };

    try {
      const buffer = await buildPriceListXlsx(data);
      fs.writeFileSync(filePath, buffer);
      return { saved: true, path: filePath };
    } catch (err) {
      return { saved: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('export:xlsx-bulk', async (_e, ids: string[]) => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose folder to save exported price lists',
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    const db = getDb();
    const folder = filePaths[0];
    const results: { id: string; filename?: string; error?: string }[] = [];

    for (const id of ids) {
      try {
        const data = fetchExportData(db, id);
        const filename = suggestFilename(data.customer, data.priceList);
        const buffer = await buildPriceListXlsx(data);
        fs.writeFileSync(path.join(folder, filename), buffer);
        results.push({ id, filename });
      } catch (err) {
        results.push({ id, error: (err as Error).message });
      }
    }

    return { canceled: false, folder, results };
  });

  ipcMain.handle('export:open-mail-bulk', async (_e, ids: string[]) => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose folder to save files before opening emails',
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    const db = getDb();
    const folder = filePaths[0];
    const results: { id: string; filename?: string; error?: string }[] = [];

    for (const id of ids) {
      try {
        const data = fetchExportData(db, id);
        const { priceList, customer } = data;
        const filename = suggestFilename(customer, priceList);
        const filePath = path.join(folder, filename);
        const buffer = await buildPriceListXlsx(data);
        fs.writeFileSync(filePath, buffer);

        const to = [customer.email_to_customer, customer.email_internal_copy, customer.email_pbp_copy, customer.email_pbp_common]
          .filter(Boolean).join(';');
        const subject = `Price List — ${customer.customer_short_name} — ${priceList.price_list_version}`;
        const body = `Dear Customer,\n\nPlease find attached the updated price list for ${customer.customer_full_name}.\n\nEffective: ${priceList.effective}\nVersion: ${priceList.price_list_version}\n\nBest regards,`;

        if (process.platform === 'darwin') {
          await openMailMac({ filePath, to, subject, body });
        } else if (process.platform === 'win32') {
          await openMailWin({ filePath, to, subject, body });
        } else {
          const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          await shell.openExternal(url);
        }

        results.push({ id, filename });
      } catch (err) {
        results.push({ id, error: (err as Error).message });
      }
    }

    return { canceled: false, results };
  });

  ipcMain.handle('export:open-mail-with-attachment', async (
    _e,
    { filePath, to, subject, body }: { filePath: string; to: string; subject: string; body: string }
  ) => {
    try {
      if (process.platform === 'darwin') {
        await openMailMac({ filePath, to, subject, body });
      } else if (process.platform === 'win32') {
        await openMailWin({ filePath, to, subject, body });
      } else {
        const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        await shell.openExternal(url);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function openMailMac({ filePath, to, subject, body }: { filePath: string; to: string; subject: string; body: string }) {
  const recipients = to.split(';').map(e => e.trim()).filter(Boolean);
  const recipientLines = recipients
    .map(addr => `make new to recipient at end of to recipients with properties {address:"${escapeAppleScript(addr)}"}`)
    .join('\n      ');

  const bodyLines = body.split('\n').map(escapeAppleScript);
  const contentExpr = bodyLines.length > 1
    ? bodyLines.map(l => `"${l}"`).join(' & return & ')
    : `"${bodyLines[0] ?? ''}"`;

  const script = `tell application "Mail"
  activate
  set newMessage to make new outgoing message with properties {subject:"${escapeAppleScript(subject)}", content:${contentExpr}}
  tell newMessage
    ${recipientLines}
    make new attachment with properties {file name:POSIX file "${filePath}"}
    set visible to true
  end tell
end tell`;

  const scriptPath = path.join(os.tmpdir(), 'epl-tool-mail.applescript');
  fs.writeFileSync(scriptPath, script, 'utf8');
  await execFileAsync('osascript', [scriptPath]);
}

async function openMailWin({ filePath, to, subject, body }: { filePath: string; to: string; subject: string; body: string }) {
  const ps = [
    `$ol = New-Object -ComObject Outlook.Application`,
    `$mail = $ol.CreateItem(0)`,
    `$mail.To = [System.Uri]::UnescapeDataString('${encodeURIComponent(to)}')`,
    `$mail.Subject = [System.Uri]::UnescapeDataString('${encodeURIComponent(subject)}')`,
    `$mail.Body = [System.Uri]::UnescapeDataString('${encodeURIComponent(body)}')`,
    `$mail.Attachments.Add('${filePath.replace(/'/g, "''")}')`,
    `$mail.Display()`,
  ].join('; ');

  await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
}
