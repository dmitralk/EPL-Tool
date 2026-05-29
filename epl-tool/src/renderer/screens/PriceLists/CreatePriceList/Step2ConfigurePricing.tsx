import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { Input, Label } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useWizard, type Override, type ProductLine } from './index';
import type { StandardEplRow } from '../../../../types';

type PriceMethod = 'Discount' | 'Net Price' | 'PrevPercent' | 'PrevAbsolute';
type RuleLevel = 'all' | 'type' | 'rip';

const METHODS: { id: PriceMethod; label: string; description: string; requiresPrev: boolean }[] = [
  { id: 'Discount',     label: '% Discount from Standard EPL',       description: 'Apply a flat discount % to the standard EPL prices',        requiresPrev: false },
  { id: 'Net Price',    label: 'Enter Net Prices Directly',           description: 'Load previous prices as a starting point or enter manually', requiresPrev: false },
  { id: 'PrevPercent',  label: '% Change from Previous List',         description: 'Increase or decrease current prices by a percentage',        requiresPrev: true  },
  { id: 'PrevAbsolute', label: 'Fixed Amount Change from Previous List', description: 'Add or subtract a fixed amount from each current price',  requiresPrev: true  },
];

export function Step2ConfigurePricing() {
  const { state, dispatch } = useWizard();
  const [eplRows, setEplRows] = useState<StandardEplRow[]>([]);
  const [discountInput, setDiscountInput] = useState(
    state.price_type === 'Discount' && state.discount_percent != null ? String(state.discount_percent) : ''
  );
  const [changeInput, setChangeInput] = useState(
    (state.price_type === 'PrevPercent' || state.price_type === 'PrevAbsolute') && state.discount_percent != null
      ? String(state.discount_percent) : ''
  );
  const [error, setError] = useState('');

  const currency   = state.customer!.currency;
  const prevEntries = state.previousEntries ?? [];
  const hasPrevious = state.previousEntries !== null && state.previousEntries !== undefined;

  useEffect(() => {
    api.getStandardEpl(currency).then(rows => setEplRows(rows as StandardEplRow[]));
  }, [currency]);

  const eplByRip = useMemo(() => new Map(eplRows.map(r => [r.rip_code, r])), [eplRows]);

  // ── Derived lists for override dropdowns ──────────────────────────────────
  const productTypes = useMemo(
    () => [...new Set(eplRows.map(r => r.product_type))].sort(),
    [eplRows]
  );
  const eplList = useMemo(
    () => [...eplRows].sort((a, b) => a.product_type.localeCompare(b.product_type) || a.rip_code.localeCompare(b.rip_code)),
    [eplRows]
  );

  const usedTypes = useMemo(() => new Set(state.typeOverrides.map(o => o.scopeValue)), [state.typeOverrides]);
  const usedRips  = useMemo(() => new Set(state.ripOverrides.map(o => o.scopeValue)),  [state.ripOverrides]);

  const baseValStr = state.price_type === 'Discount' ? discountInput : changeInput;
  const suffix     = state.price_type === 'PrevAbsolute' ? currency : '%';

  // ── Rule resolver ──────────────────────────────────────────────────────────
  function resolveRule(prev: ProductLine, baseVal: number): { value: number; level: RuleLevel } {
    const ripOvr = state.ripOverrides.find(o => o.scopeValue === prev.rip_code);
    if (ripOvr) { const v = parseFloat(ripOvr.valueStr); if (!isNaN(v)) return { value: v, level: 'rip' }; }
    const typeOvr = state.typeOverrides.find(o => o.scopeValue === prev.product_type);
    if (typeOvr) { const v = parseFloat(typeOvr.valueStr); if (!isNaN(v)) return { value: v, level: 'type' }; }
    return { value: baseVal, level: 'all' };
  }

  // ── Compute functions ──────────────────────────────────────────────────────
  function computeDiscountLines(basePct: number): ProductLine[] {
    return prevEntries.map(prev => {
      const epl  = eplByRip.get(prev.rip_code);
      const base = epl?.net_price ?? prev.net_price;
      const { value: pct } = resolveRule(prev, basePct);
      return { product_type: prev.product_type, rip_code: prev.rip_code, product_name: prev.product_name,
               net_price: Math.round(base * (1 - pct / 100) * 100) / 100, currency: prev.currency,
               unit: epl?.unit ?? prev.unit };
    });
  }
  function computeNetPriceLines(): ProductLine[] {
    return prevEntries.map(prev => { const epl = eplByRip.get(prev.rip_code); return { ...prev, unit: epl?.unit ?? prev.unit }; });
  }
  function computePrevPercentLines(basePct: number): ProductLine[] {
    return prevEntries.map(prev => {
      const { value: pct } = resolveRule(prev, basePct);
      return { ...prev, net_price: Math.round(prev.net_price * (1 + pct / 100) * 100) / 100 };
    });
  }
  function computePrevAbsoluteLines(baseAmt: number): ProductLine[] {
    return prevEntries.map(prev => {
      const { value: amt } = resolveRule(prev, baseAmt);
      return { ...prev, net_price: Math.round((prev.net_price + amt) * 100) / 100 };
    });
  }

  // ── Override management ────────────────────────────────────────────────────
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

  // ── Validation & submit ────────────────────────────────────────────────────
  function handleNext() {
    // Validate base input
    if (state.price_type === 'Discount') {
      const pct = parseFloat(discountInput);
      if (isNaN(pct) || pct < 0 || pct >= 100) { setError('Enter a valid discount between 0 and 99.99%'); return; }
      // Validate overrides
      for (const o of [...state.typeOverrides, ...state.ripOverrides]) {
        const v = parseFloat(o.valueStr);
        if (isNaN(v) || v < 0 || v >= 100) { setError('All overrides must be valid discounts between 0 and 99.99%'); return; }
      }
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: pct });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computeDiscountLines(pct) });
    } else if (state.price_type === 'PrevPercent') {
      const pct = parseFloat(changeInput);
      if (isNaN(pct)) { setError('Enter a valid percentage, e.g. 5 or -3.5'); return; }
      for (const o of [...state.typeOverrides, ...state.ripOverrides]) {
        if (isNaN(parseFloat(o.valueStr))) { setError('All overrides must have a valid numeric value'); return; }
      }
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: pct });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computePrevPercentLines(pct) });
    } else if (state.price_type === 'PrevAbsolute') {
      const amt = parseFloat(changeInput);
      if (isNaN(amt)) { setError('Enter a valid amount, e.g. 10 or -5.50'); return; }
      for (const o of [...state.typeOverrides, ...state.ripOverrides]) {
        if (isNaN(parseFloat(o.valueStr))) { setError('All overrides must have a valid numeric value'); return; }
      }
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: amt });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computePrevAbsoluteLines(amt) });
    } else {
      dispatch({ type: 'SET_FIELD', field: 'discount_percent', value: null });
      dispatch({ type: 'SET_PRODUCT_LINES', lines: computeNetPriceLines() });
    }
    dispatch({ type: 'SET_STEP', step: 3 });
  }

  // ── Preview rows ───────────────────────────────────────────────────────────
  const baseValNum = parseFloat(baseValStr) || 0;
  const showPreview = state.price_type !== 'Net Price' && baseValStr !== '' && prevEntries.length > 0;

  const previewRows = useMemo((): PreviewRow[] => {
    if (!showPreview) return [];
    return prevEntries.map(prev => {
      const epl = eplByRip.get(prev.rip_code);
      const { value, level } = resolveRule(prev, baseValNum);
      let colA: number | null;
      let colB: number;
      if (state.price_type === 'Discount') {
        const base = epl?.net_price ?? prev.net_price;
        colA = epl?.net_price ?? null;
        colB = Math.round(base * (1 - value / 100) * 100) / 100;
      } else if (state.price_type === 'PrevPercent') {
        colA = prev.net_price;
        colB = Math.round(prev.net_price * (1 + value / 100) * 100) / 100;
      } else {
        colA = prev.net_price;
        colB = Math.round((prev.net_price + value) * 100) / 100;
      }
      return { rip_code: prev.rip_code, product_name: prev.product_name, unit: epl?.unit ?? prev.unit, colA, colB, level };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, baseValStr, state.price_type, state.typeOverrides, state.ripOverrides, prevEntries, eplByRip]);

  const hasOverrides = state.typeOverrides.length > 0 || state.ripOverrides.length > 0;
  const showOverrideSections = state.price_type !== 'Net Price' && hasPrevious;

  // ── Render ─────────────────────────────────────────────────────────────────
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

          {/* Method selector */}
          <div>
            <Label>Pricing Method</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {METHODS.map(method => {
                const disabled = method.requiresPrev && !hasPrevious;
                const active   = state.price_type === method.id;
                return (
                  <button key={method.id} disabled={disabled}
                    onClick={() => { if (!disabled) { dispatch({ type: 'SET_FIELD', field: 'price_type', value: method.id }); setError(''); } }}
                    className={`py-2.5 px-4 rounded-md border text-sm font-medium transition-colors text-left ${
                      disabled ? 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
                      : active  ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                  >
                    <div>{method.label}</div>
                    <div className={`text-xs font-normal mt-0.5 ${disabled ? 'text-gray-300' : active ? 'text-blue-500' : 'text-gray-400'}`}>
                      {disabled ? 'Requires a previous price list' : method.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Base value — All Products */}
          {state.price_type === 'Discount' && (
            <div>
              <Label>Discount % — All Products</Label>
              <p className="text-xs text-gray-400 mb-1.5">Applied to every product unless overridden below</p>
              <div className="flex items-center gap-2 max-w-xs">
                <Input type="number" min={0} max={99.99} step={0.01} value={discountInput}
                  onChange={e => { setDiscountInput(e.target.value); setError(''); }} placeholder="e.g. 10" />
                <span className="text-gray-500 font-medium">%</span>
              </div>
            </div>
          )}
          {state.price_type === 'Net Price' && (
            <div className="p-3 bg-blue-50 rounded-md text-sm text-blue-700">
              {hasPrevious ? 'Previous prices are pre-loaded. You can edit each price in the next step.'
                : 'You will enter prices manually in the next step after adding products.'}
            </div>
          )}
          {state.price_type === 'PrevPercent' && (
            <div>
              <Label>Change % — All Products</Label>
              <p className="text-xs text-gray-400 mb-1.5">Positive = increase · Negative = decrease · Applied unless overridden below</p>
              <div className="flex items-center gap-2 max-w-xs">
                <Input type="number" step={0.01} value={changeInput}
                  onChange={e => { setChangeInput(e.target.value); setError(''); }} placeholder="e.g. 5 or -3.5" />
                <span className="text-gray-500 font-medium">%</span>
              </div>
            </div>
          )}
          {state.price_type === 'PrevAbsolute' && (
            <div>
              <Label>Change Amount — All Products</Label>
              <p className="text-xs text-gray-400 mb-1.5">Positive = increase · Negative = decrease · Applied unless overridden below</p>
              <div className="flex items-center gap-2 max-w-xs">
                <Input type="number" step={0.01} value={changeInput}
                  onChange={e => { setChangeInput(e.target.value); setError(''); }} placeholder="e.g. 10 or -5.50" />
                <span className="text-gray-500 font-medium">{currency}</span>
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-xs -mt-2">{error}</p>}

          {/* ── Override sections ── */}
          {showOverrideSections && (
            <div className="border-t border-gray-100 pt-4 space-y-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Granular Overrides <span className="font-normal normal-case">(optional — most specific rule wins: product &gt; type &gt; all)</span>
              </p>

              {/* Product Type overrides */}
              <OverrideSection
                title="Product Type Overrides"
                hint="Override the base value for an entire product family"
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

              {/* Product (RIP) overrides */}
              <OverrideSection
                title="Product Overrides"
                hint="Override for individual products — finest level of control"
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
          )}

          {/* Preview table */}
          {previewRows.length > 0 && (
            <PricePreviewTable
              currency={currency}
              label={buildPreviewLabel(state.price_type, baseValStr, currency)}
              colALabel={state.price_type === 'Discount' ? 'EPL Base' : 'Previous'}
              colBLabel={state.price_type === 'Discount' ? 'After disc.' : 'New price'}
              rows={previewRows}
              hasOverrides={hasOverrides}
            />
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 1 })}>← Back</Button>
            <Button onClick={handleNext}>Next →</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface OverrideSectionProps {
  title: string;
  hint: string;
  suffix: string;
  overrides: Override[];
  options: string[];      // all possible scopeValues
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
        <p className="text-xs text-gray-400 italic">None — all use the base value above.</p>
      ) : (
        <div className="space-y-1.5">
          {overrides.map((override, i) => {
            // Options available for this row: unselected ones + its own current value
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

interface PreviewRow {
  rip_code: string;
  product_name: string;
  unit: string;
  colA: number | null;
  colB: number;
  level: RuleLevel;
}

interface PricePreviewTableProps {
  currency: string;
  label: string;
  colALabel: string;
  colBLabel: string;
  rows: PreviewRow[];
  hasOverrides: boolean;
}

function PricePreviewTable({ currency, label, colALabel, colBLabel, rows, hasOverrides }: PricePreviewTableProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-700">
          Price preview — {currency} ({rows.length} products, {label})
        </div>
        {hasOverrides && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="inline-block bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">type</span>
            <span className="inline-block bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">product</span>
            <span>= override applied</span>
          </div>
        )}
      </div>
      <div className="border border-gray-200 rounded-md overflow-hidden max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">RIP</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Product</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">{colALabel}</th>
              <th className="text-right px-3 py-2 font-medium text-blue-600">{colBLabel}</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Unit</th>
              {hasOverrides && <th className="px-3 py-2 w-16" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.rip_code} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 font-mono text-gray-500">{row.rip_code}</td>
                <td className="px-3 py-1.5 text-gray-800">{row.product_name}</td>
                <td className="px-3 py-1.5 text-right text-gray-500">
                  {row.colA !== null ? row.colA.toFixed(2) : <span className="italic text-gray-300">—</span>}
                </td>
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
    </div>
  );
}

function buildPreviewLabel(priceType: string, baseValStr: string, currency: string): string {
  const val = parseFloat(baseValStr) || 0;
  if (priceType === 'Discount') return `${baseValStr}% discount`;
  if (priceType === 'PrevPercent') return `${val > 0 ? '+' : ''}${baseValStr}% change`;
  return `${val > 0 ? '+' : ''}${baseValStr} ${currency} change`;
}
