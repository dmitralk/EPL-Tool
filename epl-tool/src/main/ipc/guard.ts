import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isOpen } from '../database';
import { getActor } from '../currentUser';
import { afterWrite, waitForPublish, writeBlockMessage } from '../sync/sync';
import type { AppUser } from '../../types';

// Every channel is registered through handle() with the rule it needs; ipcMain.handle itself is disabled below, so a
// channel can't be added without a rule. The rule is checked here first; per-customer checks run inside the handlers.
//   public — anyone, even people not on the user list (db:*, auth:*, sync:*, recovery)
//   viewer — any active user on the list
//   editor — Admins and Users
//   admin  — Admins only
// Channels that change the database ("writes", the default for editor and admin channels) are also refused while the open
// database is a read-only copy of the shared database (Phase C): role → read-only → handler (per-customer rules).
export type Rule = 'public' | 'viewer' | 'editor' | 'admin';

export interface ChannelOptions {
  denied?: string;      // refusal message for the role check
  writes?: boolean;
}

const NO_ACCESS = 'You do not have access to EPL Tool. Ask an admin to add you in Settings → Users.';
const VIEWER_DENIED = 'Viewers can only view and export.';
const ADMIN_DENIED = 'Only admins can do this.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (() => {
  throw new Error('Register IPC channels with handle() from main/ipc/guard.ts so each one declares its access rule.');
}) as typeof ipcMain.handle;

const declared = new Map<string, { rule: Rule; writes: boolean }>();

export function requireRule(rule: Rule, deniedMessage?: string): AppUser | null {
  if (rule === 'public') return null;
  if (!isOpen()) throw new Error('No database is open.');
  const actor = getActor();
  if (!actor) throw new Error(NO_ACCESS);
  if (rule === 'editor' && actor.role === 'viewer') throw new Error(deniedMessage ?? VIEWER_DENIED);
  if (rule === 'admin' && actor.role !== 'admin') throw new Error(deniedMessage ?? ADMIN_DENIED);
  return actor;
}

// The active user for a channel whose rule is not 'public' (requireRule has already run).
export function actor(): AppUser {
  const a = getActor();
  if (!a) throw new Error(NO_ACCESS);
  return a;
}

// Refuses a change while the open database is a read-only copy (read mode, offline copy, newer app needed).
export function requireWritable(user: AppUser | null): void {
  const block = writeBlockMessage(user);
  if (block) throw new Error(block);
}

// Safety net: SQLite itself refuses changes on a read-only copy (PRAGMA query_only); explain it the same way.
function explain(e: unknown): unknown {
  if ((e as { code?: string } | null)?.code !== 'SQLITE_READONLY') return e;
  return new Error(writeBlockMessage(getActor()) ?? 'Read-only copy — changes are not possible.');
}

function call(fn: Handler, event: IpcMainInvokeEvent, args: unknown[]): unknown {
  let result: unknown;
  try {
    result = fn(event, ...args);
  } catch (e) {
    throw explain(e);
  }
  return result instanceof Promise ? result.catch(e => { throw explain(e); }) : result;
}

export function handle(channel: string, rule: Rule, fn: Handler, options?: string | ChannelOptions): void {
  if (declared.has(channel)) throw new Error(`IPC channel registered twice: ${channel}`);
  const opts = typeof options === 'string' ? { denied: options } : options ?? {};
  const writes = opts.writes ?? (rule === 'editor' || rule === 'admin');
  declared.set(channel, { rule, writes });
  register(channel, (event, ...args) => {
    const user = requireRule(rule, opts.denied);
    if (!writes) return call(fn, event, args);
    requireWritable(user);
    // While a publish takes its snapshot of the working copy, changes wait for it (about a second).
    const publishing = waitForPublish();
    if (!publishing) return afterWrite(() => call(fn, event, args));
    return publishing.then(() => {
      requireWritable(getActor());
      return afterWrite(() => call(fn, event, args));
    });
  });
}

export function declaredChannels(): ReadonlyMap<string, { rule: Rule; writes: boolean }> {
  return declared;
}
