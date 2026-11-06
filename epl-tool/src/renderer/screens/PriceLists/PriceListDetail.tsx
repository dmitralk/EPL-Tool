import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, Mail, Trash2 } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { EmailComposeDialog } from '../../components/EmailComposeDialog';
import { formatDate, formatCurrency, ipcErrorMessage, priceTypeLabel } from '../../lib/utils';
import { useCan } from '../../lib/auth';
import { LockBadge } from '../../components/LockBadge';
import type { PriceListFull, Customer } from '../../../types';

export function PriceListDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [priceList, setPriceList] = useState<PriceListFull | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const can = useCan();

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
    if (result.saved) {
      toast('Exported successfully', 'success');
    } else if (result.error) {
      toast(`Export failed: ${result.error}`, 'error');
    }
  }

  function openDelete() {
    setDeleteConfirmText('');
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!priceList) return;
    setDeleting(true);
    try {
      await api.deletePriceList(priceList.price_list_id);
      toast(`Price list ${priceList.price_list_version} deleted`, 'info');
      navigate('/price-lists', { replace: true });
    } catch (err) {
      toast(`Delete failed: ${ipcErrorMessage(err)}`, 'error');
      setDeleting(false);
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
          onClick={() => setComposeOpen(true)}
          variant="outline"
          className="gap-2"
          disabled={!customer}
        >
          <Mail size={15} />
          Email
        </Button>
        {customer && can.changeCustomer(customer) ? (
          <Button
            onClick={openDelete}
            variant="ghost"
            className="gap-2 text-red-600 hover:bg-red-50"
          >
            <Trash2 size={15} />
            Delete
          </Button>
        ) : customer && (
          <LockBadge reason={can.lockReason(customer) ?? ''} />
        )}
      </div>

      <p className="text-xs text-gray-500 -mt-4 mb-5">
        {priceList.created_by_name
          ? <>Created by <b className="font-medium text-gray-700">{priceList.created_by_name}</b>{priceList.created_at ? ` on ${formatDate(priceList.created_at)}` : ''}</>
          : <>Created{priceList.created_at ? ` on ${formatDate(priceList.created_at)}` : ''} (before creators were recorded)</>}
      </p>

      <EmailComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        priceListIds={[priceList.price_list_id]}
      />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Price List">
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            You are about to permanently delete{' '}
            <strong>{priceList.customer_short_name ?? priceList.customer_ref_sap} — {priceList.price_list_version}</strong>{' '}
            (effective {formatDate(priceList.effective)}) and its {priceList.entries.length} product price{priceList.entries.length !== 1 ? 's' : ''}.
          </p>
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            This cannot be undone from the app. Restoring would require a database backup (Settings → Backups).
          </p>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">
              Type <strong className="font-mono">{priceList.price_list_version}</strong> to confirm
            </label>
            <input
              autoFocus
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && deleteConfirmText.trim() === priceList.price_list_version && !deleting) handleDelete(); }}
              className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || deleteConfirmText.trim() !== priceList.price_list_version}
            className="gap-1.5"
          >
            <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </div>
      </Dialog>

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
                  {priceTypeLabel(priceList.price_type, priceList.discount_percent)}
                </Badge>
              </Row>
              {priceList.price_type === 'Discount' && (
                <Row label="Discount" value={`${priceList.discount_percent}%`} />
              )}
              {priceList.price_type === 'PrevPercent' && priceList.discount_percent != null && (
                <Row label="Adjustment" value={`${priceList.discount_percent > 0 ? '+' : ''}${priceList.discount_percent}%`} />
              )}
              {priceList.price_type === 'PrevAbsolute' && priceList.discount_percent != null && (
                <Row label="Adjustment" value={`${priceList.discount_percent > 0 ? '+' : ''}${priceList.discount_percent}`} />
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
