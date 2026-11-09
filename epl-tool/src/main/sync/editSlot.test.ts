import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { holderOf, inactiveHolderOf, isActive, isStale, isValidClaim, takenOverBy, type SlotClaim } from './editSlot';

const T0 = Date.parse('2026-11-09T10:00:00Z');
const MIN = 60_000;
const TAKEOVER = 15 * MIN;

function claim(slotId: string, claimedMin: number, heartbeatMin: number, state: SlotClaim['state'] = 'holding'): SlotClaim {
  return {
    format: 1, slotId, db: 'epl-database.db', user: slotId, account: slotId, machine: 'PC', state, appVersion: '0.8.0',
    claimedAt: new Date(T0 + claimedMin * MIN).toISOString(),
    heartbeatAt: new Date(T0 + heartbeatMin * MIN).toISOString(),
    lastChangeAt: null,
  };
}

describe('edit slot rules', () => {
  it('a claim is active while its heartbeat is recent', () => {
    assert.equal(isActive(claim('a', 0, 10), T0 + 24 * MIN, TAKEOVER), true);
    assert.equal(isActive(claim('a', 0, 10), T0 + 25 * MIN, TAKEOVER), false);
  });

  it('the earliest active claim holds the slot, the smaller id on a tie', () => {
    const now = T0 + 5 * MIN;
    assert.equal(holderOf([claim('b', 2, 4), claim('a', 1, 4)], now, TAKEOVER)?.slotId, 'a');
    assert.equal(holderOf([claim('b', 1, 4), claim('a', 1, 4)], now, TAKEOVER)?.slotId, 'a');
    assert.equal(holderOf([], now, TAKEOVER), null);
  });

  it('an inactive claim never holds the slot, even if it is the earliest', () => {
    const now = T0 + 30 * MIN;
    assert.equal(holderOf([claim('old', 0, 1), claim('new', 20, 29)], now, TAKEOVER)?.slotId, 'new');
    assert.equal(holderOf([claim('old', 0, 1)], now, TAKEOVER), null);
  });

  it('an inactive editing session is offered for take-over only when nobody holds the slot', () => {
    const now = T0 + 30 * MIN;
    assert.equal(inactiveHolderOf([claim('old', 0, 1)], now, TAKEOVER)?.slotId, 'old');
    assert.equal(inactiveHolderOf([claim('old', 0, 1), claim('new', 20, 29)], now, TAKEOVER), null);
    assert.equal(inactiveHolderOf([claim('gave-up', 0, 1, 'claiming')], now, TAKEOVER), null);
  });

  it('a session that was taken over never holds the slot again, even when its claim comes back to life', () => {
    const now = T0 + 40 * MIN;
    const revived = claim('laptop', 0, 39);                                   // OneDrive paused: heartbeats synced late
    const taker = { ...claim('taker', 20, 38), takesOver: ['laptop'] };
    assert.equal(holderOf([revived, taker], now, TAKEOVER)?.slotId, 'taker');
    assert.equal(takenOverBy([revived, taker], 'laptop')?.slotId, 'taker');
    assert.equal(takenOverBy([revived, taker], 'taker'), null);
    // the session that was taken over is not offered for take-over again (only the taker's own, inactive now)
    assert.equal(inactiveHolderOf([claim('laptop', 0, 1), { ...claim('taker', 20, 21), takesOver: ['laptop'] }], now, TAKEOVER)?.slotId, 'taker');
  });

  it('claims without heartbeat for days are stale', () => {
    assert.equal(isStale(claim('a', 0, 0), T0 + 7 * 24 * 60 * MIN, 7 * 24 * 60 * MIN), true);
    assert.equal(isStale(claim('a', 0, 0), T0 + 6 * 24 * 60 * MIN, 7 * 24 * 60 * MIN), false);
  });

  it('rejects files that are not claims', () => {
    assert.equal(isValidClaim(claim('a', 0, 0)), true);
    assert.equal(isValidClaim({ ...claim('a', 0, 0), takesOver: ['b'] }), true);
    assert.equal(isValidClaim({ ...claim('a', 0, 0), takesOver: 'b' }), false);
    assert.equal(isValidClaim({ slotId: 'x' }), false);
    assert.equal(isValidClaim(null), false);
  });
});
