/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase E checks (dev-plan Phase E): Force release of the edit slot and the Shared database card, on simulated PCs sharing
// one temp "central" folder (pcs.ts). The orchestrator plays PCs that OneDrive hears from late (claims, release records).
//   npm run test:main -- phase-e
import fs from 'fs';
import path from 'path';
import { getIdentity, initIdentity } from '../../src/main/auth';
import { SCHEMA_VERSION } from '../../src/main/database';
import { MIN_EDIT_APP_VERSION } from '../../src/shared/sync';
import { allowed, check, expectError, finish, run, setupTemp, sha } from './harness';
import {
  PEOPLE, Pc, centralQuery, claimsOf, conflictsOf, ls, manifestOf, prepareCentral, releasesOf, slotDirOf, spocOf, worker,
  writeClaimAs, writeReleaseAs, type Person,
} from './pcs';

const BEN_PC = { name: 'Ben Admin', account: PEOPLE.ben.account, machine: 'PC-B' };
const OLA = { name: 'Ola Other', account: 'oth-o', machine: 'PC-OLA' };
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60_000);
const noMs = (iso: string) => iso.replace(/\.\d{3}Z$/, 'Z');

async function releaseChecks(tmp: string) {
  const c = prepareCentral(tmp);
  const pcs: Pc[] = [];
  const pc = async (name: string, who: Person) => {
    const p = new Pc(name, path.join(tmp, `pc${name}`), who);
    pcs.push(p);
    await p.start();
    await p.startup();
    const r = await p.invoke('sync:connect', c.central);
    if (!r.ok) check(`${name} connects`, false, r);
    return p;
  };
  try {
    const A = await pc('A', PEOPLE.anna);
    const B = await pc('B', PEOPLE.ben);
    const U = await pc('U', PEOPLE.uma);
    const V = await pc('V', PEOPLE.vic);
    const ref = (await A.sql('SELECT customer_ref_sap AS ref FROM customers WHERE is_deleted = 0 ORDER BY id LIMIT 1'))[0].ref;
    const everybodySees = async (label: string, holder: string | null, who: Pc[] = [A, B, U, V]) => {
      const seen = [];
      for (const p of who) seen.push((await p.invoke('sync:check')).slot.holder?.user ?? null);
      check(`${label}: every PC agrees`, seen.every(x => x === holder), seen);
    };

    // ── The card: who is editing ──
    let r = await B.invoke('sync:start-editing');
    await allowed('B edits', () => B.invoke('customers:update', ref, { customer_spoc: 'Ben, released' }));
    const bClaim = claimsOf(c)[0];
    check('B (Ben) holds the edit slot', r.ok && claimsOf(c).length === 1 && bClaim.user === 'Ben Admin', { r, claims: claimsOf(c) });
    r = await U.invoke('sync:start-editing');
    await U.invoke('sync:wait-for-slot');
    await U.notices();
    let d = await A.invoke('sync:details');
    check('the card lists the session: Ben, PC-B, editing, holds the slot, not mine', d.sessions.length === 1 &&
      d.sessions[0].slotId === bClaim.slotId && d.sessions[0].user === 'Ben Admin' && d.sessions[0].machine === 'PC-B' &&
      d.sessions[0].state === 'editing' && d.sessions[0].holder && !d.sessions[0].mine && d.sessions[0].endedBy === null &&
      d.sessions[0].appVersion === MIN_EDIT_APP_VERSION && d.releases.length === 0, d);
    check('the card names the shared database and its folder', d.dbPath === c.central && d.folder === c.centralDir, d);
    const db = await B.invoke('sync:details');
    check("on Ben's PC the session is his own", db.sessions[0]?.mine === true && db.sessions[0].holder, db.sessions);
    const dv = await V.invoke('sync:details');
    check('a Viewer sees the card too', dv?.sessions.length === 1 && dv.sessions[0].user === 'Ben Admin', dv);

    // ── Who may force-release ──
    await expectError('U (user): Force release refused', () => U.invoke('sync:force-release', bClaim.slotId), /^Only admins can do this\.$/);
    await expectError('V (viewer): Force release refused', () => V.invoke('sync:force-release', bClaim.slotId), /^Only admins can do this\.$/);
    r = await B.invoke('sync:force-release', bClaim.slotId);
    check('B: not its own session (Finish editing instead)', !r.ok && /^This is your own editing session/.test(r.error), r);
    r = await A.invoke('sync:force-release', 'no-such-session');
    check('an unknown session: refused', !r.ok && r.error === 'This editing session has already ended.', r);
    check('the refusals wrote nothing', releasesOf(c).length === 0 && (await B.status()).phase === 'edit', releasesOf(c));

    // ── Anna releases Ben's active session ──
    const centralBefore = sha(c.central);
    r = await A.invoke('sync:force-release', bClaim.slotId);
    const rel = releasesOf(c);
    check("A releases Ben's session: one release record, written by Anna", r.ok && rel.length === 1 &&
      rel[0].slotId === bClaim.slotId && rel[0].kind === 'release' && rel[0].db === 'epl-database.db' && rel[0].user === 'Anna Admin' &&
      rel[0].account === PEOPLE.anna.account && rel[0].machine === 'PC-A' && rel[0].released.user === 'Ben Admin' &&
      rel[0].released.machine === 'PC-B' && ls(slotDirOf(c)).includes(`${bClaim.slotId}.release.json`), { r, rel });
    check("Ben's claim file is left alone (only its owner writes or deletes it)", claimsOf(c).some(x => x.slotId === bClaim.slotId));
    check('the release changes nothing in the shared database', sha(c.central) === centralBefore);
    const sa = await A.status();
    check('A: the slot is free at once (not offered for take-over either)', sa.slot.holder === null && sa.slot.inactive === null &&
      sa.phase === 'read', sa.slot);
    d = await A.invoke('sync:details');
    check("the card: Ben's session released by Anna, listed under the releases", d.sessions[0]?.state === 'released' &&
      d.sessions[0].endedBy === 'Anna Admin' && !d.sessions[0].holder && d.releases.length === 1 &&
      d.releases[0].user === 'Ben Admin' && d.releases[0].machine === 'PC-B' && d.releases[0].by === 'Anna Admin' &&
      d.releases[0].at === rel[0].at, d);
    r = await A.invoke('sync:force-release', bClaim.slotId);
    check('releasing it again: already ended', !r.ok && r.error === 'This editing session has already ended.', r);

    await U.invoke('sync:check');
    const nu = await U.notices();
    check('U (waiting) is told that Anna released the slot', nu.length === 1 && nu[0].kind === 'slot-free' &&
      nu[0].body === "Ben Admin's edit slot was released by Anna Admin. Click Start editing to make your changes.", nu);
    await U.invoke('sync:stop-waiting');

    let sb = await B.invoke('sync:check');
    check('B gives up at its next check: read mode, told who released the slot and when', sb.phase === 'read' &&
      /^Anna Admin released your edit slot at \d\d:\d\d\. Your unpublished changes were saved as /.test(sb.conflict?.message ?? ''),
      sb.conflict);
    check("B's unpublished change is kept in EPL-Conflicts/, nothing published", !!sb.conflict?.savedTo &&
      path.dirname(sb.conflict.savedTo) === path.join(c.centralDir, 'EPL-Conflicts') &&
      spocOf(c, ref, sb.conflict.savedTo) === 'Ben, released' && sha(c.central) === centralBefore, sb.conflict);
    check('B deletes its own claim; the release record stays', !claimsOf(c).some(x => x.slotId === bClaim.slotId) &&
      releasesOf(c).length === 1, ls(slotDirOf(c)));
    const nb = await B.notices();
    check('B gets a notification naming Anna', nb.length === 1 && nb[0].kind === 'slot-lost' &&
      /^Anna Admin released your edit slot at \d\d:\d\d\. Your unpublished changes were saved in EPL-Conflicts\.$/.test(nb[0].body), nb);
    check('the admin who released gets no notification', (await A.notices()).length === 0);
    await B.invoke('sync:dismiss-conflict');
    d = await A.invoke('sync:details');
    check("the card keeps listing the release once Ben's claim is gone", d.sessions.length === 0 && d.releases.length === 1, d);

    // Ben's laptop had OneDrive paused: its claim comes back with a fresh heartbeat. A released session never holds again.
    await writeClaimAs(c, BEN_PC, { claimedAt: new Date(bClaim.claimedAt), heartbeatAt: new Date() }, { slotId: bClaim.slotId });
    await everybodySees("Ben's released claim comes back to life", null);
    r = await A.invoke('sync:start-editing');
    check('A starts editing without waiting for Ben (and without a take-over question)', r.ok, r);

    // ── The next publish records the release in the activity log ──
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna after the release' }));
    let p = await A.invoke('sync:publish');
    const annaId = centralQuery(c, 'SELECT id FROM users WHERE account = ?', [PEOPLE.anna.account])[0]?.id;
    let log = centralQuery(c, "SELECT at, user_id, user_label, entity_type, entity_key, summary, details FROM audit_log WHERE action = 'sync.force-release'");
    check('the next publish records the release: by Anna, at the time of the release', p.ok && p.published && log.length === 1 &&
      log[0].user_id === annaId && log[0].user_label === `Anna Admin (${PEOPLE.anna.account})` && log[0].entity_type === 'edit-slot' &&
      log[0].entity_key === bClaim.slotId && log[0].summary === "Released Ben Admin's edit slot (PC-B)" && log[0].at === noMs(rel[0].at) &&
      JSON.parse(log[0].details).released?.user === 'Ben Admin', { p, log });
    const local = await A.sql("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'sync.force-release'");
    check('…the same entry in the working copy', local[0].n === 1, local);
    await allowed('A edits again', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna, second publish' }));
    p = await A.invoke('sync:publish');
    log = centralQuery(c, "SELECT entity_key FROM audit_log WHERE action = 'sync.force-release'");
    check('recorded once: the following publish does not repeat it', p.ok && p.published && log.length === 1, log);
    await A.invoke('sync:finish-editing');
    fs.rmSync(path.join(slotDirOf(c), `${bClaim.slotId}.json`), { force: true });   // Ben's PC gives up once it hears of it

    d = await V.invoke('sync:details');
    const m = manifestOf(c);
    check('the card shows the last publish (who, generation, minimum version to edit)', d.manifest?.generation === m.generation &&
      d.manifest.publishedBy === 'Anna Admin' && d.manifest.minAppVersion === MIN_EDIT_APP_VERSION &&
      d.manifest.schemaVersion === SCHEMA_VERSION, d.manifest);
    check("the card names the copy open on this PC (V's read copy)", !!d.localCopy && d.localCopy.startsWith(V.local) &&
      fs.existsSync(d.localCopy), d.localCopy);

    // ── A session without changes: released, nothing to keep ──
    const conflictsBefore = conflictsOf(c).length;
    r = await U.invoke('sync:start-editing');
    const uClaim = claimsOf(c)[0];
    const r2 = await A.invoke('sync:force-release', uClaim?.slotId);
    let su = await U.invoke('sync:check');
    check('U (no changes) released: read mode, a message, no conflict copy', r.ok && r2.ok && su.phase === 'read' &&
      /^Anna Admin released your edit slot at \d\d:\d\d\.$/.test(su.conflict?.message ?? '') && su.conflict?.savedTo === null &&
      conflictsOf(c).length === conflictsBefore, { r, r2, conflict: su.conflict });
    await U.invoke('sync:dismiss-conflict');
    await U.notices();

    // ── A PC that died a minute ago still "holds" the slot: released at once instead of waiting 15 minutes ──
    r = await B.invoke('sync:start-editing');
    await allowed('B edits', () => B.invoke('customers:update', ref, { customer_spoc: 'Ben before the crash' }));
    const bCrash = claimsOf(c).find(x => x.user === 'Ben Admin');
    await B.kill();
    r = await A.invoke('sync:start-editing');
    check('right after the crash A would have to wait for Ben', !r.ok && r.waiting?.user === 'Ben Admin', r);
    d = await A.invoke('sync:details');
    check("the card: Ben's session still active", d.sessions.find((x: any) => x.slotId === bCrash?.slotId)?.state === 'editing', d.sessions);
    r = await A.invoke('sync:force-release', bCrash?.slotId);
    check('A releases it', r.ok, r);
    r = await A.invoke('sync:start-editing');
    check('A starts editing at once (no take-over question, no 15-minute wait)', r.ok, r);
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna after the crash release' }));
    await A.invoke('sync:finish-editing');
    await B.start();
    sb = await B.startup();
    check("B restarts: its unpublished change is offered", !!sb.recovery, sb.recovery);
    p = await B.invoke('sync:recover', 'resume');
    sb = await B.status();
    check('B: Resume editing claims the slot again (its old session was released); Anna published meanwhile → the copy goes ' +
      'to EPL-Conflicts/ at once', !p.ok && p.conflict && !!p.savedTo && spocOf(c, ref, p.savedTo) === 'Ben before the crash' &&
      spocOf(c, ref) === 'Anna after the crash release' && sb.phase === 'read' && !sb.recovery, { p, phase: sb.phase });
    check("B's released claim is gone, no claim left", claimsOf(c).length === 0, claimsOf(c));
    await B.notices();
    await B.invoke('sync:dismiss-conflict');

    // ── Release records of another database in the same folder are ignored ──
    r = await U.invoke('sync:start-editing');
    const uHold = claimsOf(c)[0];
    await writeReleaseAs(c, OLA, uHold, new Date(), { db: 'other.db' });
    su = await U.invoke('sync:check');
    check('a release record of another database does not end the session', r.ok && su.phase === 'edit', su.phase);
    await U.invoke('sync:finish-editing');
    fs.rmSync(path.join(slotDirOf(c), `${uHold.slotId}.release.json`), { force: true });

    // ── Release records nobody needs any more: deleted after 7 days ──
    await writeReleaseAs(c, BEN_PC, { slotId: 'old-8', user: 'Ola Other', account: OLA.account, machine: OLA.machine }, daysAgo(8));
    await writeReleaseAs(c, BEN_PC, { slotId: 'old-6', user: 'Ola Other', account: OLA.account, machine: OLA.machine }, daysAgo(6));
    await V.invoke('sync:check');
    const left = releasesOf(c).map(x => x.slotId);
    check('8 days old: deleted at the next check; 6 days old: kept', !left.includes('old-8') && left.includes('old-6'), left);

    check('the edit slot folder holds only release records at the end (no claims, no temp files)',
      claimsOf(c).length === 0 && ls(slotDirOf(c)).every(f => f.endsWith('.release.json')), ls(slotDirOf(c)));
  } finally {
    for (const p of pcs) await p.stop();
  }
}

if (process.env.EPL_PC) {
  worker();
} else {
  run(async () => {
    const tmp = setupTemp('epl-check-e-');
    process.env.LOCALAPPDATA = path.join(tmp, 'local');
    process.env.EPL_DEV_ACCOUNT = PEOPLE.anna.account;
    process.env.EPL_DEV_EMAIL = PEOPLE.anna.email;
    initIdentity({ allowOverride: true });
    await getIdentity();
    console.log(`schema ${SCHEMA_VERSION}`);
    await releaseChecks(tmp);
    finish(tmp);
  });
}
