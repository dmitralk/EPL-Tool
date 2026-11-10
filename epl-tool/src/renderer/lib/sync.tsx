import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './ipc';
import { useAuth } from './auth';
import { useBusyCount } from './busy';
import { SyncContext, useSync } from './syncState';
import { ipcErrorMessage } from './utils';
import { useToast } from '../components/ui/toast';
import type { SyncStatus } from '../../types';

// Shared database on the screens (multi-user study §5): the status pushed by the main process, new data applied when
// nothing is open, and the current screen re-rendered whenever another copy of the database was opened.

const WIZARD_ROUTE = /^\/price-lists\/create/;

type PublishOutcome = { ok: true; published: boolean; generation: number } | { ok: false; error: string; conflict?: boolean };

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { refresh: refreshAuth } = useAuth();
  const location = useLocation();
  const busyCount = useBusyCount();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const seenOpenId = useRef<number | null>(null);
  const reloadDue = useRef(false);
  const busy = busyCount > 0 || WIZARD_ROUTE.test(location.pathname);

  useEffect(() => {
    let alive = true;
    api.getSyncStatus().then((s: SyncStatus) => { if (alive) setStatus(s); });
    const off = api.onSyncStatus(s => setStatus(s));
    const onFocus = () => { void api.checkSync(); };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Another copy was opened (new data, Start / Finish editing): reload who I am, and re-render the current screen as
  // soon as no dialog or wizard is open.
  const openId = status?.openId;
  useEffect(() => {
    if (openId === undefined) return;
    if (seenOpenId.current !== null && openId !== seenOpenId.current) {
      reloadDue.current = true;
      void refreshAuth();
    }
    seenOpenId.current = openId;
    if (reloadDue.current && !busy) {
      reloadDue.current = false;
      setDataVersion(v => v + 1);
    }
  }, [openId, busy, refreshAuth]);

  // Newer data downloaded: applied at once when nothing is open (decided 9 Nov 2026), otherwise the banner offers Refresh.
  const pendingKey = status?.phase === 'read' && status.pendingUpdate
    ? `${status.pendingUpdate.generation}|${status.pendingUpdate.publishedAt}` : null;
  useEffect(() => {
    if (pendingKey && !busy) void api.applySyncUpdate();
  }, [pendingKey, busy]);

  // An open dialog or wizard keeps the edit slot (no release after the idle time while something is open).
  useEffect(() => {
    void api.setSyncBusy(busy);
  }, [busy]);

  const value = useMemo(() => ({ status, busy, dataVersion, setStatus }), [status, busy, dataVersion]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

// ── Texts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// "10:45" today, "5 Nov 10:45" otherwise.
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${time}`;
}

const firstName = (name: string | null | undefined) => (name ?? '').split(' ')[0];

// "data of 5 Nov 10:45 (Anna)": when the open copy was published and by whom (file date before the first publish).
export function dataLabel(s: SyncStatus): string {
  const d = s.data;
  if (!d) return '';
  const when = formatWhen(d.publishedAt ?? d.fileTime ?? d.copiedAt);
  return `data of ${when}${d.publishedBy ? ` (${firstName(d.publishedBy)})` : ''}`;
}

export interface StatusLine {
  text: string;
  detail: string;
  tone: 'gray' | 'green' | 'blue' | 'amber' | 'red';
}

export function statusLine(s: SyncStatus): StatusLine {
  if (s.mode === 'local') return { text: 'Local database', detail: `${s.path ?? ''} — opened directly, not shared.`, tone: 'gray' };
  if (s.mode !== 'shared') return { text: 'No database', detail: '', tone: 'gray' };
  if (s.phase === 'connecting') return { text: 'Connecting…', detail: s.path ?? '', tone: 'gray' };
  const published = s.data?.publishedBy ? ` Published by ${s.data.publishedBy}${s.data.publishedAt ? ` at ${formatWhen(s.data.publishedAt)}` : ''}.` : '';
  if (s.phase === 'edit' && s.edit) {
    const e = s.edit;
    if (e.publishing) return { text: 'Editing · publishing…', detail: 'Publishing your changes to the shared folder.', tone: 'blue' };
    if (e.error) return { text: 'Editing · not published', detail: e.error, tone: 'amber' };
    if (e.dirty) {
      return { text: 'Editing · changes to publish', tone: 'blue',
        detail: 'Your changes are saved on this PC and published automatically about a minute after your last change.' };
    }
    return { text: e.lastPublishedAt ? `Editing · published ${formatWhen(e.lastPublishedAt)}` : 'Editing', tone: 'blue',
      detail: 'You are editing the shared database. Click Finish editing when you are done.' };
  }
  const when = formatWhen(s.data?.publishedAt ?? s.data?.fileTime ?? s.data?.copiedAt);
  if (s.offline) return { text: `Offline copy · ${when}`, detail: `${s.offline.reason} You are working on your last copy (read-only).`, tone: 'amber' };
  if (s.centralDamaged) return { text: `Last good copy · ${when}`, detail: s.error ?? '', tone: 'red' };
  if (s.syncing) {
    return { text: 'Read-only · newer data syncing…', tone: 'gray',
      detail: `${s.syncing.publishedBy ?? 'Someone'} published newer data; it is still syncing to this PC.` };
  }
  return { text: `Read-only · ${dataLabel(s)}`, detail: `Your copy of ${s.path ?? 'the shared database'}.${published}`, tone: 'green' };
}

// ── Actions ───────────────────────────────────────────────────────────────────────────────────────────────────────

// "Anna is editing" while someone else holds the edit slot (read mode), with the details for the tooltip.
export function editorLine(s: SyncStatus): { text: string; detail: string } | null {
  const h = s.slot?.holder;
  if (s.mode !== 'shared' || s.phase !== 'read' || !h || h.mine) return null;
  return {
    text: `${firstName(h.user)} is editing`,
    detail: `${h.user} (${h.machine}) has been editing since ${formatWhen(h.since)}` +
      `${h.lastChangeAt ? `; last change ${formatWhen(h.lastChangeAt)}` : ''}.`,
  };
}

export function useSyncActions() {
  const { toast } = useToast();
  const { setStatus } = useSync();
  const [working, setWorking] = useState<string | null>(null);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setWorking(label);
    try {
      return await fn();
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
      return null;
    } finally {
      setWorking(null);
      setStatus(await api.getSyncStatus() as SyncStatus);
    }
  }, [toast, setStatus]);

  const report = useCallback((r: PublishOutcome | null, success?: string) => {
    if (!r) return;
    if (r.ok) {
      if (success) toast(success, 'success');
    } else if (!r.conflict) {
      toast(r.error, 'error');
    }
  }, [toast]);

  // Start editing, Resume editing and Publish now (earlier changes) go through the edit slot: useEditFlow (lib/editFlow.tsx).
  return {
    working,
    publishNow: () => run('publish', async () => {
      const r = await api.publishNow() as PublishOutcome;
      report(r, r.ok && r.published ? `Published (generation ${r.generation})` : r.ok ? 'Nothing new to publish' : undefined);
    }),
    finishEditing: () => run('finish', async () => {
      const r = await api.finishEditing() as PublishOutcome;
      report(r, 'Published — you are back in read mode');
    }),
    refresh: () => run('refresh', async () => { await api.refreshSync(); }),
    discardRecovery: () => run('discard', async () => {
      report(await api.recoverUnpublished('discard') as PublishOutcome, 'Your earlier changes were discarded');
    }),
    dismissConflict: () => run('dismiss', async () => { await api.dismissSyncConflict(); }),
    stopWaiting: () => run('stop-waiting', async () => { await api.stopWaitingForSlot(); }),
    keepEditing: () => run('keep', async () => { await api.keepEditing(); }),
    dismissReleased: () => run('dismiss-released', async () => { await api.dismissSlotReleased(); }),
  };
}
