import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, FolderOpen, Info, Plus, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useAuth, useCan } from '../../lib/auth';
import { ipcErrorMessage, cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent } from '../../components/ui/card';
import { ConfirmDialog, Dialog } from '../../components/ui/dialog';
import { Input, Label } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { LockBadge } from '../../components/LockBadge';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../../shared/permissions';
import type { AppUser, AuthState, Customer, Role, UserInput } from '../../../types';

type UserRow = AppUser & { managed_count: number };

const SHAREPOINT_ACCESS: Record<Role, string> = { admin: 'Edit', user: 'Edit', viewer: 'Read' };

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.split(/[._]+/).filter(Boolean)
    .map(part => part.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-')).join(' ');
}

// Customers whose managers are all deactivated or viewers: they behave as Managed by PBP until an admin reassigns them.
function orphaned(customers: Customer[], users: UserRow[]): Customer[] {
  const active = new Set(users.filter(u => u.is_active && u.role !== 'viewer').map(u => u.id));
  return customers.filter(c => c.pricing_mode === 'managed' && !c.manager_ids.some(id => active.has(id)));
}

export function UsersScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const can = useCan();
  const { state, setState } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<(UserInput & { id: number | null }) | null>(null);
  const [deactivate, setDeactivate] = useState<UserRow | null>(null);
  const [reminder, setReminder] = useState<{ name: string; role: Role } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [u, active, hidden] = await Promise.all([api.listUsers(), api.getCustomers(), api.getDeletedCustomers()]);
    setUsers(u as UserRow[]);
    setCustomers([...(active as Customer[]), ...(hidden as Customer[])]);
  }
  useEffect(() => { load(); }, []);

  const orphans = useMemo(() => orphaned(customers, users), [customers, users]);
  const realId = state?.realUser?.id;

  // Admins see the list and can Preview as… on a read-only copy too; adding and editing needs edit mode.
  if (!can.isAdmin) {
    return <div className="p-6 text-sm text-gray-500">Only admins can manage users.</div>;
  }

  async function save() {
    if (!editing) return;
    setError(null);
    const { id, ...data } = editing;
    try {
      const before = id === null ? null : users.find(u => u.id === id) ?? null;
      const saved = id === null
        ? await api.createUser(data) as AppUser
        : await api.updateUser(id, data) as AppUser;
      setEditing(null);
      if (!before || before.role !== saved.role || (!before.is_active && saved.is_active)) {
        setReminder({ name: saved.display_name, role: saved.role });
      }
      toast(id === null ? `${saved.display_name} added` : 'User updated', 'success');
      await load();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function setActive(u: UserRow, active: boolean) {
    try {
      await api.updateUser(u.id, { is_active: active ? 1 : 0 });
      toast(active ? `${u.display_name} reactivated` : `${u.display_name} deactivated`, 'success');
      if (active) setReminder({ name: u.display_name, role: u.role });
      await load();
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  async function preview(u: UserRow) {
    try {
      setState(await api.startPreview(u.id) as AuthState);
      navigate('/');
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  const wouldOrphan = deactivate
    ? orphaned(customers, users.map(u => (u.id === deactivate.id ? { ...u, is_active: 0 as const } : u)))
      .filter(c => !orphans.some(o => o.customer_ref_sap === c.customer_ref_sap))
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} className="gap-1">
          <ArrowLeft size={15} /> Settings
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            People are recognised by their Windows account and company email — no passwords. Users are never deleted, only deactivated.
          </p>
        </div>
        {can.manageUsers ? (
          <Button onClick={() => { setError(null); setEditing({ id: null, display_name: '', email: '', account: '', role: 'user' }); }} className="gap-2">
            <Plus size={14} /> Add user
          </Button>
        ) : (
          <LockBadge reason={can.readOnly ?? 'View only'} />
        )}
      </div>

      <div className={cn('flex items-start gap-3 p-4 rounded-lg border text-sm',
        reminder ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900')}>
        <Info size={16} className="shrink-0 mt-0.5" />
        <div className="flex-1">
          {reminder ? (
            <p>
              Also give <b>{reminder.name}</b> access to the SharePoint folder: <b>{SHAREPOINT_ACCESS[reminder.role]}</b> ({ROLE_LABELS[reminder.role]}).
              The app cannot do this for you.
            </p>
          ) : (
            <p>
              SharePoint access is managed outside the app: <b>Edit</b> for Admins and Users, <b>Read</b> for Viewers. Remember it when you
              add someone or change a role.
            </p>
          )}
          <p className="text-xs mt-1 opacity-80">In the folder, right-click → OneDrive → <i>Manage access</i>.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => api.dbOpenFolder()}>
          <FolderOpen size={13} /> Open shared folder
        </Button>
      </div>

      {orphans.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" />
          <div>
            <b>{orphans.length} customer{orphans.length === 1 ? ' has' : 's have'} no active manager</b> and behave{orphans.length === 1 ? 's' : ''} as
            Managed by PBP until an admin reassigns {orphans.length === 1 ? 'it' : 'them'}:{' '}
            {orphans.map((c, i) => (
              <span key={c.customer_ref_sap}>
                {i > 0 && ', '}
                <button className="underline" onClick={() => navigate(`/customers/${encodeURIComponent(c.customer_ref_sap)}`)}>{c.customer_short_name}</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Windows account</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Manages</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className={u.is_active ? 'hover:bg-gray-50' : 'bg-gray-50/70 text-gray-400'}>
                  <td className="px-4 py-2.5">
                    <span className={u.is_active ? 'font-medium text-gray-900' : ''}>{u.display_name}</span>
                    {u.id === realId && <Badge variant="outline" className="ml-2">you</Badge>}
                    {!u.is_active && <Badge variant="secondary" className="ml-2">deactivated</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{u.email ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{u.account ?? <span className="italic">at first sign-in</span>}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={u.role === 'admin' ? 'default' : u.role === 'user' ? 'success' : 'secondary'}>{ROLE_LABELS[u.role]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{u.managed_count ? `${u.managed_count} customer${u.managed_count === 1 ? '' : 's'}` : '—'}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {u.is_active && u.id !== realId && (
                      <Button variant="ghost" size="sm" onClick={() => preview(u)} title="See the app exactly as this user does" className="gap-1">
                        <Eye size={13} /> Preview as…
                      </Button>
                    )}
                    {can.manageUsers && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => { setError(null); setEditing({ id: u.id, display_name: u.display_name, email: u.email ?? '', account: u.account ?? '', role: u.role }); }}>
                          Edit
                        </Button>
                        {u.is_active
                          ? <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setDeactivate(u)}>Deactivate</Button>
                          : <Button variant="ghost" size="sm" onClick={() => setActive(u, true)}>Reactivate</Button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3 text-xs text-gray-500">
        {ROLES.map(r => (
          <div key={r} className="p-3 rounded-md bg-white border border-gray-200">
            <b className="text-gray-700">{ROLE_LABELS[r]}</b> — {ROLE_DESCRIPTIONS[r]}
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id === null ? 'Add user' : 'Edit user'}>
        {editing && (
          <div className="space-y-3">
            <div>
              <Label>Company email</Label>
              <Input
                value={editing.email ?? ''}
                placeholder="firstname.lastname@totalenergies.com"
                onChange={e => {
                  const email = e.target.value;
                  setEditing(prev => prev && ({
                    ...prev,
                    email,
                    display_name: prev.id === null && (!prev.display_name || prev.display_name === nameFromEmail(prev.email ?? ''))
                      ? nameFromEmail(email) : prev.display_name,
                  }));
                }}
              />
            </div>
            <div>
              <Label>Display name</Label>
              <Input value={editing.display_name ?? ''} onChange={e => setEditing({ ...editing, display_name: e.target.value })} />
            </div>
            <div>
              <Label>Windows account <span className="text-gray-400 font-normal">(optional — recorded at first sign-in)</span></Label>
              <Input value={editing.account ?? ''} placeholder="e.g. J0123456" onChange={e => setEditing({ ...editing, account: e.target.value })} />
            </div>
            <div>
              <Label>Role</Label>
              <div className="space-y-1.5">
                {ROLES.map(r => (
                  <label key={r} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="radio" className="mt-1" checked={editing.role === r} onChange={() => setEditing({ ...editing, role: r })} />
                    <span><b>{ROLE_LABELS[r]}</b> <span className="text-gray-500">— {ROLE_DESCRIPTIONS[r]}</span></span>
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save}>{editing.id === null ? 'Add user' : 'Save'}</Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deactivate}
        onClose={() => setDeactivate(null)}
        onConfirm={() => { if (deactivate) setActive(deactivate, false); }}
        title="Deactivate user"
        description={deactivate
          ? `${deactivate.display_name} will no longer be able to use EPL Tool. Their name stays in the history.` +
            (wouldOrphan.length ? ` ${wouldOrphan.length} customer(s) will be left without an active manager and behave as Managed by PBP: ${wouldOrphan.map(c => c.customer_short_name).join(', ')}.` : '') +
            ' Remember to remove their SharePoint access too.'
          : ''}
        confirmLabel="Deactivate"
      />
    </div>
  );
}
