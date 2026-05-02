import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, GitCompareArrows, Pencil, Lock } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { useToast } from '../../components/ui/toast';
import { formatDate } from '../../lib/utils';
import { ComparisonPanel } from './ComparisonPanel';
import type { AdminEmail, Customer, PriceListHeader } from '../../../types';

export function CustomerDetail() {
  const { ref } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [priceLists, setPriceLists] = useState<PriceListHeader[]>([]);
  const [adminEmails, setAdminEmails] = useState<AdminEmail[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState<{ idA: string; idB: string } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ref) return;
    const decoded = decodeURIComponent(ref);
    Promise.all([
      api.getCustomer(decoded),
      api.getPriceLists({ customer_ref_sap: decoded }),
      api.getAdminEmails(),
    ]).then(([c, lists, emails]) => {
      setCustomer(c as Customer);
      setPriceLists(lists as PriceListHeader[]);
      setAdminEmails(emails as AdminEmail[]);
    });
  }, [ref]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < priceLists.length;
    }
  }, [selected.size, priceLists.length]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 2) next.delete([...next][0]);
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(prev =>
      prev.size === priceLists.length
        ? new Set()
        : new Set(priceLists.slice(0, 2).map(p => p.price_list_id))
    );
  }

  function openComparison() {
    const [idA, idB] = [...selected];
    setComparing({ idA, idB });
  }

  function startEdit() {
    setDraft({ ...customer! });
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(null);
    setEditing(false);
  }

  async function saveEdit() {
    if (!customer || !draft) return;
    setSaving(true);
    try {
      const updated = await api.updateCustomer(customer.customer_ref_sap, draft);
      setCustomer(updated as Customer);
      setEditing(false);
      setDraft(null);
      toast('Customer updated', 'success');
    } catch {
      toast('Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Customer>(key: K, value: Customer[K]) {
    setDraft(d => d ? { ...d, [key]: value } : d);
  }

  if (!customer) return <div className="p-6 text-center text-gray-400">Loading…</div>;

  const d = draft ?? customer;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/customers')} className="gap-1" disabled={editing}>
          <ArrowLeft size={15} /> Back
        </Button>
        <div className="flex-1">
          {editing ? (
            <input
              className="text-xl font-bold text-gray-900 border-b border-gray-300 focus:outline-none focus:border-blue-500 w-full bg-transparent"
              value={d.customer_full_name}
              onChange={e => set('customer_full_name', e.target.value)}
            />
          ) : (
            <h1 className="text-xl font-bold text-gray-900">{customer.customer_full_name}</h1>
          )}
          <p className="text-gray-500 text-sm">{customer.customer_ref_sap}</p>
        </div>
        {editing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={cancelEdit} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {selected.size === 2 && (
              <Button variant="outline" onClick={openComparison} className="gap-2">
                <GitCompareArrows size={15} /> Compare Selected
              </Button>
            )}
            <Button variant="outline" onClick={startEdit} className="gap-2">
              <Pencil size={14} /> Edit
            </Button>
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2.5">
              <ERow label="Customer Ref SAP" value={customer.customer_ref_sap} readOnly />
              <ERow label="Short Name" value={d.customer_short_name} editing={editing}
                onChange={v => set('customer_short_name', v)} />
              <ERow label="Customer Type" value={d.customer_type ?? ''} editing={editing}
                onChange={v => set('customer_type', v || null)} />
              <ERow label="Customer Type Ref SAP" value={d.customer_ref_type_sap ?? ''} editing={editing}
                onChange={v => set('customer_ref_type_sap', v || null)} />
              <ERow label="Business Model" value={d.comment_on_business_model ?? ''} editing={editing}
                onChange={v => set('comment_on_business_model', v || null)} />
              <div className="flex justify-between items-center gap-4">
                <dt className="text-gray-500 shrink-0 text-sm">Currency</dt>
                {editing ? (
                  <dd>
                    <select
                      value={d.currency}
                      onChange={e => set('currency', e.target.value as 'USD' | 'EUR')}
                      className="text-sm font-medium border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </dd>
                ) : (
                  <dd>
                    <Badge variant={customer.currency === 'USD' ? 'default' : 'secondary'}>{customer.currency}</Badge>
                  </dd>
                )}
              </div>
              <ERow label="Country" value={d.country ?? ''} editing={editing}
                onChange={v => set('country', v || null)} />
              <ERow label="Zone" value={d.zone ?? ''} editing={editing}
                onChange={v => set('zone', v || null)} />
              <ERow label="Packaging" value={d.packaging_version} editing={editing}
                onChange={v => set('packaging_version', v)} />
              <ERow label="SPOC" value={d.customer_spoc ?? ''} editing={editing}
                onChange={v => set('customer_spoc', v || null)} />
              <ERow label="Managed by" value={d.price_list_managed_by ?? ''} editing={editing}
                onChange={v => set('price_list_managed_by', v || null)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2.5">
              <ERow label="To customer" value={d.email_to_customer ?? ''} editing={editing}
                onChange={v => set('email_to_customer', v || null)} />
              <ERow label="Internal copy" value={d.email_internal_copy ?? ''} editing={editing}
                onChange={v => set('email_internal_copy', v || null)} />
              <AdminEmailRow
                label="PBP copy"
                adminEmails={adminEmails}
                match="costing"
                fallback={customer.email_pbp_copy}
              />
              <AdminEmailRow
                label="PBP common"
                adminEmails={adminEmails}
                match="common"
                fallback={customer.email_pbp_common}
              />
            </dl>
            <p className="text-xs text-gray-400 mt-4 flex items-center gap-1">
              <Lock size={10} /> PBP emails are shared across all customers and managed in Settings → Admin Email Addresses.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Price Lists */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Price Lists ({priceLists.length})</CardTitle>
            {selected.size > 0 && (
              <span className="text-sm text-blue-600 font-medium">
                {selected.size} selected{selected.size < 2 ? ' — select one more to compare' : ''}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="rounded border-gray-300 cursor-pointer"
                    checked={priceLists.length > 0 && selected.size === priceLists.length}
                    onChange={toggleSelectAll}
                    title="Select top 2"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Effective</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Mailing Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Version</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {priceLists.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">No price lists yet</td>
                </tr>
              ) : (
                priceLists.map(pl => (
                  <tr
                    key={pl.price_list_id}
                    className={`hover:bg-gray-50 transition-colors ${selected.has(pl.price_list_id) ? 'bg-blue-50/50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 cursor-pointer"
                        checked={selected.has(pl.price_list_id)}
                        onChange={() => toggleSelect(pl.price_list_id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(pl.effective)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(pl.mailing_date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{pl.price_list_version}</td>
                    <td className="px-4 py-3">
                      <Badge variant={pl.price_type === 'Discount' ? 'default' : 'secondary'}>
                        {pl.price_type === 'Discount' ? `${pl.discount_percent}% disc.` : 'Net Price'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/price-lists/${pl.price_list_id}`)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {comparing && (
        <ComparisonPanel
          initialIdA={comparing.idA}
          initialIdB={comparing.idB}
          onClose={() => setComparing(null)}
        />
      )}
    </div>
  );
}

function AdminEmailRow({ label, adminEmails, match, fallback }: {
  label: string;
  adminEmails: AdminEmail[];
  match: string;
  fallback: string | null | undefined;
}) {
  const entry = adminEmails.find(e => e.email_name.toLowerCase().includes(match));
  const email = entry?.email ?? fallback ?? '—';
  const source = entry?.email_name ?? null;
  return (
    <div className="flex justify-between items-start gap-4">
      <dt className="text-gray-500 shrink-0 text-sm flex items-center gap-1">
        <Lock size={10} className="text-gray-300" />
        {label}
      </dt>
      <dd className="text-right">
        <span className="text-gray-900 font-medium text-sm">{email}</span>
        {source && (
          <div className="text-xs text-gray-400 mt-0.5">{source}</div>
        )}
      </dd>
    </div>
  );
}

function ERow({
  label, value, editing = false, onChange, readOnly = false,
}: {
  label: string;
  value: string;
  editing?: boolean;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-4">
      <dt className="text-gray-500 shrink-0 text-sm">{label}</dt>
      {editing && !readOnly ? (
        <dd>
          <input
            type="text"
            value={value}
            onChange={e => onChange?.(e.target.value)}
            className="text-sm font-medium text-gray-900 border border-gray-300 rounded px-2 py-0.5 w-52 text-right focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </dd>
      ) : (
        <dd className="text-gray-900 font-medium text-sm text-right truncate max-w-[13rem]">
          {value || '—'}
        </dd>
      )}
    </div>
  );
}
