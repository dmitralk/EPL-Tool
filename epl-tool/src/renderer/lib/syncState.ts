import { createContext, useContext } from 'react';
import type { SyncStatus } from '../../types';

// The shared-database status (pushed by the main process), kept apart from lib/sync.tsx so lib/auth.tsx can read it
// without an import cycle.
export interface SyncContextValue {
  status: SyncStatus | null;
  busy: boolean;                 // a dialog or wizard is open
  dataVersion: number;           // changes when the screens must reload their data
  setStatus: (status: SyncStatus) => void;
}

export const SyncContext = createContext<SyncContextValue>({
  status: null,
  busy: false,
  dataVersion: 0,
  setStatus: () => undefined,
});

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
