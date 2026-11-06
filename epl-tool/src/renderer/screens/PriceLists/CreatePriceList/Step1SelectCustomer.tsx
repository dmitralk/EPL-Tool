import { useEffect, useState } from 'react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Input, Label } from '../../../components/ui/input';
import { SearchableSelect } from '../../../components/ui/searchable-select';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { todayISO, nextVersion, formatDate } from '../../../lib/utils';
import { useWizard } from './index';
import { useCan } from '../../../lib/auth';
import type { Customer, PriceListFull, PriceListHeader } from '../../../../types';

export function Step1SelectCustomer() {
  const { state, dispatch } = useWizard();
  const can = useCan();
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingPrev, setLoadingPrev] = useState(false);

  useEffect(() => {
    api.getCustomers().then(c => setAllCustomers(c as Customer[]));
  }, []);

  // Only the customers this user may price (Open, managed by them, or all for admins).
  const customers = allCustomers.filter(c => can.changeCustomer(c));
  const hiddenCount = allCustomers.length - customers.length;

  const selectedCustomer = state.customer;

  async function handleCustomerChange(ref: string) {
    const c = customers.find(c => c.customer_ref_sap === ref) ?? null;
    if (!c) return;
    dispatch({ type: 'SET_CUSTOMER', customer: c });
    const nextVer = nextVersion(c.last_price_list_version);
    dispatch({ type: 'SET_FIELD', field: 'price_list_version', value: nextVer });

    // Fetch the latest price list for this customer to pre-populate products
    setLoadingPrev(true);
    try {
      const lists = await api.getPriceLists({ customer_ref_sap: ref }) as { price_list_id: string }[];
      if (lists.length === 0) {
        dispatch({ type: 'SET_PREVIOUS_ENTRIES', entries: null });
      } else {
        const latest = await api.getPriceList(lists[0].price_list_id) as PriceListFull;
        dispatch({
          type: 'SET_PREVIOUS_ENTRIES',
          entries: latest.entries.map(e => ({
            product_type: e.product_type,
            rip_code: e.rip_code,
            product_name: e.product_name,
            net_price: e.net_price,
            currency: e.currency,
            unit: e.unit,
          })),
        });
      }
    } finally {
      setLoadingPrev(false);
    }
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!state.customer) e.customer = 'Select a customer';
    if (!state.effective) e.effective = 'Required';
    if (!state.mailing_date) e.mailing_date = 'Required';
    if (!state.price_list_version) e.version = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleNext() {
    if (!validate()) return;
    const existing = await api.getPriceLists({ customer_ref_sap: state.customer!.customer_ref_sap }) as PriceListHeader[];
    const version = state.price_list_version.trim().toUpperCase();
    const clash = existing.find(pl => pl.effective === state.effective && (pl.price_list_version ?? '').trim().toUpperCase() === version);
    if (clash) {
      setErrors({
        duplicate: `A price list with application date ${formatDate(state.effective)} and version ${clash.price_list_version} already exists for this customer. ` +
          'Please choose another date or version, or delete the existing price list.',
      });
      return;
    }
    dispatch({ type: 'SET_STEP', step: 2 });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Step 1 — Select Customer & Dates</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Label>Customer *</Label>
            <SearchableSelect
              values={state.customer ? [state.customer.customer_ref_sap] : []}
              onChange={v => { if (v[0]) handleCustomerChange(v[0]); }}
              options={customers.map(c => ({
                value: c.customer_ref_sap,
                label: c.customer_short_name,
                sublabel: `${c.customer_ref_sap} · ${c.currency}`,
                keywords: c.customer_full_name,
              }))}
              placeholder="Select customer…"
              searchPlaceholder="Search customer name or SAP code…"
            />
            {hiddenCount > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                {hiddenCount} customer{hiddenCount === 1 ? ' is' : 's are'} not listed: you can only price customers that are Open or that you manage.
              </p>
            )}
            {errors.customer && <p className="text-red-500 text-xs mt-1">{errors.customer}</p>}
          </div>

          {selectedCustomer && (
            <div className="p-3 bg-blue-50 rounded-md text-sm text-blue-800">
              <strong>{selectedCustomer.customer_full_name}</strong> · {selectedCustomer.country} · {selectedCustomer.currency} · Packaging: {selectedCustomer.packaging_version}
            </div>
          )}

          {loadingPrev && (
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <span className="animate-spin">⟳</span> Checking previous price lists…
            </div>
          )}
          {!loadingPrev && state.previousEntries !== undefined && (
            <div className={`p-3 rounded-md text-sm ${state.previousEntries === null ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
              {state.previousEntries === null
                ? 'No previous price list found — you will add products manually in Step 3.'
                : `${state.previousEntries.length} product(s) from the latest price list will be pre-loaded.`}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Effective Date *</Label>
              <Input
                type="date"
                value={state.effective}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'effective', value: e.target.value })}
              />
              {errors.effective && <p className="text-red-500 text-xs mt-1">{errors.effective}</p>}
            </div>
            <div>
              <Label>Mailing Date *</Label>
              <Input
                type="date"
                value={state.mailing_date}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'mailing_date', value: e.target.value })}
              />
              {errors.mailing_date && <p className="text-red-500 text-xs mt-1">{errors.mailing_date}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Price List Version *</Label>
              <Input
                value={state.price_list_version}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'price_list_version', value: e.target.value })}
                placeholder="e.g. V1"
              />
              {errors.version && <p className="text-red-500 text-xs mt-1">{errors.version}</p>}
            </div>
            <div>
              <Label>SAP Plant</Label>
              <Input
                value={state.sap_plant}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'sap_plant', value: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <Label>Comments about Changes</Label>
            <Input
              value={state.comments_about_changes}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'comments_about_changes', value: e.target.value })}
              placeholder="Optional"
            />
          </div>

          {errors.duplicate && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {errors.duplicate}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleNext}>Next →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
