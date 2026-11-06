import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Identity } from '../types';

const execFileAsync = promisify(execFile);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXEC_OPTS = { windowsHide: true, timeout: 5000 };

export const DEV_ACCOUNT_ENV = 'EPL_DEV_ACCOUNT';
export const DEV_EMAIL_ENV = 'EPL_DEV_EMAIL';

function normalizeEmail(value: string | undefined | null): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

async function upnEmail(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync('whoami', ['/upn'], EXEC_OPTS);
    return normalizeEmail(stdout);
  } catch {
    return null;
  }
}

// Fallback: the work account signed in to OneDrive (HKCU\Software\Microsoft\OneDrive\Accounts\Business<N>\UserEmail).
export async function oneDriveEmail(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'reg', ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s', '/v', 'UserEmail'], EXEC_OPTS,
    );
    let key = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('HKEY_')) key = line.trim();
      const m = line.match(/^\s+UserEmail\s+REG_SZ\s+(\S+)\s*$/);
      const email = m ? normalizeEmail(m[1]) : null;
      if (email && /\\Business\d+$/i.test(key)) return email;
    }
  } catch {
    // no OneDrive work account
  }
  return null;
}

function windowsAccount(): string | null {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
}

// "jan-martin.molegraaf@…" → "Jan-Martin Molegraaf"; only a suggestion, the user list holds the real name.
export function displayNameFromEmail(email: string): string {
  return email.split('@')[0]
    .split(/[._]+/)
    .filter(Boolean)
    .map(part => part.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-'))
    .join(' ');
}

export async function detectIdentity(
  opts: { allowOverride: boolean; env?: NodeJS.ProcessEnv },
): Promise<Identity> {
  const env = opts.env ?? process.env;
  const devAccount = env[DEV_ACCOUNT_ENV]?.trim() || null;
  const devEmail = normalizeEmail(env[DEV_EMAIL_ENV]);

  // Development only: pretend to be someone else. Unset parts stay empty so the real identity can't leak in.
  if (opts.allowOverride && (devAccount || devEmail)) {
    return {
      account: devAccount,
      email: devEmail,
      emailSource: devEmail ? 'override' : null,
      displayNameHint: devEmail ? displayNameFromEmail(devEmail) : devAccount ?? '',
      overridden: true,
    };
  }

  const account = windowsAccount();
  const upn = await upnEmail();
  const email = upn ?? await oneDriveEmail();
  return {
    account,
    email,
    emailSource: upn ? 'upn' : email ? 'onedrive' : null,
    displayNameHint: email ? displayNameFromEmail(email) : account ?? '',
    overridden: false,
  };
}

let identity: Promise<Identity> | null = null;
let resolved: Identity | null = null;
let allowOverride = false;

function start(): Promise<Identity> {
  identity = detectIdentity({ allowOverride }).then(id => (resolved = id));
  return identity;
}

// Called once at start-up; the detection runs in the background and is awaited by getIdentity().
export function initIdentity(opts: { allowOverride: boolean }): void {
  allowOverride = opts.allowOverride;
  start();
}

export function getIdentity(): Promise<Identity> {
  return identity ?? start();
}

// The identity once detection has finished (await getIdentity() before opening a database), else null.
export function getResolvedIdentity(): Identity | null {
  return resolved;
}
