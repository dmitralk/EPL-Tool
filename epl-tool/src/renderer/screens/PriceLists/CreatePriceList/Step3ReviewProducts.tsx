import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useWizard, type ProductLine } from './index';

export function Step3ReviewProducts() {
  const { state, dispatch } = useWizard();
  const [lines, setLines] = useState<ProductLine[]>(state.product_lines);
  const [errors, setErrors] = useState<Set<number>>(new Set());

  function updatePrice(index: number, value: string) {
    const price = parseFloat(value);
    const updated = lines.map((l, i) => i === index ? { ...l, net_price: isNaN(price) ? 0 : price } : l);
    setLines(updated);
    if (!isNaN(price) && price > 0) {
      setErrors(prev => { const next = new Set(prev); next.delete(index); return next; });
    }
  }

  function validate(): boolean {
    const bad = new Set<number>();
    lines.forEach((l, i) => { if (!l.net_price || l.net_price <= 0) bad.add(i); });
    setErrors(bad);
    return bad.size === 0;
  }

  function handleNext() {
    if (!validate()) return;
    dispatch({ type: 'SET_PRODUCT_LINES', lines });
    dispatch({ type: 'SET_STEP', step: 4 });
  }

  const isNetPrice = state.price_type === 'Net Price';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 — Review Products</CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          {isNetPrice
            ? 'Enter the net price for each product.'
            : `Prices computed at ${state.discount_percent}% discount. You can override individual prices.`}
        </p>
      </CardHeader>
      <CardContent>
        <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Product</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">RIP</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600 w-36">
                    Net Price ({state.customer?.currency})
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, i) => (
                  <tr key={line.rip_code} className={errors.has(i) ? 'bg-red-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-1.5 text-gray-900">{line.product_name}</td>
                    <td className="px-4 py-1.5 font-mono text-gray-500 text-xs">{line.rip_code}</td>
                    <td className="px-4 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={line.net_price || ''}
                        onChange={e => updatePrice(i, e.target.value)}
                        className={`text-right h-7 text-sm ${errors.has(i) ? 'border-red-400' : ''}`}
                      />
                    </td>
                    <td className="px-4 py-1.5 text-gray-500">{line.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {errors.size > 0 && (
          <p className="text-red-500 text-sm mb-4">
            {errors.size} product(s) have invalid prices. All prices must be greater than 0.
          </p>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}>
            ← Back
          </Button>
          <Button onClick={handleNext}>
            Create Price List →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
