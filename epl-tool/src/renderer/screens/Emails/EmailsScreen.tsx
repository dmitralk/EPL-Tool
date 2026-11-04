import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Pencil, ArrowRightLeft, Trash2, Lock, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Dialog, ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import type { AdminEmail, Customer, EmailAssignmentChange, EmailUsage } from '../../../types';

type RoleFilter = 'all' | 'to' | 'internal' | 'admin';
type Assign = { to: boolean; internal: boolean };

const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
const CHIP_LIMIT = 8;
const NONE: Assign = { to: false, internal: false };
const norm = (e: string) => e.trim().toLowerCase();

function chipClass(to: boolean, internal: boolean): string {
  if (to && internal) return 'bg-purple-50 text-purple-700 border-purple-200';
  if (to) return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

export function EmailsScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [usages, setUsages] = useState<EmailUsage[]>([]);
  const [adminEmails, setAdminEmails] = useState<AdminEmail[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [assignTarget, setAssignTarget] = useState<{ email: string; isNew: boolean } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<EmailUsage | null>(null);
  const [removeTarget, setRemoveTarget] = useState<EmailUsage | null>(null);

  async function reload() {
    const list = await api.listEmails();
    setUsages(list as EmailUsage[]);
  }

  useEffect(() => {
    Promise.all([api.listEmails(), api.getAdminEmails(), api.getCustomers()])
      .then(([list, admins, custs]) => {
        setUsages(list as EmailUsage[]);
        setAdminEmails(admins as AdminEmail[]);
        setCustomers(custs as Customer[]);
      })
      .finally(() => setLoading(false));
  }, []);

  const s = search.trim().toLowerCase();

  const visibleUsages = useMemo(() => {
    if (role === 'admin') return [];
    return usages.filter(u => {
      if (role === 'to' && !u.customers.some(c => c.to)) return false;
      if (role === 'internal' && !u.customers.some(c => c.internal)) return false;
      if (!s) return true;
      return u.email.toLowerCase().includes(s) || u.customers.some(c => c.customer_short_name.toLowerCase().includes(s));
    });
  }, [usages, role, s]);

  const visibleAdmins = useMemo(() => {
    if (role !== 'all' && role !== 'admin') return [];
    return adminEmails.filter(a => !s || a.email.toLowerCase().includes(s) || a.email_name.toLowerCase().includes(s));
  }, [adminEmails, role, s]);

  function toggleExpanded(email: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  async function handleRemove(u: EmailUsage) {
    const res = await api.removeEmail(u.email) as { ok: boolean; updated?: number; error?: string };
    if (res.ok) toast(`Removed from ${res.updated} customer${res.updated === 1 ? '' : 's'}`, 'success');
    else toast(res.error ?? 'Remove failed', 'error');
    await reload();
  }

  const assignUsage = assignTarget ? usages.find(u => norm(u.email) === norm(assignTarget.email)) : undefined;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Addresses</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {loading ? 'Loading…' : `${usages.length} customer/internal address${usages.length === 1 ? '' : 'es'} · ${adminEmails.length} PBP admin`}
          </p>
        </div>
        <Button size="sm" onClick={() => setAssignTarget({ email: '', isNew: true })}>
          <Plus size={14} className="mr-1.5" />
          Add Email
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
          {([['all', 'All'], ['to', 'Customer'], ['internal', 'Internal'], ['admin', 'PBP admin']] as [RoleFilter, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRole(k)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${role === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search email or customer…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 ml-auto">
          <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded border ${chipClass(true, false)}`} />To customer</span>
          <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded border ${chipClass(false, true)}`} />Internal copy</span>
          <span className="flex items-center gap-1"><span className={`w-3 h-3 rounded border ${chipClass(true, true)}`} />Both</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Customers</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : visibleAdmins.length === 0 && visibleUsages.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">No email addresses found</td></tr>
            ) : (
              <>
                {visibleAdmins.map(a => (
                  <tr key={`admin-${a.id}`} className="bg-gray-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{a.email}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="success">PBP admin</Badge>
                      <div className="text-[11px] text-gray-400 mt-0.5">{a.email_name}</div>
                    </td>
                    <td className="px-3 py-2.5"><Badge variant="outline">All customers</Badge></td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} title="PBP admin emails are managed in Settings">
                        <Lock size={12} className="mr-1" /> Settings
                      </Button>
                    </td>
                  </tr>
                ))}
                {visibleUsages.map(u => {
                  const isOpen = expanded.has(u.email);
                  const sorted = [...u.customers].sort((x, y) => Number(x.is_deleted) - Number(y.is_deleted));
                  const shown = isOpen ? sorted : sorted.slice(0, CHIP_LIMIT);
                  const hasTo = u.customers.some(c => c.to);
                  const hasInternal = u.customers.some(c => c.internal);
                  return (
                    <tr key={u.email} className="hover:bg-gray-50 transition-colors align-top">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {u.email}
                        {!EMAIL_RE.test(u.email) && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-amber-700" title="This does not look like a valid email address">
                            <TriangleAlert size={11} /> check format
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {hasTo && <Badge className="mr-1">Customer</Badge>}
                        {hasInternal && <Badge variant="secondary">Internal</Badge>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {shown.map(c => (
                            <button
                              key={c.customer_ref_sap}
                              onClick={() => navigate(`/customers/${encodeURIComponent(c.customer_ref_sap)}`)}
                              title={`${c.to && c.internal ? 'To customer + Internal copy' : c.to ? 'To customer' : 'Internal copy'}${c.is_deleted ? ' · hidden customer' : ''}`}
                              className={`px-2 py-0.5 rounded border text-xs hover:underline ${chipClass(c.to, c.internal)} ${c.is_deleted ? 'opacity-50 line-through' : ''}`}
                            >
                              {c.customer_short_name}
                            </button>
                          ))}
                          {sorted.length > CHIP_LIMIT && (
                            <button className="text-xs text-blue-600 hover:underline px-1" onClick={() => toggleExpanded(u.email)}>
                              {isOpen ? 'show less' : `+${sorted.length - CHIP_LIMIT} more`}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setAssignTarget({ email: u.email, isNew: false })} title="Add / remove customers">
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setReplaceTarget(u)} title="Replace with another address everywhere">
                          <ArrowRightLeft size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(u)} title="Remove from all customers" className="text-red-600 hover:bg-red-50">
                          <Trash2 size={13} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>

      {assignTarget && (
        <AssignDialog
          initialEmail={assignTarget.email}
          isNew={assignTarget.isNew}
          usage={assignTarget.isNew ? undefined : assignUsage}
          allUsages={usages}
          customers={customers}
          onClose={() => setAssignTarget(null)}
          onSaved={async () => { setAssignTarget(null); await reload(); }}
        />
      )}

      {replaceTarget && (
        <ReplaceDialog
          usage={replaceTarget}
          allUsages={usages}
          onClose={() => setReplaceTarget(null)}
          onSaved={async () => { setReplaceTarget(null); await reload(); }}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => { if (removeTarget) handleRemove(removeTarget); }}
        title="Remove Email"
        description={removeTarget
          ? `Remove ${removeTarget.email} from ${removeTarget.customers.length} customer${removeTarget.customers.length === 1 ? '' : 's'} (To customer and Internal copy, including hidden customers)?`
          : ''}
        confirmLabel="Remove"
      />
    </div>
  );
}

function AssignDialog({ initialEmail, isNew, usage, allUsages, customers, onClose, onSaved }: {
  initialEmail: string;
  isNew: boolean;
  usage: EmailUsage | undefined;
  allUsages: EmailUsage[];
  customers: Customer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState(initialEmail);
  const [search, setSearch] = useState('');
  const [assignedOnly, setAssignedOnly] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const initial = useMemo(() => {
    const m = new Map<string, Assign>();
    for (const c of usage?.customers ?? []) m.set(c.customer_ref_sap, { to: c.to, internal: c.internal });
    return m;
  }, [usage]);
  const [state, setState] = useState<Map<string, Assign>>(() => new Map(initial));

  const get = (m: Map<string, Assign>, ref: string) => m.get(ref) ?? NONE;
  const hiddenCount = usage?.customers.filter(c => c.is_deleted).length ?? 0;
  const existing = isNew && email.trim() ? allUsages.find(u => norm(u.email) === norm(email)) : undefined;

  const visible = customers.filter(c => {
    if (assignedOnly) {
      const a = get(state, c.customer_ref_sap);
      const b = get(initial, c.customer_ref_sap);
      if (!a.to && !a.internal && !b.to && !b.internal) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return c.customer_short_name.toLowerCase().includes(q) || c.customer_ref_sap.toLowerCase().includes(q) || (c.country ?? '').toLowerCase().includes(q);
  });

  const changes: EmailAssignmentChange[] = customers
    .filter(c => {
      const a = get(initial, c.customer_ref_sap);
      const b = get(state, c.customer_ref_sap);
      return a.to !== b.to || a.internal !== b.internal;
    })
    .map(c => ({ customer_ref_sap: c.customer_ref_sap, ...get(state, c.customer_ref_sap) }));

  function setField(ref: string, field: keyof Assign, value: boolean) {
    setState(prev => new Map(prev).set(ref, { ...get(prev, ref), [field]: value }));
  }

  function toggleAllVisible(field: keyof Assign) {
    const allOn = visible.length > 0 && visible.every(c => get(state, c.customer_ref_sap)[field]);
    setState(prev => {
      const next = new Map(prev);
      for (const c of visible) next.set(c.customer_ref_sap, { ...get(prev, c.customer_ref_sap), [field]: !allOn });
      return next;
    });
  }

  const emailValid = EMAIL_RE.test(email.trim());

  async function save() {
    setSaving(true);
    try {
      const res = await api.setEmailAssignments(email.trim(), changes) as { ok: boolean; updated?: number; error?: string };
      if (!res.ok) { toast(res.error ?? 'Save failed', 'error'); return; }
      toast(`Updated ${res.updated} customer${res.updated === 1 ? '' : 's'}`, 'success');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const allTo = visible.length > 0 && visible.every(c => get(state, c.customer_ref_sap).to);
  const allInternal = visible.length > 0 && visible.every(c => get(state, c.customer_ref_sap).internal);

  return (
    <Dialog open onClose={onClose} title={isNew ? 'Add Email to Customers' : 'Edit Customers for Email'} className="max-w-2xl">
      <div className="space-y-3">
        {isNew ? (
          <div>
            <label className="text-xs text-gray-500">Email address</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
            {email.trim() && !emailValid && <p className="text-xs text-red-600 mt-1">Enter a valid email address.</p>}
            {existing && <p className="text-xs text-amber-700 mt-1">This address is already used by {existing.customers.length} customer(s); checked customers will be added.</p>}
          </div>
        ) : (
          <p className="text-sm font-medium text-gray-900">{email}</p>
        )}

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input placeholder="Search customer, SAP ref or country…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 text-sm" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0 cursor-pointer">
            <input type="checkbox" checked={assignedOnly} onChange={e => setAssignedOnly(e.target.checked)} />
            Assigned only
          </label>
        </div>

        <div className="border border-gray-200 rounded-md max-h-[45vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Customer</th>
                <th className="px-3 py-2 font-medium text-gray-600 w-28">
                  <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={allTo} onChange={() => toggleAllVisible('to')} title="Toggle all shown" />
                    To customer
                  </label>
                </th>
                <th className="px-3 py-2 font-medium text-gray-600 w-28">
                  <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={allInternal} onChange={() => toggleAllVisible('internal')} title="Toggle all shown" />
                    Internal copy
                  </label>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-6 text-gray-400 text-xs">No customers</td></tr>
              ) : visible.map(c => {
                const a = get(state, c.customer_ref_sap);
                return (
                  <tr key={c.customer_ref_sap} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5">
                      <span className="text-gray-900">{c.customer_short_name}</span>
                      <span className="text-[11px] text-gray-400 ml-2">{c.customer_ref_sap}{c.country ? ` · ${c.country}` : ''}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={a.to} onChange={e => setField(c.customer_ref_sap, 'to', e.target.checked)} />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={a.internal} onChange={e => setField(c.customer_ref_sap, 'internal', e.target.checked)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && (
          <p className="text-xs text-gray-400">Also used by {hiddenCount} hidden customer{hiddenCount === 1 ? '' : 's'} (not shown, left unchanged).</p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <span className="text-xs text-gray-500 mr-auto self-center">{changes.length} customer{changes.length === 1 ? '' : 's'} changed</span>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !emailValid || changes.length === 0}>Save</Button>
      </div>
    </Dialog>
  );
}

function ReplaceDialog({ usage, allUsages, onClose, onSaved }: {
  usage: EmailUsage;
  allUsages: EmailUsage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(usage.email);
  const [saving, setSaving] = useState(false);

  const trimmed = value.trim();
  const valid = EMAIL_RE.test(trimmed);
  const unchanged = trimmed === usage.email;
  const mergeWith = norm(trimmed) !== norm(usage.email) ? allUsages.find(u => norm(u.email) === norm(trimmed)) : undefined;

  async function save() {
    setSaving(true);
    try {
      const res = await api.replaceEmail(usage.email, trimmed) as { ok: boolean; updated?: number; error?: string };
      if (!res.ok) { toast(res.error ?? 'Replace failed', 'error'); return; }
      toast(`Replaced in ${res.updated} customer${res.updated === 1 ? '' : 's'}`, 'success');
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Replace Email">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Replaces <strong>{usage.email}</strong> with a new address in all {usage.customers.length} customer{usage.customers.length === 1 ? '' : 's'} using it
          (To customer and Internal copy, including hidden customers).
        </p>
        <div>
          <label className="text-xs text-gray-500">New email address</label>
          <Input value={value} onChange={e => setValue(e.target.value)} autoFocus />
          {trimmed && !valid && <p className="text-xs text-red-600 mt-1">Enter a valid email address.</p>}
          {mergeWith && <p className="text-xs text-amber-700 mt-1">This address already exists on {mergeWith.customers.length} customer(s); the two will be merged without duplicates.</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !valid || unchanged}>Replace</Button>
      </div>
    </Dialog>
  );
}
