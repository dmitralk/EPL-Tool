import { useEffect, useRef, useState } from 'react';
import { Download, Lock, Mail, Search } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import type { CombinedEplRow, PackagingRow, PackagingVersion, Unit } from '../../../types';

type EditingCell = { id: number; currency: 'USD' | 'EUR'; field: 'price' | 'unit' };
type Tab = 'prices' | 'packaging';

export function StandardEplScreen() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('prices');

  // Standard prices state
  const [rows, setRows] = useState<CombinedEplRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingEnabled, setEditingEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Packaging state
  const [packagingVersions, setPackagingVersions] = useState<PackagingVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [packagingRows, setPackagingRows] = useState<PackagingRow[]>([]);
  const [packagingLoading, setPackagingLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getStandardEplCombined(),
      api.getUnits(),
      api.getSetting('standard_epl_editable'),
      api.listPackagingVersions(),
    ]).then(([r, u, editable, versions]) => {
      setRows(r as CombinedEplRow[]);
      setUnits(u as Unit[]);
      setEditingEnabled(editable === '1');
      const vList = versions as PackagingVersion[];
      setPackagingVersions(vList);
      if (vList.length > 0) setSelectedVersion(vList[0].version);
    });
  }, []);

  useEffect(() => {
    if (!selectedVersion) return;
    setPackagingLoading(true);
    api.getPackaging(selectedVersion)
      .then(list => setPackagingRows(list as PackagingRow[]))
      .finally(() => setPackagingLoading(false));
  }, [selectedVersion]);

  useEffect(() => {
    if (editing?.field === 'price') inputRef.current?.select();
  }, [editing]);

  const filtered = rows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.rip_code.toLowerCase().includes(s) ||
      r.product_name.toLowerCase().includes(s) ||
      r.product_type.toLowerCase().includes(s)
    );
  });

  const defaultUnit = units[0]?.name ?? '100 KG';

  async function handleExport() {
    const result = await api.exportStandardEplXlsx() as { saved: boolean; error?: string };
    if (result.saved) toast('EPL exported', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  async function handleEmail() {
    const result = await api.exportStandardEplMail() as { success: boolean; error?: string };
    if (!result.success) toast(`Email failed: ${result.error}`, 'error');
  }

  async function handleExportPackaging() {
    const result = await api.exportPackagingXlsx(selectedVersion) as { saved: boolean; error?: string };
    if (result.saved) toast('Packaging exported', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  async function handleEmailPackaging() {
    const result = await api.exportPackagingMail(selectedVersion) as { success: boolean; error?: string };
    if (!result.success) toast(`Email failed: ${result.error}`, 'error');
  }

  function startEdit(row: CombinedEplRow, currency: 'USD' | 'EUR', field: 'price' | 'unit') {
    const current = currency === 'USD'
      ? (field === 'price' ? row.usd_price : row.usd_unit)
      : (field === 'price' ? row.eur_price : row.eur_unit);
    setEditing({ id: row.id, currency, field });
    setDraftValue(current !== null && current !== undefined ? String(current) : (field === 'unit' ? defaultUnit : ''));
  }

  function cancelEdit() {
    setEditing(null);
    setDraftValue('');
  }

  async function commitEdit(row: CombinedEplRow, valueOverride?: string) {
    if (!editing) return;
    const { currency, field } = editing;
    const value = valueOverride ?? draftValue;

    const existingId = currency === 'USD' ? row.usd_id : row.eur_id;
    const currentPrice = currency === 'USD' ? row.usd_price : row.eur_price;
    const currentUnit = currency === 'USD' ? row.usd_unit : row.eur_unit;

    const newPrice = field === 'price' ? parseFloat(value) : (currentPrice ?? 0);
    const newUnit = field === 'unit' ? value : (currentUnit ?? defaultUnit);

    if (field === 'price' && (isNaN(newPrice) || newPrice < 0)) {
      toast('Invalid price', 'error');
      cancelEdit();
      return;
    }

    setSaving(true);
    try {
      if (existingId !== null) {
        if (field === 'price') {
          await api.updateStandardEplPrice(existingId, newPrice);
        } else {
          await api.upsertStandardEpl({
            rip_code: row.rip_code,
            product_type: row.product_type,
            product_name: row.product_name,
            currency,
            net_price: currentPrice ?? 0,
            unit: newUnit,
          });
        }
      } else {
        await api.upsertStandardEpl({
          rip_code: row.rip_code,
          product_type: row.product_type,
          product_name: row.product_name,
          currency,
          net_price: field === 'price' ? newPrice : 0,
          unit: newUnit,
        });
      }
      const updated = await api.getStandardEplCombined();
      setRows(updated as CombinedEplRow[]);
      toast('Saved', 'success');
    } catch {
      toast('Failed to save', 'error');
    } finally {
      setSaving(false);
      setEditing(null);
      setDraftValue('');
    }
  }

  function PriceCell({ row, currency }: { row: CombinedEplRow; currency: 'USD' | 'EUR' }) {
    const isEditingPrice = editing?.id === row.id && editing.currency === currency && editing.field === 'price';
    const isEditingUnit = editing?.id === row.id && editing.currency === currency && editing.field === 'unit';
    const price = currency === 'USD' ? row.usd_price : row.eur_price;
    const unit = currency === 'USD' ? row.usd_unit : row.eur_unit;

    if (!editingEnabled) {
      return (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono w-24 text-right px-2 py-0.5 ${price !== null ? 'text-gray-900' : 'text-gray-300 italic'}`}>
            {price !== null ? price.toFixed(2) : 'no price'}
          </span>
          <span className="text-xs text-gray-400 px-1 py-0.5">{unit ?? defaultUnit}</span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        {isEditingPrice ? (
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            className="w-24 text-sm border border-blue-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={draftValue}
            onChange={e => setDraftValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(row); if (e.key === 'Escape') cancelEdit(); }}
            onBlur={() => commitEdit(row)}
            disabled={saving}
          />
        ) : (
          <button
            className={`text-sm font-mono w-24 text-right px-2 py-0.5 rounded cursor-pointer transition-colors
              ${price !== null ? 'text-gray-900 hover:bg-blue-50 hover:text-blue-700' : 'text-gray-300 hover:bg-gray-50 italic'}`}
            onClick={() => startEdit(row, currency, 'price')}
            title="Click to edit price"
          >
            {price !== null ? price.toFixed(2) : 'no price'}
          </button>
        )}
        {isEditingUnit ? (
          <select
            autoFocus
            className="text-xs border border-blue-400 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            value={draftValue}
            onChange={e => {
              const chosen = e.target.value;
              setDraftValue(chosen);
              commitEdit(row, chosen);
            }}
            onBlur={() => cancelEdit()}
            disabled={saving}
          >
            {units.map(u => (
              <option key={u.id} value={u.name}>{u.name}</option>
            ))}
          </select>
        ) : (
          <button
            className="text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded cursor-pointer transition-colors"
            onClick={() => startEdit(row, currency, 'unit')}
            title="Click to change unit"
          >
            {unit ?? defaultUnit}
          </button>
        )}
      </div>
    );
  }

  const selectedVersionMeta = packagingVersions.find(v => v.version === selectedVersion);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Standard EPL</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {tab === 'prices'
              ? `${rows.length} products${editingEnabled ? ' — click a price or unit to edit' : ''}`
              : `${packagingVersions.length} packaging version${packagingVersions.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {tab === 'prices' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
              <Download size={14} className="mr-1.5" />
              Export EPL to Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleEmail} disabled={rows.length === 0}>
              <Mail size={14} className="mr-1.5" />
              Email EPL
            </Button>
          </div>
        )}
        {tab === 'packaging' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportPackaging} disabled={!selectedVersion || packagingRows.length === 0}>
              <Download size={14} className="mr-1.5" />
              Export to Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleEmailPackaging} disabled={!selectedVersion || packagingRows.length === 0}>
              <Mail size={14} className="mr-1.5" />
              Email
            </Button>
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button
          onClick={() => setTab('prices')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'prices'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Standard Prices
        </button>
        <button
          onClick={() => setTab('packaging')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'packaging'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Packaging Charges
        </button>
      </div>

      {tab === 'prices' && (
        <>
          {!editingEnabled && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500">
              <Lock size={13} className="shrink-0" />
              <span>Read-only — to make changes, go to <strong className="text-gray-700">Settings → Standard EPL Prices</strong></span>
            </div>
          )}

          <div className="relative max-w-xs mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">RIP Code</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">USD Price / Unit</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">EUR Price / Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-gray-400">No products found</td>
                  </tr>
                ) : (
                  filtered.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{row.rip_code}</td>
                      <td className="px-4 py-2 text-gray-600">{row.product_type}</td>
                      <td className="px-4 py-2 text-gray-900">{row.product_name}</td>
                      <td className="px-4 py-2">
                        <PriceCell row={row} currency="USD" />
                      </td>
                      <td className="px-4 py-2">
                        <PriceCell row={row} currency="EUR" />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'packaging' && (
        <>
          {packagingVersions.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              No packaging versions found. Add one in <strong className="text-gray-500">Settings → Packaging</strong>.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm text-gray-600 shrink-0">Version:</label>
                <select
                  value={selectedVersion}
                  onChange={e => setSelectedVersion(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {packagingVersions.map(v => (
                    <option key={v.version} value={v.version}>{v.version}</option>
                  ))}
                </select>
                {selectedVersionMeta && (
                  <span className="text-xs text-gray-400">
                    {selectedVersionMeta.row_count} rows · {selectedVersionMeta.customer_count} customer{selectedVersionMeta.customer_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 w-32">Price</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 w-20">Currency</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {packagingLoading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-gray-400">Loading…</td>
                      </tr>
                    ) : packagingRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-gray-400">No rows in this version</td>
                      </tr>
                    ) : packagingRows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 text-gray-500 text-xs">{row.product_type}</td>
                        <td className="px-4 py-2 text-gray-900">{row.packaging_name}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {row.price === null
                            ? <span className="text-gray-300 text-xs italic">label</span>
                            : <span className="text-gray-900">{row.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          }
                        </td>
                        <td className="px-4 py-2 text-gray-600 text-xs font-mono">{row.currency}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{row.unit ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-400 mt-3">
                Read-only — to edit packaging, go to <strong className="text-gray-600">Settings → Packaging</strong>
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
