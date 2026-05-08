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
  const prevEntries = state.previousEntries ?? []; // treat undefined/null as empty
  const hasPrevious = state.previousEntries !== null && state.previousEntries !== undefined;

  useEffect(() => {
    api.getStandardEpl(currency).then(rows => setEplRows(rows as StandardEplRow[]));
  }, [currency]);

  // Build an index of standard EPL prices by rip_code for quick lookup
  const eplByRip = new Map(eplRows.map(r => [r.rip_code, r]));

  function computeDiscountLines(discountPct: number): ProductLine[] {
    return prevEntries.map(prev => {
      const epl = eplByRip.get(prev.rip_code);
      const basePrice = epl?.net_price ?? prev.net_price;
      return {
        product_type: prev.product_type,
        rip_code: prev.rip_code,
        product_name: prev.product_name,
        net_price: Math.round(basePrice * (1 - discountPct / 100) * 100) / 100,
        currency: prev.currency,
        unit: epl?.unit ?? prev.unit,
      };
    });
  }

  function computeNetPriceLines(): ProductLine[] {
    return prevEntries.map(prev => {
      const epl = eplByRip.get(prev.rip_code);
      return {
        product_type: prev.product_type,
        rip_code: prev.rip_code,
        product_name: prev.product_name,
        net_price: prev.net_price,
        currency: prev.currency,
        unit: epl?.unit ?? prev.unit,
      };
    });
  }

  function handleNext() {
    if (state.price_type === 'Discount') {
      const pct = parseFloat(discountInput);
      if (isNaN(pct) || pct < 0 || pct >= 100) {
        setError('Enter a valid discount between 0 and 99.99%');
        return;
      }
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: pct });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computeDiscountLines(pct) });
    } else {
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: null });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computeNetPriceLines() });
    }
    dispatch({ type: 'SET_STEP', step: 3 });
  }

  const discountPct = parseFloat(discountInput) || 0;
  const preview = state.price_type === 'Discount' && discountInput && prevEntries.length > 0
    ? computeDiscountLines(discountPct)
    : [];

  return (
    <Card>
      <CardHeader><CardTitle>Step 2 — Configure Pricing</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-5">
          {/* Source info */}
          <div className={`p-3 rounded-md text-sm ${hasPrevious ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            {hasPrevious
              ? `${prevEntries.length} product(s) from the latest price list will be used as the starting point. You can add or remove products in the next step.`
              : 'No previous price list — the product list will start empty. You will add products in the next step.'}
          </div>

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
              {hasPrevious
                ? 'Previous prices are pre-loaded. You can edit each price in the next step.'
                : 'You will enter prices manually in the next step after adding products.'}
            </div>
          )}

          {/* Preview table — only shown when there are previous products and discount is set */}
          {preview.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                Price preview — {currency} ({preview.length} products, {discountInput}% discount)
              </div>
              <div className="border border-gray-200 rounded-md overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">RIP</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600">EPL Base</th>
                      <th className="text-right px-3 py-2 font-medium text-blue-600">After disc.</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {prevEntries.map((prev, i) => {
                      const epl = eplByRip.get(prev.rip_code);
                      return (
                        <tr key={prev.rip_code} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 font-mono text-gray-500">{prev.rip_code}</td>
                          <td className="px-3 py-1.5 text-gray-800">{prev.product_name}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500">
                            {epl ? epl.net_price.toFixed(2) : <span className="italic text-gray-400">prev</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right text-blue-700 font-medium">
                            {preview[i]?.net_price.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-gray-500">{epl?.unit ?? prev.unit}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
