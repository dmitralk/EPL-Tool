import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, FileDown, Mail } from 'lucide-react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useToast } from '../../../components/ui/toast';
import { useMassWizard, computeLines } from './index';
import type { StandardEplRow, CreatePriceListInput } from '../../../../types';

interface RowResult {
  customerRef: string;
  customerName: string;
  priceListId: string | null;
  newVersion: string;
  status: 'pending' | 'ok' | 'error';
  error?: string;
}

const DEFAULT_SUBJECT = 'Price List — {customer} — {version}';
const DEFAULT_BODY = `Dear Customer,\n\nPlease find attached the updated price list for {customer_full}.\n\nEffective: {effective}\nVersion: {version}\n\nBest regards,`;

export function Step4CreateResults() {
  const navigate = useNavigate();
  const { state } = useMassWizard();
  const { toast } = useToast();
  const [results, setResults] = useState<RowResult[]>(
    state.selectedRows.map(r => ({
      customerRef: r.customer.customer_ref_sap,
      customerName: r.customer.customer_short_name,
      priceListId: null,
      newVersion: r.newVersion,
      status: 'pending',
    }))
  );
  const [saving, setSaving] = useState(true);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [eplRows, setEplRows] = useState<StandardEplRow[]>([]);
  const eplLoaded = useRef(false);

  // Load EPL rows then create all price lists
  useEffect(() => {
    async function run() {
      const rows = await api.getStandardEpl(state.currency) as StandardEplRow[];
      setEplRows(rows);
      eplLoaded.current = true;

      const eplByRip = new Map(rows.map(r => [r.rip_code, r]));
      const baseVal = state.price_type === 'Net Price' ? 0 : (state.discount_percent ?? 0);

      // Create price lists sequentially to avoid DB contention
      for (const row of state.selectedRows) {
        const lines = computeLines(row.entries, state.price_type, baseVal, state.typeOverrides, state.ripOverrides, eplByRip);

        // Determine stored price_type: 'Net Price' carry-forward saves as 'Net Price'
        const storedPriceType: CreatePriceListInput['price_type'] =
          state.price_type === 'Net Price' ? 'Net Price' : state.price_type;

        const input: CreatePriceListInput = {
          customer_ref_sap: row.customer.customer_ref_sap,
          sap_plant: row.latestHeader.sap_plant ?? '',
          effective: state.effective,
          mailing_date: state.mailing_date,
          price_list_version: row.newVersion,
          comments_about_changes: state.comments_about_changes,
          price_type: storedPriceType,
          discount_percent: state.price_type === 'Net Price' ? null : (state.discount_percent ?? null),
          entries: lines,
        };

        try {
          const result = await api.createPriceList(input) as { price_list_id: string };
          setResults(prev => prev.map(r =>
            r.customerRef === row.customer.customer_ref_sap
              ? { ...r, status: 'ok', priceListId: result.price_list_id }
              : r
          ));
        } catch (e) {
          setResults(prev => prev.map(r =>
            r.customerRef === row.customer.customer_ref_sap
              ? { ...r, status: 'error', error: (e as Error).message }
              : r
          ));
        }
      }
      setSaving(false);
    }
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createdIds = useMemo(
    () => results.filter(r => r.status === 'ok' && r.priceListId).map(r => r.priceListId!),
    [results]
  );
  const okCount   = results.filter(r => r.status === 'ok').length;
  const errCount  = results.filter(r => r.status === 'error').length;
  const doneCount = okCount + errCount;

  async function handleBulkExport() {
    if (createdIds.length === 0) return;
    setBulkWorking(true);
    const result = await api.exportXlsxBulk(createdIds);
    setBulkWorking(false);
    if ((result as any).canceled) return;
    const r = (result as any).results as { id: string; error?: string }[];
    const ok = r.filter(x => !x.error).length;
    const fail = r.filter(x => x.error).length;
    if (fail === 0) toast(`Exported ${ok} file${ok !== 1 ? 's' : ''} to ${(result as any).folder}`, 'success');
    else toast(`${ok} exported, ${fail} failed`, 'error');
  }

  async function handleBulkEmail() {
    if (createdIds.length === 0) return;
    const savedSubject = await api.getSetting('email_subject_template');
    const savedBody    = await api.getSetting('email_body_template');
    setBulkWorking(true);
    const result = await api.openMailBulk(
      createdIds,
      savedSubject || DEFAULT_SUBJECT,
      savedBody || DEFAULT_BODY,
    );
    setBulkWorking(false);
    if ((result as any).canceled) return;
    const r = (result as any).results as { id: string; error?: string }[];
    const ok = r.filter(x => !x.error).length;
    const fail = r.filter(x => x.error).length;
    if (fail === 0) toast(`Opened ${ok} email${ok !== 1 ? 's' : ''} with attachments`, 'success');
    else {
      const isPermission = r.some(x => x.error && (x.error.includes('-1743') || x.error.includes('Not authorized')));
      toast(isPermission
        ? 'Mail access denied. Go to System Settings → Privacy & Security → Automation → EPL Tool and enable Mail.'
        : `${ok} emails opened, ${fail} failed`, 'error');
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {saving
            ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            : errCount === 0
            ? <CheckCircle className="text-green-500" size={20} />
            : <XCircle className="text-red-500" size={20} />
          }
          <CardTitle>
            {saving
              ? `Creating price lists… (${doneCount} / ${results.length})`
              : errCount === 0
              ? `${okCount} Price List${okCount !== 1 ? 's' : ''} Created`
              : `${okCount} created, ${errCount} failed`
            }
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {/* Results table */}
        <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">New Version</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Price List ID</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Status</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map(r => (
                <tr key={r.customerRef} className={r.status === 'error' ? 'bg-red-50' : ''}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.customerName}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.newVersion}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                    {r.priceListId ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.status === 'pending' && (
                      <span className="text-gray-400 text-xs">Pending…</span>
                    )}
                    {r.status === 'ok' && (
                      <span className="text-green-600 text-xs font-medium flex items-center gap-1">
                        <CheckCircle size={12} /> Created
                      </span>
                    )}
                    {r.status === 'error' && (
                      <span className="text-red-600 text-xs" title={r.error}>
                        Failed: {r.error?.slice(0, 60)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.status === 'ok' && r.priceListId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/price-lists/${r.priceListId}`)}
                        className="text-xs"
                      >
                        View
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bulk actions */}
        {!saving && okCount > 0 && (
          <div className="flex gap-3 mb-4">
            <Button onClick={handleBulkExport} disabled={bulkWorking} className="flex-1 gap-2">
              <FileDown size={15} />
              {bulkWorking ? 'Working…' : `Export All (${okCount})`}
            </Button>
            <Button onClick={handleBulkEmail} variant="outline" disabled={bulkWorking} className="flex-1 gap-2">
              <Mail size={15} />
              {bulkWorking ? 'Working…' : `Email All (${okCount})`}
            </Button>
          </div>
        )}

        {!saving && (
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => navigate('/price-lists')}>
              View All Price Lists
            </Button>
            <Button variant="outline" onClick={() => navigate('/price-lists/new')}>
              New Price Update
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
