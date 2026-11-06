import { Outlet } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { api } from '../../lib/ipc';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../../shared/permissions';
import type { AuthState } from '../../../types';

export function AppShell() {
  const { state, setState } = useAuth();

  async function exitPreview() {
    setState(await api.stopPreview() as AuthState);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {state?.previewing && state.user && (
          <div className="sticky top-0 z-30 flex items-center justify-between gap-3 px-6 py-2 bg-purple-600 text-white text-sm shadow">
            <span className="flex items-center gap-2">
              <Eye size={15} />
              Previewing as <b>{state.user.display_name}</b> ({ROLE_LABELS[state.user.role]}) — the app behaves exactly as for them.
              Changes you make are recorded as yours.
            </span>
            <button onClick={exitPreview} className="px-3 py-1 rounded bg-white/20 hover:bg-white/30 font-medium">Exit preview</button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
