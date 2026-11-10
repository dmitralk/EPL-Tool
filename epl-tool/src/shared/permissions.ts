// Who may do what (access-rights study §3). Pure functions with no dependencies, used by the main process (enforcement),
// the screens (gating) and Help (the generated matrix), so they can never disagree.
import type { PricingMode, Role } from '../types';

export interface PermUser {
  id: number;
  role: Role;
}

export interface PermCustomer {
  pricing_mode: PricingMode;
  manager_ids: readonly number[];
  manager_names?: readonly string[];
}

export interface AccessChange {
  pricing_mode: PricingMode;
  manager_ids: readonly number[];
}

type U = PermUser | null | undefined;

export const ROLES: readonly Role[] = ['admin', 'user', 'viewer'];
export const PRICING_MODES: readonly PricingMode[] = ['open', 'pbp', 'managed'];

export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', user: 'User', viewer: 'Viewer' };

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything (the PBP team).',
  user: 'Sees everything. Works on price lists, emails and master data of customers that are Open or that they manage. ' +
    'Can create customers and automatically manages them.',
  viewer: 'Sees everything and can export to Excel and open email drafts. Cannot change anything.',
};

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  open: 'Open',
  pbp: 'Managed by PBP',
  managed: 'Managed by named users',
};

export function pricingModeLabel(c: PermCustomer): string {
  if (c.pricing_mode !== 'managed') return PRICING_MODE_LABELS[c.pricing_mode];
  return c.manager_names?.length ? `Managed by ${c.manager_names.join(', ')}` : 'Managed by named users';
}

export function isAdmin(u: U): boolean {
  return u?.role === 'admin';
}

// Admins and Users; Viewers never change anything.
export function isEditor(u: U): boolean {
  return u?.role === 'admin' || u?.role === 'user';
}

export function canView(u: U): boolean {
  return !!u;
}

export function managesCustomer(u: U, c: PermCustomer): boolean {
  return !!u && c.pricing_mode === 'managed' && c.manager_ids.includes(u.id);
}

// Price lists (create / delete), email addresses and master data of one customer: "✓ own" in the matrix.
export function canChangeCustomer(u: U, c: PermCustomer): boolean {
  if (isAdmin(u)) return true;
  return u?.role === 'user' && (c.pricing_mode === 'open' || managesCustomer(u, c));
}

export const canManagePriceLists = canChangeCustomer;
export const canEditCustomer = canChangeCustomer;

export function canHideCustomer(u: U, c: PermCustomer): boolean {
  return isAdmin(u) || (u?.role === 'user' && managesCustomer(u, c));
}

// Restore or permanently delete hidden customers.
export function canRestoreCustomer(u: U): boolean {
  return isAdmin(u);
}

export function canCreateCustomer(u: U): boolean {
  return isEditor(u);
}

// Whether the user may open the mode / managers editor of a customer (the change itself: accessChangeError).
export function canChangeCustomerAccess(u: U, c: PermCustomer): boolean {
  return isAdmin(u) || (u?.role === 'user' && managesCustomer(u, c));
}

// Standard EPL, products, packaging, currencies, units, PBP emails, logo, default FX rates.
export function canEditReferenceData(u: U): boolean {
  return isAdmin(u);
}

export function canManageUsers(u: U): boolean {
  return isAdmin(u);
}

// Back up now, restore a backup.
export function canBackup(u: U): boolean {
  return isAdmin(u);
}

// Shared database: who may click Start editing — Admins and Users (Users only change what their rights allow; v0.8,
// decided 9 Nov 2026). Viewers never edit.
export function canStartEditing(u: U): boolean {
  return isEditor(u);
}

// Conflict copies (unpublished work kept in EPL-Conflicts/, Phase D rescue tool): everybody can review them; re-applying a
// price list from one is creating it (same per-customer rule); archiving a reviewed copy is for admins.
export function canReviewConflictCopies(u: U): boolean {
  return canView(u);
}

export const canReapplyPriceLists = canManagePriceLists;

export function canArchiveConflictCopies(u: U): boolean {
  return isAdmin(u);
}

// Why the open copy of a shared database can't be changed: read mode, offline copy, or a newer app is needed.
export type WriteBlock = 'read' | 'offline' | 'update';

export function readOnlyMessage(u: U, block: WriteBlock, minVersion?: string | null): string {
  if (block === 'offline') return 'Offline copy — changes need the shared database.';
  if (block === 'update') return `Update EPL Tool${minVersion ? ` to ${minVersion}` : ''} to make changes.`;
  return canStartEditing(u)
    ? 'Read-only — click Start editing to make changes.'
    : 'Viewers can only view and export.';
}

export function canExport(u: U): boolean {
  return canView(u);
}

export function canViewActivity(u: U): boolean {
  return canView(u);
}

export function canUseSessionFxRates(u: U): boolean {
  return canView(u);
}

// Why a mode / managers change is refused, or null when allowed (study §3.3).
export function accessChangeError(u: U, c: PermCustomer, next: AccessChange): string | null {
  if (!PRICING_MODES.includes(next.pricing_mode)) return 'Unknown pricing mode.';
  if (next.pricing_mode === 'managed' && next.manager_ids.length === 0) {
    return 'A customer managed by named users needs at least one manager.';
  }
  if (isAdmin(u)) return null;
  if (u?.role !== 'user') return 'Viewers can only view and export.';
  if (!managesCustomer(u, c)) {
    return c.pricing_mode === 'open'
      ? 'Only an admin can change how an Open customer is managed.'
      : 'Only admins and the managers of this customer can change how it is managed.';
  }
  return null;
}

// Clear refusal for changing one customer (price lists, emails, master data), or null when allowed.
export function customerChangeError(u: U, c: PermCustomer, name: string): string | null {
  if (canChangeCustomer(u, c)) return null;
  if (!u) return 'You do not have access to EPL Tool.';
  if (u.role === 'viewer') return 'Viewers can only view and export.';
  if (c.pricing_mode === 'pbp') return `${name} is managed by PBP: only admins can change it.`;
  const who = c.manager_names?.length ? c.manager_names.join(', ') : 'named users';
  return `${name} is managed by ${who}: only its managers and admins can change it.`;
}

export function hideCustomerError(u: U, c: PermCustomer, name: string): string | null {
  if (canHideCustomer(u, c)) return null;
  if (u?.role === 'viewer') return 'Viewers can only view and export.';
  return `Only admins and the managers of ${name} can hide it.`;
}

// Short reason shown next to a lock icon, or null when the user may change the customer.
export function customerLockReason(u: U, c: PermCustomer): string | null {
  if (canChangeCustomer(u, c)) return null;
  if (!u) return 'No access';
  if (u.role === 'viewer') return 'View only';
  return `${pricingModeLabel(c)} — view only`;
}

// ── Permission matrix for Help, generated from the functions above ────────────────────────────────────────────────

export type MatrixCell = 'yes' | 'own' | 'managed' | 'no';

export interface MatrixRow {
  action: string;
  cells: Record<Role, MatrixCell>;
}

export const MATRIX_CELL_LABELS: Record<MatrixCell, string> = {
  yes: '✓',
  own: '✓ own',
  managed: '✓ if they manage it',
  no: '✗',
};

const SAMPLE_USER_ID = 2;
const SAMPLE: Record<'open' | 'pbp' | 'mine' | 'others', PermCustomer> = {
  open: { pricing_mode: 'open', manager_ids: [] },
  pbp: { pricing_mode: 'pbp', manager_ids: [] },
  mine: { pricing_mode: 'managed', manager_ids: [SAMPLE_USER_ID] },
  others: { pricing_mode: 'managed', manager_ids: [SAMPLE_USER_ID + 1] },
};

function byRole(cell: (u: PermUser) => MatrixCell): Record<Role, MatrixCell> {
  return {
    admin: cell({ id: SAMPLE_USER_ID, role: 'admin' }),
    user: cell({ id: SAMPLE_USER_ID, role: 'user' }),
    viewer: cell({ id: SAMPLE_USER_ID, role: 'viewer' }),
  };
}

function global(fn: (u: PermUser) => boolean): Record<Role, MatrixCell> {
  return byRole(u => (fn(u) ? 'yes' : 'no'));
}

function perCustomer(fn: (u: PermUser, c: PermCustomer) => boolean): Record<Role, MatrixCell> {
  return byRole(u => {
    if (fn(u, SAMPLE.pbp) && fn(u, SAMPLE.others)) return 'yes';
    if (fn(u, SAMPLE.open) && fn(u, SAMPLE.mine)) return 'own';
    if (fn(u, SAMPLE.mine)) return 'managed';
    return 'no';
  });
}

export const PERMISSION_MATRIX: readonly MatrixRow[] = [
  { action: 'View everything (customers, price lists, EPL, products, packaging, analysis, emails, settings)', cells: global(canView) },
  { action: 'Export price lists / EPL / packaging to Excel and open email drafts (any customer)', cells: global(canExport) },
  { action: 'Choose the database on their own PC; their own email template', cells: global(canView) },
  { action: 'Create price lists (single wizard or mass update)', cells: perCustomer(canManagePriceLists) },
  { action: 'Delete price lists', cells: perCustomer(canManagePriceLists) },
  { action: 'Change customer email addresses (customer page or Emails tab)', cells: perCustomer(canEditCustomer) },
  { action: 'Change customer master data', cells: perCustomer(canEditCustomer) },
  { action: 'Create a new customer (and become its manager)', cells: global(canCreateCustomer) },
  { action: 'Hide a customer', cells: perCustomer(canHideCustomer) },
  { action: 'Restore or permanently delete hidden customers', cells: global(canRestoreCustomer) },
  { action: 'Change the pricing mode / managers of a customer', cells: perCustomer(canChangeCustomerAccess) },
  { action: 'Standard EPL, products, packaging, currencies, units, PBP emails, logo, default FX rates', cells: global(canEditReferenceData) },
  { action: 'Try own FX rates on the Analysis screen for the current session', cells: global(canUseSessionFxRates) },
  { action: 'Back up now, restore a backup', cells: global(canBackup) },
  { action: 'Start editing the shared database (changes are then published for everybody)', cells: global(canStartEditing) },
  { action: 'Review conflict copies (unpublished work kept in EPL-Conflicts)', cells: global(canReviewConflictCopies) },
  { action: 'Re-apply price lists from a conflict copy', cells: perCustomer(canReapplyPriceLists) },
  { action: 'Archive a reviewed conflict copy', cells: global(canArchiveConflictCopies) },
  { action: 'Manage users', cells: global(canManageUsers) },
  { action: 'View the activity log', cells: global(canViewActivity) },
];
