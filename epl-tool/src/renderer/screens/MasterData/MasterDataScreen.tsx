import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { Dialog } from '../../components/ui/dialog';
import type { Product } from '../../../types';

export function MasterDataScreen() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Product>>({});
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newProduct, setNewProduct] = useState<Omit<Product, 'id'>>({ plant: '', product_type: '', rip_code: '', product_name: '' });
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getProducts().then(p => setProducts(p as Product[]));
  }, []);

  useEffect(() => {
    if (editingId !== null) inputRef.current?.focus();
  }, [editingId]);

  const filtered = products.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      p.rip_code.toLowerCase().includes(s) ||
      p.product_name.toLowerCase().includes(s) ||
      p.product_type.toLowerCase().includes(s) ||
      (p.plant ?? '').toLowerCase().includes(s)
    );
  });

  function startEdit(p: Product) {
    setEditingId(p.id);
    setDraft({ plant: p.plant ?? '', product_type: p.product_type, product_name: p.product_name });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({});
  }

  async function saveEdit(p: Product) {
    setSaving(true);
    try {
      const updated = await api.updateProduct(p.id, {
        plant: (draft.plant as string) || null,
        product_type: draft.product_type as string,
        product_name: draft.product_name as string,
      });
      setProducts(prev => prev.map(x => x.id === p.id ? updated as Product : x));
      setEditingId(null);
      setDraft({});
      toast('Product updated', 'success');
    } catch {
      toast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    if (!newProduct.rip_code.trim() || !newProduct.product_name.trim() || !newProduct.product_type.trim()) {
      toast('RIP Code, Product Type, and Name are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await api.createProduct({
        plant: newProduct.plant || null,
        product_type: newProduct.product_type.trim(),
        rip_code: newProduct.rip_code.trim(),
        product_name: newProduct.product_name.trim(),
      });
      setProducts(prev => [...prev, created as Product].sort((a, b) =>
        a.product_type.localeCompare(b.product_type) || a.rip_code.localeCompare(b.rip_code)
      ));
      setAddOpen(false);
      setNewProduct({ plant: '', product_type: '', rip_code: '', product_name: '' });
      toast('Product added', 'success');
    } catch {
      toast('Failed to add product (duplicate RIP code?)', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.deleteProduct(deleteTarget.id);
    setProducts(prev => prev.filter(p => p.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast('Product deleted', 'success');
  }

  function setNew<K extends keyof typeof newProduct>(k: K, v: string) {
    setNewProduct(prev => ({ ...prev, [k]: v }));
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Data</h1>
          <p className="text-gray-500 text-sm mt-0.5">{products.length} products</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <Plus size={14} /> Add Product
        </Button>
      </div>

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
              <th className="text-left px-4 py-3 font-medium text-gray-600">Plant</th>
              <th className="px-4 py-3 w-32" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-gray-400">No products found</td>
              </tr>
            ) : (
              filtered.map(p => {
                const isEditing = editingId === p.id;
                return (
                  <tr key={p.id} className={`transition-colors ${isEditing ? 'bg-blue-50/30' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{p.rip_code}</td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          className="text-sm border border-gray-300 rounded px-2 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={draft.product_type as string}
                          onChange={e => setDraft(d => ({ ...d, product_type: e.target.value }))}
                        />
                      ) : (
                        <span className="text-gray-900">{p.product_type}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="text-sm border border-gray-300 rounded px-2 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={draft.product_name as string}
                          onChange={e => setDraft(d => ({ ...d, product_name: e.target.value }))}
                        />
                      ) : (
                        <span className="text-gray-900">{p.product_name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          className="text-sm border border-gray-300 rounded px-2 py-0.5 w-24 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={draft.plant as string}
                          onChange={e => setDraft(d => ({ ...d, plant: e.target.value }))}
                        />
                      ) : (
                        <span className="text-gray-500 text-xs">{p.plant ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Button>
                          <Button size="sm" onClick={() => saveEdit(p)} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>Edit</Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteTarget(p)}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add product dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Product">
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">RIP Code *</label>
            <Input value={newProduct.rip_code} onChange={e => setNew('rip_code', e.target.value)} placeholder="e.g. RIP001" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Product Type *</label>
            <Input value={newProduct.product_type} onChange={e => setNew('product_type', e.target.value)} placeholder="e.g. Lubricant" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Product Name *</label>
            <Input value={newProduct.product_name} onChange={e => setNew('product_name', e.target.value)} placeholder="e.g. Marine Oil 40" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Plant</label>
            <Input value={newProduct.plant ?? ''} onChange={e => setNew('plant', e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Button>
        </div>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Product">
        <p className="text-sm text-gray-700 mb-1">
          Are you sure you want to delete <strong>{deleteTarget?.product_name}</strong>?
        </p>
        <p className="text-xs text-gray-500 mb-4">
          This will also remove its standard EPL price entries.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
        </div>
      </Dialog>
    </div>
  );
}
