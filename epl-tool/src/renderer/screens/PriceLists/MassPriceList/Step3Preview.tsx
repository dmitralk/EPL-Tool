import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { formatDate, priceTypeLabel } from '../../../lib/utils';
import { useMassWizard, computeLines } from './index';
import type { StandardEplRow } from '../../../../types';

export function Step3Preview() {
  const { state, dispatch } = useMassWizard();
  const [eplRows, setEplRows] = useState<StandardEplRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.getStandardEpl(state.currency).then(rows => setEplRows(rows as StandardEplRow[]));
  }, [state.currency]);

  const eplByRip = useMemo(() => new Map(eplRows.map(r => [r.rip_code, r])), [eplRows]);

  const baseVal = state.price_type === 'Net Price' ? 0 : (state.discount_percent ?? 0);

  const computedByCustomer = useMemo(() => {
    return state.selectedRows.map(row => ({
      row,
      lines: computeLines(row.entries, state.price_type, baseVal, state.typeOverrides, state.ripOverrides, eplByRip),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedRows, state.price_type, baseVal, state.typeOverrides, state.ripOverrides, eplByRip]);

  const badgeVariant = state.price_type === 'Discount' ? 'default' : 'secondary';
  const methodSummary = priceTypeLabel(
    state.price_type === 'Net Price' ? 'Net Price' : state.price_type,
    state.price_type === 'Net Price' ? null : state.discount_percent
  );
  const overrideCount = state.typeOverrides.length + state.ripOverrides.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 — Preview</CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          Review the changes before creating {state.selectedRows.length} price list{state.selectedRows.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      <CardContent>
        {/* Summary bar */}
        <div className="flex flex-wrap gap-4 p-3 bg-gray-50 border border-gray-200 rounded-md mb-4 text-sm">
          <div>
            <span className="text-gray-500 text-xs">Method</span>
            <div className="mt-0.5">
              <Badge variant={badgeVariant}>{methodSummary}</Badge>
              {overrideCount > 0 && (
                <span className="ml-2 text-xs text-gray-500">
                  + {overrideCount} granular override{overrideCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Effective</span>
            <div className="font-medium mt-0.5">{formatDate(state.effective)}</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Mailing Date</span>
            <div className="font-medium mt-0.5">{formatDate(state.mailing_date)}</div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Currency</span>
            <div className="font-medium mt-0.5">{state.currency}</div>
          </div>
          {state.comments_about_changes && (
            <div className="w-full">
              <span className="text-gray-500 text-xs">Comments</span>
              <div className="text-gray-700 mt-0.5">{state.comments_about_changes}</div>
            </div>
          )}
        </div>

        {/* Per-customer table */}
        <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Base Version</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">New Version</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Products</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {computedByCustomer.map(({ row, lines }) => {
                const isExpanded = expanded === row.customer.customer_ref_sap;
                return (
                  <>
                    <tr
                      key={row.customer.customer_ref_sap}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded(isExpanded ? null : row.customer.customer_ref_sap)}
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900">{row.customer.customer_short_name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{row.latestHeader.price_list_version}</td>
                      <td className="px-4 py-2.5 text-blue-700 font-medium">{row.newVersion}</td>
                      <td className="px-4 py-2.5 text-right text-gray-600">{lines.length}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-xs text-gray-400">{isExpanded ? '▲ Hide' : '▼ Details'}</span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.customer.customer_ref_sap}-detail`}>
                        <td colSpan={5} className="px-4 py-0 bg-gray-50/80">
                          <div className="max-h-48 overflow-y-auto py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-500">
                                  <th className="text-left py-1 pr-4 font-medium">RIP</th>
                                  <th className="text-left py-1 pr-4 font-medium">Product</th>
                                  <th className="text-right py-1 pr-4 font-medium">Previous</th>
                                  <th className="text-right py-1 font-medium text-blue-600">New Price</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.slice(0, 20).map((line, idx) => {
                                  const prev = row.entries[idx];
                                  return (
                                    <tr key={line.rip_code}>
                                      <td className="py-1 pr-4 font-mono text-gray-400">{line.rip_code}</td>
                                      <td className="py-1 pr-4 text-gray-700">{line.product_name}</td>
                                      <td className="py-1 pr-4 text-right text-gray-400">{prev?.net_price.toFixed(2) ?? '—'}</td>
                                      <td className="py-1 text-right text-blue-700 font-medium">{line.net_price.toFixed(2)}</td>
                                    </tr>
                                  );
                                })}
                                {lines.length > 20 && (
                                  <tr>
                                    <td colSpan={4} className="py-1 text-gray-400 italic">
                                      …and {lines.length - 20} more products
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}>← Back</Button>
          <Button onClick={() => dispatch({ type: 'SET_STEP', step: 4 })}>
            Create {state.selectedRows.length} Price List{state.selectedRows.length !== 1 ? 's' : ''} →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
