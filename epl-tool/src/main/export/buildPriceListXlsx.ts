import ExcelJS from 'exceljs';
import fs from 'fs';
import type { PriceListFull, Customer, PackagingRow } from '../../types';

interface ExportData {
  priceList: PriceListFull;
  customer: Customer;
  packaging: PackagingRow[];
  logoPath: string | null;
  adminEmail: string;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

const COL_COUNT = 6;

const headerFill: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF002060' },
};

const headerFont: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
};

const tableBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

const noFill: ExcelJS.Fill = { type: 'pattern', pattern: 'none' };

// Apply "center across selection" to every cell in the row (A–F).
// Text stays in cell A; adjacent cells must be empty for Excel to centre across them.
// Pass fill/font to also style each cell (e.g. dark-blue EXPORT PRICES header).
function centerAcrossRow(row: ExcelJS.Row, fill?: ExcelJS.Fill, font?: Partial<ExcelJS.Font>) {
  for (let col = 1; col <= COL_COUNT; col++) {
    const cell = row.getCell(col);
    cell.alignment = { horizontal: 'centerContinuous', vertical: 'middle' };
    if (fill) cell.fill = fill;
    if (font) cell.font = font;
  }
}

export async function buildPriceListXlsx(data: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Price list');

  // Column widths (match reference file)
  ws.columns = [
    { width: 20 },  // A: Product type
    { width: 18 },  // B: RIP code
    { width: 50 },  // C: Product
    { width: 20 },  // D: Net price
    { width: 14 },  // E: Currency
    { width: 16 },  // F: Unit
  ];

  // ── Rows 1-2: empty space for logo (right side) ────────────────────────────
  ws.addRow([]);
  ws.addRow([]);

  // ── Rows 3-6: header info ───────────────────────────────────────────────────
  const row3 = ws.addRow(['Mailing date', formatDate(data.priceList.mailing_date)]);
  row3.font = { bold: true };

  const row4 = ws.addRow(['Customer', data.customer.customer_full_name]);
  row4.font = { bold: true };

  const row5 = ws.addRow(['Effective', formatDate(data.priceList.effective), `Revision: ${data.priceList.price_list_version}`]);
  row5.font = { bold: true };

  const row6 = ws.addRow(['Customer ref.', data.customer.customer_ref_sap]);
  row6.font = { bold: true };

  // ── Row 7: empty ────────────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Row 8: "EXPORT PRICES" — center across selection, no merge ──────────────
  // Adjacent cells must have no value (null) for centerContinuous to work in Excel.
  const row8 = ws.addRow(['EXPORT PRICES', null, null, null, null, null]);
  row8.height = 20;
  centerAcrossRow(row8, headerFill, { ...headerFont, size: 12 });

  // ── Row 9: Disclaimer — left-aligned, no merge ──────────────────────────────
  const row9 = ws.addRow(['All prices in bulk ex plant and are subject to packaging charge when no bulk is available']);
  row9.getCell(1).font = { italic: true, size: 9 };
  row9.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

  // ── Row 10: Column headers ──────────────────────────────────────────────────
  const headerRow = ws.addRow(['Product type', 'RIP code', 'Product', 'Net price\n(Currency / Unit)', 'Currency', 'Unit']);
  headerRow.height = 34;
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = tableBorder;
  });

  // ── Product rows ────────────────────────────────────────────────────────────
  for (const entry of data.priceList.entries) {
    const r = ws.addRow([
      entry.product_type,
      entry.rip_code,
      entry.product_name,
      entry.net_price,
      entry.currency,
      entry.unit,
    ]);
    r.eachCell((cell) => {
      cell.border = tableBorder;
      cell.alignment = { vertical: 'middle' };
    });
    const priceCell = r.getCell(4);
    priceCell.numFmt = '#,##0.00';
    priceCell.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  // ── Blank row before packaging ───────────────────────────────────────────────
  ws.addRow([]);

  // ── Packaging section ────────────────────────────────────────────────────────
  const packagingByType = groupBy(
    data.packaging.filter(p => p.price !== null),
    p => p.product_type
  );

  for (const [ptype, items] of packagingByType) {
    // Section header: center across selection, no fill, no merge
    const secRow = ws.addRow([ptype, null, null, null, null, null]);
    secRow.height = 18;
    centerAcrossRow(secRow, noFill, { bold: true, size: 10 });

    for (const pkg of items) {
      const pkgRow = ws.addRow([
        '',
        '',
        pkg.packaging_name,
        pkg.price,
        pkg.currency,
        pkg.unit || '',
      ]);
      pkgRow.eachCell((cell) => {
        cell.border = tableBorder;
        cell.alignment = { vertical: 'middle' };
      });
      const pkgPriceCell = pkgRow.getCell(4);
      pkgPriceCell.numFmt = '#,##0.00';
      pkgPriceCell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    ws.addRow([]);
  }

  // ── Contact row — left-aligned, no merge ────────────────────────────────────
  const contactText = `For any information please contact us at: ${data.adminEmail}`;
  const contactRow = ws.addRow([contactText]);
  contactRow.getCell(1).font = { italic: true, size: 9 };
  contactRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

  // ── Sheet view: freeze top 10 rows, no gridlines ────────────────────────────
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 10, showGridLines: false }];

  // ── Logo: added last so its anchor doesn't pre-create rows ──────────────────
  // Covers cols D-F, rows 1-6 (right side of header block).
  if (data.logoPath && fs.existsSync(data.logoPath)) {
    const ext = data.logoPath.split('.').pop()?.toLowerCase() as 'png' | 'jpeg' | 'gif';
    const imageId = wb.addImage({ filename: data.logoPath, extension: ext || 'png' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.addImage(imageId, { tl: { col: 3, row: 0 }, br: { col: 6, row: 6 } } as any);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
