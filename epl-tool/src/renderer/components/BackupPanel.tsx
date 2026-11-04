import { useEffect, useState } from 'react';
import { FolderOpen, DatabaseBackup, RotateCcw } from 'lucide-react';
import { api } from '../lib/ipc';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ConfirmDialog } from './ui/dialog';
import { useToast } from './ui/toast';
import type { BackupInfo, BackupListResult } from '../../types';

const PREVIEW_COUNT = 5;

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function BackupPanel({ canCreate, onRestored }: { canCreate: boolean; onRestored: () => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<BackupListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);

  async function load() {
    setData(await api.listBackups() as BackupListResult);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    setBusy(true);
    const res = await api.createBackup() as { ok: boolean; error?: string };
    setBusy(false);
    if (res.ok) toast('Backup created', 'success');
    else toast(`Backup failed: ${res.error}`, 'error');
    await load();
  }

  async function handleOpenFolder() {
    const res = await api.openBackupFolder() as { ok: boolean; error?: string };
    if (!res.ok) toast(`Could not open folder: ${res.error}`, 'error');
  }

  async function handleRestore(b: BackupInfo) {
    setBusy(true);
    const res = await api.restoreBackup(b.path) as { ok: boolean; error?: string };
    setBusy(false);
    if (res.ok) {
      toast('Database restored from backup', 'success');
      onRestored();
    } else {
      toast(`Restore failed: ${res.error}`, 'error');
      await load();
    }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!data.folder) return <p className="text-sm text-gray-400">No database selected.</p>;

  const shown = showAll ? data.backups : data.backups.slice(0, PREVIEW_COUNT);

  return (
    <div className="space-y-3">
      {data.last?.error ? (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          Last backup failed ({fmtDateTime(data.last.at)}): {data.last.error}
        </div>
      ) : data.last?.path ? (
        <p className="text-sm text-green-700">Backed up {fmtDateTime(data.last.at)}.</p>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-md border border-gray-200 font-mono break-all">
          {data.folder}
        </div>
        <Button variant="outline" size="sm" onClick={handleOpenFolder}>
          <FolderOpen size={14} className="mr-1.5" /> Open folder
        </Button>
        {canCreate && (
          <Button size="sm" onClick={handleCreate} disabled={busy}>
            <DatabaseBackup size={14} className="mr-1.5" /> Back up now
          </Button>
        )}
      </div>

      {data.backups.length === 0 ? (
        <p className="text-sm text-gray-400">No backups yet.</p>
      ) : (
        <div className="border border-gray-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {shown.map(b => (
                <tr key={b.path} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-900 whitespace-nowrap">
                    {fmtDateTime(b.created_at)}
                    {b.pre_restore && <Badge variant="secondary" className="ml-2">pre-restore</Badge>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs text-right">{fmtSize(b.size)}</td>
                  <td className="px-3 py-2 text-right w-28">
                    <Button variant="ghost" size="sm" onClick={() => setRestoreTarget(b)} disabled={busy}>
                      <RotateCcw size={13} className="mr-1" /> Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.backups.length > PREVIEW_COUNT && (
        <button className="text-xs text-blue-600 hover:underline" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `Show all ${data.backups.length} backups`}
        </button>
      )}

      <p className="text-xs text-gray-400">
        A verified backup is taken automatically each time the database is opened, in an <span className="font-mono">EPL-Backups</span> folder
        next to the database. The 20 most recent are kept.
      </p>

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => { if (restoreTarget) handleRestore(restoreTarget); }}
        title="Restore Backup"
        description={restoreTarget
          ? `Replace the current database with the backup from ${fmtDateTime(restoreTarget.created_at)}? The current database is first saved as a "pre-restore" copy in the backup folder, so this can be undone.`
          : ''}
        confirmLabel="Restore"
      />
    </div>
  );
}
