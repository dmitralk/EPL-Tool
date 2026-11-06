import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Mail, RefreshCw, ShieldOff } from 'lucide-react';
import { api } from '../lib/ipc';
import { useAuth } from '../lib/auth';
import { ipcErrorMessage } from '../lib/utils';
import { Button } from '../components/ui/button';
import type { AuthState } from '../../types';

export function NoAccessScreen() {
  const navigate = useNavigate();
  const { state, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh().then(s => {
      if (!s.dbOpen) navigate('/setup', { replace: true });
      else if (s.user) navigate('/', { replace: true });
    });
  }, [refresh, navigate]);

  async function retry(after?: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await after?.();
      const s: AuthState = await refresh();
      if (s.user) navigate('/', { replace: true });
      else if (!s.dbOpen) navigate('/setup', { replace: true });
      else setMessage('Still no access with this database.');
    } catch (err) {
      setMessage(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeDatabase() {
    const filePath = await api.dbSelectFile();
    if (!filePath) return;
    await retry(async () => {
      const r = await api.dbOpen(filePath);
      if (!r.ok) throw new Error(r.error ?? 'Failed to open database');
    });
  }

  async function requestAccess() {
    try {
      await api.requestAccess();
      setMessage('An email draft to the admins has opened in your mail program.');
    } catch (err) {
      setMessage(ipcErrorMessage(err));
    }
  }

  if (!state) return null;
  const id = state.identity;
  const who = [id.account, id.email].filter(Boolean).join(' · ') || 'unknown account';
  const deactivated = !!state.realUser && !state.realUser.is_active;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8">
        <div className="flex items-center justify-center mb-5">
          <div className="bg-amber-500 rounded-xl p-3"><ShieldOff size={30} className="text-white" /></div>
        </div>
        <h1 className="text-xl font-bold text-gray-900 text-center mb-2">No access to EPL Tool</h1>
        <p className="text-sm text-gray-600 text-center mb-5">
          {deactivated ? 'Your access to EPL Tool has been deactivated.' : 'Your account does not have access to EPL Tool.'}
          <br />
          <span className="font-mono text-xs text-gray-500">{who}</span>
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5 text-sm">
          <p className="font-medium text-gray-800 mb-1">Ask an admin</p>
          {state.admins.length === 0 ? (
            <p className="text-gray-500">No admin is listed in this database.</p>
          ) : (
            <ul className="text-gray-700 space-y-0.5">
              {state.admins.map(a => (
                <li key={`${a.display_name}-${a.email}`}>{a.display_name}{a.email ? <span className="text-gray-400"> · {a.email}</span> : null}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={requestAccess} disabled={busy || state.admins.length === 0} className="gap-2">
            <Mail size={15} /> Request access
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => retry()} disabled={busy} className="flex-1 gap-2">
              <RefreshCw size={14} /> Try again
            </Button>
            <Button variant="outline" onClick={changeDatabase} disabled={busy} className="flex-1 gap-2">
              <FolderOpen size={14} /> Open another database
            </Button>
          </div>
        </div>

        {message && <p className="mt-4 text-sm text-gray-700 text-center">{message}</p>}

        <p className="mt-6 text-xs text-gray-400 leading-relaxed">
          EPL Tool recognises you by your Windows account and company email — there is no password. An admin adds you in
          <b> Settings → Users</b> with a role (Admin, User or Viewer); then click <b>Try again</b>. You also need access to the
          shared SharePoint folder, which the admins arrange separately.
        </p>
      </div>
    </div>
  );
}
