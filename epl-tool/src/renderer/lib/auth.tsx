import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './ipc';
import {
  canBackup, canChangeCustomer, canChangeCustomerAccess, canCreateCustomer, canEditReferenceData, canHideCustomer,
  canManageUsers, canRestoreCustomer, customerLockReason, isAdmin, isEditor, type PermCustomer,
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

export function useCan() {
  const { state } = useAuth();
  const user = state?.user ?? null;
  return useMemo(() => ({
    user,
    isAdmin: isAdmin(user),
    isEditor: isEditor(user),
    referenceData: canEditReferenceData(user),
    manageUsers: canManageUsers(user),
    backup: canBackup(user),
    restoreCustomers: canRestoreCustomer(user),
    createCustomer: canCreateCustomer(user),
    changeCustomer: (c: PermCustomer) => canChangeCustomer(user, c),
    hideCustomer: (c: PermCustomer) => canHideCustomer(user, c),
    changeAccess: (c: PermCustomer) => canChangeCustomerAccess(user, c),
    lockReason: (c: PermCustomer) => customerLockReason(user, c),
    manages: (ref: string) => !!state?.managedCustomerRefs.includes(ref),
  }), [user, state?.managedCustomerRefs]);
}
