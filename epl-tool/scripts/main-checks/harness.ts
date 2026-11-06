/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared helpers for the *.checks.ts files (see run.js). `electron` is the stub, so IPC handlers can be called directly.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import * as electron from 'electron';

export const REPO_ROOT = process.env.EPL_CHECKS_REPO ?? path.resolve(process.cwd(), '..');
export const SAMPLE_DBS = ['EPL-Database.db', 'EPL-Database BackUp.db'];
export const stub = electron as any;
export const handlers: Map<string, (...args: any[]) => any> = stub.handlers;

const verbose = !!process.env.EPL_CHECKS_VERBOSE;
let pass = 0;
let fail = 0;

export function sample(name: string): string {
  return path.join(REPO_ROOT, name);
}

// A temp folder with its own userData (settings.json) for the run.
export function setupTemp(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  stub.__state.userData = path.join(tmp, 'userData');
  fs.mkdirSync(stub.__state.userData);
  return tmp;
}

export async function invoke(channel: string, ...args: any[]): Promise<any> {
  const h = handlers.get(channel);
  if (!h) throw new Error(`No handler registered for '${channel}'`);
  return h({}, ...args);
}

export function check(name: string, ok: boolean, info?: unknown): void {
  if (ok) pass++; else fail++;
  if (ok && !verbose) return;
  const detail = !ok && info !== undefined ? `  → ${JSON.stringify(info).slice(0, 400)}` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail}`);
}

// Passes when fn throws an error whose message matches re.
export async function expectError(name: string, fn: () => unknown, re: RegExp): Promise<void> {
  try {
    await fn();
    check(name, false, 'no error');
  } catch (e) {
    check(name, re.test((e as Error).message), (e as Error).message);
  }
}

export async function allowed<T>(name: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    const r = await fn();
    check(name, true);
    return r;
  } catch (e) {
    check(name, false, (e as Error).message);
    return undefined;
  }
}

export const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function userVersion(file: string): number {
  const d = new Database(file, { readonly: true });
  const v = d.pragma('user_version', { simple: true }) as number;
  d.close();
  return v;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function finish(tmp: string): never {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

export function run(main: () => Promise<void>): void {
  main().catch(e => { console.error(e); process.exit(2); });
}
