import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './ipc';
import { useSync } from './syncState';
import {
  canBackup, canChangeCustomer, canChangeCustomerAccess, canCreateCustomer, canEditReferenceData, canForceRelease,
  canHideCustomer, canManageUsers, canPublishInstaller, canRestoreCustomer, customerLockReason, isAdmin, isEditor, readOnlyMessage, type PermCustomer,
} from '../../shared/permissions';
import type { AuthState } from '../../types';

// Mirrors the rules the main process enforces (shared/permissions.ts), so screens hide or lock what the user can't do.
interface AuthContextValue {
  state: AuthState | null;
  refresh: () => Promise<AuthState>;
  setState: (s: AuthState) => void;
}

const AuthContext = createContext<AuthContextValue>({
  state: null,
  refresh: async () => { throw new Error('AuthProvider missing'); },
  setState: () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const refresh = useCallback(async () => {
    const next = await api.getAuthState() as AuthState;
    setState(next);
    return next;
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <AuthContext.Provider value={{ state, refresh, setState }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Every change also needs a writable database: a local one, or the shared one while editing. On a read-only copy the
// change permissions are false and the lock texts give the read-only reason (the guard refuses the same way).
export function useCan() {
  const { state } = useAuth();
  const { status } = useSync();
  const user = state?.user ?? null;
  const writable = !status || status.mode !== 'shared' || status.writable;
  const readOnly = writable ? null : readOnlyMessage(user, status?.writeBlock ?? 'read', status?.newerApp?.minAppVersion);
  return useMemo(() => {
    const w = (allowed: boolean) => allowed && writable;
    return {
      user,
      writable,
      readOnly,                                   // why nothing can be changed right now, or null
      isAdmin: isAdmin(user),                     // the role (e.g. which options a dialog offers)
      isEditor: w(isEditor(user)),                // may change something now
      referenceData: w(canEditReferenceData(user)),
      manageUsers: w(canManageUsers(user)),
      backup: w(canBackup(user)),
      restoreCustomers: w(canRestoreCustomer(user)),
      // Shared folder only (EPL-EditSlot/, Installer/), so also in read mode.
      forceRelease: canForceRelease(user),
      publishInstaller: canPublishInstaller(user),
      createCustomer: w(canCreateCustomer(user)),
      changeCustomer: (c: PermCustomer) => w(canChangeCustomer(user, c)),
      hideCustomer: (c: PermCustomer) => w(canHideCustomer(user, c)),
      changeAccess: (c: PermCustomer) => w(canChangeCustomerAccess(user, c)),
      lockReason: (c: PermCustomer) => customerLockReason(user, c) ?? readOnly,
      // Lock text for an action limited by role: the read-only reason when the role would allow it.
      why: (roleAllows: boolean, roleReason: string) => (roleAllows && readOnly ? readOnly : roleReason),
      manages: (ref: string) => !!state?.managedCustomerRefs.includes(ref),
    };
  }, [user, writable, readOnly, state?.managedCustomerRefs]);
}
