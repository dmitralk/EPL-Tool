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
