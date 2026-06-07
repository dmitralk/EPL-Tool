import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import type { CombinedEplRow, StandardEplVersion } from '../../../types';

interface DiffRow {
  rip_code: string;
  product_name: string;
  product_type: string;
  usd_a: number | null;
  usd_b: number | null;
  eur_a: number | null;
  eur_b: number | null;
  status: 'changed' | 'added' | 'removed';
}

function pctDelta(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return '—';
  const d = ((b - a) / a) * 100;
  return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
}

function absDelta(a: number | null, b: number | null): string {
  if (a === null || b === null) return '—';
  const d = b - a;
  return (d >= 0 ? '+' : '') + d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  versionIdA: number;
  versionIdB: number;
  versions: StandardEplVersion[];
  onClose: () => void;
}

export function StandardEplComparisonPanel({ versionIdA, versionIdB, versions, onClose }: Props) {
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [loading, setLoading] = useState(true);

  const versionA = versions.find(v => v.version_id === versionIdA);
  const versionB = versions.find(v => v.version_id === versionIdB);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getStandardEplCombined(versionIdA),
      api.getStandardEplCombined(versionIdB),
    ]).then(([rawA, rawB]) => {
      const a = rawA as CombinedEplRow[];
      const b = rawB as CombinedEplRow[];
      const mapA = new Map(a.map(r => [r.rip_code, r]));
      const mapB = new Map(b.map(r => [r.rip_code, r]));

      const diff: DiffRow[] = [];
      const allRips = new Set([...mapA.keys(), ...mapB.keys()]);

      for (const rip of allRips) {
        const ra = mapA.get(rip);
        const rb = mapB.get(rip);
        if (ra && !rb) {
          diff.push({ rip_code: rip, product_name: ra.product_name, product_type: ra.product_type,
            usd_a: ra.usd_price, usd_b: null, eur_a: ra.eur_price, eur_b: null, status: 'removed' });
        } else if (!ra && rb) {
          diff.push({ rip_code: rip, product_name: rb.product_name, product_type: rb.product_type,
            usd_a: null, usd_b: rb.usd_price, eur_a: null, eur_b: rb.eur_price, status: 'added' });
        } else if (ra && rb) {
          const changed = ra.usd_price !== rb.usd_price || ra.eur_price !== rb.eur_price ||
            ra.usd_unit !== rb.usd_unit || ra.eur_unit !== rb.eur_unit;
          if (changed) {
            diff.push({ rip_code: rip, product_name: rb.product_name, product_type: rb.product_type,
              usd_a: ra.usd_price, usd_b: rb.usd_price, eur_a: ra.eur_price, eur_b: rb.eur_price, status: 'changed' });
          }
        }
      }
      diff.sort((a, b) => a.product_type.localeCompare(b.product_type) || a.rip_code.localeCompare(b.rip_code));
      setRows(diff);
      setLoading(false);
    });
  }, [versionIdA, versionIdB]);

  const changed = rows.filter(r => r.status === 'changed');
  const added = rows.filter(r => r.status === 'added');
  const removed = rows.filter(r => r.status === 'removed');

  function Section({ title, color, items }: { title: string; color: string; items: DiffRow[] }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-5">
        <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${color}`}>
          {title} ({items.length})
        </h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="text-left px-3 py-2 font-medium">RIP</th>
              <th className="text-left px-3 py-2 font-medium">Product</th>
              <th className="text-right px-3 py-2 font-medium">USD ({versionA?.version_name ?? 'A'})</th>
              <th className="text-right px-3 py-2 font-medium">USD ({versionB?.version_name ?? 'B'})</th>
              <th className="text-right px-3 py-2 font-medium">USD Δ</th>
              <th className="text-right px-3 py-2 font-medium">EUR ({versionA?.version_name ?? 'A'})</th>
              <th className="text-right px-3 py-2 font-medium">EUR ({versionB?.version_name ?? 'B'})</th>
              <th className="text-right px-3 py-2 font-medium">EUR Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(row => (
              <tr key={row.rip_code} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.rip_code}</td>
                <td className="px-3 py-2 text-gray-900">{row.product_name}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">{fmt(row.usd_a)}</td>
                <td className="px-3 py-2 text-right font-mono font-medium">{fmt(row.usd_b)}</td>
                <td className={`px-3 py-2 text-right font-mono text-xs ${
                  row.usd_b !== null && row.usd_a !== null && row.usd_b > row.usd_a ? 'text-red-600' :
                  row.usd_b !== null && row.usd_a !== null && row.usd_b < row.usd_a ? 'text-green-600' : 'text-gray-400'
                }`}>
                  <div>{absDelta(row.usd_a, row.usd_b)}</div>
                  <div className="opacity-60">{pctDelta(row.usd_a, row.usd_b)}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">{fmt(row.eur_a)}</td>
                <td className="px-3 py-2 text-right font-mono font-medium">{fmt(row.eur_b)}</td>
                <td className={`px-3 py-2 text-right font-mono text-xs ${
                  row.eur_b !== null && row.eur_a !== null && row.eur_b > row.eur_a ? 'text-red-600' :
                  row.eur_b !== null && row.eur_a !== null && row.eur_b < row.eur_a ? 'text-green-600' : 'text-gray-400'
                }`}>
                  <div>{absDelta(row.eur_a, row.eur_b)}</div>
                  <div className="opacity-60">{pctDelta(row.eur_a, row.eur_b)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mt-6 border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <span className="font-medium text-gray-800 text-sm">Comparing versions</span>
          <span className="ml-2 text-sm text-gray-500">
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs">{versionA?.version_name ?? versionIdA}</span>
            <span className="mx-2 text-gray-400">→</span>
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs">{versionB?.version_name ?? versionIdB}</span>
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading comparison…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No differences between these versions.</div>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-4">
              {changed.length} changed · {added.length} added · {removed.length} removed
            </p>
            <Section title="Changed" color="text-amber-600" items={changed} />
            <Section title="Added" color="text-green-700" items={added} />
            <Section title="Removed" color="text-red-600" items={removed} />
          </>
        )}
      </div>
    </div>
  );
}
