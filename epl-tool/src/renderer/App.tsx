import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { DatabaseSelector } from './screens/DatabaseSelector';
import { Dashboard } from './screens/Dashboard';
import { PriceListsScreen } from './screens/PriceLists/PriceListsScreen';
import { PriceListDetail } from './screens/PriceLists/PriceListDetail';
import { CreatePriceList } from './screens/PriceLists/CreatePriceList/index';
import { NewPriceListGateway } from './screens/PriceLists/NewPriceListGateway';
import { MassCreatePriceList } from './screens/PriceLists/MassPriceList/index';
import { SettingsScreen } from './screens/Settings/SettingsScreen';
import { DeletedCustomersScreen } from './screens/Settings/DeletedCustomersScreen';
import { CurrenciesScreen } from './screens/Settings/CurrenciesScreen';
import { PackagingScreen } from './screens/Settings/PackagingScreen';
import { PackagingVersionScreen } from './screens/Settings/PackagingVersionScreen';
import { CustomersScreen } from './screens/Customers/CustomersScreen';
import { CustomerDetail } from './screens/Customers/CustomerDetail';
import { MasterDataScreen } from './screens/MasterData/MasterDataScreen';
import { AnalysisScreen } from './screens/Analysis/AnalysisScreen';
import { EmailsScreen } from './screens/Emails/EmailsScreen';
import { StandardEplScreen } from './screens/StandardEpl/StandardEplScreen';
import { NoAccessScreen } from './screens/NoAccessScreen';
import { UsersScreen } from './screens/Settings/UsersScreen';
import { ActivityScreen } from './screens/Settings/ActivityScreen';
import { HelpScreen } from './screens/Help/HelpScreen';
import { ToastProvider } from './components/ui/toast';
import { AuthProvider, useAuth } from './lib/auth';
import type { AuthState } from '../types';

// Re-reads who is signed in each time the app shell is entered: no database → /setup, not on the user list → /no-access.
function AccessGuard({ children }: { children: React.ReactNode }) {
  const { refresh } = useAuth();
  const [state, setState] = useState<AuthState | null>(null);

  useEffect(() => {
    refresh().then(setState);
  }, [refresh]);

  if (!state) return null;
  if (!state.dbOpen) return <Navigate to="/setup" replace />;
  if (!state.user) return <Navigate to="/no-access" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <AuthProvider>
          <Routes>
            <Route path="/setup" element={<DatabaseSelector />} />
            <Route path="/no-access" element={<NoAccessScreen />} />
            <Route
              path="/"
              element={
                <AccessGuard>
                  <AppShell />
                </AccessGuard>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="price-lists" element={<PriceListsScreen />} />
              <Route path="price-lists/new" element={<NewPriceListGateway />} />
              <Route path="price-lists/create" element={<CreatePriceList />} />
              <Route path="price-lists/create/mass" element={<MassCreatePriceList />} />
              <Route path="price-lists/:id" element={<PriceListDetail />} />
              <Route path="customers" element={<CustomersScreen />} />
              <Route path="customers/:ref" element={<CustomerDetail />} />
              <Route path="emails" element={<EmailsScreen />} />
              <Route path="analysis" element={<AnalysisScreen />} />
              <Route path="master-data" element={<MasterDataScreen />} />
              <Route path="standard-epl" element={<StandardEplScreen />} />
              <Route path="help" element={<HelpScreen />} />
              <Route path="help/:topic" element={<HelpScreen />} />
              <Route path="settings" element={<SettingsScreen />} />
              <Route path="settings/users" element={<UsersScreen />} />
              <Route path="settings/activity" element={<ActivityScreen />} />
              <Route path="settings/deleted-customers" element={<DeletedCustomersScreen />} />
              <Route path="settings/currencies" element={<CurrenciesScreen />} />
              <Route path="settings/packaging" element={<PackagingScreen />} />
              <Route path="settings/packaging/:version" element={<PackagingVersionScreen />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </HashRouter>
    </ToastProvider>
  );
}
