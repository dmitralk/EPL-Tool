import crypto from 'crypto';

// Edit slot rules (multi-user study §5.5): one claim file per editing session in EPL-EditSlot/, written only by its owner.
// Every PC reads the same files and reaches the same answer: the holder is the active claim with the earliest claimedAt
// (the smaller slotId on a tie). A session that was taken over is ended for good, even if its claim comes back to life
// (e.g. a laptop whose OneDrive was paused kept rewriting it): the taker's claim lists it in takesOver.
// Pure functions, no Electron or file access (unit-tested in editSlot.test.ts).

export interface SlotClaim {
  format: 1;
  slotId: string;
  db: string;                    // central database file name (lower case): one folder could hold several databases
  user: string;                  // display name
  account: string | null;        // Windows account
  machine: string;               // computer name
  claimedAt: string;             // ISO UTC
  heartbeatAt: string;           // ISO UTC, rewritten by the holder every few minutes
  lastChangeAt: string | null;   // last change in the working copy (shown to people waiting)
  state: 'claiming' | 'holding';
  appVersion: string;
  takesOver?: string[];          // slotIds of the inactive sessions this one took over
}

export function newSlotId(): string {
  return crypto.randomUUID();
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// A claim counts while its heartbeat is recent; after that others may take over.
export function isActive(c: SlotClaim, nowMs: number, takeoverMs: number): boolean {
  return nowMs - ms(c.heartbeatAt) < takeoverMs;
}

export function compareClaims(a: SlotClaim, b: SlotClaim): number {
  const d = ms(a.claimedAt) - ms(b.claimedAt);
  if (d !== 0) return d;
  return a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0;
}

// The claim that took over the given session, if any.
export function takenOverBy(claims: readonly SlotClaim[], slotId: string): SlotClaim | null {
  return claims.find(c => c.slotId !== slotId && (c.takesOver ?? []).includes(slotId)) ?? null;
}

const takenOver = (claims: readonly SlotClaim[]) => new Set(claims.flatMap(c => c.takesOver ?? []));

// The active claim that holds the slot, or null when it is free.
export function holderOf(claims: readonly SlotClaim[], nowMs: number, takeoverMs: number): SlotClaim | null {
  const ended = takenOver(claims);
  const active = claims.filter(c => isActive(c, nowMs, takeoverMs) && !ended.has(c.slotId)).sort(compareClaims);
  return active[0] ?? null;
}

// The most recent inactive claim of a session that was editing (offered for take-over), if no claim is active.
export function inactiveHolderOf(claims: readonly SlotClaim[], nowMs: number, takeoverMs: number): SlotClaim | null {
  if (holderOf(claims, nowMs, takeoverMs)) return null;
  const ended = takenOver(claims);
  const inactive = claims.filter(c => c.state === 'holding' && !ended.has(c.slotId))
    .sort((a, b) => ms(b.heartbeatAt) - ms(a.heartbeatAt));
  return inactive[0] ?? null;
}

// Claims of other people that nobody will ever renew (no heartbeat for days): safe to delete.
export function isStale(c: SlotClaim, nowMs: number, cleanupMs: number): boolean {
  return nowMs - ms(c.heartbeatAt) >= cleanupMs;
}

export function isValidClaim(x: unknown): x is SlotClaim {
  const c = x as SlotClaim;
  return !!c && typeof c === 'object' && typeof c.slotId === 'string' && typeof c.claimedAt === 'string' &&
    typeof c.heartbeatAt === 'string' && typeof c.db === 'string' && (c.state === 'claiming' || c.state === 'holding') &&
    (c.takesOver === undefined || (Array.isArray(c.takesOver) && c.takesOver.every(id => typeof id === 'string')));
}
