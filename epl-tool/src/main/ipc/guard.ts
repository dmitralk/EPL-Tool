import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isOpen } from '../database';
import { getActor } from '../currentUser';
import type { AppUser } from '../../types';

// Every channel is registered through handle() with the rule it needs; ipcMain.handle itself is disabled below, so a
// channel can't be added without a rule. The rule is checked here first; per-customer checks run inside the handlers.
//   public — anyone, even people not on the user list (db:*, auth:*, recovery)
//   viewer — any active user on the list
//   editor — Admins and Users
//   admin  — Admins only
export type Rule = 'public' | 'viewer' | 'editor' | 'admin';

const NO_ACCESS = 'You do not have access to EPL Tool. Ask an admin to add you in Settings → Users.';
const VIEWER_DENIED = 'Viewers can only view and export.';
const ADMIN_DENIED = 'Only admins can do this.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (() => {
  throw new Error('Register IPC channels with handle() from main/ipc/guard.ts so each one declares its access rule.');
}) as typeof ipcMain.handle;

const declared = new Map<string, Rule>();

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

export function handle(channel: string, rule: Rule, fn: Handler, deniedMessage?: string): void {
  if (declared.has(channel)) throw new Error(`IPC channel registered twice: ${channel}`);
  declared.set(channel, rule);
  register(channel, (event, ...args) => {
    requireRule(rule, deniedMessage);
    return fn(event, ...args);
  });
}

export function declaredChannels(): ReadonlyMap<string, Rule> {
  return declared;
}
