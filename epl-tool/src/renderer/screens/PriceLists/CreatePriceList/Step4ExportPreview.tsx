import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDown, Mail, CheckCircle } from 'lucide-react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { useToast } from '../../../components/ui/toast';
import { formatDate } from '../../../lib/utils';
import { useWizard } from './index';
import type { PriceListFull } from '../../../../types';

export function Step4ExportPreview() {
  const { state, dispatch } = useWizard();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [saving, setSaving] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  useEffect(() => {
    async function save() {
      try {
        const result = await api.createPriceList({
          customer_ref_sap: state.customer!.customer_ref_sap,
          sap_plant: state.sap_plant,
          effective: state.effective,
          mailing_date: state.mailing_date,
          price_list_version: state.price_list_version,
          comments_about_changes: state.comments_about_changes,
          price_type: state.price_type,
          discount_percent: state.discount_percent,
          entries: state.product_lines,
        });
        dispatch({ type: 'SET_SAVED_ID', id: (result as PriceListFull).price_list_id });
        toast('Price list saved', 'success');
      } catch (e) {
        setSaveError((e as Error).message);
        toast('Failed to save price list', 'error');
      } finally {
        setSaving(false);
      }
    }
    save();
  }, []);

  async function handleExport() {
    if (!state.savedPriceListId) return;
    const result = await api.exportXlsx(state.savedPriceListId);
    if (result.saved && result.path) {
      setExportedPath(result.path as string);
      toast('File exported successfully', 'success');
    } else if (result.error) {
      toast(`Export failed: ${result.error}`, 'error');
    }
  }

  async function handleMailClient() {
    if (!exportedPath) {
      toast('Export the file first, then open the mail client', 'error');
      return;
    }
    const customer = state.customer!;
    const to = [customer.email_to_customer, customer.email_internal_copy, customer.email_pbp_copy, customer.email_pbp_common]
      .filter(Boolean).join(';');
    const subject = `Price List — ${customer.customer_short_name} — ${state.price_list_version}`;
    const body = `Dear Customer,\n\nPlease find attached the updated price list for ${customer.customer_full_name}.\n\nEffective: ${state.effective}\nVersion: ${state.price_list_version}\n\nBest regards,`;
    const result = await api.openMailWithAttachment({ filePath: exportedPath, to, subject, body });
    if (!result.success) {
      const isPermission = String(result.error).includes('-1743') || String(result.error).includes('Not authorized');
      const msg = isPermission
        ? 'Mail access denied. Go to System Settings → Privacy & Security → Automation → EPL Tool and enable Mail.'
        : `Could not open mail client: ${result.error}`;
      toast(msg, 'error');
    }
  }

  if (saving) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-gray-500">
          Saving price list…
        </CardContent>
      </Card>
    );
  }

  if (saveError) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-red-600 mb-4">Failed to save: {saveError}</p>
          <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 3 })}>
            ← Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  const customer = state.customer!;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle className="text-green-500" size={20} />
          <CardTitle>Step 4 — Price List Created</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {/* Preview */}
        <div className="border border-gray-200 rounded-md p-4 mb-5 bg-gray-50 text-sm">
          <div className="flex justify-between mb-4">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Mailing Date</div>
              <div className="font-medium">{formatDate(state.mailing_date)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-0.5">Customer</div>
              <div className="font-medium">{customer.customer_full_name}</div>
            </div>
          </div>
          <div className="flex justify-between mb-4">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">Effective Date</div>
              <div className="font-medium">{formatDate(state.effective)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-0.5">Version</div>
              <div className="font-medium">{state.price_list_version}</div>
            </div>
          </div>

          {/* Price summary */}
          <div className="border-t border-gray-200 pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-xs">Products</span>
              <Badge variant={state.price_type === 'Discount' ? 'default' : 'secondary'}>
                {state.price_type === 'Discount' ? `${state.discount_percent}% discount` : 'Net Price'}
              </Badge>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {state.product_lines.slice(0, 5).map(line => (
                <div key={line.rip_code} className="flex justify-between text-xs">
                  <span className="text-gray-600 truncate max-w-[60%]">{line.product_name}</span>
                  <span className="font-medium">{line.net_price.toFixed(2)} {line.currency}</span>
                </div>
              ))}
              {state.product_lines.length > 5 && (
                <div className="text-xs text-gray-400">…and {state.product_lines.length - 5} more</div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-4">
          <Button onClick={handleExport} className="flex-1 gap-2" variant={exportedPath ? 'secondary' : 'default'}>
            <FileDown size={16} />
            {exportedPath ? 'Export Again' : 'Export to Excel'}
          </Button>
          <Button
            onClick={handleMailClient}
            variant="outline"
            className="flex-1 gap-2"
            disabled={!exportedPath}
            title={!exportedPath ? 'Export the file first' : ''}
          >
            <Mail size={16} />
            Open Mail Client
          </Button>
        </div>

        {exportedPath && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800 mb-4">
            File saved. Click "Open Mail Client" to compose an email with the attachment.
          </div>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => navigate('/price-lists')}>
            View All Price Lists
          </Button>
          <Button variant="outline" onClick={() => navigate('/price-lists/create')}>
            Create Another
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
