import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Settings, Database } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/ipc';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/price-lists', label: 'Price Lists', icon: FileText },
];

const bottomItems = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const navigate = useNavigate();

  async function handleChangeDb() {
    const filePath = await api.dbSelectFile();
    if (!filePath) return;
    const result = await api.dbOpen(filePath);
    if (result.ok) navigate('/');
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

      {/* Bottom nav */}
      <div className="px-2 py-4 border-t border-gray-700 space-y-1">
        <button
          onClick={handleChangeDb}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white w-full transition-colors"
        >
          <Database size={16} />
          Change Database
        </button>
        {bottomItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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
      </div>
    </aside>
  );
}
