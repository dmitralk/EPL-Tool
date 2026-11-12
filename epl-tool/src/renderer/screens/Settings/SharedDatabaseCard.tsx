import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, FileWarning, FolderOpen, HardDrive, Package, RefreshCw, Unlock } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useCan } from '../../lib/auth';
import { useSync } from '../../lib/syncState';
import { formatWhen, statusLine } from '../../lib/sync';
import { cn, ipcErrorMessage } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { useToast } from '../../components/ui/toast';
import { ConfirmDialog } from '../../components/ui/dialog';
import { CHANGE_CHECK_SECONDS, describeSeconds } from '../../../shared/sync';
import type { InstallerPick, SlotSession, SyncDetails } from '../../../types';

type Result = { ok: true } | { ok: false; error?: string; cancelled?: boolean };

const STATE: Record<SlotSession['state'], { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'outline' }> = {
  editing: { label: 'Editing', variant: 'success' },
  reserving: { label: 'Reserving', variant: 'default' },
  inactive: { label: 'Inactive', variant: 'destructive' },
  'taken-over': { label: 'Taken over', variant: 'secondary' },
  released: { label: 'Released', variant: 'secondary' },
};

const ENDED: SlotSession['state'][] = ['taken-over', 'released'];

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 text-sm">
      <div className="text-gray-500">{label}</div>
      <div className="text-gray-800 min-w-0">{children}</div>
    </div>
  );
}

function Path({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-xs text-gray-600 break-all">{children}</div>;
}

function releaseText(s: SlotSession): string {
  const when = s.state === 'inactive'
    ? `has been inactive since ${formatWhen(s.heartbeatAt)}`
    : `has been editing since ${formatWhen(s.since)}; last change ${s.lastChangeAt ? formatWhen(s.lastChangeAt) : 'none yet'}, last sign of life ${formatWhen(s.heartbeatAt)}`;
  return `${s.user} (${s.machine}) ${when}. The edit slot is free at once. Their EPL Tool stops editing as soon as the ` +
    `release reaches their PC (it checks every ${describeSeconds(CHANGE_CHECK_SECONDS)} while it is open): changes not ` +
    'published yet are kept as a conflict copy, to be reviewed in Settings → Conflict copies. Ask them first if you can.';
}

// Settings → Shared database (Phase E): who is editing, every editing session, the last publish, this PC's copy, the
// installer next to the shared database. Admins can force release a session and publish a new setup.
export function SharedDatabaseCard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const can = useCan();
  const { status } = useSync();
  const [details, setDetails] = useState<SyncDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [release, setRelease] = useState<SlotSession | null>(null);
  const [pick, setPick] = useState<InstallerPick | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetails(await api.getSyncDetails() as SyncDetails | null);
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Reloaded at every check of the shared folder (and when another copy was opened or editing started / ended).
  useEffect(() => { void load(); }, [load, status?.lastCheckAt, status?.openId, status?.phase]);

  async function act(label: string, fn: () => Promise<Result>, success?: string) {
    setWorking(label);
    try {
      const r = await fn();
      if (r.ok) {
        if (success) toast(success, 'success');
      } else if (!r.cancelled) {
        toast(r.error ?? 'Something went wrong.', 'error');
      }
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    } finally {
      setWorking(null);
      void load();
    }
  }

  async function handlePickInstaller() {
    setWorking('pick');
    try {
      const r = await api.pickInstaller() as { ok: true; pick: InstallerPick } | { ok: false; error?: string; cancelled?: boolean };
      if (r.ok) setPick(r.pick);
      else if (!r.cancelled) toast(r.error ?? 'The setup could not be read.', 'error');
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    } finally {
      setWorking(null);
    }
  }

  if (!status || status.mode !== 'shared') return null;
  const line = statusLine(status);
  const m = details?.manifest ?? null;
  const sessions = details?.sessions ?? [];
  const holder = sessions.find(s => s.holder) ?? null;
  const open = sessions.filter(s => !ENDED.includes(s.state));
  const ended = sessions.filter(s => ENDED.includes(s.state));
  const installer = details?.installer ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Database size={16} className="text-gray-400" /> Shared database</CardTitle>
          <div className="flex items-center gap-3">
            <button onClick={() => void load()} disabled={loading} title="Read the shared folder again"
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
              <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            </button>
            <Link to="/help/shared-database" className="text-xs text-blue-600 hover:underline">About the shared database</Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-gray-100">
          <Row label="Status">
            {line.text}
            {(line.tone === 'amber' || line.tone === 'red') && <div className="text-xs text-gray-500">{line.detail}</div>}
          </Row>
          <Row label="Shared database">
            <Path>{details?.dbPath ?? status.path}</Path>
          </Row>
          <Row label="Editing now">
            {holder
              ? <>
                {holder.user} ({holder.machine}){holder.mine && ' — you'} · since {formatWhen(holder.since)}
                <div className="text-xs text-gray-500">
                  Last change {holder.lastChangeAt ? formatWhen(holder.lastChangeAt) : 'none yet'} · last sign of life{' '}
                  {formatWhen(holder.heartbeatAt)}
                </div>
              </>
              : 'Nobody is editing.'}
          </Row>
          <Row label="Last publish">
            {m && m.generation > 0
              ? <>
                Generation {m.generation} · {m.publishedBy ?? 'someone'}{m.publishedAt && ` at ${formatWhen(m.publishedAt)}`}
                <div className="text-xs text-gray-500">With EPL Tool {m.appVersion}</div>
              </>
              : 'Not published with EPL Tool yet.'}
          </Row>
          <Row label="To edit">
            {m ? <>EPL Tool {m.minAppVersion} or newer</> : 'Any version (nothing published yet)'}
            {details && <div className="text-xs text-gray-500">This PC runs EPL Tool {details.appVersion}.</div>}
          </Row>
          <Row label="My copy">
            {status.phase === 'edit' ? 'Working copy (you are editing)' : status.data ? `Read copy, copied ${formatWhen(status.data.copiedAt)}` : '—'}
            {details?.localCopy && <Path>{details.localCopy}</Path>}
          </Row>
        </div>

        {/* Editing sessions in EPL-EditSlot/ */}
        <div className="mt-4">
          <div className="text-sm font-medium text-gray-700 mb-2">Editing sessions</div>
          {open.length === 0 && ended.length === 0 && (
            <p className="text-sm text-gray-500">No editing session at the moment.</p>
          )}
          {(open.length > 0 || ended.length > 0) && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-1.5 font-medium">Person</th>
                  <th className="py-1.5 font-medium">State</th>
                  <th className="py-1.5 font-medium">Since</th>
                  <th className="py-1.5 font-medium">Last change</th>
                  <th className="py-1.5 font-medium">Last sign of life</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {[...open, ...ended].map(s => (
                  <tr key={s.slotId} className={cn('border-b border-gray-100', ENDED.includes(s.state) && 'text-gray-400')}>
                    <td className="py-1.5">
                      {s.user}{s.mine && <span className="text-gray-400"> (you)</span>}
                      <div className="text-xs text-gray-400">{s.machine} · EPL Tool {s.appVersion}</div>
                    </td>
                    <td className="py-1.5">
                      <Badge variant={STATE[s.state].variant}>{STATE[s.state].label}</Badge>
                      {s.holder && s.state !== 'editing' && <span className="ml-1 text-xs text-gray-500">holds the slot</span>}
                      {s.endedBy && <div className="text-xs text-gray-400">by {s.endedBy}</div>}
                    </td>
                    <td className="py-1.5 whitespace-nowrap">{formatWhen(s.since)}</td>
                    <td className="py-1.5 whitespace-nowrap">{s.lastChangeAt ? formatWhen(s.lastChangeAt) : '—'}</td>
                    <td className="py-1.5 whitespace-nowrap">{formatWhen(s.heartbeatAt)}</td>
                    <td className="py-1.5 text-right">
                      {can.forceRelease && !s.mine && !ENDED.includes(s.state) && (
                        <Button size="sm" variant="outline" onClick={() => setRelease(s)} disabled={!!working}>
                          <Unlock size={12} className="mr-1" /> Force release
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {details && details.releases.length > 0 && (
            <div className="mt-2 text-xs text-gray-500 space-y-0.5">
              {details.releases.map(r => (
                <div key={r.slotId}>{r.by} released {r.user}'s edit slot ({r.machine}) at {formatWhen(r.at)}.</div>
              ))}
            </div>
          )}
          {can.forceRelease && open.some(s => !s.mine) && (
            <p className="text-xs text-gray-400 mt-2">
              Force release ends someone's editing session, e.g. when a dialog was left open on a PC nobody is at.{' '}
              <Link to="/help/shared-database" className="text-blue-600 hover:underline">How it works</Link>
            </p>
          )}
        </div>

        {/* Installer/ next to the shared database */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm min-w-0">
              <div className="font-medium text-gray-700 flex items-center gap-2"><Package size={14} className="text-gray-400" /> Installer</div>
              <div className="text-gray-600 mt-0.5">
                {installer
                  ? <>EPL Tool {installer.version} · published by {installer.publishedBy ?? 'someone'} at {formatWhen(installer.publishedAt)}</>
                  : 'No setup published next to the shared database yet.'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {installer && (
                <Button size="sm" variant="outline" disabled={!!working}
                  onClick={() => act('folder', () => api.openInstallerFolder() as Promise<Result>)}>
                  <FolderOpen size={12} className="mr-1" /> Open folder
                </Button>
              )}
              {can.publishInstaller && (
                <Button size="sm" variant="outline" onClick={handlePickInstaller} disabled={!!working}>
                  {working === 'publish' ? 'Copying the setup…' : 'Publish an installer…'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
          <Button size="sm" variant="outline" disabled={!!working}
            onClick={() => act('shared-folder', () => api.dbOpenFolder() as Promise<Result>)}>
            <FolderOpen size={12} className="mr-1" /> Open shared folder
          </Button>
          <Button size="sm" variant="outline" onClick={() => document.getElementById('backups')?.scrollIntoView({ behavior: 'smooth' })}>
            <HardDrive size={12} className="mr-1" /> Backups
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/settings/conflicts')}>
            <FileWarning size={12} className="mr-1" /> Conflict copies{status.conflictCount > 0 && ` (${status.conflictCount})`}
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-2">To change the database, use "Change Database" in the sidebar.</p>
      </CardContent>

      <ConfirmDialog open={!!release} onClose={() => setRelease(null)}
        title={`Force release ${release?.user ?? ''}'s edit slot?`} confirmLabel="Force release"
        description={release ? releaseText(release) : ''}
        onConfirm={() => {
          const s = release;
          if (s) void act('release', () => api.forceReleaseSlot(s.slotId) as Promise<Result>, `${s.user}'s edit slot was released`);
        }} />

      <ConfirmDialog open={!!pick} onClose={() => setPick(null)} variant="default"
        title={`Publish EPL Tool ${pick?.version ?? ''}?`} confirmLabel="Publish"
        description={pick ? `${pick.name} (${megabytes(pick.size)}) is copied to the Installer folder next to the shared database. ` +
          `${pick.current ? `Published now: EPL Tool ${pick.current}${pick.current === pick.version ? ' (the same version: its file is replaced)' : ''}. ` : ''}` +
          'Everybody with an older EPL Tool then sees "Install update".' : ''}
        onConfirm={() => {
          const p = pick;
          if (p) void act('publish', () => api.publishInstaller(p.file) as Promise<Result>, `EPL Tool ${p.version} published in the Installer folder`);
        }} />
    </Card>
  );
}
