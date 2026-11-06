import type Database from 'better-sqlite3';
import { getDb, isOpen, userLabel } from './database';
import { getResolvedIdentity } from './auth';
import type { AppUser, AuthState, Identity } from '../types';

// The person at the keyboard is looked up in the user list on every check (cheap, indexed), so changes to the list
// apply at once. An admin can "preview as" another user: checks then use that user's rights, and the activity log
// records the admin "as" that user.
let previewUserId: number | null = null;

function findUser(db: Database.Database, identity: Identity): AppUser | null {
  if (identity.account) {
    const byAccount = db.prepare('SELECT * FROM users WHERE account = ? COLLATE NOCASE').get(identity.account) as AppUser | undefined;
    if (byAccount) return byAccount;
  }
  if (identity.email) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(identity.email) as AppUser | undefined;
    if (byEmail) {
      // Added by email only: remember the Windows account at the first sign-in.
      if (!byEmail.account && identity.account) {
        db.transaction(() => {
          db.prepare('UPDATE users SET account = ? WHERE id = ?').run(identity.account, byEmail.id);
          db.prepare(`
            INSERT INTO audit_log (user_id, user_label, action, entity_type, entity_key, summary)
            VALUES (?, ?, 'user.link-account', 'user', ?, ?)
          `).run(byEmail.id, userLabel(byEmail.display_name, identity.account), String(byEmail.id),
            `${byEmail.display_name} signed in for the first time (Windows account ${identity.account} recorded)`);
        })();
        return { ...byEmail, account: identity.account };
      }
      return byEmail;
    }
  }
  return null;
}

// The real user's record (active or not), or null when no database is open or the person is not on the list.
export function getRealUser(): AppUser | null {
  const identity = getResolvedIdentity();
  if (!identity || !isOpen()) return null;
  return findUser(getDb(), identity);
}

function getUserById(id: number): AppUser | null {
  return (getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as AppUser | undefined) ?? null;
}

// The effective, active user whose rights apply (the previewed user while an admin previews), or null = no access.
export function getActor(): AppUser | null {
  const real = getRealUser();
  if (!real || !real.is_active) return null;
  if (previewUserId !== null && real.role === 'admin' && previewUserId !== real.id) {
    const previewed = getUserById(previewUserId);
    if (previewed?.is_active) return previewed;
  }
  return real;
}

export function isRealUserAdmin(): boolean {
  const real = getRealUser();
  return !!real && real.is_active === 1 && real.role === 'admin';
}

export function startPreview(userId: number): void {
  if (!isRealUserAdmin()) throw new Error('Only admins can preview another user.');
  const user = getUserById(userId);
  if (!user) throw new Error('User not found.');
  if (!user.is_active) throw new Error('Deactivated users have no access, so there is nothing to preview.');
  previewUserId = user.id;
}

export function stopPreview(): void {
  previewUserId = null;
}

// Who to record in the activity log: always the real person, plus the previewed user if any.
export function auditActor(): { userId: number | null; label: string } {
  const real = getRealUser();
  if (!real) return { userId: null, label: 'Unknown user' };
  const label = userLabel(real.display_name, real.account);
  const actor = getActor();
  return { userId: real.id, label: actor && actor.id !== real.id ? `${label} as ${actor.display_name}` : label };
}

export function managedCustomerRefs(userId: number): string[] {
  return (getDb().prepare(`
    SELECT m.customer_ref_sap FROM customer_managers m
    JOIN customers c ON c.customer_ref_sap = m.customer_ref_sap
    WHERE m.user_id = ? AND c.pricing_mode = 'managed'
  `).all(userId) as { customer_ref_sap: string }[]).map(r => r.customer_ref_sap);
}

export function activeAdmins(): { display_name: string; email: string | null }[] {
  return getDb().prepare(`
    SELECT display_name, email FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY display_name
  `).all() as { display_name: string; email: string | null }[];
}

export function getAuthState(identity: Identity): AuthState {
  if (!isOpen()) {
    previewUserId = null;
    return { identity, dbOpen: false, realUser: null, user: null, previewing: false, managedCustomerRefs: [], admins: [] };
  }
  const realUser = getRealUser();
  const user = getActor();
  return {
    identity,
    dbOpen: true,
    realUser,
    user,
    previewing: !!user && !!realUser && user.id !== realUser.id,
    managedCustomerRefs: user ? managedCustomerRefs(user.id) : [],
    admins: activeAdmins(),
  };
}
