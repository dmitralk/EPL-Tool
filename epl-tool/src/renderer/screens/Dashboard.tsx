import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Users, TrendingUp, Plus, Upload } from 'lucide-react';
import { api } from '../lib/ipc';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog } from '../components/ui/dialog';
import { useToast } from '../components/ui/toast';
import { formatDate } from '../lib/utils';
import type { PriceListHeader } from '../../types';

interface Stats {
  total: number;
  thisYear: number;
  last: PriceListHeader | null;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats>({ total: 0, thisYear: 0, last: null });
  const [recentLists, setRecentLists] = useState<PriceListHeader[]>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [s, lists, customers] = await Promise.all([
        api.getPriceListStats(),
        api.getPriceLists(),
        api.getCustomers(),
      ]);
      setStats(s);
      setRecentLists((lists as PriceListHeader[]).slice(0, 8));
      setCustomerCount((customers as unknown[]).length);
    }
    load();
  }, []);

  async function handleImport() {
    const filePath = await api.migrationSelectFile();
    if (!filePath) return;
    setImporting(true);
    setImportResult(null);
    const result = await api.migrationImport(filePath);
    setImporting(false);
    if (result.success) {
      const c = result.counts;
      setImportResult(`Import complete: ${c.customers} customers, ${c.products} products, ${c.standardEpl} EPL rows, ${c.packaging} packaging rows, ${c.priceLists} price lists, ${c.priceListEntries} price entries.`);
      // Refresh
      const [s, lists, customers] = await Promise.all([
        api.getPriceListStats(),
        api.getPriceLists(),
        api.getCustomers(),
      ]);
      setStats(s);
      setRecentLists((lists as PriceListHeader[]).slice(0, 8));
      setCustomerCount((customers as unknown[]).length);
      toast('Data imported successfully', 'success');
    } else {
      setImportResult(`Import failed: ${result.error}`);
      toast('Import failed', 'error');
    }
  }

  async function handleExport(id: string) {
    const result = await api.exportXlsx(id);
    if (result.saved) toast('Price list exported', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Overview of your price list activity</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload size={15} />
            Import Excel
          </Button>
          <Button onClick={() => navigate('/price-lists/create')} className="gap-2">
            <Plus size={15} />
            New Price List
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-500">Total Price Lists</CardTitle>
              <FileText size={16} className="text-gray-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-500">This Year</CardTitle>
              <TrendingUp size={16} className="text-gray-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{stats.thisYear}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-500">Customers</CardTitle>
              <Users size={16} className="text-gray-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-900">{customerCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent price lists */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Price Lists</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/price-lists')}>
              View all →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentLists.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              No price lists yet. Create your first one!
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 font-medium text-gray-500">Customer</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Effective</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Version</th>
                  <th className="text-left px-3 py-3 font-medium text-gray-500">Type</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {recentLists.map(pl => (
                  <tr key={pl.price_list_id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900">
                      {pl.customer_short_name ?? pl.customer_ref_sap}
                    </td>
                    <td className="px-3 py-3 text-gray-600">{formatDate(pl.effective)}</td>
                    <td className="px-3 py-3 text-gray-600">{pl.price_list_version}</td>
                    <td className="px-3 py-3">
                      <Badge variant={pl.price_type === 'Discount' ? 'default' : 'secondary'}>
                        {pl.price_type === 'Discount' ? `Discount ${pl.discount_percent}%` : 'Net Price'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/price-lists/${pl.price_list_id}`)}
                        className="mr-1"
                      >
                        View
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport(pl.price_list_id)}
                      >
                        Export
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Import dialog */}
      <Dialog open={importOpen} onClose={() => { setImportOpen(false); setImportResult(null); }} title="Import from Excel">
        <p className="text-sm text-gray-600 mb-4">
          Select your <strong>All_Prices.xlsx</strong> file to import customers, products, standard EPL prices, packaging, and price list history into the database.
        </p>
        {importResult && (
          <div className={`p-3 rounded-md text-sm mb-4 ${importResult.startsWith('Import failed') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
            {importResult}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setImportOpen(false); setImportResult(null); }}>
            Close
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : 'Select File & Import'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
