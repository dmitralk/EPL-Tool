import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Users, Settings, Database, Package, BookOpen, BarChart3, Mail, HelpCircle, UserCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/ipc';
import { useAuth } from '../../lib/auth';
import { ROLE_LABELS } from '../../../shared/permissions';

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

export function Sidebar() {
  const navigate = useNavigate();
  const { state, refresh } = useAuth();

  async function handleChangeDb() {
    const filePath = await api.dbSelectFile();
    if (!filePath) return;
    const result = await api.dbOpen(filePath);
    const next = await refresh();
    navigate(!result.ok || !next.dbOpen ? '/setup' : next.user ? '/' : '/no-access');
  }

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
          onClick={handleChangeDb}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white w-full transition-colors"
        >
          <Database size={16} />
          Change Database
        </button>
        <NavLink to={settingsItem.to} className={linkClass}>
          <settingsItem.icon size={16} />
          {settingsItem.label}
        </NavLink>
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
