import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, Mail } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { useToast } from '../../components/ui/toast';
import { formatDate, formatCurrency } from '../../lib/utils';
import type { PriceListFull, Customer } from '../../../types';

export function PriceListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [priceList, setPriceList] = useState<PriceListFull | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function load() {
      const pl = await api.getPriceList(id!);
      setPriceList(pl as PriceListFull);
      const c = await api.getCustomer(pl.customer_ref_sap);
      setCustomer(c as Customer);
    }
    load();
  }, [id]);

  async function handleExport() {
    if (!id) return;
    const result = await api.exportXlsx(id);
    if (result.saved && result.path) {
      setExportedPath(result.path as string);
      toast('Exported successfully', 'success');
    } else if (result.error) {
      toast(`Export failed: ${result.error}`, 'error');
    }
  }

  async function handleMailClient() {
    if (!customer || !priceList) return;
    if (!exportedPath) {
      toast('Export the file first, then open the mail client', 'error');
      return;
    }
    const to = [
      customer.email_to_customer,
      customer.email_internal_copy,
      customer.email_pbp_copy,
      customer.email_pbp_common,
    ].filter(Boolean).join(';');
    const subject = `Price List — ${customer.customer_short_name} — ${priceList.price_list_version}`;
    const body = `Dear Customer,\n\nPlease find attached the updated price list for ${customer.customer_full_name}.\n\nEffective: ${priceList.effective}\nVersion: ${priceList.price_list_version}\n\nBest regards,`;
    const result = await api.openMailWithAttachment({ filePath: exportedPath, to, subject, body });
    if (!result.success) {
      const isPermission = String(result.error).includes('-1743') || String(result.error).includes('Not authorized');
      const msg = isPermission
        ? 'Mail access denied. Go to System Settings → Privacy & Security → Automation → EPL Tool and enable Mail.'
        : `Could not open mail client: ${result.error}`;
      toast(msg, 'error');
    }
  }

  if (!priceList) {
    return (
      <div className="p-6 text-center text-gray-400">Loading…</div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft size={15} />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {priceList.customer_short_name ?? priceList.customer_ref_sap} — {priceList.price_list_version}
          </h1>
          <p className="text-gray-500 text-sm">{priceList.price_list_id}</p>
        </div>
        <Button onClick={handleExport} className="gap-2">
          <FileDown size={15} />
          Export XLSX
        </Button>
        <Button
          onClick={handleMailClient}
          variant="outline"
          className="gap-2"
          disabled={!customer || !exportedPath}
          title={!exportedPath ? 'Export the file first' : ''}
        >
          <Mail size={15} />
          Open Mail Client
        </Button>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader><CardTitle>Price List Info</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Customer" value={customer?.customer_full_name ?? priceList.customer_ref_sap} />
              <Row label="SAP Ref" value={priceList.customer_ref_sap} />
              <Row label="Effective" value={formatDate(priceList.effective)} />
              <Row label="Mailing Date" value={formatDate(priceList.mailing_date)} />
              <Row label="Version" value={priceList.price_list_version} />
              <Row label="SAP Plant" value={priceList.sap_plant ?? '—'} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Price Type">
                <Badge variant={priceList.price_type === 'Discount' ? 'default' : 'secondary'}>
                  {priceList.price_type}
                </Badge>
              </Row>
              {priceList.price_type === 'Discount' && (
                <Row label="Discount" value={`${priceList.discount_percent}%`} />
              )}
              <Row label="Currency" value={customer?.currency ?? '—'} />
              <Row label="Comments" value={priceList.comments_about_changes ?? '—'} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Products */}
      <Card>
        <CardHeader>
          <CardTitle>Products ({priceList.entries.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Product Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">RIP Code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Product</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Net Price</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Currency</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {priceList.entries.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-700">{entry.product_type}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600 text-xs">{entry.rip_code}</td>
                  <td className="px-4 py-2.5 text-gray-900">{entry.product_name}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{formatCurrency(entry.net_price)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{entry.currency}</td>
                  <td className="px-4 py-2.5 text-gray-600">{entry.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium">{children ?? value}</dd>
    </div>
  );
}
