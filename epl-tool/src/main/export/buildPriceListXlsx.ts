import ExcelJS from 'exceljs';
import fs from 'fs';
import type { PriceListFull, Customer, PackagingRow, AdminEmail } from '../../types';

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

  // Logo (rows 1-2, right side)
  if (data.logoPath && fs.existsSync(data.logoPath)) {
    const ext = data.logoPath.split('.').pop()?.toLowerCase() as 'png' | 'jpeg' | 'gif';
    const imageId = wb.addImage({ filename: data.logoPath, extension: ext || 'png' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.addImage(imageId, { tl: { col: 3, row: 0 }, br: { col: 6, row: 2 } } as any);
  }

  // Row 1-2: empty (logo placeholder)
  ws.addRow([]);
  ws.addRow([]);

  // Row 3: Mailing date
  const row3 = ws.addRow(['Mailing date', formatDate(data.priceList.mailing_date)]);
  row3.font = { bold: true };

  // Row 4: Customer
  const row4 = ws.addRow(['Customer', data.customer.customer_full_name]);
  row4.font = { bold: true };

  // Row 5: Effective + Revision
  const row5 = ws.addRow(['Effective', formatDate(data.priceList.effective), `Revision: ${data.priceList.price_list_version}`]);
  row5.font = { bold: true };

  // Row 6: Customer ref
  const row6 = ws.addRow(['Customer ref.', data.customer.customer_ref_sap]);
  row6.font = { bold: true };

  // Row 7: empty
  ws.addRow([]);

  // Row 8: "EXPORT PRICES" merged header
  const row8 = ws.addRow(['EXPORT PRICES']);
  ws.mergeCells(`A${row8.number}:F${row8.number}`);
  row8.getCell(1).fill = headerFill;
  row8.getCell(1).font = { ...headerFont, size: 12 };
  row8.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  row8.height = 20;

  // Row 9: Disclaimer
  const row9 = ws.addRow(['All prices in bulk ex plant and are subject to packaging charge when no bulk is available']);
  ws.mergeCells(`A${row9.number}:F${row9.number}`);
  row9.getCell(1).font = { italic: true, size: 9 };
  row9.getCell(1).alignment = { wrapText: true };

  // Row 10: Column headers
  const headers = ['Product type', 'RIP code', 'Product', 'Net price\n(Currency / Unit)', 'Currency', 'Unit'];
  const headerRow = ws.addRow(headers);
  headerRow.height = 34;
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = tableBorder;
  });

  // Product rows
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
    // Net price: right-aligned, 2 decimal places
    const priceCell = r.getCell(4);
    priceCell.numFmt = '#,##0.00';
    priceCell.alignment = { horizontal: 'right', vertical: 'middle' };
  }

  // Blank row before packaging
  ws.addRow([]);

  // Packaging section
  const packagingByType = groupBy(
    data.packaging.filter(p => p.price !== null),
    p => p.product_type
  );

  for (const [ptype, items] of packagingByType) {
    // Section header
    const secRow = ws.addRow([ptype]);
    const lastRowNum = secRow.number;
    ws.mergeCells(`A${lastRowNum}:F${lastRowNum}`);
    secRow.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD6E4F7' },
    };
    secRow.getCell(1).font = { bold: true, size: 10 };
    secRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    secRow.height = 18;

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

  // Contact row
  const contactText = `For any information please contact us at: ${data.adminEmail}`;
  const contactRow = ws.addRow([contactText]);
  const contactRowNum = contactRow.number;
  ws.mergeCells(`A${contactRowNum}:F${contactRowNum}`);
  contactRow.getCell(1).font = { italic: true, size: 9 };
  contactRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // Freeze top 10 rows
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 10 }];

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
