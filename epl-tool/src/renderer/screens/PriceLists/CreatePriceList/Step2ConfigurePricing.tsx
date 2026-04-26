import { useEffect, useState } from 'react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Input, Label } from '../../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useWizard, type ProductLine } from './index';
import type { StandardEplRow } from '../../../../types';

export function Step2ConfigurePricing() {
  const { state, dispatch } = useWizard();
  const [eplRows, setEplRows] = useState<StandardEplRow[]>([]);
  const [discountInput, setDiscountInput] = useState(
    state.discount_percent != null ? String(state.discount_percent) : ''
  );
  const [error, setError] = useState('');

  const currency = state.customer!.currency;

  useEffect(() => {
    api.getStandardEpl(currency).then(rows => setEplRows(rows as StandardEplRow[]));
  }, [currency]);

  function computeLines(discountPct: number): ProductLine[] {
    return eplRows.map(row => ({
      product_type: row.product_type,
      rip_code: row.rip_code,
      product_name: row.product_name,
      net_price: Math.round(row.net_price * (1 - discountPct / 100) * 100) / 100,
      currency: row.currency,
      unit: row.unit,
    }));
  }

  function handleNext() {
    if (state.price_type === 'Discount') {
      const pct = parseFloat(discountInput);
      if (isNaN(pct) || pct < 0 || pct >= 100) {
        setError('Enter a valid discount between 0 and 99.99%');
        return;
      }
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: pct });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computeLines(pct) });
    } else {
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: null });
      // For Net Price mode: pre-populate with EPL prices as starting point
      if (state.product_lines.length === 0) {
        dispatch({
          type: 'SET_PRODUCT_LINES', lines: eplRows.map(row => ({
            product_type: row.product_type,
            rip_code: row.rip_code,
            product_name: row.product_name,
            net_price: row.net_price,
            currency: row.currency,
            unit: row.unit,
          }))
        });
      }
    }
    dispatch({ type: 'SET_STEP', step: 3 });
  }

  const preview = state.price_type === 'Discount' && discountInput
    ? computeLines(parseFloat(discountInput) || 0)
    : [];

  return (
    <Card>
      <CardHeader><CardTitle>Step 2 — Configure Pricing</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-5">
          {/* Mode toggle */}
          <div>
            <Label>Pricing Method</Label>
            <div className="flex gap-3 mt-1">
              {(['Discount', 'Net Price'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => {
                    dispatch({ type: 'SET_FIELD', field: 'price_type', value: mode });
                    setError('');
                  }}
                  className={`flex-1 py-2.5 px-4 rounded-md border text-sm font-medium transition-colors ${
                    state.price_type === mode
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {mode === 'Discount' ? '% Discount from Standard EPL' : 'Enter Net Prices Directly'}
                </button>
              ))}
            </div>
          </div>

          {state.price_type === 'Discount' && (
            <div>
              <Label>Discount Percentage *</Label>
              <div className="flex items-center gap-2 max-w-xs">
                <Input
                  type="number"
                  min={0}
                  max={99.99}
                  step={0.01}
                  value={discountInput}
                  onChange={e => { setDiscountInput(e.target.value); setError(''); }}
                  placeholder="e.g. 10"
                />
                <span className="text-gray-500 font-medium">%</span>
              </div>
              {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
            </div>
          )}

          {state.price_type === 'Net Price' && (
            <div className="p-3 bg-blue-50 rounded-md text-sm text-blue-700">
              You will enter prices manually in the next step. Standard EPL prices are pre-loaded as a starting point.
            </div>
          )}

          {/* Standard EPL reference table */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">
              Standard EPL — {currency} ({eplRows.length} products)
            </div>
            <div className="border border-gray-200 rounded-md overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">RIP</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Standard Price</th>
                    {preview.length > 0 && (
                      <th className="text-right px-3 py-2 font-medium text-blue-600">
                        After {discountInput}% disc.
                      </th>
                    )}
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {eplRows.map((row, i) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-mono text-gray-500">{row.rip_code}</td>
                      <td className="px-3 py-1.5 text-gray-800">{row.product_name}</td>
                      <td className="px-3 py-1.5 text-right text-gray-700">{row.net_price.toFixed(2)}</td>
                      {preview.length > 0 && (
                        <td className="px-3 py-1.5 text-right text-blue-700 font-medium">
                          {preview[i]?.net_price.toFixed(2)}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-gray-500">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 1 })}>
              ← Back
            </Button>
            <Button onClick={handleNext}>Next →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
