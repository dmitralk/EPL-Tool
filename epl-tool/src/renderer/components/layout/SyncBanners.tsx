import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bell, Clock, CloudOff, Download, History, Hourglass, Info, Pencil, RefreshCw, ShieldAlert, X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCan } from '../../lib/auth';
import { useSync } from '../../lib/syncState';
import { formatWhen, useSyncActions } from '../../lib/sync';
import { AUTO_PUBLISH_SECONDS, IDLE_RELEASE_MINUTES, describeSeconds } from '../../../shared/sync';
import type { SyncPublishInfo } from '../../../types';

type Tone = 'blue' | 'amber' | 'red' | 'gray';

const TONES: Record<Tone, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-900',
  amber: 'bg-amber-50 border-amber-300 text-amber-900',
  red: 'bg-red-50 border-red-300 text-red-900',
  gray: 'bg-gray-100 border-gray-200 text-gray-700',
};

function Banner({ tone, icon: Icon, children, actions }: {
  tone: Tone;
  icon: typeof AlertTriangle;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-3 px-6 py-2 border-b text-sm', TONES[tone])}>
      <Icon size={15} className="shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

function BannerButton({ onClick, disabled, children, title }: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="px-2.5 py-1 rounded border border-black/10 bg-white/70 hover:bg-white font-medium text-xs disabled:opacity-50">
      {children}
    </button>
  );
}

const by = (p: SyncPublishInfo) =>
  `${p.publishedBy ?? 'someone'}${p.publishedAt ? ` at ${formatWhen(p.publishedAt)}` : ''}`;

// Shared-database messages above every screen (multi-user study §5.3–5.7).
export function SyncBanners() {
  const { status, busy } = useSync();
  const can = useCan();
  const act = useSyncActions();
  if (!status || status.mode !== 'shared') return null;
  const working = !!act.working;
  const edit = status.edit;

  return (
    <div>
      {status.recovery && (
        <Banner tone="amber" icon={History} actions={<>
          <BannerButton onClick={() => act.recover('resume')} disabled={working}>Resume editing</BannerButton>
          <BannerButton onClick={() => act.recover('publish')} disabled={working}>Publish now</BannerButton>
          <BannerButton onClick={() => act.recover('discard')} disabled={working}>Discard</BannerButton>
        </>}>
          You have changes from {formatWhen(status.recovery.changedAt ?? status.recovery.since)} that were not published
          (EPL Tool was closed before it could publish them).
        </Banner>
      )}

      {status.conflict && (
        <Banner tone="red" icon={ShieldAlert} actions={
          <button onClick={act.dismissConflict} title="Dismiss" className="p-1 rounded hover:bg-white/60"><X size={14} /></button>
        }>
          {status.conflict.message}{' '}
          <Link to="/help/shared-database" className="underline">What now?</Link>
        </Banner>
      )}

      {edit?.centralChanged && (
        <Banner tone="red" icon={AlertTriangle} actions={
          <BannerButton onClick={act.finishEditing} disabled={working}>Finish editing</BannerButton>
        }>
          {edit.centralChanged}
        </Banner>
      )}

      {edit?.error && !edit.centralChanged && (
        <Banner tone="amber" icon={AlertTriangle} actions={
          <BannerButton onClick={act.publishNow} disabled={working || edit.publishing}>Publish now</BannerButton>
        }>
          Your changes are saved on this PC but not published yet: {edit.error} EPL Tool tries again automatically.
        </Banner>
      )}

      {edit?.releaseAt && !edit.error && !edit.centralChanged && (
        <Banner tone="amber" icon={Clock} actions={<>
          <BannerButton onClick={act.keepEditing} disabled={working}>Keep editing</BannerButton>
          <BannerButton onClick={act.finishEditing} disabled={working || edit.publishing}>Finish editing</BannerButton>
        </>}>
          No changes for almost {IDLE_RELEASE_MINUTES} minutes: at {formatWhen(edit.releaseAt)} EPL Tool publishes your changes
          and ends editing, so others can edit.
        </Banner>
      )}

      {edit && !edit.error && !edit.centralChanged && !edit.releaseAt && (
        <Banner tone="blue" icon={Pencil} actions={<>
          {edit.dirty && <BannerButton onClick={act.publishNow} disabled={working || edit.publishing}>Publish now</BannerButton>}
          <BannerButton onClick={act.finishEditing} disabled={working || edit.publishing}>Finish editing</BannerButton>
        </>}>
          You are editing the shared database. Changes are saved on this PC and published automatically{' '}
          {describeSeconds(AUTO_PUBLISH_SECONDS)} after your last change.
        </Banner>
      )}

      {status.released && (
        <Banner tone="gray" icon={Info} actions={<>
          {status.canStartEditing && <BannerButton onClick={act.startEditing} disabled={working}>Start editing</BannerButton>}
          <button onClick={act.dismissReleased} title="Dismiss" className="p-1 rounded hover:bg-white/60"><X size={14} /></button>
        </>}>
          {status.released.message}
        </Banner>
      )}

      {status.slot.waitingSince && status.slot.holder && !status.slot.holder.mine && (
        <Banner tone="gray" icon={Hourglass} actions={
          <BannerButton onClick={act.stopWaiting} disabled={working}>Stop waiting</BannerButton>
        }>
          Waiting for the edit slot: {status.slot.holder.user} has been editing since {formatWhen(status.slot.holder.since)}
          {status.slot.holder.lastChangeAt ? ` (last change ${formatWhen(status.slot.holder.lastChangeAt)})` : ''}. You'll get a
          notification when it is free.
        </Banner>
      )}

      {status.slot.waitingSince && !status.slot.holder && (
        <Banner tone="blue" icon={Bell} actions={<>
          <BannerButton onClick={act.startEditing} disabled={working || !status.canStartEditing}>Start editing</BannerButton>
          <BannerButton onClick={act.stopWaiting} disabled={working}>Stop waiting</BannerButton>
        </>}>
          The edit slot is free.
        </Banner>
      )}

      {status.phase === 'read' && status.pendingUpdate && busy && (
        <Banner tone="blue" icon={Download} actions={
          <BannerButton onClick={act.refresh} disabled={working}>Refresh</BannerButton>
        }>
          New data published by {by(status.pendingUpdate)}. Refresh when you have finished what you are doing.
        </Banner>
      )}

      {status.syncing && (
        <Banner tone="gray" icon={RefreshCw}>
          Newer data published by {by(status.syncing)} is still syncing to your computer. It appears here automatically.
        </Banner>
      )}

      {status.offline && (
        <Banner tone="amber" icon={CloudOff}>
          Offline copy of {formatWhen(status.data?.publishedAt ?? status.data?.fileTime ?? status.data?.copiedAt)} —{' '}
          {status.offline.reason} You can look things up and export; changes are not possible.
        </Banner>
      )}

      {status.newerApp && (
        <Banner tone="amber" icon={AlertTriangle}>
          This database was published by a newer version of EPL Tool. Update EPL Tool
          {status.newerApp.minAppVersion ? ` to ${status.newerApp.minAppVersion}` : ''} to make changes; you can still look
          things up and export.
        </Banner>
      )}

      {status.centralDamaged && (
        <Banner tone="red" icon={ShieldAlert}>
          {status.error}{' '}
          {can.isAdmin ? <>Restore a backup in <Link to="/settings" className="underline">Settings → Backups</Link>.</> : 'Please tell an admin.'}
        </Banner>
      )}

      {status.conflictCopies.length > 0 && (
        <Banner tone="amber" icon={AlertTriangle}>
          OneDrive created a conflict copy next to the shared database
          ({status.conflictCopies.map(f => f.split(/[\\/]/).pop()).join(', ')}). It may contain changes that were not
          published. {can.isAdmin ? 'Check it, then delete or move it.' : 'Please tell an admin.'}
        </Banner>
      )}
    </div>
  );
}
