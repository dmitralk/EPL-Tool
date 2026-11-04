import { useEffect, useMemo, useState } from 'react';
import { Download, Search, Filter, DollarSign, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { absDelta, pctDelta, fmtNum, priceTypeLabel, formatDate } from '../../lib/utils';
import type { AnalysisRow, FxRate, StandardEplVersion } from '../../../types';

type CurrencyMode = 'USD' | 'EUR' | 'ALL';

type ColKey =
  | 'customer' | 'sapCode' | 'customerType' | 'customerTypeSap' | 'country'
  | 'region' | 'version' | 'effective' | 'mailing'
  | 'productType' | 'product' | 'unit' | 'terms' | 'net' | 'epl' | 'diff';

const COLUMNS: { key: ColKey; label: string; defaultVisible: boolean; locked?: boolean }[] = [
  { key: 'customer', label: 'Customer', defaultVisible: true, locked: true },
  { key: 'sapCode', label: 'Customer SAP Code', defaultVisible: false },
  { key: 'customerType', label: 'Customer Type', defaultVisible: true },
  { key: 'customerTypeSap', label: 'Customer Type SAP', defaultVisible: false },
  { key: 'country', label: 'Country', defaultVisible: true },
  { key: 'region', label: 'Supply Region', defaultVisible: true },
  { key: 'version', label: 'Version', defaultVisible: true },
  { key: 'effective', label: 'Effective', defaultVisible: true },
  { key: 'mailing', label: 'Mailing Date', defaultVisible: false },
  { key: 'productType', label: 'Product Type', defaultVisible: true },
  { key: 'product', label: 'Product', defaultVisible: true, locked: true },
  { key: 'unit', label: 'Unit', defaultVisible: true },
  { key: 'terms', label: 'Terms', defaultVisible: true },
  { key: 'net', label: 'Net Price', defaultVisible: true },
  { key: 'epl', label: 'EPL', defaultVisible: true },
  { key: 'diff', label: 'Diff', defaultVisible: true },
];

const COLUMNS_STORAGE_KEY = 'analysis.visibleColumns';

function defaultVisibility(): Record<ColKey, boolean> {
  return Object.fromEntries(COLUMNS.map(c => [c.key, c.defaultVisible])) as Record<ColKey, boolean>;
}

function loadVisibility(): Record<ColKey, boolean> {
  const vis = defaultVisibility();
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) ?? '{}') as Partial<Record<ColKey, boolean>>;
    for (const c of COLUMNS) {
      if (!c.locked && typeof saved[c.key] === 'boolean') vis[c.key] = saved[c.key] as boolean;
    }
  } catch {
    // ignore corrupt saved state
  }
  return vis;
}

interface Computed {
  row: AnalysisRow;
  native: number;        // net price in the entry's own currency
  netCmp: number;        // the value compared against EPL (native, or USD-converted in All mode)
  epl: number | null;    // the EPL yardstick for this mode
  diffAbs: number | null;
  diffPct: number | null;
  approx: boolean;       // true when a currency conversion was applied
}

function round(n: number, dp: number): number {
  return Number(n.toFixed(dp));
}

export function AnalysisScreen() {
  const { toast } = useToast();

  const [versions, setVersions] = useState<StandardEplVersion[]>([]);
  const [comparisonVersionId, setComparisonVersionId] = useState<number | null>(null);
  const [allRows, setAllRows] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('ALL');
  const [latestOnly, setLatestOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedRips, setSelectedRips] = useState<Set<string>>(new Set());

  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productPickerSearch, setProductPickerSearch] = useState('');

  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [showFx, setShowFx] = useState(false);

  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(loadVisibility);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const show = (k: ColKey) => visibleCols[k];
  const visibleCount = COLUMNS.filter(c => visibleCols[c.key]).length;
  const hiddenCount = COLUMNS.length - visibleCount;

  useEffect(() => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleCols));
  }, [visibleCols]);

  function toggleColumn(k: ColKey) {
    setVisibleCols(prev => ({ ...prev, [k]: !prev[k] }));
  }

  // Initial load: EPL versions + FX rates
  useEffect(() => {
    Promise.all([api.listStandardEplVersions(), api.getFxRates()]).then(([vers, fx]) => {
      const vList = vers as StandardEplVersion[];
      setVersions(vList);
      const latestPub = vList.find(v => v.status === 'published');
      setComparisonVersionId(latestPub?.version_id ?? vList[0]?.version_id ?? null);
      const map: Record<string, number> = {};
      for (const r of fx as FxRate[]) map[r.currency_code] = r.rate_to_usd;
      setFxRates(map);
    });
  }, []);

  // Load analysis rows when the comparison EPL version changes
  useEffect(() => {
    if (comparisonVersionId === null) return;
    setLoading(true);
    api.getAnalysisRows(comparisonVersionId)
      .then(r => setAllRows(r as AnalysisRow[]))
      .finally(() => setLoading(false));
  }, [comparisonVersionId]);

  const selectedVersion = versions.find(v => v.version_id === comparisonVersionId) ?? null;
  const latestPublishedId = versions.find(v => v.status === 'published')?.version_id ?? null;

  // Distinct products present in the data (for the product multi-select)
  const products = useMemo(() => {
    const m = new Map<string, { rip: string; name: string }>();
    for (const r of allRows) if (!m.has(r.rip_code)) m.set(r.rip_code, { rip: r.rip_code, name: r.product_name });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  // Non-USD currencies present in the data (need FX rates for All mode)
  const nonUsdCurrencies = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRows) if (r.currency !== 'USD') s.add(r.currency);
    return Array.from(s).sort();
  }, [allRows]);

  function computeRow(r: AnalysisRow): Computed {
    if (currencyMode === 'ALL') {
      const rate = fxRates[r.currency] ?? 1;
      const netCmp = r.net_price * rate;
      const epl = r.epl_usd_price;
      const diffAbs = epl !== null ? netCmp - epl : null;
      const diffPct = epl !== null && epl !== 0 ? ((netCmp - epl) / epl) * 100 : null;
      return { row: r, native: r.net_price, netCmp, epl, diffAbs, diffPct, approx: r.currency !== 'USD' };
    }
    const epl = currencyMode === 'USD' ? r.epl_usd_price : r.epl_eur_price;
    const diffAbs = epl !== null ? r.net_price - epl : null;
    const diffPct = epl !== null && epl !== 0 ? ((r.net_price - epl) / epl) * 100 : null;
    return { row: r, native: r.net_price, netCmp: r.net_price, epl, diffAbs, diffPct, approx: false };
  }

  const display = useMemo(() => {
    const s = search.trim().toLowerCase();
    return allRows
      .filter(r => (latestOnly ? r.is_latest : true))
      .filter(r => (currencyMode === 'ALL' ? true : r.currency === currencyMode))
      .filter(r => (selectedRips.size > 0 ? selectedRips.has(r.rip_code) : true))
      .filter(r => {
        if (!s) return true;
        return (
          r.customer_short_name.toLowerCase().includes(s) ||
          r.customer_full_name.toLowerCase().includes(s) ||
          r.product_name.toLowerCase().includes(s) ||
          r.rip_code.toLowerCase().includes(s) ||
          r.product_type.toLowerCase().includes(s)
        );
      })
      .map(computeRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, latestOnly, currencyMode, selectedRips, search, fxRates]);

  const anyFilter = latestOnly === false || search.trim() !== '' || selectedRips.size > 0;

  function clearFilters() {
    setSearch('');
    setSelectedRips(new Set());
    setLatestOnly(true);
  }

  function toggleRip(rip: string) {
    setSelectedRips(prev => {
      const next = new Set(prev);
      if (next.has(rip)) next.delete(rip); else next.add(rip);
      return next;
    });
  }

  async function handleSetFx(code: string, value: string) {
    const rate = parseFloat(value);
    setFxRates(prev => ({ ...prev, [code]: isNaN(rate) ? prev[code] : rate }));
    if (!isNaN(rate) && rate > 0) await api.setFxRate(code, rate);
  }

  async function handleExport() {
    if (display.length === 0) return;
    const isAll = currencyMode === 'ALL';
    const eplLabel = isAll ? 'EPL (USD)' : `EPL (${currencyMode})`;
    type ExportCol = { key: ColKey; header: string; kind?: 'number' | 'date'; value: (d: Computed) => string | number | null };
    const allExportCols: ExportCol[] = [
      { key: 'customer', header: 'Customer', value: d => d.row.customer_short_name },
      { key: 'sapCode', header: 'Customer SAP Code', value: d => d.row.customer_ref_sap },
      { key: 'customerType', header: 'Customer Type', value: d => d.row.customer_type ?? '' },
      { key: 'customerTypeSap', header: 'Customer Type SAP', value: d => d.row.customer_ref_type_sap ?? '' },
      { key: 'country', header: 'Country', value: d => d.row.country ?? '' },
      { key: 'region', header: 'Supply Region', value: d => d.row.main_supply_region ?? '' },
      { key: 'version', header: 'Version', value: d => d.row.price_list_version },
      { key: 'version', header: 'Latest', value: d => (d.row.is_latest ? 'Yes' : 'No') },
      { key: 'effective', header: 'Effective', kind: 'date', value: d => d.row.effective },
      { key: 'mailing', header: 'Mailing Date', kind: 'date', value: d => d.row.mailing_date },
      { key: 'productType', header: 'Product Type', value: d => d.row.product_type },
      { key: 'product', header: 'Product', value: d => d.row.product_name },
      { key: 'product', header: 'RIP', value: d => d.row.rip_code },
      { key: 'net', header: 'Currency', value: d => d.row.currency },
      { key: 'unit', header: 'Unit', value: d => d.row.unit },
      { key: 'terms', header: 'Terms', value: d => priceTypeLabel(d.row.price_type, d.row.discount_percent) },
      { key: 'net', header: 'Net Price', kind: 'number', value: d => round(d.native, 2) },
      ...(isAll ? [{ key: 'net', header: 'Net (USD)', kind: 'number', value: (d: Computed) => round(d.netCmp, 2) } as ExportCol] : []),
      { key: 'epl', header: eplLabel, kind: 'number', value: d => (d.epl !== null ? round(d.epl, 2) : null) },
      { key: 'diff', header: 'Diff', kind: 'number', value: d => (d.diffAbs !== null ? round(d.diffAbs, 2) : null) },
      { key: 'diff', header: 'Diff %', kind: 'number', value: d => (d.diffPct !== null ? round(d.diffPct, 1) : null) },
    ];
    const cols = allExportCols.filter(c => visibleCols[c.key]);
    const headers = cols.map(c => c.header);
    const rows = display.map(d => cols.map(c => c.value(d)));
    const numericCols = cols.flatMap((c, i) => (c.kind === 'number' ? [i] : []));
    const dateCols = cols.flatMap((c, i) => (c.kind === 'date' ? [i] : []));

    const result = await api.exportAnalysisXlsx({ headers, rows, numericCols, dateCols, mode: currencyMode }) as { saved: boolean; error?: string };
    if (result.saved) toast('Analysis exported', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  const filteredProducts = products.filter(p => {
    if (!productPickerSearch) return true;
    const s = productPickerSearch.toLowerCase();
    return p.rip.toLowerCase().includes(s) || p.name.toLowerCase().includes(s);
  });

  const customerCount = new Set(display.map(d => d.row.customer_ref_sap)).size;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Analysis</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${display.length} rows · ${customerCount} customer${customerCount !== 1 ? 's' : ''} · vs ${selectedVersion?.version_name ?? '—'}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={display.length === 0}>
          <Download size={14} className="mr-1.5" />
          Export to Excel
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        {/* Currency mode */}
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
          {(['USD', 'EUR', 'ALL'] as CurrencyMode[]).map(m => (
            <button
              key={m}
              onClick={() => setCurrencyMode(m)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                currencyMode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {m === 'ALL' ? 'All' : m}
            </button>
          ))}
        </div>

        {/* Comparison EPL version */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 shrink-0">Compare vs EPL:</label>
          <select
            value={comparisonVersionId ?? ''}
            onChange={e => setComparisonVersionId(Number(e.target.value))}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {versions.map(v => (
              <option key={v.version_id} value={v.version_id}>
                {v.status === 'draft' ? `Draft: ${v.version_name}` : v.version_name}
                {v.version_id === latestPublishedId ? ' (active)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Latest-only toggle */}
        <Button
          variant={latestOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setLatestOnly(v => !v)}
        >
          {latestOnly ? 'Latest only' : 'All versions'}
        </Button>

        {/* Product multi-select */}
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setShowProductPicker(v => !v)}>
            <Filter size={14} className="mr-1.5" />
            Products{selectedRips.size > 0 ? ` (${selectedRips.size})` : ''}
          </Button>
          {showProductPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowProductPicker(false)} />
              <div className="absolute left-0 z-20 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Search products…"
                    value={productPickerSearch}
                    onChange={e => setProductPickerSearch(e.target.value)}
                    className="pl-8 text-sm"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto -mx-1 px-1">
                  {filteredProducts.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">No products</p>
                  ) : filteredProducts.map(p => (
                    <label key={p.rip} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer text-sm">
                      <input type="checkbox" checked={selectedRips.has(p.rip)} onChange={() => toggleRip(p.rip)} />
                      <span className="font-mono text-xs text-gray-500 shrink-0">{p.rip}</span>
                      <span className="text-gray-800 truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                  <button className="text-xs text-gray-500 hover:text-gray-700" onClick={() => setSelectedRips(new Set())}>
                    Clear
                  </button>
                  <Button size="sm" onClick={() => setShowProductPicker(false)}>Done</Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* FX rates (All mode) */}
        {currencyMode === 'ALL' && (
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowFx(v => !v)}>
              <DollarSign size={14} className="mr-1.5" />
              FX rates
            </Button>
            {showFx && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowFx(false)} />
                <div className="absolute left-0 z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                  <p className="text-xs text-gray-500 mb-2">USD per 1 unit of currency. Used only for this view.</p>
                  {nonUsdCurrencies.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2 text-center">Only USD in the data.</p>
                  ) : nonUsdCurrencies.map(code => (
                    <div key={code} className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-sm text-gray-700 w-12">{code}</span>
                      <Input
                        type="number"
                        step="0.0001"
                        value={fxRates[code] ?? ''}
                        onChange={e => handleSetFx(code, e.target.value)}
                        className="text-sm"
                        placeholder="1.00"
                      />
                    </div>
                  ))}
                  <div className="flex justify-end pt-1">
                    <Button size="sm" onClick={() => setShowFx(false)}>Done</Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Column visibility */}
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setShowColumnPicker(v => !v)}>
            <SlidersHorizontal size={14} className="mr-1.5" />
            Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
          </Button>
          {showColumnPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowColumnPicker(false)} />
              <div className="absolute left-0 z-20 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                <p className="text-xs text-gray-500 mb-2">Hidden columns are also excluded from the Excel export.</p>
                {COLUMNS.map(c => (
                  <label
                    key={c.key}
                    className={`flex items-center gap-2 px-1.5 py-1 rounded text-sm ${c.locked ? 'text-gray-400 cursor-not-allowed' : 'text-gray-800 hover:bg-gray-50 cursor-pointer'}`}
                  >
                    <input type="checkbox" checked={visibleCols[c.key]} disabled={c.locked} onChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-100">
                  <button className="text-xs text-gray-500 hover:text-gray-700" onClick={() => setVisibleCols(defaultVisibility())}>
                    Reset
                  </button>
                  <Button size="sm" onClick={() => setShowColumnPicker(false)}>Done</Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search customer or product…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        {anyFilter && (
          <button className="text-xs text-blue-600 hover:underline" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {/* All-mode note */}
      {currencyMode === 'ALL' && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <strong>All currencies</strong> — non-USD net prices are converted to USD (≈) at editable FX rates and compared against the <strong>USD</strong> EPL.
          Converted figures blend FX with pricing; for exact analysis use the USD / EUR tabs.
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {show('customer') && <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>}
              {show('sapCode') && <th className="text-left px-3 py-3 font-medium text-gray-600">SAP Code</th>}
              {show('customerType') && <th className="text-left px-3 py-3 font-medium text-gray-600">Customer Type</th>}
              {show('customerTypeSap') && <th className="text-left px-3 py-3 font-medium text-gray-600">Customer Type SAP</th>}
              {show('country') && <th className="text-left px-3 py-3 font-medium text-gray-600">Country</th>}
              {show('region') && <th className="text-left px-3 py-3 font-medium text-gray-600">Supply Region</th>}
              {show('version') && <th className="text-left px-3 py-3 font-medium text-gray-600">Version</th>}
              {show('effective') && <th className="text-left px-3 py-3 font-medium text-gray-600">Effective</th>}
              {show('mailing') && <th className="text-left px-3 py-3 font-medium text-gray-600">Mailing Date</th>}
              {show('productType') && <th className="text-left px-3 py-3 font-medium text-gray-600">Product Type</th>}
              {show('product') && <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>}
              {show('unit') && <th className="text-left px-3 py-3 font-medium text-gray-600">Unit</th>}
              {show('terms') && <th className="text-left px-3 py-3 font-medium text-gray-600">Terms</th>}
              {show('net') && <th className="text-right px-4 py-3 font-medium text-gray-600">Net Price</th>}
              {show('epl') && <th className="text-right px-4 py-3 font-medium text-gray-600">{currencyMode === 'ALL' ? 'EPL (USD)' : `EPL (${currencyMode})`}</th>}
              {show('diff') && <th className="text-right px-4 py-3 font-medium text-gray-600">Diff</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={visibleCount} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : display.length === 0 ? (
              <tr><td colSpan={visibleCount} className="text-center py-10 text-gray-400">No matching price list entries</td></tr>
            ) : display.map((d, i) => {
              const up = d.diffAbs !== null && d.diffAbs > 0;
              const down = d.diffAbs !== null && d.diffAbs < 0;
              return (
                <tr key={`${d.row.price_list_id}-${d.row.rip_code}-${i}`} className="hover:bg-gray-50 transition-colors">
                  {show('customer') && <td className="px-4 py-2 text-gray-900" title={d.row.customer_full_name}>{d.row.customer_short_name}</td>}
                  {show('sapCode') && <td className="px-3 py-2 text-gray-500 text-xs font-mono">{d.row.customer_ref_sap}</td>}
                  {show('customerType') && <td className="px-3 py-2 text-gray-500 text-xs">{d.row.customer_type ?? '—'}</td>}
                  {show('customerTypeSap') && <td className="px-3 py-2 text-gray-500 text-xs">{d.row.customer_ref_type_sap ?? '—'}</td>}
                  {show('country') && <td className="px-3 py-2 text-gray-500 text-xs">{d.row.country ?? '—'}</td>}
                  {show('region') && <td className="px-3 py-2 text-gray-500 text-xs">{d.row.main_supply_region ?? '—'}</td>}
                  {show('version') && (
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {d.row.price_list_version}
                      {!latestOnly && d.row.is_latest && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">latest</span>
                      )}
                    </td>
                  )}
                  {show('effective') && <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(d.row.effective)}</td>}
                  {show('mailing') && <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(d.row.mailing_date)}</td>}
                  {show('productType') && <td className="px-3 py-2 text-gray-500 text-xs">{d.row.product_type}</td>}
                  {show('product') && (
                    <td className="px-4 py-2 text-gray-900">
                      <span className="font-mono text-[11px] text-gray-400 mr-2">{d.row.rip_code}</span>
                      {d.row.product_name}
                    </td>
                  )}
                  {show('unit') && <td className="px-3 py-2 text-gray-400 text-xs">{d.row.unit}</td>}
                  {show('terms') && <td className="px-3 py-2 text-gray-500 text-xs">{priceTypeLabel(d.row.price_type, d.row.discount_percent)}</td>}
                  {show('net') && <td className="px-4 py-2 text-right font-mono">
                    {currencyMode === 'ALL' && d.approx ? (
                      <>
                        <div className="text-gray-900">≈ {fmtNum(d.netCmp)}<span className="text-gray-400 text-xs ml-1">USD</span></div>
                        <div className="text-[11px] text-gray-400">{fmtNum(d.native)} {d.row.currency}</div>
                      </>
                    ) : (
                      <div>
                        <span className="text-gray-900">{fmtNum(d.native)}</span>
                        <span className="text-gray-400 text-xs ml-1">{d.row.currency}</span>
                      </div>
                    )}
                  </td>}
                  {show('epl') && <td className="px-4 py-2 text-right font-mono text-gray-500">{fmtNum(d.epl)}</td>}
                  {show('diff') && (
                    <td className={`px-4 py-2 text-right font-mono ${up ? 'text-red-600' : down ? 'text-green-600' : 'text-gray-400'}`}>
                      <div className="text-sm">{pctDelta(d.epl, d.netCmp)}</div>
                      <div className="text-[11px] opacity-60">{currencyMode === 'ALL' && d.approx && d.diffAbs !== null ? '≈' : ''}{absDelta(d.epl, d.netCmp)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
