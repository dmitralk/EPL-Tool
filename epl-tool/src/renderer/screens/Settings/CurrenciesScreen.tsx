import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/ipc';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import type { Currency } from '../../../types';

export function CurrenciesScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getCurrencies().then(list => setCurrencies(list as Currency[]));
  }, []);

  const mainCurrencies = currencies.filter(c => c.is_main === 1);
  const otherCurrencies = currencies.filter(c => c.is_main === 0);

  async function handleAdd() {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z]{2,5}$/.test(code)) {
      toast('Currency code must be 2–5 letters (e.g. GBP, CHF)', 'error');
      return;
    }
    if (currencies.some(c => c.code === code)) {
      toast(`${code} already exists`, 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await api.createCurrency(code);
      setCurrencies(prev => [...prev, created as Currency].sort((a, b) => {
        if (a.is_main !== b.is_main) return b.is_main - a.is_main;
        return a.code.localeCompare(b.code);
      }));
      setNewCode('');
      setAdding(false);
      toast(`${code} added`, 'success');
    } catch {
      toast('Failed to add currency — it may already exist', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(currency: Currency) {
    const result = await api.deleteCurrency(currency.id) as { ok: boolean; error?: string };
    if (!result.ok) {
      toast(result.error ?? 'Cannot delete currency', 'error');
      return;
    }
    setCurrencies(prev => prev.filter(c => c.id !== currency.id));
    toast(`${currency.code} removed`, 'success');
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <button
          onClick={() => navigate('/settings')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3 inline-block"
        >
          ← Settings
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Currencies</h1>
      </div>

      {/* Main currencies */}
      <Card>
        <CardHeader><CardTitle>Main Currencies</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            These currencies have full Standard EPL price reference support and are available in Mass Price Update.
          </p>
          <div className="flex gap-2 flex-wrap">
            {mainCurrencies.map(c => (
              <span
                key={c.id}
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-mono font-medium text-sm"
              >
                {c.code}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Other currencies */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Other Currencies</CardTitle>
            {!adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>+ Add Currency</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="p-3 mb-4 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
            These currencies are not linked to Standard EPL prices and cannot be used in Mass Price Update.
            They can only be assigned to individual customers for one-off price lists.
          </div>

          {otherCurrencies.length === 0 && !adding && (
            <p className="text-sm text-gray-400">No other currencies added yet.</p>
          )}

          {otherCurrencies.length > 0 && (
            <div className="space-y-2 mb-3">
              {otherCurrencies.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-1">
                  <span className="font-mono font-medium text-sm text-gray-900">{c.code}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 h-6 px-2 text-xs"
                    onClick={() => handleDelete(c)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          {adding && (
            <div className="flex gap-2 mt-2">
              <Input
                autoFocus
                placeholder="e.g. GBP"
                value={newCode}
                onChange={e => setNewCode(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAdding(false); setNewCode(''); } }}
                className="flex-1 uppercase font-mono"
                maxLength={5}
              />
              <Button size="sm" onClick={handleAdd} disabled={saving}>Add</Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNewCode(''); }}>Cancel</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
