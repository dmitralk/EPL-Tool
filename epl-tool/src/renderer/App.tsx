import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/ipc';
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
import { ImportScreen } from './screens/Settings/ImportScreen';
import { CurrenciesScreen } from './screens/Settings/CurrenciesScreen';
import { PackagingScreen } from './screens/Settings/PackagingScreen';
import { PackagingVersionScreen } from './screens/Settings/PackagingVersionScreen';
import { CustomersScreen } from './screens/Customers/CustomersScreen';
import { CustomerDetail } from './screens/Customers/CustomerDetail';
import { MasterDataScreen } from './screens/MasterData/MasterDataScreen';
import { StandardEplScreen } from './screens/StandardEpl/StandardEplScreen';
import { ToastProvider } from './components/ui/toast';

function DbGuard({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    api.dbIsOpen().then((open) => {
      setIsOpen(Boolean(open));
      setChecked(true);
    });
  }, []);

  if (!checked) return null;
  if (!isOpen) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/setup" element={<DatabaseSelector />} />
          <Route
            path="/"
            element={
              <DbGuard>
                <AppShell />
              </DbGuard>
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
            <Route path="master-data" element={<MasterDataScreen />} />
            <Route path="standard-epl" element={<StandardEplScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="settings/deleted-customers" element={<DeletedCustomersScreen />} />
            <Route path="settings/import" element={<ImportScreen />} />
            <Route path="settings/currencies" element={<CurrenciesScreen />} />
            <Route path="settings/packaging" element={<PackagingScreen />} />
            <Route path="settings/packaging/:version" element={<PackagingVersionScreen />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
