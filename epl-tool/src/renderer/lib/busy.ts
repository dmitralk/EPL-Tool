import { useEffect, useSyncExternalStore } from 'react';

// Open dialogs (and wizards, see lib/sync.tsx) mark the app as busy: new data from the shared database is then offered
// with a Refresh banner instead of being applied under the user's hands (decided 9 Nov 2026).
let count = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function useBusyWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    count++;
    notify();
    return () => {
      count--;
      notify();
    };
  }, [active]);
}

export function useBusyCount(): number {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => count,
  );
}
