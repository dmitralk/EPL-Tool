import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Dialog } from '../../../components/ui/dialog';
import { api } from '../../../lib/ipc';
import { useWizard, type ProductLine } from './index';
import type { StandardEplRow } from '../../../../types';

export function Step3ReviewProducts() {
  const { state, dispatch } = useWizard();
  const [lines, setLines] = useState<ProductLine[]>(state.product_lines);
  const [errors, setErrors] = useState<Set<number>>(new Set());

  // Add products dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [eplRows, setEplRows] = useState<StandardEplRow[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [selectedRips, setSelectedRips] = useState<Set<string>>(new Set());

  const isNetPrice = state.price_type === 'Net Price';
  const discountPct = state.discount_percent ?? 0;
  const currency = state.customer!.currency;

  // Load EPL rows when the add dialog opens
  useEffect(() => {
    if (addOpen && eplRows.length === 0) {
      api.getStandardEpl(currency).then(r => setEplRows(r as StandardEplRow[]));
    }
  }, [addOpen, currency, eplRows.length]);

  // EPL rows not already in the price list
  const existingRips = new Set(lines.map(l => l.rip_code));
  const availableEpl = eplRows.filter(r => !existingRips.has(r.rip_code));
  const filteredEpl = availableEpl.filter(r => {
    if (!addSearch) return true;
    const s = addSearch.toLowerCase();
    return r.rip_code.toLowerCase().includes(s) || r.product_name.toLowerCase().includes(s) || r.product_type.toLowerCase().includes(s);
  });

  function updatePrice(index: number, value: string) {
    const price = parseFloat(value);
    const updated = lines.map((l, i) => i === index ? { ...l, net_price: isNaN(price) ? 0 : price } : l);
    setLines(updated);
    if (!isNaN(price) && price > 0) {
      setErrors(prev => { const next = new Set(prev); next.delete(index); return next; });
    }
  }

  function removeLine(index: number) {
    setLines(prev => prev.filter((_, i) => i !== index));
    setErrors(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  }

  function toggleAddSelect(rip: string) {
    setSelectedRips(prev => {
      const next = new Set(prev);
      if (next.has(rip)) next.delete(rip); else next.add(rip);
      return next;
    });
  }

  function confirmAdd() {
    const newLines: ProductLine[] = eplRows
      .filter(r => selectedRips.has(r.rip_code))
      .map(r => ({
        product_type: r.product_type,
        rip_code: r.rip_code,
        product_name: r.product_name,
        net_price: isNetPrice
          ? r.net_price
          : Math.round(r.net_price * (1 - discountPct / 100) * 100) / 100,
        currency: r.currency,
        unit: r.unit,
      }));
    setLines(prev => [...prev, ...newLines].sort((a, b) =>
      a.product_type.localeCompare(b.product_type) || a.rip_code.localeCompare(b.rip_code)
    ));
    setSelectedRips(new Set());
    setAddSearch('');
    setAddOpen(false);
  }

  function validate(): boolean {
    const bad = new Set<number>();
    lines.forEach((l, i) => { if (!l.net_price || l.net_price <= 0) bad.add(i); });
    setErrors(bad);
    return bad.size === 0;
  }

  function handleNext() {
    if (lines.length === 0) {
      return; // prevent proceeding with no products
    }
    if (!validate()) return;
    dispatch({ type: 'SET_PRODUCT_LINES', lines });
    dispatch({ type: 'SET_STEP', step: 4 });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Step 3 — Review Products</CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              {isNetPrice
                ? 'Enter the net price for each product.'
                : `Prices computed at ${state.discount_percent}% discount. You can override individual prices.`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="shrink-0 mt-1">
            + Add Products
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-md py-12 text-center text-gray-400 mb-4">
            <p className="text-sm mb-2">No products yet.</p>
            <p className="text-xs">Click <strong>+ Add Products</strong> to select from the Standard EPL catalogue.</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-md overflow-hidden mb-4">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Product</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">RIP</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-600 w-36">
                      Net Price ({currency})
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Unit</th>
                    <th className="w-8" />
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
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => removeLine(i)}
                          className="text-gray-300 hover:text-red-500 transition-colors p-0.5 rounded"
                          title="Remove product"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {errors.size > 0 && (
          <p className="text-red-500 text-sm mb-4">
            {errors.size} product(s) have invalid prices. All prices must be greater than 0.
          </p>
        )}
        {lines.length === 0 && (
          <p className="text-amber-600 text-sm mb-4">Add at least one product to continue.</p>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}>
            ← Back
          </Button>
          <Button onClick={handleNext} disabled={lines.length === 0}>
            Create Price List →
          </Button>
        </div>
      </CardContent>

      {/* Add Products dialog */}
      <Dialog open={addOpen} onClose={() => { setAddOpen(false); setSelectedRips(new Set()); setAddSearch(''); }} title="Add Products from Standard EPL">
        <div className="mb-3">
          <input
            autoFocus
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Search by RIP, product name or type…"
            value={addSearch}
            onChange={e => setAddSearch(e.target.value)}
          />
        </div>
        <div className="border border-gray-200 rounded-md overflow-hidden mb-3">
          <div className="max-h-72 overflow-y-auto">
            {filteredEpl.length === 0 ? (
              <p className="text-center py-6 text-sm text-gray-400">
                {availableEpl.length === 0 ? 'All EPL products are already in this price list.' : 'No products match your search.'}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="w-8 px-3 py-2" />
                    <th className="text-left px-3 py-2 font-medium text-gray-600">RIP</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">EPL Price</th>
                    {!isNetPrice && (
                      <th className="text-right px-3 py-2 font-medium text-blue-600">After disc.</th>
                    )}
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredEpl.map(r => {
                    const discountedPrice = Math.round(r.net_price * (1 - discountPct / 100) * 100) / 100;
                    return (
                      <tr
                        key={r.rip_code}
                        className={`cursor-pointer ${selectedRips.has(r.rip_code) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        onClick={() => toggleAddSelect(r.rip_code)}
                      >
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            readOnly
                            checked={selectedRips.has(r.rip_code)}
                            className="rounded border-gray-300 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-500">{r.rip_code}</td>
                        <td className="px-3 py-1.5 text-gray-800">{r.product_name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-700">{r.net_price.toFixed(2)}</td>
                        {!isNetPrice && (
                          <td className="px-3 py-1.5 text-right text-blue-700 font-medium">{discountedPrice.toFixed(2)}</td>
                        )}
                        <td className="px-3 py-1.5 text-gray-500">{r.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {selectedRips.size > 0 ? `${selectedRips.size} selected` : 'Click rows to select'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setAddOpen(false); setSelectedRips(new Set()); setAddSearch(''); }}>
              Cancel
            </Button>
            <Button onClick={confirmAdd} disabled={selectedRips.size === 0}>
              Add {selectedRips.size > 0 ? selectedRips.size : ''} Product{selectedRips.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
