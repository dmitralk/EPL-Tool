import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { formatDate, nextVersion } from '../../../lib/utils';
import { useMassWizard, type MassSelectedRow } from './index';
import type { Customer, PriceListHeader, PriceListFull } from '../../../../types';

const REGIONS = ['ASIA', 'EUROPE', 'AMERICA'] as const;

export function Step1SelectCustomers() {
  const navigate = useNavigate();
  const { state, dispatch } = useMassWizard();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allLists, setAllLists] = useState<PriceListHeader[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(state.selectedRows.map(r => r.customer.customer_ref_sap))
  );
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api.getCustomers(), api.getPriceLists()])
      .then(([c, l]) => {
        setCustomers(c as Customer[]);
        setAllLists(l as PriceListHeader[]);
        setLoading(false);
      });
  }, []);

  // Latest price list per customer (by effective date desc)
  const latestByCustomer = useMemo(() => {
    const map = new Map<string, PriceListHeader>();
    for (const pl of allLists) {
      const existing = map.get(pl.customer_ref_sap);
      if (!existing) {
        map.set(pl.customer_ref_sap, pl);
      } else {
        const plDate = pl.effective ? new Date(pl.effective).getTime() : -Infinity;
        const exDate = existing.effective ? new Date(existing.effective).getTime() : -Infinity;
        if (plDate > exDate) map.set(pl.customer_ref_sap, pl);
      }
    }
    return map;
  }, [allLists]);

  const visibleCustomers = useMemo(
    () => customers.filter(c => c.currency === state.currency),
    [customers, state.currency]
  );

  const filteredCustomers = useMemo(() => {
    return visibleCustomers.filter(c => {
      if (search && !c.customer_short_name.toLowerCase().includes(search.toLowerCase())) return false;
      if (regionFilter && c.main_supply_region !== regionFilter) return false;
      if (effectiveFrom || effectiveTo) {
        const latest = latestByCustomer.get(c.customer_ref_sap);
        if (latest?.effective) {
          if (effectiveFrom && latest.effective < effectiveFrom) return false;
          if (effectiveTo && latest.effective > effectiveTo) return false;
        }
      }
      return true;
    });
  }, [visibleCustomers, search, regionFilter, effectiveFrom, effectiveTo, latestByCustomer]);

  const selectableRefs = useMemo(
    () => new Set(filteredCustomers.filter(c => latestByCustomer.has(c.customer_ref_sap)).map(c => c.customer_ref_sap)),
    [filteredCustomers, latestByCustomer]
  );

  const selectedInView = [...selected].filter(r => selectableRefs.has(r));
  const allSelected = selectableRefs.size > 0 && selectedInView.length === selectableRefs.size;

  const hasFilters = search || regionFilter || effectiveFrom || effectiveTo;

  function clearFilters() {
    setSearch('');
    setRegionFilter('');
    setEffectiveFrom('');
    setEffectiveTo('');
  }

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedInView.length > 0 && selectedInView.length < selectableRefs.size;
    }
  }, [selectedInView.length, selectableRefs.size]);

  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); selectableRefs.forEach(r => next.delete(r)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); selectableRefs.forEach(r => next.add(r)); return next; });
    }
  }

  function toggleOne(ref: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref); else next.add(ref);
      return next;
    });
  }

  function handleCurrencySwitch(c: 'USD' | 'EUR') {
    dispatch({ type: 'SET_CURRENCY', currency: c });
    setSelected(new Set());
    clearFilters();
  }

  async function handleNext() {
    const toLoad = visibleCustomers.filter(
      c => selected.has(c.customer_ref_sap) && latestByCustomer.has(c.customer_ref_sap)
    );
    setAdvancing(true);
    try {
      const rows: MassSelectedRow[] = await Promise.all(
        toLoad.map(async customer => {
          const header = latestByCustomer.get(customer.customer_ref_sap)!;
          const full = await api.getPriceList(header.price_list_id) as PriceListFull;
          return {
            customer,
            latestHeader: header,
            entries: full.entries.map(e => ({
              product_type: e.product_type,
              rip_code: e.rip_code,
              product_name: e.product_name,
              net_price: e.net_price,
              currency: e.currency,
              unit: e.unit,
            })),
            newVersion: nextVersion(header.price_list_version),
          };
        })
      );
      dispatch({ type: 'SET_SELECTED_ROWS', rows });
      dispatch({ type: 'SET_STEP', step: 2 });
    } finally {
      setAdvancing(false);
    }
  }

  const totalProducts = useMemo(
    () => state.selectedRows.reduce((sum, r) => sum + r.entries.length, 0),
    [state.selectedRows]
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-gray-400">Loading customers…</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Step 1 — Select Customers</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Select the customers whose latest price lists you want to reprice
            </p>
          </div>
          {/* Currency toggle */}
          <div className="flex rounded-md border border-gray-300 overflow-hidden shrink-0 mt-1">
            {(['USD', 'EUR'] as const).map(c => (
              <button
                key={c}
                onClick={() => handleCurrencySwitch(c)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  state.currency === c
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
            />
          </div>
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700"
          >
            <option value="">All regions</option>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 shrink-0">Effective</span>
            <input
              type="date"
              value={effectiveFrom}
              onChange={e => setEffectiveFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700"
            />
            <span className="text-xs text-gray-400">–</span>
            <input
              type="date"
              value={effectiveTo}
              onChange={e => setEffectiveTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700"
            />
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-600 hover:text-blue-800 px-1"
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 cursor-pointer"
                    disabled={selectableRefs.size === 0}
                  />
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">SAP Ref</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Supply Region</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Latest Effective</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Version</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">New Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400">
                    {hasFilters ? 'No customers match the current filters' : `No ${state.currency} customers found`}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map(customer => {
                  const latest = latestByCustomer.get(customer.customer_ref_sap);
                  const selectable = !!latest;
                  const isSelected = selected.has(customer.customer_ref_sap);
                  return (
                    <tr
                      key={customer.customer_ref_sap}
                      onClick={() => selectable && toggleOne(customer.customer_ref_sap)}
                      className={`transition-colors ${
                        !selectable
                          ? 'opacity-40'
                          : isSelected
                          ? 'bg-blue-50/50 cursor-pointer'
                          : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          disabled={!selectable}
                          className="rounded border-gray-300 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {customer.customer_short_name}
                        {!selectable && (
                          <span className="ml-2 text-xs text-gray-400 font-normal">No price list on record</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{customer.customer_ref_sap}</td>
                      <td className="px-4 py-2.5 text-gray-600">{customer.main_supply_region ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{latest ? formatDate(latest.effective) : '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{latest?.price_list_version ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">
                        {latest ? nextVersion(latest.price_list_version) : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {selectedInView.length > 0 && (
          <p className="text-sm text-blue-700 mb-4">
            {selectedInView.length} customer{selectedInView.length !== 1 ? 's' : ''} selected
            {totalProducts > 0 && ` · ${totalProducts} products loaded`}
          </p>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => navigate('/price-lists/new')}>
            ← Back
          </Button>
          <Button onClick={handleNext} disabled={selectedInView.length === 0 || advancing}>
            {advancing ? 'Loading price lists…' : `Next — Configure Change →`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
