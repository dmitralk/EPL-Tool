import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Hourglass, Loader2, UserX } from 'lucide-react';
import { api } from './ipc';
import { useAuth } from './auth';
import { useSync } from './syncState';
import { formatWhen } from './sync';
import { ipcErrorMessage } from './utils';
import { useToast } from '../components/ui/toast';
import { Dialog } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { SLOT_TAKEOVER_MINUTES } from '../../shared/sync';
import type { SlotPerson, SyncStatus } from '../../types';

// Getting the edit slot on the screens (dev-plan Phase D): Start editing, and Resume editing / Publish now for changes left by
// a previous run. One dialog follows the claim: "Reserving the edit slot…" (countdown, Cancel) → done; or someone is editing
// [Wait] [Cancel]; or an inactive session can be taken over [Take over] [Wait].

type FlowAction = { kind: 'start' } | { kind: 'recover'; action: 'resume' | 'publish' };

type View =
  | { step: 'working'; action: FlowAction }
  | { step: 'waiting'; person: SlotPerson; action: FlowAction }
  | { step: 'takeOver'; person: SlotPerson; action: FlowAction };

type Answer = {
  ok: boolean; error?: string; conflict?: boolean; published?: boolean;
  waiting?: SlotPerson; takeOver?: SlotPerson; cancelled?: boolean;
};

interface EditFlow {
  start: () => void;
  recover: (action: 'resume' | 'publish') => void;
  running: boolean;
}

const EditFlowContext = createContext<EditFlow>({ start: () => undefined, recover: () => undefined, running: false });

export function useEditFlow(): EditFlow {
  return useContext(EditFlowContext);
}

const firstName = (name: string) => name.split(' ')[0];

export function EditFlowProvider({ children }: { children: React.ReactNode }) {
  const { status, setStatus } = useSync();
  const { refresh: refreshAuth } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<View | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(async (action: FlowAction, takeOver = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setView({ step: 'working', action });
    let r: Answer;
    try {
      r = (action.kind === 'start'
        ? await api.startEditing({ takeOver })
        : await api.recoverUnpublished(action.action, { takeOver })) as Answer;
    } catch (err) {
      r = { ok: false, error: ipcErrorMessage(err) };
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
    setStatus(await api.getSyncStatus() as SyncStatus);
    if (r.waiting) return setView({ step: 'waiting', person: r.waiting, action });
    if (r.takeOver) return setView({ step: 'takeOver', person: r.takeOver, action });
    setView(null);
    if (r.cancelled) return;
    if (!r.ok) {
      if (!r.conflict) toast(r.error ?? 'Editing could not be started.', 'error');   // a refused copy shows as the red banner
      return;
    }
    await refreshAuth();
    if (action.kind === 'start') toast('You are editing. Changes are published automatically.', 'success');
    else if (action.action === 'resume') toast('You are editing again, with your earlier changes.', 'success');
    else toast('Your earlier changes were published.', 'success');
  }, [refreshAuth, setStatus, toast]);

  const value = useMemo<EditFlow>(() => ({
    start: () => { void run({ kind: 'start' }); },
    recover: action => { void run({ kind: 'recover', action }); },
    running,
  }), [run, running]);

  async function wait() {
    setView(null);
    try {
      setStatus(await api.waitForSlot() as SyncStatus);
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  // Closing while the slot is being reserved cancels the claim; later steps (fresh copy) can't be stopped, the dialog just
  // goes away and the result still arrives.
  function close() {
    if (view?.step === 'working' && status?.slot.claimingUntil) void api.cancelClaim();
    setView(null);
  }

  const recovering = view?.action.kind === 'recover';
  const title = view?.step === 'waiting' ? 'Someone is editing'
    : view?.step === 'takeOver' ? 'Take over the edit slot?'
      : !view || view.action.kind === 'start' ? 'Start editing'
        : view.action.action === 'resume' ? 'Resume editing' : 'Publish your earlier changes';

  return (
    <EditFlowContext.Provider value={value}>
      {children}
      <Dialog open={!!view} onClose={close} title={title}>
        {view?.step === 'working' && <Working claimingUntil={status?.slot.claimingUntil ?? null} onCancel={close} />}
        {view?.step === 'waiting' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <Hourglass size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-gray-700 space-y-2">
                <p>
                  <b>{view.person.user}</b> ({view.person.machine}) has been editing since {formatWhen(view.person.since)}
                  {view.person.lastChangeAt ? ` (last change ${formatWhen(view.person.lastChangeAt)})` : ''}. Only one person can
                  edit at a time.
                </p>
                <p>Wait, and EPL Tool tells you as soon as the edit slot is free — also with a Windows notification.</p>
                {recovering && <p className="text-gray-500">Your earlier changes stay on this PC meanwhile.</p>}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <HelpLink onClick={() => setView(null)} />
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={wait}>Wait</Button>
            </div>
          </div>
        )}
        {view?.step === 'takeOver' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <UserX size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-gray-700 space-y-2">
                <p>
                  <b>{view.person.user}</b>'s editing session ({view.person.machine}) has been inactive since{' '}
                  {formatWhen(view.person.heartbeatAt)}: EPL Tool on that PC has given no sign of life for more than{' '}
                  {SLOT_TAKEOVER_MINUTES} minutes (closed without finishing, or the PC is asleep).
                </p>
                <p>
                  If you take over, any changes of {firstName(view.person.user)}'s that were not published are kept as a conflict
                  copy, not lost.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <HelpLink onClick={() => setView(null)} />
              <Button variant="outline" onClick={wait}>Wait</Button>
              <Button onClick={() => { void run(view.action, true); }}>Take over</Button>
            </div>
          </div>
        )}
      </Dialog>
    </EditFlowContext.Provider>
  );
}

// "?" link to the Help topic about editing (closes the dialog).
function HelpLink({ onClick }: { onClick: () => void }) {
  return (
    <Link to="/help/editing" onClick={onClick} className="mr-auto flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600">
      <HelpCircle size={13} /> How editing works
    </Link>
  );
}

// While the claim runs: the waiting window with a countdown (Cancel), then the fresh copy.
function Working({ claimingUntil, onCancel }: { claimingUntil: string | null; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  const sawClaim = useRef(false);
  if (claimingUntil) sawClaim.current = true;
  useEffect(() => {
    if (!claimingUntil) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [claimingUntil]);

  if (claimingUntil) {
    const left = Math.max(0, Math.ceil((Date.parse(claimingUntil) - now) / 1000));
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          <Loader2 size={20} className="text-blue-600 animate-spin shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700 space-y-1">
            <p>Reserving the edit slot — making sure nobody else asked at the same moment…</p>
            <p className="text-gray-500">{left > 0 ? `About ${left} second${left === 1 ? '' : 's'} left.` : 'Almost done…'}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 text-sm text-gray-700">
      <Loader2 size={20} className="text-blue-600 animate-spin shrink-0" />
      <p>{sawClaim.current ? 'Getting a fresh copy of the shared database…' : 'Checking who is editing…'}</p>
    </div>
  );
}
