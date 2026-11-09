import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Users, Settings, Database, Package, BookOpen, BarChart3, Mail, HelpCircle, UserCircle, Pencil, RefreshCw, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { useSync } from '../../lib/syncState';
import { statusLine, useSyncActions } from '../../lib/sync';
import { ROLE_LABELS, canStartEditing } from '../../../shared/permissions';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/price-lists', label: 'Price Lists', icon: FileText },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/emails', label: 'Emails', icon: Mail },
  { to: '/analysis', label: 'Analysis', icon: BarChart3 },
  { to: '/master-data', label: 'Products', icon: Package },
  { to: '/standard-epl', label: 'Standard EPL', icon: BookOpen },
];

// Shown as "Guides & Help": documentation and guides for every role (route /help).
const helpItem = { to: '/help', label: 'Guides & Help', icon: HelpCircle };
const settingsItem = { to: '/settings', label: 'Settings', icon: Settings };

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
    isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white',
  );

const TONE_DOT = { gray: 'bg-gray-500', green: 'bg-green-400', blue: 'bg-blue-400', amber: 'bg-amber-400', red: 'bg-red-500' };

const smallButton = 'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-40';

export function Sidebar() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const { status } = useSync();
  const act = useSyncActions();
  const editing = status?.phase === 'edit';
  const line = status ? statusLine(status) : null;
  const working = !!act.working;

  return (
    <aside className="w-52 shrink-0 bg-gray-900 text-white flex flex-col h-full">
      {/* Logo / app name */}
      <div className="px-4 py-5 border-b border-gray-700">
        <div className="text-blue-400 font-bold text-lg">EPL Tool</div>
        <div className="text-gray-400 text-xs mt-0.5">Export Price List</div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white',
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom nav: Guides & Help, Change Database, Settings */}
      <div className="px-2 py-4 border-t border-gray-700 space-y-1">
        <NavLink to={helpItem.to} className={linkClass}>
          <helpItem.icon size={16} />
          {helpItem.label}
        </NavLink>
        <button
          onClick={() => navigate('/setup')}
          disabled={editing}
          title={editing ? 'Finish editing first' : 'Connect to the shared database or open another database'}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white w-full transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Database size={16} />
          Change Database
        </button>
        <NavLink to={settingsItem.to} className={linkClass}>
          <settingsItem.icon size={16} />
          {settingsItem.label}
        </NavLink>
        {status && line && status.mode !== 'none' && (
          <div className="px-3 pt-3 mt-2 border-t border-gray-800 text-xs">
            <div className="flex items-start gap-2" title={line.detail}>
              <span className={cn('mt-1 h-2 w-2 rounded-full shrink-0', TONE_DOT[line.tone])} />
              <span className="text-gray-300 leading-snug flex-1">{line.text}</span>
              {status.mode === 'shared' && (
                <NavLink to="/help/shared-database" title="About the shared database" className="text-gray-500 hover:text-gray-200">
                  <HelpCircle size={12} />
                </NavLink>
              )}
            </div>
            {status.mode === 'shared' && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {status.phase === 'read' && canStartEditing(state?.user) && (
                  <button onClick={act.startEditing} disabled={working || !status.canStartEditing}
                    title={status.startEditingBlocked ?? 'Get a fresh copy and make changes; they are published for everybody'}
                    className={cn(smallButton, 'bg-blue-600 text-white hover:bg-blue-500')}>
                    <Pencil size={11} /> {act.working === 'start' ? 'Starting…' : 'Start editing'}
                  </button>
                )}
                {editing && (
                  <button onClick={act.finishEditing} disabled={working || status.edit?.publishing}
                    title="Publish your changes and go back to read mode"
                    className={cn(smallButton, 'bg-green-600 text-white hover:bg-green-500')}>
                    <Check size={11} /> {act.working === 'finish' ? 'Publishing…' : 'Finish editing'}
                  </button>
                )}
                {status.phase === 'read' && (
                  <button onClick={act.refresh} disabled={working} title="Look for newer data now"
                    className={cn(smallButton, 'text-gray-300 hover:bg-gray-800 hover:text-white')}>
                    <RefreshCw size={11} className={act.working === 'refresh' ? 'animate-spin' : ''} /> Refresh
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {state?.user && (
          <div className="flex items-center gap-2 px-3 pt-3 mt-2 border-t border-gray-800 text-xs" title={state.realUser?.email ?? ''}>
            <UserCircle size={16} className="text-gray-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-gray-200 truncate">{state.realUser?.display_name ?? state.user.display_name}</div>
              <div className="text-gray-500">
                {ROLE_LABELS[state.realUser?.role ?? state.user.role]}
                {state.previewing && <span className="text-purple-300"> · as {state.user.display_name}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
