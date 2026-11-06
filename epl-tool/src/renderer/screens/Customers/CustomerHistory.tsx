import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import type { AuditListResult } from '../../../types';

export function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// The customer's entries from the activity log (visible to everybody).
export function CustomerHistory({ customerRef, reloadKey }: { customerRef: string; reloadKey?: unknown }) {
  const navigate = useNavigate();
  const [data, setData] = useState<AuditListResult | null>(null);

  useEffect(() => {
    api.listAudit({ customerRef, limit: 25 }).then(r => setData(r as AuditListResult));
  }, [customerRef, reloadKey]);

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><History size={16} className="text-gray-400" /> History</CardTitle>
          {data && data.total > 0 && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/settings/activity?customer=${encodeURIComponent(customerRef)}`)}>
              {data.total > data.entries.length ? `View all ${data.total}` : 'Open in Activity'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!data ? (
          <p className="px-4 py-6 text-sm text-gray-400">Loading…</p>
        ) : data.entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400">No recorded changes yet (changes are recorded from v0.6 on).</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {data.entries.map(e => (
                <tr key={e.id}>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap align-top w-40">{formatAuditTime(e.at)}</td>
                  <td className="px-2 py-2 text-gray-600 whitespace-nowrap align-top w-56 truncate max-w-[14rem]" title={e.user_label}>{e.user_label}</td>
                  <td className="px-4 py-2 text-gray-900">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
