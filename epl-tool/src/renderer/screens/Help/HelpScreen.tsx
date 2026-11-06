import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mail, Search, UserCircle } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useAuth } from '../../lib/auth';
import { cn, ipcErrorMessage } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { Markdown } from '../../components/Markdown';
import { MATRIX_CELL_LABELS, PERMISSION_MATRIX, ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../../shared/permissions';
import { HELP_TOPICS } from '../../help';
import type { Customer } from '../../../types';

interface Topic { id: string; title: string; body: string }

const TOPICS: Topic[] = HELP_TOPICS.map(t => ({ ...t, title: /^#\s+(.*)$/m.exec(t.body)?.[1] ?? t.id }));

function RolesBlock() {
  return (
    <div className="my-3 space-y-1.5">
      {ROLES.map(r => (
        <div key={r} className="text-sm text-gray-700"><b className="text-gray-900">{ROLE_LABELS[r]}</b> — {ROLE_DESCRIPTIONS[r]}</div>
      ))}
    </div>
  );
}

function MatrixBlock() {
  const cell = (v: keyof typeof MATRIX_CELL_LABELS) => (
    <td className={cn('px-3 py-1.5 text-center whitespace-nowrap', v === 'no' ? 'text-gray-300' : v === 'yes' ? 'text-green-700' : 'text-blue-700')}>
      {MATRIX_CELL_LABELS[v]}
    </td>
  );
  return (
    <div className="overflow-x-auto my-3">
      <table className="text-sm border border-gray-200 rounded">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-3 py-1.5 font-medium text-gray-700 border-b border-gray-200">Action</th>
            {ROLES.map(r => <th key={r} className="px-3 py-1.5 font-medium text-gray-700 border-b border-gray-200">{ROLE_LABELS[r]}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {PERMISSION_MATRIX.map(row => (
            <tr key={row.action}>
              <td className="px-3 py-1.5 text-gray-700">{row.action}</td>
              {ROLES.map(r => <Fragment key={r}>{cell(row.cells[r])}</Fragment>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-1">People who are not on the user list can't use the tool (No access screen).</p>
    </div>
  );
}

function YourAccess() {
  const { state } = useAuth();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  useEffect(() => { api.getCustomers().then(c => setCustomers(c as Customer[])); }, []);
  if (!state?.user) return null;
  const real = state.realUser ?? state.user;
  const managed = customers.filter(c => state.managedCustomerRefs.includes(c.customer_ref_sap));

  async function requestChange() {
    try {
      await api.requestAccess('change');
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  return (
    <div className="mb-6 p-4 rounded-lg border border-blue-200 bg-blue-50/60 text-sm">
      <div className="flex items-start gap-3">
        <UserCircle size={28} className="text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900">
            {real.display_name} · {ROLE_LABELS[real.role]}
            {state.previewing && <span className="font-normal text-purple-700"> — previewing as {state.user.display_name} ({ROLE_LABELS[state.user.role]})</span>}
          </div>
          <div className="text-gray-600 mt-0.5">{ROLE_DESCRIPTIONS[state.user.role]}</div>
          <div className="text-gray-600 mt-1">
            {managed.length
              ? <>You manage: {managed.map(c => c.customer_short_name).join(', ')}</>
              : 'You don\'t manage any customer.'}
          </div>
          <div className="text-gray-500 text-xs mt-1">
            Admins: {state.admins.map(a => a.display_name).join(', ') || '—'}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={requestChange} className="gap-1.5 shrink-0" title="Email the admins">
          <Mail size={13} /> Request a change
        </Button>
      </div>
    </div>
  );
}

export function HelpScreen() {
  const { topic } = useParams<{ topic?: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const current = TOPICS.find(t => t.id === topic) ?? TOPICS[0];
  const q = search.trim().toLowerCase();
  const matches = useMemo(() => (q ? TOPICS.filter(t => t.body.toLowerCase().includes(q)) : TOPICS), [q]);

  return (
    <div className="p-6 flex gap-6 max-w-6xl mx-auto">
      <aside className="w-60 shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Guides & Help</h1>
        <p className="text-xs text-gray-500 mb-3">Documentation, how-to guides and answers</p>
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search guides & help…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
        </div>
        <nav className="space-y-0.5">
          {matches.map(t => (
            <button
              key={t.id}
              onClick={() => navigate(`/help/${t.id}`)}
              className={cn('block w-full text-left px-3 py-1.5 rounded-md text-sm',
                t.id === current?.id ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100')}
            >
              {t.title}
            </button>
          ))}
          {matches.length === 0 && <p className="text-xs text-gray-400 px-3">No topic mentions “{search}”.</p>}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <YourAccess />
        {current && <Markdown source={current.body} blocks={{ ROLES: <RolesBlock />, PERMISSION_MATRIX: <MatrixBlock /> }} />}
      </main>
    </div>
  );
}
