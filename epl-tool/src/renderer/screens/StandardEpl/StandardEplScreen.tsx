import { useEffect, useRef, useState } from 'react';
import { Download, GitBranch, Mail, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { StandardEplComparisonPanel } from './StandardEplComparisonPanel';
import type { CombinedEplRow, PackagingRow, PackagingVersion, Product, StandardEplVersion, Unit } from '../../../types';
import { todayISO } from '../../lib/utils';

type EditingCell = { id: number; currency: 'USD' | 'EUR'; field: 'price' | 'unit' };
type Tab = 'prices' | 'packaging';

export function StandardEplScreen() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('prices');

  // Version management
  const [versions, setVersions] = useState<StandardEplVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [rows, setRows] = useState<CombinedEplRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  // Price table editing (draft only)
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Packaging state (unchanged)
  const [packagingVersions, setPackagingVersions] = useState<PackagingVersion[]>([]);
  const [selectedPackVersion, setSelectedPackVersion] = useState('');
  const [packagingRows, setPackagingRows] = useState<PackagingRow[]>([]);
  const [packagingLoading, setPackagingLoading] = useState(false);

  // Create draft dialog
  const [showCreateDraft, setShowCreateDraft] = useState(false);
  const [newDraftName, setNewDraftName] = useState('');
  const [cloneFromId, setCloneFromId] = useState<number | null>(null);
  const [newDraftNotes, setNewDraftNotes] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);

  // Publish dialog
  const [showPublish, setShowPublish] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDate, setPublishDate] = useState('');
  const [publishNotes, setPublishNotes] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Discard confirm
  const [showDiscard, setShowDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // Add product dialog (draft only)
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [addProductSearch, setAddProductSearch] = useState('');
  const [addProductRip, setAddProductRip] = useState('');
  const [addUsdPrice, setAddUsdPrice] = useState('');
  const [addUsdUnit, setAddUsdUnit] = useState('');
  const [addEurPrice, setAddEurPrice] = useState('');
  const [addEurUnit, setAddEurUnit] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);

  // Comparison
  const [showCompare, setShowCompare] = useState(false);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);

  // Derived
  const draftVersion = versions.find(v => v.status === 'draft') ?? null;
  const selectedVersion = versions.find(v => v.version_id === selectedVersionId) ?? null;
  const isDraftSelected = selectedVersion?.status === 'draft';
  const publishedVersions = versions.filter(v => v.status === 'published');
  const latestPublishedId = publishedVersions[0]?.version_id ?? null;
  const defaultUnit = units[0]?.name ?? '100 KG';

  // Initial load
  useEffect(() => {
    Promise.all([
      api.getUnits(),
      api.listStandardEplVersions(),
      api.listPackagingVersions(),
    ]).then(([u, vers, pkgVers]) => {
      setUnits(u as Unit[]);
      const vList = vers as StandardEplVersion[];
      setVersions(vList);
      const latestPub = vList.find(v => v.status === 'published');
      const draft = vList.find(v => v.status === 'draft');
      const defaultVid = latestPub?.version_id ?? draft?.version_id ?? null;
      setSelectedVersionId(defaultVid);
      const pkgList = pkgVers as PackagingVersion[];
      setPackagingVersions(pkgList);
      if (pkgList.length > 0) setSelectedPackVersion(pkgList[0].version);
    });
  }, []);

  // Load rows when selected version changes
  useEffect(() => {
    if (selectedVersionId === null) return;
    api.getStandardEplCombined(selectedVersionId).then(r => setRows(r as CombinedEplRow[]));
    setEditing(null);
  }, [selectedVersionId]);

  // Load packaging rows when version changes
  useEffect(() => {
    if (!selectedPackVersion) return;
    setPackagingLoading(true);
    api.getPackaging(selectedPackVersion)
      .then(list => setPackagingRows(list as PackagingRow[]))
      .finally(() => setPackagingLoading(false));
  }, [selectedPackVersion]);

  useEffect(() => {
    if (editing?.field === 'price') inputRef.current?.select();
  }, [editing]);

  const filtered = rows.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.rip_code.toLowerCase().includes(s) || r.product_name.toLowerCase().includes(s) || r.product_type.toLowerCase().includes(s);
  });

  async function reloadVersions(selectVersionId?: number) {
    const updated = await api.listStandardEplVersions() as StandardEplVersion[];
    setVersions(updated);
    if (selectVersionId !== undefined) setSelectedVersionId(selectVersionId);
  }

  async function reloadRows() {
    if (selectedVersionId === null) return;
    const updated = await api.getStandardEplCombined(selectedVersionId);
    setRows(updated as CombinedEplRow[]);
  }

  // --- Draft creation ---
  function openCreateDraft() {
    setNewDraftName(todayISO());
    setCloneFromId(latestPublishedId);
    setNewDraftNotes('');
    setShowCreateDraft(true);
  }

  async function handleCreateDraft() {
    if (!newDraftName.trim() || !cloneFromId) return;
    setCreatingDraft(true);
    try {
      const draft = await api.createStandardEplDraft({
        sourceVersionId: cloneFromId,
        versionName: newDraftName.trim(),
        notes: newDraftNotes.trim() || undefined,
      }) as StandardEplVersion;
      await reloadVersions(draft.version_id);
      setShowCreateDraft(false);
      toast('Draft created', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setCreatingDraft(false);
    }
  }

  // --- Publish ---
  function openPublish() {
    setPublishName(draftVersion?.version_name ?? '');
    setPublishDate('');
    setPublishNotes(draftVersion?.notes ?? '');
    setShowPublish(true);
  }

  async function handlePublish() {
    if (!publishDate) { toast('Effective date is required', 'error'); return; }
    setPublishing(true);
    try {
      const published = await api.publishStandardEplDraft({
        effectiveFrom: publishDate,
        notes: publishNotes.trim() || undefined,
        versionName: publishName.trim() || undefined,
      }) as StandardEplVersion;
      await reloadVersions(published.version_id);
      setShowPublish(false);
      toast('Version published', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPublishing(false);
    }
  }

  // --- Discard ---
  async function handleDiscard() {
    setDiscarding(true);
    try {
      await api.deleteStandardEplDraft();
      const updated = await api.listStandardEplVersions() as StandardEplVersion[];
      setVersions(updated);
      const latestPub = updated.find(v => v.status === 'published');
      setSelectedVersionId(latestPub?.version_id ?? null);
      setShowDiscard(false);
      toast('Draft discarded', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setDiscarding(false);
    }
  }

  // --- Price editing (draft only) ---
  function startEdit(row: CombinedEplRow, currency: 'USD' | 'EUR', field: 'price' | 'unit') {
    if (!isDraftSelected) return;
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
    if (!editing || !isDraftSelected || !selectedVersionId) return;
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
          await api.upsertStandardEpl({ version_id: selectedVersionId, rip_code: row.rip_code,
            product_type: row.product_type, product_name: row.product_name, currency, net_price: currentPrice ?? 0, unit: newUnit });
        }
      } else {
        await api.upsertStandardEpl({ version_id: selectedVersionId, rip_code: row.rip_code,
          product_type: row.product_type, product_name: row.product_name, currency,
          net_price: field === 'price' ? newPrice : 0, unit: newUnit });
      }
      await reloadRows();
      toast('Saved', 'success');
    } catch {
      toast('Failed to save', 'error');
    } finally {
      setSaving(false);
      setEditing(null);
      setDraftValue('');
    }
  }

  async function handleDeleteRow(ripCode: string) {
    if (!isDraftSelected || !selectedVersionId) return;
    try {
      await api.deleteStandardEplRow({ versionId: selectedVersionId, ripCode });
      await reloadRows();
      toast('Product removed from draft', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // --- Add product ---
  async function openAddProduct() {
    const prods = await api.getProducts() as Product[];
    setAllProducts(prods);
    setAddProductSearch('');
    setAddProductRip('');
    setAddUsdPrice('');
    setAddUsdUnit(defaultUnit);
    setAddEurPrice('');
    setAddEurUnit(defaultUnit);
    setShowAddProduct(true);
  }

  async function handleAddProduct() {
    if (!selectedVersionId || !addProductRip) return;
    const product = allProducts.find(p => p.rip_code === addProductRip);
    if (!product) return;
    setAddingProduct(true);
    try {
      const usdPrice = parseFloat(addUsdPrice);
      const eurPrice = parseFloat(addEurPrice);
      if (!isNaN(usdPrice) && usdPrice >= 0) {
        await api.upsertStandardEpl({ version_id: selectedVersionId, rip_code: product.rip_code,
          product_type: product.product_type, product_name: product.product_name,
          currency: 'USD', net_price: usdPrice, unit: addUsdUnit || defaultUnit });
      }
      if (!isNaN(eurPrice) && eurPrice >= 0) {
        await api.upsertStandardEpl({ version_id: selectedVersionId, rip_code: product.rip_code,
          product_type: product.product_type, product_name: product.product_name,
          currency: 'EUR', net_price: eurPrice, unit: addEurUnit || defaultUnit });
      }
      await reloadRows();
      setShowAddProduct(false);
      toast('Product added to draft', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setAddingProduct(false);
    }
  }

  // --- Export ---
  async function handleExport() {
    const result = await api.exportStandardEplXlsx(selectedVersionId ?? undefined) as { saved: boolean; error?: string };
    if (result.saved) toast('EPL exported', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  async function handleEmail() {
    const result = await api.exportStandardEplMail(selectedVersionId ?? undefined) as { success: boolean; error?: string };
    if (!result.success) toast(`Email failed: ${result.error}`, 'error');
  }

  async function handleExportPackaging() {
    const result = await api.exportPackagingXlsx(selectedPackVersion) as { saved: boolean; error?: string };
    if (result.saved) toast('Packaging exported', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  async function handleEmailPackaging() {
    const result = await api.exportPackagingMail(selectedPackVersion) as { success: boolean; error?: string };
    if (!result.success) toast(`Email failed: ${result.error}`, 'error');
  }

  // --- Compare ---
  function openCompare() {
    const pub = publishedVersions;
    if (pub.length >= 2) {
      setCompareA(pub[1].version_id);
      setCompareB(pub[0].version_id);
    } else if (pub.length === 1 && draftVersion) {
      setCompareA(pub[0].version_id);
      setCompareB(draftVersion.version_id);
    } else {
      setCompareA(null);
      setCompareB(null);
    }
    setShowCompare(true);
  }

  function PriceCell({ row, currency }: { row: CombinedEplRow; currency: 'USD' | 'EUR' }) {
    const isEditingPrice = editing?.id === row.id && editing.currency === currency && editing.field === 'price';
    const isEditingUnit = editing?.id === row.id && editing.currency === currency && editing.field === 'unit';
    const price = currency === 'USD' ? row.usd_price : row.eur_price;
    const unit = currency === 'USD' ? row.usd_unit : row.eur_unit;

    if (!isDraftSelected) {
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
            onChange={e => { const v = e.target.value; setDraftValue(v); commitEdit(row, v); }}
            onBlur={() => cancelEdit()}
            disabled={saving}
          >
            {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
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

  const selectedVersionMeta = packagingVersions.find(v => v.version === selectedPackVersion);
  const allVersionsForCompare = versions; // draft + published

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Standard EPL</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {tab === 'prices'
              ? `${rows.length} products · ${selectedVersion?.version_name ?? '—'}`
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
            <Button variant="outline" size="sm" onClick={handleExportPackaging} disabled={!selectedPackVersion || packagingRows.length === 0}>
              <Download size={14} className="mr-1.5" />
              Export to Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleEmailPackaging} disabled={!selectedPackVersion || packagingRows.length === 0}>
              <Mail size={14} className="mr-1.5" />
              Email
            </Button>
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(['prices', 'packaging'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'prices' ? 'Standard Prices' : 'Packaging Charges'}
          </button>
        ))}
      </div>

      {tab === 'prices' && (
        <>
          {/* Version bar */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <label className="text-sm text-gray-600 shrink-0">Version:</label>
            <select
              value={selectedVersionId ?? ''}
              onChange={e => setSelectedVersionId(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {versions.map(v => (
                <option key={v.version_id} value={v.version_id}>
                  {v.status === 'draft' ? `Draft: ${v.version_name}` : v.version_name}
                  {v.status === 'published' && v.effective_from ? ` (eff. ${v.effective_from})` : ''}
                </option>
              ))}
            </select>

            {selectedVersion?.status === 'draft' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                ◐ Draft
              </span>
            )}
            {selectedVersion?.status === 'published' && selectedVersionId === latestPublishedId && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                ● Active
              </span>
            )}
            {selectedVersion?.status === 'published' && selectedVersionId !== latestPublishedId && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                ○ Older
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {versions.length >= 2 && (
                <Button variant="outline" size="sm" onClick={openCompare}>
                  Compare versions
                </Button>
              )}
              {isDraftSelected ? (
                <>
                  <Button size="sm" onClick={openPublish}>
                    Publish
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                    onClick={() => setShowDiscard(true)}>
                    Discard Draft
                  </Button>
                </>
              ) : (
                !draftVersion && (
                  <Button variant="outline" size="sm" onClick={openCreateDraft}>
                    <GitBranch size={14} className="mr-1.5" />
                    New Version
                  </Button>
                )
              )}
              {!isDraftSelected && draftVersion && (
                <Button variant="outline" size="sm" onClick={() => setSelectedVersionId(draftVersion.version_id)}>
                  Go to Draft
                </Button>
              )}
            </div>
          </div>

          {/* Draft info bar */}
          {isDraftSelected && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <span className="font-medium">Editing Draft:</span>
              <span>{draftVersion?.version_name}</span>
              {draftVersion?.notes && (
                <span className="text-amber-600 text-xs ml-2 italic">— {draftVersion.notes}</span>
              )}
            </div>
          )}

          {/* Published version note */}
          {!isDraftSelected && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500">
              <span>Read-only —</span>
              {draftVersion
                ? <span>a draft exists; <button className="underline text-blue-600" onClick={() => setSelectedVersionId(draftVersion.version_id)}>switch to Draft</button> to edit prices.</span>
                : <span>click <strong className="text-gray-700">New Version</strong> to create an editable draft.</span>
              }
            </div>
          )}

          {/* Comparison panel */}
          {showCompare && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-gray-600">Compare:</span>
                <select value={compareA ?? ''} onChange={e => setCompareA(Number(e.target.value))}
                  className="text-sm border border-gray-300 rounded px-2 py-1 bg-white">
                  {allVersionsForCompare.map(v => (
                    <option key={v.version_id} value={v.version_id}>
                      {v.status === 'draft' ? `Draft: ${v.version_name}` : v.version_name}
                    </option>
                  ))}
                </select>
                <span className="text-gray-400">→</span>
                <select value={compareB ?? ''} onChange={e => setCompareB(Number(e.target.value))}
                  className="text-sm border border-gray-300 rounded px-2 py-1 bg-white">
                  {allVersionsForCompare.map(v => (
                    <option key={v.version_id} value={v.version_id}>
                      {v.status === 'draft' ? `Draft: ${v.version_name}` : v.version_name}
                    </option>
                  ))}
                </select>
              </div>
              {compareA !== null && compareB !== null && compareA !== compareB && (
                <StandardEplComparisonPanel
                  versionIdA={compareA}
                  versionIdB={compareB}
                  versions={versions}
                  onClose={() => setShowCompare(false)}
                />
              )}
              {compareA === compareB && (
                <p className="text-sm text-amber-600">Select two different versions to compare.</p>
              )}
            </div>
          )}

          {/* Search + Add Product */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            {isDraftSelected && (
              <Button variant="outline" size="sm" onClick={openAddProduct}>
                <Plus size={14} className="mr-1.5" />
                Add Product
              </Button>
            )}
          </div>

          {/* Products table */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">RIP Code</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Product Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">USD Price / Unit</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">EUR Price / Unit</th>
                  {isDraftSelected && <th className="w-10 px-2 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isDraftSelected ? 6 : 5} className="text-center py-10 text-gray-400">
                      No products found
                    </td>
                  </tr>
                ) : (
                  filtered.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{row.rip_code}</td>
                      <td className="px-4 py-2 text-gray-600">{row.product_type}</td>
                      <td className="px-4 py-2 text-gray-900">{row.product_name}</td>
                      <td className="px-4 py-2">{PriceCell({ row, currency: 'USD' })}</td>
                      <td className="px-4 py-2">{PriceCell({ row, currency: 'EUR' })}</td>
                      {isDraftSelected && (
                        <td className="px-2 py-2">
                          <button
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-all rounded"
                            title="Remove from draft"
                            onClick={() => handleDeleteRow(row.rip_code)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
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
                <select value={selectedPackVersion} onChange={e => setSelectedPackVersion(e.target.value)}
                  className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {packagingVersions.map(v => <option key={v.version} value={v.version}>{v.version}</option>)}
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
                      <tr><td colSpan={5} className="text-center py-10 text-gray-400">Loading…</td></tr>
                    ) : packagingRows.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-10 text-gray-400">No rows in this version</td></tr>
                    ) : packagingRows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 text-gray-500 text-xs">{row.product_type}</td>
                        <td className="px-4 py-2 text-gray-900">{row.packaging_name}</td>
                        <td className="px-4 py-2 text-right font-mono">
                          {row.price === null
                            ? <span className="text-gray-300 text-xs italic">label</span>
                            : <span className="text-gray-900">{row.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
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

      {/* Create Draft Dialog */}
      <Dialog open={showCreateDraft} onClose={() => setShowCreateDraft(false)} title="Create New Version">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Version Name</label>
            <Input value={newDraftName} onChange={e => setNewDraftName(e.target.value)} placeholder="e.g. 2026-06-05" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clone Prices From</label>
            <select value={cloneFromId ?? ''} onChange={e => setCloneFromId(Number(e.target.value))}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {publishedVersions.map(v => (
                <option key={v.version_id} value={v.version_id}>
                  {v.version_name}{v.effective_from ? ` (eff. ${v.effective_from})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
              placeholder="What are you changing in this version?"
              value={newDraftNotes}
              onChange={e => setNewDraftNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCreateDraft(false)} disabled={creatingDraft}>Cancel</Button>
            <Button onClick={handleCreateDraft} disabled={!newDraftName.trim() || !cloneFromId || creatingDraft}>
              {creatingDraft ? 'Creating…' : 'Create Draft'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Publish Dialog */}
      <Dialog open={showPublish} onClose={() => setShowPublish(false)} title="Publish Draft">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Version Name</label>
            <Input value={publishName} onChange={e => setPublishName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Effective Date <span className="text-red-500">*</span>
            </label>
            <Input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
              value={publishNotes}
              onChange={e => setPublishNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowPublish(false)} disabled={publishing}>Cancel</Button>
            <Button onClick={handlePublish} disabled={!publishDate || publishing}>
              {publishing ? 'Publishing…' : 'Publish Version'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Discard Confirm */}
      <Dialog open={showDiscard} onClose={() => setShowDiscard(false)} title="Discard Draft?">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will permanently delete the draft <strong>{draftVersion?.version_name}</strong> and all its price changes.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDiscard(false)} disabled={discarding}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDiscard} disabled={discarding}>
              {discarding ? 'Discarding…' : 'Discard Draft'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Add Product Dialog */}
      <Dialog open={showAddProduct} onClose={() => setShowAddProduct(false)} title="Add Product to Draft">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
            <div className="relative mb-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search by name or RIP…" value={addProductSearch}
                onChange={e => setAddProductSearch(e.target.value)} className="pl-8 text-sm" />
            </div>
            <select
              size={5}
              value={addProductRip}
              onChange={e => setAddProductRip(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {allProducts
                .filter(p => {
                  if (!addProductSearch) return true;
                  const s = addProductSearch.toLowerCase();
                  return p.rip_code.toLowerCase().includes(s) || p.product_name.toLowerCase().includes(s);
                })
                .map(p => (
                  <option key={p.rip_code} value={p.rip_code}>{p.rip_code} — {p.product_name}</option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">USD Price</label>
              <Input type="number" step="0.01" placeholder="0.00" value={addUsdPrice} onChange={e => setAddUsdPrice(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">USD Unit</label>
              <select value={addUsdUnit} onChange={e => setAddUsdUnit(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">EUR Price</label>
              <Input type="number" step="0.01" placeholder="0.00" value={addEurPrice} onChange={e => setAddEurPrice(e.target.value)} className="text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">EUR Unit</label>
              <select value={addEurUnit} onChange={e => setAddEurUnit(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {units.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400">Leave a price blank to skip that currency.</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowAddProduct(false)} disabled={addingProduct}>Cancel</Button>
            <Button onClick={handleAddProduct} disabled={!addProductRip || addingProduct}>
              {addingProduct ? 'Adding…' : 'Add Product'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
