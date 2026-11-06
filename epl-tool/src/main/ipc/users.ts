import type Database from 'better-sqlite3';
import { getDb } from '../database';
import { audit, diffFields } from '../audit';
import { ROLES, ROLE_LABELS } from '../../shared/permissions';
import { handle } from './guard';
import type { AppUser, Role, UserInput } from '../../types';

const DENIED = 'Only admins can manage users.';
const EMAIL_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

function clean(input: UserInput, existing?: AppUser) {
  const out: Required<Omit<UserInput, 'is_active'>> & { is_active: 0 | 1 } = {
    display_name: (input.display_name ?? existing?.display_name ?? '').trim(),
    email: input.email === undefined ? existing?.email ?? null : (input.email?.trim().toLowerCase() || null),
    account: input.account === undefined ? existing?.account ?? null : (input.account?.trim() || null),
    role: input.role ?? existing?.role ?? 'viewer',
    is_active: input.is_active === undefined ? existing?.is_active ?? 1 : (input.is_active ? 1 : 0),
  };
  if (!out.display_name) throw new Error('Name is required.');
  if (!out.email && !out.account) throw new Error('Enter the company email (or the Windows account).');
  if (out.email && !EMAIL_RE.test(out.email)) throw new Error('Invalid email address.');
  if (!ROLES.includes(out.role as Role)) throw new Error('Unknown role.');
  return out;
}

function checkUnique(db: Database.Database, u: { email: string | null; account: string | null }, exceptId = -1) {
  if (u.email && db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id <> ?').get(u.email, exceptId)) {
    throw new Error(`Another user already has the email ${u.email}.`);
  }
  if (u.account && db.prepare('SELECT 1 FROM users WHERE account = ? COLLATE NOCASE AND id <> ?').get(u.account, exceptId)) {
    throw new Error(`Another user already has the Windows account ${u.account}.`);
  }
}

export function registerUserHandlers() {
  handle('users:list', 'viewer', () => {
    return getDb().prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM customer_managers m JOIN customers c ON c.customer_ref_sap = m.customer_ref_sap
                   WHERE m.user_id = u.id AND c.pricing_mode = 'managed') AS managed_count
      FROM users u ORDER BY u.is_active DESC, u.display_name
    `).all() as (AppUser & { managed_count: number })[];
  });

  handle('users:create', 'admin', (_e, input: UserInput) => {
    const db = getDb();
    const u = clean(input ?? {});
    checkUnique(db, u);
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO users (display_name, email, account, role, is_active) VALUES (?, ?, ?, ?, ?)')
        .run(u.display_name, u.email, u.account, u.role, u.is_active);
      audit(db, { action: 'user.create', entityType: 'user', entityKey: result.lastInsertRowid as number,
        summary: `Added user ${u.display_name} (${u.email ?? u.account}) as ${ROLE_LABELS[u.role as Role]}` });
      return result.lastInsertRowid;
    })();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }, DENIED);

  handle('users:update', 'admin', (_e, id: number, input: UserInput) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as AppUser | undefined;
    if (!existing) throw new Error('User not found.');
    const u = clean(input ?? {}, existing);
    checkUnique(db, u, id);
    const losesAdmin = existing.role === 'admin' && existing.is_active === 1 && (u.role !== 'admin' || !u.is_active);
    if (losesAdmin) {
      const others = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?`).get(id) as { n: number }).n;
      if (others === 0) throw new Error('There must always be at least one active admin. Add another admin first.');
    }
    const changes = diffFields(existing as unknown as Record<string, unknown>, u, ['display_name', 'email', 'account', 'role', 'is_active']);
    if (Object.keys(changes).length) {
      db.transaction(() => {
        db.prepare('UPDATE users SET display_name = ?, email = ?, account = ?, role = ?, is_active = ? WHERE id = ?')
          .run(u.display_name, u.email, u.account, u.role, u.is_active, id);
        const what = 'is_active' in changes ? (u.is_active ? 'Reactivated' : 'Deactivated') : 'Updated';
        audit(db, { action: 'user.update', entityType: 'user', entityKey: id,
          summary: `${what} user ${u.display_name}${'role' in changes ? ` — role ${ROLE_LABELS[existing.role]} → ${ROLE_LABELS[u.role as Role]}` : ''}`,
          details: changes });
      })();
    }
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }, DENIED);
}
