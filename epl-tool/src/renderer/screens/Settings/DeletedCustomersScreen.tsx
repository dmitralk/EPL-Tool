import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import type { Customer } from '../../../types';

export function DeletedCustomersScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

  useEffect(() => {
    api.getDeletedCustomers().then(c => {
      setCustomers(c as Customer[]);
      setLoading(false);
    });
  }, []);

  async function handleRestore(ref: string) {
    await api.restoreCustomer(ref);
    setCustomers(prev => prev.filter(c => c.customer_ref_sap !== ref));
    toast('Customer restored', 'success');
  }

  async function handleDeletePermanent(ref: string) {
    await api.deleteCustomerPermanent(ref);
    setCustomers(prev => prev.filter(c => c.customer_ref_sap !== ref));
    setConfirmDelete(null);
    toast('Customer permanently deleted', 'info');
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} className="gap-1">
          <ArrowLeft size={15} /> Settings
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hidden Customers</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Hidden customers and their price lists are excluded from all views and mass updates.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-lg border border-gray-200">
          No hidden customers
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">SAP Ref</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Currency</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map(c => (
                <tr key={c.customer_ref_sap} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.customer_short_name}</div>
                    <div className="text-xs text-gray-400">{c.customer_full_name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.customer_ref_sap}</td>
                  <td className="px-4 py-3 text-gray-600">{c.country ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.currency === 'USD' ? 'default' : 'secondary'}>{c.currency}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(c.customer_ref_sap)}
                      >
                        Restore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(c)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        Delete Permanently
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeletePermanent(confirmDelete.customer_ref_sap)}
        title="Delete Permanently"
        description={`This will permanently delete ${confirmDelete?.customer_short_name} and all their price lists from the database. This cannot be undone.`}
        confirmLabel="Delete Permanently"
      />
    </div>
  );
}
