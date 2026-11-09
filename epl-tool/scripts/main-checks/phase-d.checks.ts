/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase D checks (dev-plan Phase D): the edit slot, on simulated PCs sharing one temp "central" folder (pcs.ts). The
// orchestrator plays the PCs that OneDrive hears from late: it writes and ages claim files in EPL-EditSlot/.
//   npm run test:main -- phase-d
import fs from 'fs';
import path from 'path';
import { getIdentity, initIdentity } from '../../src/main/auth';
import { SCHEMA_VERSION } from '../../src/main/database';
import { MIN_EDIT_APP_VERSION } from '../../src/shared/sync';
import { allowed, check, expectError, finish, run, setupTemp, sleep } from './harness';
import {
  PEOPLE, Pc, ageClaim, centralQuery, claimsOf, generationOf, ls, manifestOf, prepareCentral, slotDirOf, spocOf, worker,
  writeClaimAs, type Central, type Person,
} from './pcs';

const OLA = { name: 'Ola Other', account: 'oth-o', machine: 'PC-OLA' };   // someone on a PC that OneDrive hears from late
const BEN_PC = { name: 'Ben Admin', account: PEOPLE.ben.account, machine: 'PC-B' };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

const removeClaim = (c: Central, slotId: string) => fs.rmSync(path.join(slotDirOf(c), `${slotId}.json`), { force: true });

async function waitFor<T>(what: string, get: () => T | Promise<T>, ok: (x: T) => boolean, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const x = await get();
    if (ok(x) || Date.now() > until) {
      if (!ok(x)) check(`${what} (in time)`, false, x);
      return x;
    }
    await sleep(50);
  }
}

async function slotChecks(tmp: string) {
  const c = prepareCentral(tmp);
  const pcs: Pc[] = [];
  const pc = async (name: string, who: Person, env?: Record<string, string>) => {
    const p = new Pc(name, path.join(tmp, `pc${name}`), who, env);
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

    // ── Claim and hold ──
    let r = await A.invoke('sync:start-editing');
    let sa = await A.status();
    const first = claimsOf(c);
    const mine = first[0];
    check('A (Anna) gets the edit slot: one claim file in EPL-EditSlot/', r.ok && sa.phase === 'edit' && first.length === 1 &&
      ls(slotDirOf(c)).join() === `${mine?.slotId}.json`, { r, first });
    check('the claim: who, which PC, which database, holding', mine?.user === 'Anna Admin' && mine.account === PEOPLE.anna.account &&
      mine.machine === 'PC-A' && mine.db === 'epl-database.db' && mine.state === 'holding' && mine.appVersion === MIN_EDIT_APP_VERSION &&
      !mine.takesOver && Date.parse(mine.heartbeatAt) >= Date.parse(mine.claimedAt), mine);
    check('A: the status shows the slot as mine', sa.slot.holder?.mine === true && sa.slot.holder.user === 'Anna Admin' &&
      sa.slot.claimingUntil === null, sa.slot);
    let sb = await B.invoke('sync:check');
    check('B sees that Anna is editing, since when, on which PC', sb.slot.holder?.user === 'Anna Admin' && !sb.slot.holder.mine &&
      sb.slot.holder.machine === 'PC-A' && sb.slot.holder.since === mine.claimedAt, sb.slot);
    check('B (admin) may still click Start editing (the answer says who is editing)', sb.canStartEditing, sb.startEditingBlocked);
    r = await B.invoke('sync:start-editing');
    check('B has to wait: Anna holds the slot', !r.ok && r.waiting?.user === 'Anna Admin' && r.waiting.since === mine.claimedAt &&
      r.waiting.lastChangeAt === null, r);
    r = await U.invoke('sync:start-editing');
    check('U (user) has to wait too', !r.ok && r.waiting?.user === 'Anna Admin', r);
    check('waiting leaves no claim behind; B and U stay in read mode', claimsOf(c).length === 1 &&
      (await B.status()).phase === 'read' && (await U.status()).phase === 'read', claimsOf(c));
    const sv = await V.invoke('sync:check');
    check('V (viewer): sees Anna editing, Start editing not offered', sv.slot.holder?.user === 'Anna Admin' && !sv.canStartEditing &&
      sv.startEditingBlocked === 'Viewers can only view and export.', sv);
    r = await V.invoke('sync:start-editing');
    check('V: Start editing refused', !r.ok && r.error === 'Viewers can only view and export.', r);
    await expectError('V: a change is refused', () => V.invoke('customers:update', ref, { customer_spoc: 'X' }),
      /^Viewers can only view and export\.$/);

    // ── Heartbeat ──
    await sleep(20);
    sa = await A.heartbeat();
    let beat = claimsOf(c)[0];
    check('heartbeat: A rewrites its claim (same session, newer heartbeat)', sa.phase === 'edit' && beat.slotId === mine.slotId &&
      Date.parse(beat.heartbeatAt) > Date.parse(mine.heartbeatAt) && beat.lastChangeAt === null, beat);
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna 1' }));
    await A.heartbeat();
    beat = claimsOf(c)[0];
    r = await B.invoke('sync:start-editing');
    check('the claim carries the last change: shown to B while waiting', !!beat.lastChangeAt && !r.ok &&
      r.waiting?.lastChangeAt === beat.lastChangeAt, { beat, r });
    let p = await A.invoke('sync:publish');
    check('A publishes while holding the slot', p.ok && p.published && spocOf(c, ref) === 'Anna 1', p);
    const f = await A.invoke('sync:finish-editing');
    check('Finish editing: claim deleted, A back in read mode', f.ok && claimsOf(c).length === 0 && (await A.status()).phase === 'read', f);
    await everybodySees('the slot is free', null);

    // ── The waiting window: the claim counts at once and can be cancelled ──
    await B.configure({ slotWaitMs: 2000 });
    const claimingB = B.invoke('sync:start-editing');
    const pending = await waitFor('B writes its claim', () => claimsOf(c), x => x.length === 1);
    sb = await B.status();
    check('B: reserving (countdown in the status), claim written as "claiming"', !!sb.slot.claimingUntil && sb.phase === 'read' &&
      pending[0]?.state === 'claiming' && pending[0].user === 'Ben Admin', { slot: sb.slot, pending });
    r = await A.invoke('sync:start-editing');
    check('A meanwhile has to wait: a claim in its waiting window already counts', !r.ok && r.waiting?.user === 'Ben Admin', r);
    await B.invoke('sync:cancel-claim');
    r = await claimingB;
    sb = await B.status();
    check('B cancels: no slot, claim removed, still read mode', !r.ok && r.cancelled === true && claimsOf(c).length === 0 &&
      sb.phase === 'read' && !sb.slot.claimingUntil, { r, slot: sb.slot });

    // ── A competing claim that OneDrive delivers during the waiting window ──
    let claiming = B.invoke('sync:start-editing');
    let bClaim = (await waitFor('B writes its claim', () => claimsOf(c), x => x.length === 1))[0];
    const earlier = await writeClaimAs(c, OLA, { claimedAt: new Date(Date.parse(bClaim.claimedAt) - 1000), heartbeatAt: new Date() },
      { state: 'claiming' });
    r = await claiming;
    check('an earlier claim wins: B waits, its own claim removed', !r.ok && r.waiting?.user === 'Ola Other' &&
      claimsOf(c).map(x => x.slotId).join() === earlier.slotId, { r, claims: claimsOf(c) });
    removeClaim(c, earlier.slotId);                                // Ola's PC gives up (it waited for nobody)
    claiming = B.invoke('sync:start-editing');
    bClaim = (await waitFor('B writes its claim', () => claimsOf(c), x => x.length === 1))[0];
    const later = await writeClaimAs(c, OLA, { claimedAt: new Date(Date.parse(bClaim.claimedAt) + 1000), heartbeatAt: new Date() },
      { state: 'claiming' });
    r = await claiming;
    check('a later claim loses: B gets the slot', r.ok && (await B.status()).phase === 'edit', r);
    removeClaim(c, later.slotId);                                  // Ola's PC sees Ben and removes its claim
    await everybodySees('Ben holds the slot', 'Ben Admin');
    await B.invoke('sync:finish-editing');
    await B.configure({ slotWaitMs: 150 });

    // ── Two PCs claim at the same moment: exactly one gets the slot ──
    await B.configure({ slotWaitMs: 1500 });
    await U.configure({ slotWaitMs: 1500 });
    const [rb, ru] = await Promise.all([B.invoke('sync:start-editing'), U.invoke('sync:start-editing')]);
    const winner = rb.ok ? B : U;
    const winnerName = rb.ok ? 'Ben Admin' : 'Uma User';
    const lost = rb.ok ? ru : rb;
    check('two claims at once: exactly one gets the slot', rb.ok !== ru.ok, { rb, ru });
    check('the other waits, told who has it; one claim left', !lost.ok && lost.waiting?.user === winnerName &&
      claimsOf(c).length === 1 && claimsOf(c)[0].user === winnerName, { lost, claims: claimsOf(c) });
    await everybodySees('two claims at once', winnerName);
    await winner.invoke('sync:finish-editing');
    await B.configure({ slotWaitMs: 150 });
    await U.configure({ slotWaitMs: 150 });

    // ── An earlier claim delivered late beats the holder: the holder gives up at its next check ──
    await A.invoke('sync:start-editing');
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna, lost to Ola' }));
    const genLate = generationOf(c);
    const aClaim = claimsOf(c)[0];
    let ola = await writeClaimAs(c, OLA, { claimedAt: new Date(Date.parse(aClaim.claimedAt) - 5000), heartbeatAt: new Date() });
    sa = await A.invoke('sync:check');
    check('A notices at its next check: back to read mode, told who has the slot', sa.phase === 'read' &&
      /^Ola Other took over the edit slot\. Your unpublished changes were saved as /.test(sa.conflict?.message ?? ''), sa.conflict);
    check("A's unpublished change is kept in EPL-Conflicts/, nothing published", !!sa.conflict?.savedTo &&
      path.dirname(sa.conflict.savedTo) === path.join(c.centralDir, 'EPL-Conflicts') &&
      spocOf(c, ref, sa.conflict.savedTo) === 'Anna, lost to Ola' && generationOf(c) === genLate && spocOf(c, ref) === 'Anna 1', sa.conflict);
    check("A's claim deleted, Ola's stays", claimsOf(c).map(x => x.slotId).join() === ola.slotId, claimsOf(c));
    await A.invoke('sync:dismiss-conflict');
    removeClaim(c, ola.slotId);

    // ── The same at a publish: every publish first checks the slot ──
    await A.invoke('sync:start-editing');
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna, lost at publish' }));
    ola = await writeClaimAs(c, OLA, { claimedAt: new Date(Date.parse(claimsOf(c)[0].claimedAt) - 5000), heartbeatAt: new Date() });
    p = await A.invoke('sync:publish');
    sa = await A.status();
    check('Publish now finds the slot lost: nothing published, work kept', !p.ok && p.conflict && !!p.savedTo &&
      spocOf(c, ref, p.savedTo) === 'Anna, lost at publish' && generationOf(c) === genLate && sa.phase === 'read', { p, sa: sa.phase });
    await A.invoke('sync:dismiss-conflict');
    removeClaim(c, ola.slotId);

    // ── Someone took my session over (it looked inactive to them): I give up at my next check ──
    await A.invoke('sync:start-editing');
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna, taken over' }));
    const aSession = claimsOf(c)[0];
    ola = await writeClaimAs(c, OLA, { claimedAt: new Date(), heartbeatAt: new Date() }, { takesOver: [aSession.slotId] });
    sa = await A.invoke('sync:check');
    check('A finds its session in a take-over: read mode, work in EPL-Conflicts/', sa.phase === 'read' &&
      /^Ola Other took over the edit slot/.test(sa.conflict?.message ?? '') && spocOf(c, ref, sa.conflict?.savedTo) === 'Anna, taken over',
      sa.conflict);
    await A.invoke('sync:dismiss-conflict');
    removeClaim(c, ola.slotId);

    // ── Take-over: B's PC dies while editing; after 15 min without heartbeat (aged here) others may take over ──
    r = await B.invoke('sync:start-editing');
    await allowed('B edits', () => B.invoke('customers:update', ref, { customer_spoc: 'Ben before the crash' }));
    const bSlot = claimsOf(c)[0];
    await B.kill();
    r = await A.invoke('sync:start-editing');
    check('right after the crash Ben still holds the slot: A waits', !r.ok && r.waiting?.user === 'Ben Admin', r);
    ageClaim(c, bSlot.slotId, 16);
    sa = await A.invoke('sync:check');
    check('16 min without heartbeat: nobody holds the slot', sa.slot.holder === null, sa.slot);
    r = await A.invoke('sync:start-editing');
    check("A is asked first: Ben's session is inactive", !r.ok && r.takeOver?.user === 'Ben Admin' && r.takeOver.machine === 'PC-B', r);
    check('asking writes nothing', claimsOf(c).map(x => x.slotId).join() === bSlot.slotId, claimsOf(c));
    r = await A.invoke('sync:start-editing', { takeOver: true });
    let taker = claimsOf(c);
    check("A takes over: Ben's claim removed, A's claim records the take-over", r.ok && taker.length === 1 &&
      taker[0].user === 'Anna Admin' && taker[0].takesOver?.join() === bSlot.slotId, { r, taker });
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna after the take-over' }));
    p = await A.invoke('sync:publish');
    check('A publishes', p.ok && p.published, p);
    // Ben's laptop had OneDrive paused and kept rewriting its claim: it comes back with a fresh heartbeat and an earlier claim.
    await writeClaimAs(c, BEN_PC, { claimedAt: new Date(bSlot.claimedAt), heartbeatAt: new Date() }, { slotId: bSlot.slotId });
    sa = await A.invoke('sync:check');
    check("Ben's claim comes back to life: A keeps the slot (a taken-over session never comes back)", sa.phase === 'edit' &&
      sa.slot.holder?.mine === true, sa.slot);
    await everybodySees("Ben's revived claim (Ben's PC is off)", 'Anna Admin', [A, U, V]);
    taker = claimsOf(c);
    check("A's heartbeat keeps the take-over record", (await A.heartbeat()).phase === 'edit' &&
      claimsOf(c).find(x => x.user === 'Anna Admin')?.takesOver?.join() === bSlot.slotId, taker);

    // Ben's PC restarts: his unpublished change is offered; Anna holds the slot.
    await B.start();
    sb = await B.startup();
    check('B restarts: unpublished changes offered', !!sb.recovery, sb);
    p = await B.invoke('sync:recover', 'publish');
    check('B: Publish now has to wait for Anna, the change is kept', !p.ok && /^Anna Admin is editing right now\. Your changes are kept/.test(p.error) &&
      !!(await B.status()).recovery, p);
    check("B removed its own taken-over claim", claimsOf(c).map(x => x.user).join() === 'Anna Admin', claimsOf(c));
    await A.invoke('sync:finish-editing');
    p = await B.invoke('sync:recover', 'publish');
    sb = await B.status();
    check("B: Publish now once the slot is free → refused (Anna published meanwhile), Ben's work in EPL-Conflicts/",
      !p.ok && p.conflict && !!p.savedTo && spocOf(c, ref, p.savedTo) === 'Ben before the crash' &&
      spocOf(c, ref) === 'Anna after the take-over' && sb.phase === 'read' && !sb.recovery && claimsOf(c).length === 0, { p, sb: sb.phase });
    await B.invoke('sync:dismiss-conflict');

    // ── Crash and quick restart: the claim still holds the slot, the recovered change is published ──
    await A.invoke('sync:start-editing');
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna before a crash' }));
    const aCrash = claimsOf(c)[0];
    await A.kill();
    await A.start();
    sa = await A.startup();
    sa = await A.invoke('sync:check');
    check("A restarts: unpublished changes offered; the old claim is shown as A's own", !!sa.recovery &&
      sa.slot.holder?.mine === true && claimsOf(c).map(x => x.slotId).join() === aCrash.slotId, { recovery: sa.recovery, slot: sa.slot });
    r = await U.invoke('sync:start-editing');
    check('meanwhile U waits for Anna', !r.ok && r.waiting?.user === 'Anna Admin', r);
    p = await A.invoke('sync:recover', 'publish');
    check('A: Publish now goes through with the old claim; slot released', p.ok && p.published &&
      spocOf(c, ref) === 'Anna before a crash' && claimsOf(c).length === 0, p);

    // A crash without changes: nothing to recover, the next Start editing replaces the old claim.
    await A.invoke('sync:start-editing');
    const aIdle = claimsOf(c)[0];
    await A.kill();
    await A.start();
    sa = await A.startup();
    r = await A.invoke('sync:start-editing');
    check('crash without changes: nothing offered; Start editing replaces the old claim', !sa.recovery && r.ok &&
      claimsOf(c).length === 1 && claimsOf(c)[0].slotId !== aIdle.slotId, { recovery: sa.recovery, r });
    await A.invoke('sync:finish-editing');

    // ── A laptop that slept longer than the take-over time gives up the slot when it wakes up ──
    await A.invoke('sync:start-editing');
    await allowed('A edits', () => A.invoke('customers:update', ref, { customer_spoc: 'Anna before sleeping' }));
    await A.configure({ takeoverMs: 300 });
    await sleep(400);
    sa = await A.heartbeat();
    check('A wakes up: slot given up, read mode, told why', sa.phase === 'read' &&
      /^Your editing session ended: this PC gave no sign of life for too long\. Your unpublished changes were saved as /.test(sa.conflict?.message ?? ''),
      sa.conflict);
    check('its unpublished change is in EPL-Conflicts/, its claim deleted', spocOf(c, ref, sa.conflict?.savedTo) === 'Anna before sleeping' &&
      spocOf(c, ref) === 'Anna before a crash' && claimsOf(c).length === 0, sa.conflict);
    await A.configure({ takeoverMs: 15 * 60_000 });
    await A.invoke('sync:dismiss-conflict');

    // ── Users edit too, within their rights ──
    r = await U.invoke('sync:start-editing');
    check('U (user) gets the slot', r.ok && (await U.status()).phase === 'edit', r);
    await expectError('U: a customer managed by PBP is refused', () => U.invoke('customers:update', ref, { customer_spoc: 'Uma' }),
      /managed by PBP: only admins can change it/);
    const pkg = (await U.sql('SELECT packaging_version FROM packaging LIMIT 1'))[0].packaging_version;
    const cur = (await U.sql('SELECT currency FROM customers WHERE customer_ref_sap = ?', [ref]))[0].currency;
    await allowed('U creates a customer', () => U.invoke('customers:create', {
      customer_ref_sap: 'TEST-UMA-1', customer_short_name: 'Uma Test', customer_full_name: 'Uma Test Ltd', currency: cur,
      packaging_version: pkg }));
    await allowed('U edits her customer', () => U.invoke('customers:update', 'TEST-UMA-1', { customer_spoc: 'Uma' }));
    const fu = await U.invoke('sync:finish-editing');
    const umaCust = centralQuery(c, "SELECT pricing_mode, customer_spoc FROM customers WHERE customer_ref_sap = 'TEST-UMA-1'");
    check("U's work is published: her customer, managed by her", fu.ok && fu.published && umaCust[0]?.pricing_mode === 'managed' &&
      umaCust[0]?.customer_spoc === 'Uma' && manifestOf(c).publishedBy === 'Uma User' && claimsOf(c).length === 0, { fu, umaCust });

    // ── A v0.7 app: read-only once v0.8 has published ──
    const O = await pc('O', PEOPLE.ben, { EPL_APP_VERSION: '0.7.0' });
    const so = await O.status();
    check('manifest asks for 0.8.0 to edit', manifestOf(c).minAppVersion === MIN_EDIT_APP_VERSION && MIN_EDIT_APP_VERSION === '0.8.0',
      manifestOf(c));
    check('O (v0.7, admin): read-only, asked to update', so.phase === 'read' && !so.canStartEditing && so.writeBlock === 'update' &&
      /Update EPL Tool to 0\.8\.0/.test(so.startEditingBlocked ?? '') && so.newerApp?.minAppVersion === '0.8.0', so);
    await expectError('O: changes refused', () => O.invoke('customers:update', ref, { customer_spoc: 'X' }),
      /^Update EPL Tool to 0\.8\.0 to make changes\.$/);
    check('O still reads the latest data', (await O.invoke('customers:get', 'TEST-UMA-1'))?.customer_spoc === 'Uma');

    // ── Claims nobody renews: deleted after 7 days; younger inactive ones are offered for take-over ──
    const days = (d: number) => minutesAgo(d * 24 * 60);
    const old8 = await writeClaimAs(c, OLA, { claimedAt: days(9), heartbeatAt: days(8) });
    const old6 = await writeClaimAs(c, { ...OLA, machine: 'PC-OLA2' }, { claimedAt: days(7), heartbeatAt: days(6) });
    await V.invoke('sync:check');
    check('8 days without heartbeat: deleted at the next check', !claimsOf(c).some(x => x.slotId === old8.slotId) &&
      claimsOf(c).some(x => x.slotId === old6.slotId), claimsOf(c));
    r = await A.invoke('sync:start-editing');
    check('6 days: offered for take-over', !r.ok && r.takeOver?.user === 'Ola Other' && r.takeOver.machine === 'PC-OLA2', r);
    r = await A.invoke('sync:start-editing', { takeOver: true });
    check('after the take-over only A\'s claim is left', r.ok && claimsOf(c).length === 1 && claimsOf(c)[0].user === 'Anna Admin', claimsOf(c));
    await A.invoke('sync:finish-editing');
    r = await A.invoke('sync:start-editing');
    check('the next Start editing is not asked again', r.ok, r);
    await A.invoke('sync:finish-editing');
    check('the edit slot folder is empty at the end (no temp files)', ls(slotDirOf(c)).length === 0, ls(slotDirOf(c)));
  } finally {
    for (const p of pcs) await p.stop();
  }
}

if (process.env.EPL_PC) {
  worker();
} else {
  run(async () => {
    const tmp = setupTemp('epl-check-d-');
    process.env.LOCALAPPDATA = path.join(tmp, 'local');
    delete process.env.EPL_DEV_ACCOUNT;
    delete process.env.EPL_DEV_EMAIL;
    process.env.EPL_DEV_ACCOUNT = PEOPLE.anna.account;
    process.env.EPL_DEV_EMAIL = PEOPLE.anna.email;
    initIdentity({ allowOverride: true });
    await getIdentity();
    console.log(`schema ${SCHEMA_VERSION}`);
    await slotChecks(tmp);
    finish(tmp);
  });
}
