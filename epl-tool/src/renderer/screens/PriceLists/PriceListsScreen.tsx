import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileDown, Mail, ArrowLeftRight } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { SearchableSelect } from '../../components/ui/searchable-select';
import { Badge } from '../../components/ui/badge';
import { ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { EmailComposeDialog } from '../../components/EmailComposeDialog';
import { formatDate, ipcErrorMessage, priceTypeLabel } from '../../lib/utils';
import { useCan } from '../../lib/auth';
import { LockBadge } from '../../components/LockBadge';
import { ComparisonPanel } from '../Customers/ComparisonPanel';
import type { PriceListHeader, Customer } from '../../../types';
import type { PermCustomer } from '../../../shared/permissions';

// Lists of customers without a row (orphaned lists) behave as Managed by PBP.
const access = (pl: PriceListHeader): PermCustomer => ({
  pricing_mode: pl.pricing_mode ?? 'pbp', manager_ids: pl.manager_ids ?? [], manager_names: pl.manager_names ?? [],
});

export function PriceListsScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [lists, setLists] = useState<PriceListHeader[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filterCustomers, setFilterCustomers] = useState<string[]>([]);
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [comparing, setComparing] = useState<{ idA: string; idB: string } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const can = useCan();
  const canDelete = (pl: PriceListHeader) => can.changeCustomer(access(pl));

  useEffect(() => {
    async function load() {
      const [l, c] = await Promise.all([api.getPriceLists(), api.getCustomers()]);
      setLists(l as PriceListHeader[]);
      setCustomers(c as Customer[]);
    }
    load();
  }, []);

  const searched = lists.filter(pl => filterCustomers.length === 0 || filterCustomers.includes(pl.customer_ref_sap));

  const filtered = showLatestOnly ? (() => {
    const latestByCustomer = new Map<string, PriceListHeader>();
    for (const pl of searched) {
      const existing = latestByCustomer.get(pl.customer_ref_sap);
      if (!existing) {
        latestByCustomer.set(pl.customer_ref_sap, pl);
      } else {
        const plDate = pl.effective ? new Date(pl.effective).getTime() : -Infinity;
        const existingDate = existing.effective ? new Date(existing.effective).getTime() : -Infinity;
        if (plDate > existingDate) latestByCustomer.set(pl.customer_ref_sap, pl);
      }
    }
    return [...latestByCustomer.values()];
  })() : searched;

  // Keep the select-all checkbox indeterminate state in sync
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < filtered.length;
    }
  }, [selected.size, filtered.length]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(pl => pl.price_list_id)));
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deletePriceList(id);
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
      return;
    }
    setLists(prev => prev.filter(p => p.price_list_id !== id));
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
    toast('Price list deleted', 'info');
  }

  async function handleExport(id: string) {
    const result = await api.exportXlsx(id);
    if (result.saved) toast('Exported successfully', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  async function handleBulkExport() {
    setBulkWorking(true);
    const result = await api.exportXlsxBulk([...selected]);
    setBulkWorking(false);
    if ((result as any).canceled) return;
    const r = (result as any).results as { id: string; filename?: string; error?: string }[];
    const ok = r.filter(x => !x.error).length;
    const fail = r.filter(x => x.error).length;
    if (fail === 0) {
      toast(`Exported ${ok} file${ok !== 1 ? 's' : ''} to ${(result as any).folder}`, 'success');
    } else {
      toast(`${ok} exported, ${fail} failed`, 'error');
    }
  }

  function handleCompare() {
    const [idA, idB] = [...selected];
    setComparing({ idA, idB });
  }

  useEffect(() => {
    if (comparing) {
      comparisonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [comparing]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Lists</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {showLatestOnly ? `${filtered.length} customers` : `${filtered.length} of ${lists.length} price lists`}
          </p>
        </div>
        {can.isEditor && (
          <Button onClick={() => navigate('/price-lists/new')} className="gap-2">
            <Plus size={15} />
            New Price List
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <SearchableSelect
          multiple
          values={filterCustomers}
          onChange={v => { setFilterCustomers(v); setSelected(new Set()); }}
          options={customers.map(c => ({ value: c.customer_ref_sap, label: c.customer_short_name, sublabel: c.customer_ref_sap }))}
          placeholder="All customers"
          pluralLabel="customers"
          searchPlaceholder="Search customer name or SAP code…"
          className="w-96"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={selected.size !== 2}
            onClick={handleCompare}
            className="gap-1.5 whitespace-nowrap"
          >
            <ArrowLeftRight size={13} />
            {selected.size === 2 ? 'Compare selected' : 'Select 2 to compare'}
          </Button>
          <button
            onClick={() => { setShowLatestOnly(v => !v); setSelected(new Set()); }}
            className={`text-sm px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
              showLatestOnly
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {showLatestOnly ? 'Latest only' : 'View all'}
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">
            {selected.size} selected
          </span>
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              onClick={handleBulkExport}
              disabled={bulkWorking}
              className="gap-1.5"
            >
              <FileDown size={13} />
              {bulkWorking ? 'Working…' : `Export (${selected.size})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setComposeOpen(true)}
              disabled={bulkWorking}
              className="gap-1.5"
            >
              <Mail size={13} />
              {bulkWorking ? 'Working…' : `Email (${selected.size})`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              className="text-gray-500"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="rounded border-gray-300 cursor-pointer"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  disabled={filtered.length === 0}
                />
              </th>
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
                <td colSpan={7} className="text-center py-10 text-gray-400">
                  No price lists found
                </td>
              </tr>
            ) : (
              filtered.map(pl => (
                <tr
                  key={pl.price_list_id}
                  className={`hover:bg-gray-50 transition-colors ${selected.has(pl.price_list_id) ? 'bg-blue-50/40' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 cursor-pointer"
                      checked={selected.has(pl.price_list_id)}
                      onChange={() => toggleSelect(pl.price_list_id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {pl.customer_short_name ?? pl.customer_ref_sap}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(pl.effective)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(pl.mailing_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{pl.price_list_version}</td>
                  <td className="px-4 py-3">
                    <Badge variant={pl.price_type === 'Discount' ? 'default' : 'secondary'}>
                      {priceTypeLabel(pl.price_type, pl.discount_percent)}
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
                      {canDelete(pl) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(pl.price_list_id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </Button>
                      ) : (
                        <span className="w-[58px] flex items-center justify-center">
                          <LockBadge compact reason={can.lockReason(access(pl)) ?? ''} />
                        </span>
                      )}
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

      {comparing && (
        <div ref={comparisonRef} className="mt-6">
          <ComparisonPanel
            initialIdA={comparing.idA}
            initialIdB={comparing.idB}
            onClose={() => setComparing(null)}
          />
        </div>
      )}

      <EmailComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        priceListIds={[...selected]}
      />
    </div>
  );
}
