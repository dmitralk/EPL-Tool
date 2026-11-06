import { useEffect, useState } from 'react';
import { api } from '../../lib/ipc';
import { useCan } from '../../lib/auth';
import { ipcErrorMessage } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input, Label } from '../../components/ui/input';
import { ManagersPicker } from './ManagersPicker';
import { PRICING_MODE_LABELS, PRICING_MODES } from '../../../shared/permissions';
import type { Currency, Customer, NewCustomerInput, PackagingVersion, PricingMode } from '../../../types';

const SELECT = 'w-full h-9 text-sm border border-gray-300 rounded-md px-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

type Form = Record<'customer_ref_sap' | 'customer_short_name' | 'customer_full_name' | 'currency' | 'packaging_version' |
  'main_supply_region' | 'customer_type' | 'customer_ref_type_sap' | 'country' | 'zone' | 'comment_on_business_model' |
  'customer_spoc' | 'email_to_customer' | 'email_internal_copy', string>;

const EMPTY: Form = {
  customer_ref_sap: '', customer_short_name: '', customer_full_name: '', currency: '', packaging_version: '',
  main_supply_region: '', customer_type: '', customer_ref_type_sap: '', country: '', zone: '',
  comment_on_business_model: '', customer_spoc: '', email_to_customer: '', email_internal_copy: '',
};

// Admins and Users. A User's new customer is managed by them; an admin chooses the mode (default: Managed by PBP).
export function NewCustomerDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Customer) => void;
}) {
  const can = useCan();
  const [form, setForm] = useState<Form>(EMPTY);
  const [mode, setMode] = useState<PricingMode>('pbp');
  const [managers, setManagers] = useState<number[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [packaging, setPackaging] = useState<PackagingVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setMode('pbp');
    setManagers([]);
    setError(null);
    Promise.all([api.getCurrencies(), api.listPackagingVersions()]).then(([c, p]) => {
      setCurrencies(c as Currency[]);
      setPackaging(p as PackagingVersion[]);
    });
  }, [open]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    setError(null);
    for (const [k, label] of [['customer_ref_sap', 'Customer Ref SAP'], ['customer_short_name', 'Short name'],
      ['customer_full_name', 'Full name'], ['currency', 'Currency'], ['packaging_version', 'Packaging']] as [keyof Form, string][]) {
      if (!form[k].trim()) { setError(`${label} is required.`); return; }
    }
    if (can.isAdmin && mode === 'managed' && managers.length === 0) { setError('Choose at least one manager.'); return; }
    const data: NewCustomerInput = { customer_ref_sap: form.customer_ref_sap.trim() };
    for (const [k, v] of Object.entries(form) as [keyof Form, string][]) {
      if (k !== 'customer_ref_sap') (data as Record<string, unknown>)[k] = v.trim() ? v : null;
    }
    if (can.isAdmin) {
      data.pricing_mode = mode;
      data.manager_ids = mode === 'managed' ? managers : [];
    }
    setSaving(true);
    try {
      onCreated(await api.createCustomer(data) as Customer);
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const field = (k: keyof Form, label: string, required = false, placeholder = '') => (
    <div>
      <Label>{label}{required && <span className="text-red-500"> *</span>}</Label>
      <Input value={form[k]} onChange={set(k)} placeholder={placeholder} />
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} title="New Customer" className="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        {field('customer_ref_sap', 'Customer Ref SAP', true, 'unique SAP code')}
        {field('customer_short_name', 'Short name', true)}
        <div className="col-span-2">{field('customer_full_name', 'Full name', true)}</div>
        <div>
          <Label>Currency <span className="text-red-500">*</span></Label>
          <select className={SELECT} value={form.currency} onChange={set('currency')}>
            <option value="">—</option>
            {currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </div>
        <div>
          <Label>Packaging <span className="text-red-500">*</span></Label>
          <select className={SELECT} value={form.packaging_version} onChange={set('packaging_version')}>
            <option value="">—</option>
            {packaging.map(p => <option key={p.version} value={p.version}>{p.version}</option>)}
          </select>
        </div>
        <div>
          <Label>Main supply region</Label>
          <select className={SELECT} value={form.main_supply_region} onChange={set('main_supply_region')}>
            <option value="">—</option>
            <option value="ASIA">ASIA</option>
            <option value="EUROPE">EUROPE</option>
            <option value="AMERICA">AMERICA</option>
          </select>
        </div>
        {field('country', 'Country')}
        {field('zone', 'Zone')}
        {field('customer_type', 'Customer type')}
        {field('customer_ref_type_sap', 'Customer type ref SAP')}
        {field('customer_spoc', 'SPOC')}
        <div className="col-span-2">{field('comment_on_business_model', 'Business model')}</div>
        {field('email_to_customer', 'Email to customer', false, 'a@x.com;b@y.com')}
        {field('email_internal_copy', 'Internal copy', false, 'a@x.com;b@y.com')}
      </div>

      <div className="mt-4 p-3 rounded-md bg-gray-50 border border-gray-200 text-sm">
        <div className="font-medium text-gray-800 mb-2">Pricing management</div>
        {can.isAdmin ? (
          <div className="space-y-2">
            <select className={SELECT} value={mode} onChange={e => setMode(e.target.value as PricingMode)}>
              {PRICING_MODES.map(m => <option key={m} value={m}>{PRICING_MODE_LABELS[m]}</option>)}
            </select>
            {mode === 'managed' && <ManagersPicker values={managers} onChange={setManagers} />}
          </div>
        ) : (
          <p className="text-gray-600">You will manage this customer (<i>Managed by you</i>). You can add co-managers on the customer page.</p>
        )}
        <p className="text-xs text-gray-400 mt-2">PBP copy / PBP common addresses are filled from Settings → PBP Emails.</p>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create customer'}</Button>
      </div>
    </Dialog>
  );
}
