import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PricingMode, Role } from '../types';
import {
  PERMISSION_MATRIX, accessChangeError, canArchiveConflictCopies, canBackup, canChangeCustomer, canChangeCustomerAccess,
  canCreateCustomer, canEditReferenceData, canExport, canForceRelease, canHideCustomer, canManageUsers, canRestoreCustomer,
  canReviewConflictCopies, canStartEditing, canView, canViewActivity, customerChangeError, customerLockReason,
  hideCustomerError, isEditor, managesCustomer, pricingModeLabel, readOnlyMessage, type PermCustomer, type PermUser,
} from './permissions';

const ME = 7;
const OTHER = 8;
const user = (role: Role): PermUser => ({ id: ME, role });
const customer = (mode: PricingMode, managers: number[] = []): PermCustomer => ({ pricing_mode: mode, manager_ids: managers });

const customers = {
  open: customer('open'),
  pbp: customer('pbp'),
  mine: customer('managed', [ME]),
  shared: customer('managed', [OTHER, ME]),
  others: customer('managed', [OTHER]),
};
type Kind = keyof typeof customers;

// Expected per role and customer kind, straight from the study's matrix (§3.2).
const CHANGE: Record<Role, Kind[]> = {
  admin: ['open', 'pbp', 'mine', 'shared', 'others'],
  user: ['open', 'mine', 'shared'],
  viewer: [],
};
const HIDE: Record<Role, Kind[]> = {
  admin: ['open', 'pbp', 'mine', 'shared', 'others'],
  user: ['mine', 'shared'],
  viewer: [],
};
const ACCESS: Record<Role, Kind[]> = HIDE;

describe('per-customer rules', () => {
  for (const role of ['admin', 'user', 'viewer'] as Role[]) {
    for (const kind of Object.keys(customers) as Kind[]) {
      const c = customers[kind];
      it(`${role} × ${kind}`, () => {
        assert.equal(canChangeCustomer(user(role), c), CHANGE[role].includes(kind), 'change (price lists, emails, master data)');
        assert.equal(canHideCustomer(user(role), c), HIDE[role].includes(kind), 'hide');
        assert.equal(canChangeCustomerAccess(user(role), c), ACCESS[role].includes(kind), 'open access editor');
        assert.equal(customerChangeError(user(role), c, 'X') === null, CHANGE[role].includes(kind));
        assert.equal(hideCustomerError(user(role), c, 'X') === null, HIDE[role].includes(kind));
        assert.equal(customerLockReason(user(role), c) === null, CHANGE[role].includes(kind));
      });
    }
  }

  it('nobody without a user record can change anything', () => {
    for (const c of Object.values(customers)) {
      assert.equal(canChangeCustomer(null, c), false);
      assert.equal(canHideCustomer(undefined, c), false);
      assert.equal(canChangeCustomerAccess(null, c), false);
    }
  });

  it('managesCustomer only counts named managers of managed customers', () => {
    assert.equal(managesCustomer(user('user'), customers.mine), true);
    assert.equal(managesCustomer(user('user'), customers.others), false);
    assert.equal(managesCustomer(user('user'), customer('open', [ME])), false);
  });
});

describe('global rules', () => {
  const expect: Record<string, [(u: PermUser | null) => boolean, Role[]]> = {
    view: [canView, ['admin', 'user', 'viewer']],
    export: [canExport, ['admin', 'user', 'viewer']],
    activity: [canViewActivity, ['admin', 'user', 'viewer']],
    createCustomer: [canCreateCustomer, ['admin', 'user']],
    editor: [isEditor, ['admin', 'user']],
    restore: [canRestoreCustomer, ['admin']],
    referenceData: [canEditReferenceData, ['admin']],
    users: [canManageUsers, ['admin']],
    backup: [canBackup, ['admin']],
    startEditing: [canStartEditing, ['admin', 'user']],
    reviewConflicts: [canReviewConflictCopies, ['admin', 'user', 'viewer']],
    archiveConflicts: [canArchiveConflictCopies, ['admin']],
    forceRelease: [canForceRelease, ['admin']],
  };
  for (const [name, [fn, roles]] of Object.entries(expect)) {
    it(name, () => {
      for (const role of ['admin', 'user', 'viewer'] as Role[]) assert.equal(fn(user(role)), roles.includes(role), role);
      assert.equal(fn(null), false, 'unregistered');
    });
  }
});

describe('mode / managers changes (§3.3)', () => {
  const toOpen = { pricing_mode: 'open' as const, manager_ids: [] };
  const toPbp = { pricing_mode: 'pbp' as const, manager_ids: [] };
  const coManagers = { pricing_mode: 'managed' as const, manager_ids: [ME, OTHER] };
  const noManagers = { pricing_mode: 'managed' as const, manager_ids: [] };

  it('admin can do anything valid', () => {
    for (const c of Object.values(customers)) {
      for (const next of [toOpen, toPbp, coManagers]) assert.equal(accessChangeError(user('admin'), c, next), null);
    }
  });

  it('a managed customer always keeps at least one manager', () => {
    assert.match(accessChangeError(user('admin'), customers.pbp, noManagers) ?? '', /at least one manager/);
    assert.match(accessChangeError(user('user'), customers.mine, noManagers) ?? '', /at least one manager/);
  });

  it('a manager can add co-managers, open the customer or hand it to PBP', () => {
    for (const next of [toOpen, toPbp, coManagers, { pricing_mode: 'managed' as const, manager_ids: [OTHER] }]) {
      assert.equal(accessChangeError(user('user'), customers.mine, next), null);
    }
  });

  it('a user cannot change an Open customer, nor one managed by others or PBP', () => {
    assert.match(accessChangeError(user('user'), customers.open, coManagers) ?? '', /Open customer/);
    assert.match(accessChangeError(user('user'), customers.others, toOpen) ?? '', /Only admins and the managers/);
    assert.match(accessChangeError(user('user'), customers.pbp, coManagers) ?? '', /Only admins and the managers/);
  });

  it('viewers cannot change access', () => {
    assert.notEqual(accessChangeError(user('viewer'), customers.open, toPbp), null);
  });

  it('rejects unknown modes', () => {
    assert.notEqual(accessChangeError(user('admin'), customers.open, { pricing_mode: 'x' as PricingMode, manager_ids: [] }), null);
  });
});

describe('messages and labels', () => {
  it('names the managers in refusals', () => {
    const c = { ...customers.others, manager_names: ['Ben Durand'] };
    assert.equal(customerChangeError(user('user'), c, 'ACME'), 'ACME is managed by Ben Durand: only its managers and admins can change it.');
    assert.equal(customerChangeError(user('user'), customers.pbp, 'ACME'), 'ACME is managed by PBP: only admins can change it.');
    assert.equal(customerChangeError(user('viewer'), customers.open, 'ACME'), 'Viewers can only view and export.');
    assert.equal(customerLockReason(user('user'), c), 'Managed by Ben Durand — view only');
  });

  it('labels modes', () => {
    assert.equal(pricingModeLabel(customers.open), 'Open');
    assert.equal(pricingModeLabel(customers.pbp), 'Managed by PBP');
    assert.equal(pricingModeLabel({ ...customers.shared, manager_names: ['A', 'B'] }), 'Managed by A, B');
  });

  it('explains read-only copies of the shared database', () => {
    assert.equal(readOnlyMessage(user('admin'), 'read'), 'Read-only — click Start editing to make changes.');
    assert.equal(readOnlyMessage(user('user'), 'read'), 'Read-only — click Start editing to make changes.');
    assert.equal(readOnlyMessage(user('viewer'), 'read'), 'Viewers can only view and export.');
    assert.equal(readOnlyMessage(user('admin'), 'offline'), 'Offline copy — changes need the shared database.');
    assert.equal(readOnlyMessage(user('admin'), 'update', '0.8.0'), 'Update EPL Tool to 0.8.0 to make changes.');
  });
});

describe('generated permission matrix (Help) matches the study §3.2', () => {
  const row = (start: string) => {
    const r = PERMISSION_MATRIX.find(x => x.action.startsWith(start));
    assert.ok(r, start);
    return r.cells;
  };
  const cases: [string, string, string, string][] = [
    ['View everything', 'yes', 'yes', 'yes'],
    ['Export price lists', 'yes', 'yes', 'yes'],
    ['Create price lists', 'yes', 'own', 'no'],
    ['Delete price lists', 'yes', 'own', 'no'],
    ['Change customer email', 'yes', 'own', 'no'],
    ['Change customer master data', 'yes', 'own', 'no'],
    ['Create a new customer', 'yes', 'yes', 'no'],
    ['Hide a customer', 'yes', 'managed', 'no'],
    ['Restore or permanently delete', 'yes', 'no', 'no'],
    ['Change the pricing mode', 'yes', 'managed', 'no'],
    ['Standard EPL, products', 'yes', 'no', 'no'],
    ['Try own FX rates', 'yes', 'yes', 'yes'],
    ['Back up now', 'yes', 'no', 'no'],
    ['Start editing the shared database', 'yes', 'yes', 'no'],
    ['Force release the edit slot', 'yes', 'no', 'no'],
    ['Review conflict copies', 'yes', 'yes', 'yes'],
    ['Re-apply price lists from a conflict copy', 'yes', 'own', 'no'],
    ['Archive a reviewed conflict copy', 'yes', 'no', 'no'],
    ['Manage users', 'yes', 'no', 'no'],
    ['View the activity log', 'yes', 'yes', 'yes'],
  ];
  for (const [start, admin, usr, viewer] of cases) {
    it(start, () => assert.deepEqual(row(start), { admin, user: usr, viewer }));
  }
});
