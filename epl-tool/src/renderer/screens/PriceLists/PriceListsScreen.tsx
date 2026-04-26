import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { formatDate } from '../../lib/utils';
import type { PriceListHeader, Customer } from '../../../types';

export function PriceListsScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [lists, setLists] = useState<PriceListHeader[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [l, c] = await Promise.all([api.getPriceLists(), api.getCustomers()]);
      setLists(l as PriceListHeader[]);
      setCustomers(c as Customer[]);
    }
    load();
  }, []);

  const filtered = lists.filter(pl => {
    if (filterCustomer && pl.customer_ref_sap !== filterCustomer) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!pl.customer_short_name?.toLowerCase().includes(s) && !pl.price_list_id.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  async function handleDelete(id: string) {
    await api.deletePriceList(id);
    setLists(prev => prev.filter(p => p.price_list_id !== id));
    toast('Price list deleted', 'info');
  }

  async function handleExport(id: string) {
    const result = await api.exportXlsx(id);
    if (result.saved) toast('Exported successfully', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Lists</h1>
          <p className="text-gray-500 text-sm mt-0.5">{lists.length} total</p>
        </div>
        <Button onClick={() => navigate('/price-lists/create')} className="gap-2">
          <Plus size={15} />
          New Price List
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search customer or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filterCustomer}
          onChange={e => setFilterCustomer(e.target.value)}
          className="w-48"
          placeholder="All customers"
        >
          {customers.map(c => (
            <option key={c.customer_ref_sap} value={c.customer_ref_sap}>
              {c.customer_short_name}
            </option>
          ))}
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Effective</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Mailing</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Version</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400">
                  No price lists found
                </td>
              </tr>
            ) : (
              filtered.map(pl => (
                <tr key={pl.price_list_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {pl.customer_short_name ?? pl.customer_ref_sap}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(pl.effective)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(pl.mailing_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{pl.price_list_version}</td>
                  <td className="px-4 py-3">
                    <Badge variant={pl.price_type === 'Discount' ? 'default' : 'secondary'}>
                      {pl.price_type === 'Discount' ? `${pl.discount_percent}% disc.` : 'Net Price'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/price-lists/${pl.price_list_id}`)}>
                        View
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleExport(pl.price_list_id)}>
                        Export
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(pl.price_list_id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50">
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && handleDelete(deleteId)}
        title="Delete Price List"
        description="This will permanently delete the price list and all its entries. This cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
