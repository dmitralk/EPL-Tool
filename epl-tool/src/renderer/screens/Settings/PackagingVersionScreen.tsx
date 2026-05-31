import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import type { PackagingRow } from '../../../types';

type NewRow = Omit<PackagingRow, 'id'>;

export function PackagingVersionScreen() {
  const { version } = useParams<{ version: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const decodedVersion = decodeURIComponent(version ?? '');

  const [rows, setRows] = useState<PackagingRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PackagingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newRow, setNewRow] = useState<NewRow>({
    packaging_version: decodedVersion,
    product_type: '',
    packaging_name: '',
    price: null,
    currency: '',
    unit: null,
    sort_order: 0,
  });

  useEffect(() => {
    api.getPackaging(decodedVersion).then(list => setRows(list as PackagingRow[]));
  }, [decodedVersion]);

  function startEdit(row: PackagingRow) {
    setEditingId(row.id);
    setDraft({ ...row });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function setField<K extends keyof PackagingRow>(key: K, value: PackagingRow[K]) {
    setDraft(d => d ? { ...d, [key]: value } : d);
  }

  async function saveEdit() {
    if (!draft || editingId === null) return;
    setSaving(true);
    try {
      await api.updatePackagingRow(editingId, {
        product_type: draft.product_type,
        packaging_name: draft.packaging_name,
        price: draft.price,
        currency: draft.currency,
        unit: draft.unit,
        sort_order: draft.sort_order,
      });
      setRows(prev => prev
        .map(r => r.id === editingId ? { ...draft } : r)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      );
      setEditingId(null);
      setDraft(null);
    } catch {
      toast('Failed to save row', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await api.deletePackagingRow(id);
    setRows(prev => prev.filter(r => r.id !== id));
    if (editingId === id) cancelEdit();
  }

  function openAddDialog() {
    const maxSort = rows.length > 0 ? Math.max(...rows.map(r => r.sort_order ?? 0)) : 0;
    const defaultCurrency = rows.find(r => r.currency)?.currency ?? '';
    setNewRow({
      packaging_version: decodedVersion,
      product_type: '',
      packaging_name: '',
      price: null,
      currency: defaultCurrency,
      unit: null,
      sort_order: maxSort + 10,
    });
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!newRow.product_type.trim() || !newRow.packaging_name.trim() || !newRow.currency.trim()) {
      toast('Type, Name, and Currency are required', 'error');
      return;
    }
    const created = await api.addPackagingRow(newRow) as PackagingRow;
    setRows(prev => [...prev, created].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
    setAddOpen(false);
    toast('Row added', 'success');
  }

  const cellClass = 'w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <button
          onClick={() => navigate('/settings/packaging')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3 inline-block"
        >
          ← Packaging Versions
        </button>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{decodedVersion}</h1>
          <Button variant="outline" onClick={openAddDialog}>+ Add Row</Button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Rows without a price are treated as section labels in the export and won't appear as line items.
          Rows are ordered by Sort value ascending.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-32">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 w-28">Price</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-20">Currency</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Unit</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 w-16">Sort</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    No rows yet. Add one to get started.
                  </td>
                </tr>
              ) : rows.map(row => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className={isEditing ? 'bg-blue-50/40' : 'hover:bg-gray-50 transition-colors'}>
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2">
                          <input
                            className={cellClass}
                            value={draft!.product_type}
                            onChange={e => setField('product_type', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className={cellClass}
                            value={draft!.packaging_name}
                            onChange={e => setField('packaging_name', e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            className={`${cellClass} text-right`}
                            value={draft!.price ?? ''}
                            placeholder="(label)"
                            onChange={e =>
                              setField('price', e.target.value === '' ? null : parseFloat(e.target.value))
                            }
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className={cellClass}
                            value={draft!.currency}
                            onChange={e => setField('currency', e.target.value.toUpperCase())}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className={cellClass}
                            value={draft!.unit ?? ''}
                            placeholder="—"
                            onChange={e => setField('unit', e.target.value || null)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            className={`${cellClass} text-right`}
                            value={draft!.sort_order}
                            onChange={e => setField('sort_order', parseInt(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <Button size="sm" onClick={saveEdit} disabled={saving} className="mr-1">
                            {saving ? 'Saving…' : 'Save'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-gray-700 text-xs">{row.product_type}</td>
                        <td className="px-4 py-3 text-gray-900">{row.packaging_name}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-900">
                          {row.price === null
                            ? <span className="text-gray-300 text-xs italic">label</span>
                            : row.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs font-mono">{row.currency}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{row.unit ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-300 text-xs">{row.sort_order}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(row)}
                            className="mr-1"
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400 hover:text-red-600 hover:bg-red-50 px-2"
                            onClick={() => handleDelete(row.id)}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Add row dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Row">
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Product Type *</label>
            <input
              autoFocus
              className={cellClass}
              placeholder="e.g. ADDITIVES"
              value={newRow.product_type}
              onChange={e => setNewRow(r => ({ ...r, product_type: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input
              className={cellClass}
              placeholder="e.g. IBC 1000L"
              value={newRow.packaging_name}
              onChange={e => setNewRow(r => ({ ...r, packaging_name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Price <span className="text-gray-400 font-normal">(leave empty for a label row)</span>
            </label>
            <input
              type="number"
              className={cellClass}
              placeholder="e.g. 45.00"
              value={newRow.price ?? ''}
              onChange={e => setNewRow(r => ({ ...r, price: e.target.value === '' ? null : parseFloat(e.target.value) }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Currency *</label>
            <input
              className={`${cellClass} uppercase`}
              placeholder="e.g. EUR"
              value={newRow.currency}
              onChange={e => setNewRow(r => ({ ...r, currency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
            <input
              className={cellClass}
              placeholder="e.g. 100 KG"
              value={newRow.unit ?? ''}
              onChange={e => setNewRow(r => ({ ...r, unit: e.target.value || null }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort Order</label>
            <input
              type="number"
              className={cellClass}
              value={newRow.sort_order}
              onChange={e => setNewRow(r => ({ ...r, sort_order: parseInt(e.target.value) || 0 }))}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd}>Add Row</Button>
        </div>
      </Dialog>
    </div>
  );
}
