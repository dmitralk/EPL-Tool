import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Users, TrendingUp, Plus } from 'lucide-react';
import { api } from '../lib/ipc';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useToast } from '../components/ui/toast';
import { formatDate, priceTypeLabel } from '../lib/utils';
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
        <Button onClick={() => navigate('/price-lists/new')} className="gap-2">
          <Plus size={15} />
          New Price List
        </Button>
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
                        {priceTypeLabel(pl.price_type, pl.discount_percent)}
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

    </div>
  );
}
