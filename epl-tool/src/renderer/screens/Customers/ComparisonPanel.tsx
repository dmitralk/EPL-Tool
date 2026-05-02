import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { formatCurrency } from '../../lib/utils';
import type { Customer, PriceListFull, PriceListHeader } from '../../../types';

interface Props {
  initialIdA: string;
  initialIdB: string;
  onClose: () => void;
}

interface ComparisonRow {
  rip_code: string;
  product_type: string;
  product_name: string;
  price_a: number | null;
  price_b: number | null;
  currency: string;
}

function buildComparison(a: PriceListFull, b: PriceListFull): ComparisonRow[] {
  const map = new Map<string, ComparisonRow>();

  for (const e of a.entries) {
    map.set(e.rip_code, {
      rip_code: e.rip_code,
      product_type: e.product_type,
      product_name: e.product_name,
      price_a: e.net_price,
      price_b: null,
      currency: e.currency,
    });
  }

  for (const e of b.entries) {
    const existing = map.get(e.rip_code);
    if (existing) {
      existing.price_b = e.net_price;
    } else {
      map.set(e.rip_code, {
        rip_code: e.rip_code,
        product_type: e.product_type,
        product_name: e.product_name,
        price_a: null,
        price_b: e.net_price,
        currency: e.currency,
      });
    }
  }

  return Array.from(map.values()).sort((x, y) => {
    if (x.product_type !== y.product_type) return x.product_type.localeCompare(y.product_type);
    return x.rip_code.localeCompare(y.rip_code);
  });
}

function listLabel(pl: PriceListFull, customer: Customer | undefined) {
  return `${customer?.customer_short_name ?? pl.customer_ref_sap} — ${pl.price_list_version} (${pl.effective})`;
}

export function ComparisonPanel({ initialIdA, initialIdB, onClose }: Props) {
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);

  // Side A state
  const [refA, setRefA] = useState('');
  const [listsA, setListsA] = useState<PriceListHeader[]>([]);
  const [idA, setIdA] = useState(initialIdA);
  const [dataA, setDataA] = useState<PriceListFull | null>(null);

  // Side B state
  const [refB, setRefB] = useState('');
  const [listsB, setListsB] = useState<PriceListHeader[]>([]);
  const [idB, setIdB] = useState(initialIdB);
  const [dataB, setDataB] = useState<PriceListFull | null>(null);

  // Boot: load both lists + derive customer refs
  useEffect(() => {
    async function init() {
      const [customers, a, b] = await Promise.all([
        api.getCustomers(),
        api.getPriceList(initialIdA),
        api.getPriceList(initialIdB),
      ]);
      const fa = a as PriceListFull;
      const fb = b as PriceListFull;

      setAllCustomers(customers as Customer[]);
      setDataA(fa);
      setDataB(fb);
      setRefA(fa.customer_ref_sap);
      setRefB(fb.customer_ref_sap);

      const [la, lb] = await Promise.all([
        api.getPriceLists({ customer_ref_sap: fa.customer_ref_sap }),
        api.getPriceLists({ customer_ref_sap: fb.customer_ref_sap }),
      ]);
      setListsA(la as PriceListHeader[]);
      setListsB(lb as PriceListHeader[]);
    }
    init();
  }, [initialIdA, initialIdB]);

  async function changeCustomerA(ref: string) {
    setRefA(ref);
    const lists = (await api.getPriceLists({ customer_ref_sap: ref })) as PriceListHeader[];
    setListsA(lists);
    if (lists[0]) {
      setIdA(lists[0].price_list_id);
      setDataA((await api.getPriceList(lists[0].price_list_id)) as PriceListFull);
    }
  }

  async function changeListA(id: string) {
    setIdA(id);
    setDataA((await api.getPriceList(id)) as PriceListFull);
  }

  async function changeCustomerB(ref: string) {
    setRefB(ref);
    const lists = (await api.getPriceLists({ customer_ref_sap: ref })) as PriceListHeader[];
    setListsB(lists);
    if (lists[0]) {
      setIdB(lists[0].price_list_id);
      setDataB((await api.getPriceList(lists[0].price_list_id)) as PriceListFull);
    }
  }

  async function changeListB(id: string) {
    setIdB(id);
    setDataB((await api.getPriceList(id)) as PriceListFull);
  }

  const rows = useMemo(
    () => (dataA && dataB ? buildComparison(dataA, dataB) : []),
    [dataA, dataB]
  );

  const sameCurrency =
    dataA && dataB && dataA.entries[0]?.currency === dataB.entries[0]?.currency;

  const summary = useMemo(() => {
    const inBoth = rows.filter(r => r.price_a !== null && r.price_b !== null);
    const onlyA = rows.filter(r => r.price_a !== null && r.price_b === null).length;
    const onlyB = rows.filter(r => r.price_a === null && r.price_b !== null).length;
    const changed = inBoth.filter(r => r.price_a !== r.price_b).length;
    const avgDeltaPct = sameCurrency && inBoth.length > 0
      ? inBoth
          .filter(r => r.price_a! > 0 && r.price_b !== null)
          .reduce((sum, r) => sum + ((r.price_b! - r.price_a!) / r.price_a!) * 100, 0) /
        inBoth.filter(r => r.price_a! > 0).length
      : null;
    return { inBoth: inBoth.length, onlyA, onlyB, changed, avgDeltaPct };
  }, [rows, sameCurrency]);

  const customerMap = useMemo(
    () => new Map(allCustomers.map(c => [c.customer_ref_sap, c])),
    [allCustomers]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Price List Comparison</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1">
            <X size={14} /> Close
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Selectors */}
        <div className="grid grid-cols-2 gap-6 mb-5">
          {/* Side A */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">List A</p>
            <Select value={refA} onChange={e => changeCustomerA(e.target.value)}>
              {allCustomers.map(c => (
                <option key={c.customer_ref_sap} value={c.customer_ref_sap}>
                  {c.customer_short_name}
                </option>
              ))}
            </Select>
            <Select value={idA} onChange={e => changeListA(e.target.value)}>
              {listsA.map(pl => (
                <option key={pl.price_list_id} value={pl.price_list_id}>
                  {pl.price_list_version} — {pl.effective}
                </option>
              ))}
            </Select>
          </div>
          {/* Side B */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">List B</p>
            <Select value={refB} onChange={e => changeCustomerB(e.target.value)}>
              {allCustomers.map(c => (
                <option key={c.customer_ref_sap} value={c.customer_ref_sap}>
                  {c.customer_short_name}
                </option>
              ))}
            </Select>
            <Select value={idB} onChange={e => changeListB(e.target.value)}>
              {listsB.map(pl => (
                <option key={pl.price_list_id} value={pl.price_list_id}>
                  {pl.price_list_version} — {pl.effective}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Summary bar */}
        {rows.length > 0 && (
          <div className="flex gap-6 text-sm mb-4 px-1">
            <span className="text-gray-600">
              <span className="font-semibold text-gray-900">{summary.inBoth}</span> in both
            </span>
            {summary.onlyA > 0 && (
              <span className="text-orange-600">
                <span className="font-semibold">{summary.onlyA}</span> only in A
              </span>
            )}
            {summary.onlyB > 0 && (
              <span className="text-orange-600">
                <span className="font-semibold">{summary.onlyB}</span> only in B
              </span>
            )}
            <span className={summary.changed > 0 ? 'text-gray-700' : 'text-gray-400'}>
              <span className="font-semibold">{summary.changed}</span> price changes
            </span>
            {summary.avgDeltaPct !== null && (
              <span className={summary.avgDeltaPct > 0 ? 'text-red-600' : summary.avgDeltaPct < 0 ? 'text-green-600' : 'text-gray-400'}>
                avg {summary.avgDeltaPct > 0 ? '+' : ''}{summary.avgDeltaPct.toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {/* Comparison table */}
        {dataA && dataB ? (
          <div className="border border-gray-200 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-600">Type</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-600">RIP Code</th>
                  <th className="text-left px-3 py-2.5 font-medium text-gray-600">Product</th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">
                    A — {listLabel(dataA, customerMap.get(refA))}
                  </th>
                  <th className="text-right px-3 py-2.5 font-medium text-gray-600">
                    B — {listLabel(dataB, customerMap.get(refB))}
                  </th>
                  {sameCurrency && (
                    <>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Δ</th>
                      <th className="text-right px-3 py-2.5 font-medium text-gray-600">Δ %</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => {
                  const delta = sameCurrency && row.price_a !== null && row.price_b !== null
                    ? row.price_b - row.price_a
                    : null;
                  const deltaPct = delta !== null && row.price_a! > 0
                    ? (delta / row.price_a!) * 100
                    : null;
                  const rowCls =
                    row.price_a === null || row.price_b === null
                      ? 'bg-amber-50/60'
                      : delta !== null && delta > 0
                      ? 'bg-red-50/50'
                      : delta !== null && delta < 0
                      ? 'bg-green-50/50'
                      : '';
                  return (
                    <tr key={row.rip_code} className={rowCls}>
                      <td className="px-3 py-2 text-gray-600">{row.product_type}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.rip_code}</td>
                      <td className="px-3 py-2 text-gray-900">{row.product_name}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-700">
                        {row.price_a !== null ? `${formatCurrency(row.price_a)} ${row.currency}` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-700">
                        {row.price_b !== null ? `${formatCurrency(row.price_b)} ${row.currency}` : <span className="text-gray-300">—</span>}
                      </td>
                      {sameCurrency && (
                        <>
                          <td className={`px-3 py-2 text-right font-medium ${delta === null ? 'text-gray-300' : delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {delta === null ? '—' : `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`}
                          </td>
                          <td className={`px-3 py-2 text-right font-medium ${deltaPct === null ? 'text-gray-300' : deltaPct > 0 ? 'text-red-600' : deltaPct < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {deltaPct === null ? '—' : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-gray-400">Loading comparison…</div>
        )}
      </CardContent>
    </Card>
  );
}
