import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Input, Label } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { todayISO } from '../../../lib/utils';
import { useMassWizard, computeLines, type MassPriceMethod, type Override } from './index';
import type { StandardEplRow } from '../../../../types';

type RuleLevel = 'all' | 'type' | 'rip';

interface PreviewRow {
  rip_code: string;
  product_name: string;
  unit: string;
  colA: number | null;
  colB: number;
  level: RuleLevel;
}

const METHODS: { id: MassPriceMethod; label: string; description: string }[] = [
  {
    id: 'PrevAbsolute',
    label: 'Fixed Amount Change',
    description: 'Add or subtract a fixed amount from each current price',
  },
  {
    id: 'PrevPercent',
    label: '% Change from Previous List',
    description: 'Increase or decrease current prices by a percentage',
  },
  {
    id: 'Discount',
    label: '% Discount from Standard EPL',
    description: 'Recompute prices as a percentage discount off the standard EPL',
  },
  {
    id: 'Net Price',
    label: 'Carry Forward — No Base Change',
    description: 'Keep all prices unchanged. Use granular overrides below to adjust specific products or families.',
  },
];

export function Step2ConfigureChange() {
  const { state, dispatch } = useMassWizard();
  const [eplRows, setEplRows] = useState<StandardEplRow[]>([]);
  const [valueInput, setValueInput] = useState(
    state.discount_percent != null ? String(state.discount_percent) : ''
  );
  const [effective, setEffective] = useState(state.effective || todayISO());
  const [mailingDate, setMailingDate] = useState(state.mailing_date || todayISO());
  const [comments, setComments] = useState(state.comments_about_changes);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getStandardEpl(state.currency).then(rows => setEplRows(rows as StandardEplRow[]));
  }, [state.currency]);

  const eplByRip = useMemo(() => new Map(eplRows.map(r => [r.rip_code, r])), [eplRows]);

  const productTypes = useMemo(
    () => [...new Set(eplRows.map(r => r.product_type))].sort(),
    [eplRows]
  );
  const eplList = useMemo(
    () => [...eplRows].sort((a, b) => a.product_type.localeCompare(b.product_type) || a.rip_code.localeCompare(b.rip_code)),
    [eplRows]
  );

  const usedTypes = useMemo(() => new Set(state.typeOverrides.map(o => o.scopeValue)), [state.typeOverrides]);
  const usedRips  = useMemo(() => new Set(state.ripOverrides.map(o => o.scopeValue)), [state.ripOverrides]);

  const isCarryForward = state.price_type === 'Net Price';
  const suffix = state.price_type === 'PrevAbsolute' || state.price_type === 'Net Price'
    ? state.currency
    : '%';

  const baseValStr = isCarryForward ? '0' : valueInput;

  // Override management
  function setTypeOverrides(overrides: Override[]) {
    dispatch({ type: 'SET_FIELD', field: 'typeOverrides', value: overrides });
  }
  function setRipOverrides(overrides: Override[]) {
    dispatch({ type: 'SET_FIELD', field: 'ripOverrides', value: overrides });
  }
  function addTypeOverride() {
    const first = productTypes.find(t => !usedTypes.has(t));
    if (!first) return;
    setTypeOverrides([...state.typeOverrides, { scopeValue: first, valueStr: baseValStr || '0' }]);
  }
  function addRipOverride() {
    const first = eplList.find(r => !usedRips.has(r.rip_code));
    if (!first) return;
    setRipOverrides([...state.ripOverrides, { scopeValue: first.rip_code, valueStr: baseValStr || '0' }]);
  }
  function updateTypeOverride(i: number, field: keyof Override, val: string) {
    setTypeOverrides(state.typeOverrides.map((o, idx) => idx === i ? { ...o, [field]: val } : o));
  }
  function updateRipOverride(i: number, field: keyof Override, val: string) {
    setRipOverrides(state.ripOverrides.map((o, idx) => idx === i ? { ...o, [field]: val } : o));
  }
  function removeTypeOverride(i: number) { setTypeOverrides(state.typeOverrides.filter((_, idx) => idx !== i)); }
  function removeRipOverride(i: number)  { setRipOverrides(state.ripOverrides.filter((_, idx) => idx !== i)); }

  function handleNext() {
    if (!effective) { setError('Enter an effective date'); return; }
    if (!mailingDate) { setError('Enter a mailing date'); return; }

    let baseVal = 0;
    if (!isCarryForward) {
      baseVal = parseFloat(valueInput);
      if (isNaN(baseVal)) {
        setError(state.price_type === 'Discount'
          ? 'Enter a valid discount between 0 and 99.99%'
          : 'Enter a valid numeric value');
        return;
      }
      if (state.price_type === 'Discount' && (baseVal < 0 || baseVal >= 100)) {
        setError('Discount must be between 0 and 99.99%');
        return;
      }
    }

    for (const o of [...state.typeOverrides, ...state.ripOverrides]) {
      if (isNaN(parseFloat(o.valueStr))) {
        setError('All overrides must have a valid numeric value');
        return;
      }
      if (state.price_type === 'Discount') {
        const v = parseFloat(o.valueStr);
        if (v < 0 || v >= 100) { setError('All discount overrides must be between 0 and 99.99%'); return; }
      }
    }

    dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: isCarryForward ? null : baseVal });
    dispatch({ type: 'SET_FIELD', field: 'effective', value: effective });
    dispatch({ type: 'SET_FIELD', field: 'mailing_date', value: mailingDate });
    dispatch({ type: 'SET_FIELD', field: 'comments_about_changes', value: comments });
    dispatch({ type: 'SET_STEP', step: 3 });
  }

  // Preview: show first customer's lines as a sample
  const sampleRow = state.selectedRows[0];
  const baseValNum = isCarryForward ? 0 : (parseFloat(valueInput) || 0);
  const showPreview = sampleRow && valueInput !== '' || isCarryForward;

  const previewRows = useMemo((): PreviewRow[] => {
    if (!sampleRow) return [];
    if (!isCarryForward && valueInput === '') return [];

    function resolveLevel(entry: { rip_code: string; product_type: string }): RuleLevel {
      if (state.ripOverrides.some(o => o.scopeValue === entry.rip_code && !isNaN(parseFloat(o.valueStr)))) return 'rip';
      if (state.typeOverrides.some(o => o.scopeValue === entry.product_type && !isNaN(parseFloat(o.valueStr)))) return 'type';
      return 'all';
    }

    return sampleRow.entries.map(entry => {
      const epl = eplByRip.get(entry.rip_code);
      const computed = computeLines([entry], state.price_type, baseValNum, state.typeOverrides, state.ripOverrides, eplByRip)[0];
      const colA = state.price_type === 'Discount'
        ? (epl?.net_price ?? null)
        : state.price_type === 'Net Price'
        ? null
        : entry.net_price;
      return {
        rip_code: entry.rip_code,
        product_name: entry.product_name,
        unit: epl?.unit ?? entry.unit,
        colA,
        colB: computed.net_price,
        level: resolveLevel(entry),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleRow, valueInput, isCarryForward, state.price_type, state.typeOverrides, state.ripOverrides, eplByRip, baseValNum]);

  const hasOverrides = state.typeOverrides.length > 0 || state.ripOverrides.length > 0;
  const totalProducts = state.selectedRows.reduce((s, r) => s + r.entries.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 — Configure Change</CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          {state.selectedRows.length} customer{state.selectedRows.length !== 1 ? 's' : ''} · {totalProducts} total products · {state.currency}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">

          {/* Method selector */}
          <div>
            <Label>Pricing Method</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {METHODS.map(m => {
                const active = state.price_type === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { dispatch({ type: 'SET_PRICE_TYPE', price_type: m.id }); setValueInput(''); setError(''); }}
                    className={`py-2.5 px-4 rounded-md border text-sm font-medium transition-colors text-left ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <div>{m.label}</div>
                    <div className={`text-xs font-normal mt-0.5 ${active ? 'text-blue-500' : 'text-gray-400'}`}>
                      {m.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Base value input */}
          {state.price_type === 'PrevAbsolute' && (
            <div>
              <Label>Change Amount — All Products</Label>
              <p className="text-xs text-gray-400 mb-1.5">Positive = increase · Negative = decrease · Applied unless overridden below</p>
              <div className="flex items-center gap-2 max-w-xs">
                <Input type="number" step={0.01} value={valueInput}
                  onChange={e => { setValueInput(e.target.value); setError(''); }}
                  placeholder="e.g. 25 or -10" />
                <span className="text-gray-500 font-medium">{state.currency}</span>
              </div>
            </div>
          )}
          {state.price_type === 'PrevPercent' && (
            <div>
              <Label>Change % — All Products</Label>
              <p className="text-xs text-gray-400 mb-1.5">Positive = increase · Negative = decrease · Applied unless overridden below</p>
              <div className="flex items-center gap-2 max-w-xs">
                <Input type="number" step={0.01} value={valueInput}
                  onChange={e => { setValueInput(e.target.value); setError(''); }}
                  placeholder="e.g. 5 or -3.5" />
                <span className="text-gray-500 font-medium">%</span>
              </div>
            </div>
          )}
          {state.price_type === 'Discount' && (
            <div>
              <Label>Discount % — All Products</Label>
              <p className="text-xs text-gray-400 mb-1.5">Applied to Standard EPL prices · Applied unless overridden below</p>
              <div className="flex items-center gap-2 max-w-xs">
                <Input type="number" min={0} max={99.99} step={0.01} value={valueInput}
                  onChange={e => { setValueInput(e.target.value); setError(''); }}
                  placeholder="e.g. 10" />
                <span className="text-gray-500 font-medium">%</span>
              </div>
            </div>
          )}
          {isCarryForward && (
            <div className="p-3 bg-blue-50 rounded-md text-sm text-blue-700">
              All current prices will be carried forward unchanged. Use the granular overrides below to adjust specific products or families.
            </div>
          )}

          {error && <p className="text-red-500 text-xs -mt-2">{error}</p>}

          {/* Granular overrides */}
          <div className="border-t border-gray-100 pt-4 space-y-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Granular Overrides <span className="font-normal normal-case">(optional — most specific rule wins: product &gt; type &gt; all)</span>
            </p>

            <OverrideSection
              title="Product Type Overrides"
              hint="Override for an entire product family"
              suffix={suffix}
              overrides={state.typeOverrides}
              options={productTypes}
              usedValues={usedTypes}
              getLabel={t => t}
              canAdd={productTypes.some(t => !usedTypes.has(t))}
              onAdd={addTypeOverride}
              onRemove={removeTypeOverride}
              onChangeScopeValue={(i, v) => updateTypeOverride(i, 'scopeValue', v)}
              onChangeValueStr={(i, v) => updateTypeOverride(i, 'valueStr', v)}
            />

            <OverrideSection
              title="Product Overrides"
              hint="Override for individual products"
              suffix={suffix}
              overrides={state.ripOverrides}
              options={eplList.map(r => r.rip_code)}
              usedValues={usedRips}
              getLabel={rip => { const r = eplByRip.get(rip); return r ? `${rip} — ${r.product_name}` : rip; }}
              canAdd={eplList.some(r => !usedRips.has(r.rip_code))}
              onAdd={addRipOverride}
              onRemove={removeRipOverride}
              onChangeScopeValue={(i, v) => updateRipOverride(i, 'scopeValue', v)}
              onChangeValueStr={(i, v) => updateRipOverride(i, 'valueStr', v)}
            />
          </div>

          {/* Dates & comments */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Price List Details <span className="font-normal normal-case">(applied to all created price lists)</span>
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Effective Date</Label>
                <Input type="date" value={effective} onChange={e => { setEffective(e.target.value); setError(''); }} />
              </div>
              <div>
                <Label>Mailing Date</Label>
                <Input type="date" value={mailingDate} onChange={e => { setMailingDate(e.target.value); setError(''); }} />
              </div>
            </div>
            <div className="mt-3">
              <Label>Comments (optional)</Label>
              <Input value={comments} onChange={e => setComments(e.target.value)} placeholder="e.g. Annual price adjustment" />
            </div>
          </div>

          {/* Preview table (first customer as sample) */}
          {showPreview && previewRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-700">
                  Price preview — {sampleRow.customer.customer_short_name} · {previewRows.length} products
                </div>
                {hasOverrides && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="inline-block bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">type</span>
                    <span className="inline-block bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">product</span>
                    <span>= override applied</span>
                  </div>
                )}
              </div>
              <div className="border border-gray-200 rounded-md overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">RIP</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
                      {!isCarryForward && <th className="text-right px-3 py-2 font-medium text-gray-600">Current</th>}
                      <th className="text-right px-3 py-2 font-medium text-blue-600">New Price</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Unit</th>
                      {hasOverrides && <th className="px-3 py-2 w-16" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map(row => (
                      <tr key={row.rip_code} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-mono text-gray-500">{row.rip_code}</td>
                        <td className="px-3 py-1.5 text-gray-800">{row.product_name}</td>
                        {!isCarryForward && (
                          <td className="px-3 py-1.5 text-right text-gray-500">
                            {row.colA !== null ? row.colA.toFixed(2) : <span className="italic text-gray-300">—</span>}
                          </td>
                        )}
                        <td className="px-3 py-1.5 text-right text-blue-700 font-medium">{row.colB.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-gray-500">{row.unit}</td>
                        {hasOverrides && (
                          <td className="px-3 py-1.5 text-center">
                            {row.level === 'type' && (
                              <span className="inline-block text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">type</span>
                            )}
                            {row.level === 'rip' && (
                              <span className="inline-block text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">product</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {state.selectedRows.length > 1 && (
                <p className="text-xs text-gray-400 mt-1">
                  Showing preview for {sampleRow.customer.customer_short_name} · same rules apply to all {state.selectedRows.length} customers
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 1 })}>← Back</Button>
            <Button onClick={handleNext}>Preview All →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

interface OverrideSectionProps {
  title: string;
  hint: string;
  suffix: string;
  overrides: Override[];
  options: string[];
  usedValues: Set<string>;
  getLabel: (v: string) => string;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onChangeScopeValue: (i: number, v: string) => void;
  onChangeValueStr: (i: number, v: string) => void;
}

function OverrideSection({
  title, hint, suffix, overrides, options, usedValues, getLabel,
  canAdd, onAdd, onRemove, onChangeScopeValue, onChangeValueStr,
}: OverrideSectionProps) {
  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-sm font-medium text-gray-700">{title}</span>
          <span className="text-xs text-gray-400 ml-2">{hint}</span>
        </div>
        <button
          onClick={onAdd}
          disabled={!canAdd}
          className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed whitespace-nowrap ml-4"
        >
          + Add
        </button>
      </div>
      {overrides.length === 0 ? (
        <p className="text-xs text-gray-400 italic">None — all products use the base value above.</p>
      ) : (
        <div className="space-y-1.5">
          {overrides.map((override, i) => {
            const rowOptions = options.filter(v => !usedValues.has(v) || v === override.scopeValue);
            return (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={override.scopeValue}
                  onChange={e => onChangeScopeValue(i, e.target.value)}
                  className="flex-1 min-w-0"
                >
                  {rowOptions.map(v => (
                    <option key={v} value={v}>{getLabel(v)}</option>
                  ))}
                </Select>
                <Input
                  type="number"
                  step={0.01}
                  value={override.valueStr}
                  onChange={e => onChangeValueStr(i, e.target.value)}
                  className="w-24 text-right"
                  placeholder="value"
                />
                <span className="text-sm text-gray-500 w-8 shrink-0 text-right">{suffix}</span>
                <button
                  onClick={() => onRemove(i)}
                  className="text-gray-300 hover:text-red-500 transition-colors p-1 rounded shrink-0"
                  title="Remove override"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
