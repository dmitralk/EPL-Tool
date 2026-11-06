import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useAuth, useCan } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { SearchableSelect } from '../../components/ui/searchable-select';
import { Badge } from '../../components/ui/badge';
import { ModeBadge } from '../../components/ModeBadge';
import { NewCustomerDialog } from './NewCustomerDialog';
import type { Customer } from '../../../types';

export function CustomersScreen() {
  const navigate = useNavigate();
  const can = useCan();
  const { refresh } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filterCustomers, setFilterCustomers] = useState<string[]>([]);
  const [mineOnly, setMineOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.getCustomers().then(c => setCustomers(c as Customer[]));
  }, []);

  const filtered = customers
    .filter(c => filterCustomers.length === 0 || filterCustomers.includes(c.customer_ref_sap))
    .filter(c => !mineOnly || can.manages(c.customer_ref_sap));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {filtered.length !== customers.length ? `${filtered.length} of ${customers.length}` : `${customers.length} total`}
          </p>
        </div>
        {can.createCustomer && (
          <Button onClick={() => setCreating(true)} className="gap-2"><Plus size={14} /> New Customer</Button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <SearchableSelect
          multiple
          values={filterCustomers}
          onChange={setFilterCustomers}
          options={customers.map(c => ({
            value: c.customer_ref_sap,
            label: c.customer_short_name,
            sublabel: c.customer_ref_sap,
            keywords: c.customer_full_name,
          }))}
          placeholder="All customers"
          pluralLabel="customers"
          searchPlaceholder="Search customer name or SAP code…"
          className="w-96"
        />
        <button
          onClick={() => setMineOnly(v => !v)}
          className={cn('h-9 px-3 rounded-md border text-sm', mineOnly
            ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50')}
          title="Customers you manage"
        >
          My customers
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Short Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Full Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">SAP Ref</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Country</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Customer Type</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Currency</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Pricing management</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-gray-400">
                  {mineOnly ? 'You don\'t manage any of these customers' : 'No customers found'}
                </td>
              </tr>
            ) : (
              filtered.map(c => (
                <tr key={c.customer_ref_sap} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.customer_short_name}</td>
                  <td className="px-4 py-3 text-gray-700">{c.customer_full_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.customer_ref_sap}</td>
                  <td className="px-4 py-3 text-gray-600">{c.country ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.customer_type ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.currency === 'USD' ? 'default' : 'secondary'}>
                      {c.currency}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><ModeBadge customer={c} /></td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/customers/${encodeURIComponent(c.customer_ref_sap)}`)}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NewCustomerDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async c => {
          setCreating(false);
          await refresh();
          navigate(`/customers/${encodeURIComponent(c.customer_ref_sap)}`);
        }}
      />
    </div>
  );
}
