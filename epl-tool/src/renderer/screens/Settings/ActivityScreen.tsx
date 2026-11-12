import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileDown, Search } from 'lucide-react';
import { api } from '../../lib/ipc';
import { ipcErrorMessage } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SearchableSelect } from '../../components/ui/searchable-select';
import { useToast } from '../../components/ui/toast';
import { formatAuditTime } from '../Customers/CustomerHistory';
import type { AuditFilters, AuditListResult, Customer } from '../../../types';

const AREAS: [string, string][] = [
  ['customer.', 'Customers'], ['price_list.', 'Price lists'], ['email.', 'Emails'], ['product.', 'Products'],
  ['epl.', 'Standard EPL'], ['packaging.', 'Packaging'], ['currency.', 'Currencies'], ['unit.', 'Units'],
  ['pbp_email.', 'PBP emails'], ['settings.', 'Settings'], ['fx.', 'FX rates'], ['user.', 'Users'], ['backup.', 'Backups'],
  ['sync.', 'Shared database'],
];

const SELECT = 'h-9 text-sm border border-gray-300 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

// The activity log, visible to every user: who changed what, when.
export function ActivityScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<AuditFilters>({ customerRef: params.get('customer') ?? undefined, limit: 500 });
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AuditListResult | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.getCustomers(), api.getDeletedCustomers()])
      .then(([a, h]) => setCustomers([...(a as Customer[]), ...(h as Customer[])]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.listAudit({ ...filters, search: search.trim() || undefined }).then(r => setData(r as AuditListResult));
    }, 200);
    return () => clearTimeout(t);
  }, [filters, search]);

  const set = (patch: Partial<AuditFilters>) => setFilters(f => ({ ...f, ...patch }));
  const hasFilters = filters.userId !== undefined || filters.action || filters.customerRef || filters.from || filters.to || search;
  const customerName = (ref: string | null) => customers.find(c => c.customer_ref_sap === ref)?.customer_short_name ?? ref;

  async function exportXlsx() {
    try {
      const r = await api.exportAuditXlsx({ ...filters, search: search.trim() || undefined }) as { saved: boolean; count?: number; error?: string };
      if (r.saved) toast(`Exported ${r.count} entr${r.count === 1 ? 'y' : 'ies'}`, 'success');
      else if (r.error) toast(`Export failed: ${r.error}`, 'error');
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} className="gap-1">
          <ArrowLeft size={15} /> Settings
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {data ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'}${data.total > data.entries.length ? ` · showing the latest ${data.entries.length}` : ''}` : 'Loading…'}
          </p>
        </div>
        <Button variant="outline" onClick={exportXlsx} className="gap-2" disabled={!data || data.total === 0}>
          <FileDown size={14} /> Export to Excel
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search summary…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 w-56" />
        </div>
        <select className={SELECT} value={filters.userId ?? ''} onChange={e => set({ userId: e.target.value === '' ? undefined : Number(e.target.value) })}>
          <option value="">All users</option>
          {data?.users.map(u => (u.user_id === null ? null : <option key={u.user_id} value={u.user_id}>{u.user_label}</option>))}
        </select>
        <select className={SELECT} value={filters.action ?? ''} onChange={e => set({ action: e.target.value || undefined })}>
          <option value="">All actions</option>
          {AREAS.map(([prefix, label]) => <option key={prefix} value={prefix}>{label}</option>)}
          <optgroup label="Exact action">
            {data?.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </optgroup>
        </select>
        <SearchableSelect
          values={filters.customerRef ? [filters.customerRef] : []}
          onChange={v => set({ customerRef: v[0] })}
          options={customers.map(c => ({ value: c.customer_ref_sap, label: c.customer_short_name, sublabel: c.customer_ref_sap, keywords: c.customer_full_name }))}
          placeholder="All customers"
          searchPlaceholder="Search customer…"
          className="w-56"
        />
        <span className="text-xs text-gray-400">From</span>
        <input type="date" className={SELECT} value={filters.from ?? ''} onChange={e => set({ from: e.target.value || undefined })} />
        <span className="text-xs text-gray-400">to</span>
        <input type="date" className={SELECT} value={filters.to ?? ''} onChange={e => set({ to: e.target.value || undefined })} />
        {hasFilters && (
          <button className="text-xs text-blue-600 hover:text-blue-800 px-1" onClick={() => { setFilters({ limit: 500 }); setSearch(''); }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-40">When</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-56">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Action</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-32">Customer</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data && data.entries.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No activity {hasFilters ? 'matches these filters' : 'recorded yet'}</td></tr>
            )}
            {data?.entries.map(e => (
              <tr key={e.id} className="hover:bg-gray-50 align-top cursor-pointer" onClick={() => setExpanded(x => (x === e.id ? null : e.id))}>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatAuditTime(e.at)}</td>
                <td className="px-4 py-2 text-gray-700 truncate max-w-[14rem]" title={e.user_label}>{e.user_label}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">{e.action}</td>
                <td className="px-4 py-2 text-gray-600">
                  {e.customer_ref_sap && (
                    <button className="text-blue-600 hover:underline" onClick={ev => { ev.stopPropagation(); navigate(`/customers/${encodeURIComponent(e.customer_ref_sap ?? '')}`); }}>
                      {customerName(e.customer_ref_sap)}
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-900">
                  {e.summary}
                  {expanded === e.id && e.details && (
                    <pre className="mt-2 p-2 bg-gray-50 rounded text-[11px] text-gray-600 whitespace-pre-wrap break-all">
                      {JSON.stringify(JSON.parse(e.details), null, 2)}
                    </pre>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
