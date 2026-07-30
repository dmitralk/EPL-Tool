import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function formatCurrency(value: number | null | undefined, currency?: string): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nextVersion(last: string | null | undefined): string {
  if (!last) return 'V1';
  const match = last.match(/V(\d+)$/i);
  if (match) return `V${parseInt(match[1]) + 1}`;
  return 'V1';
}

// Shared delta/formatting helpers used by the EPL version comparison panel and
// the Price Analysis screen so both render deltas identically.
export function fmtNum(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function absDelta(a: number | null, b: number | null): string {
  if (a === null || b === null) return '—';
  const d = b - a;
  return (d >= 0 ? '+' : '') + d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pctDelta(a: number | null, b: number | null): string {
  if (a === null || b === null || a === 0) return '—';
  const d = ((b - a) / a) * 100;
  return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
}

export function priceTypeLabel(priceType: string, discountPercent: number | null): string {
  if (priceType === 'Discount') return `${discountPercent}% disc.`;
  if (priceType === 'PrevPercent') {
    const v = discountPercent ?? 0;
    return `${v > 0 ? '+' : ''}${v}% adj.`;
  }
  if (priceType === 'PrevAbsolute') {
    const v = discountPercent ?? 0;
    return `${v > 0 ? '+' : ''}${v} adj.`;
  }
  return 'Net Price';
}
