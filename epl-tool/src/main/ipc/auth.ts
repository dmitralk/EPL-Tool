import { shell } from 'electron';
import { getIdentity } from '../auth';
import { isOpen } from '../database';
import { activeAdmins, getAuthState, startPreview, stopPreview } from '../currentUser';
import { handle } from './guard';

export function registerAuthHandlers() {
  handle('auth:whoami', 'public', () => getIdentity());

  handle('auth:me', 'public', async () => getAuthState(await getIdentity()));

  // startPreview itself checks that the real user is an admin.
  handle('auth:preview-start', 'public', async (_e, userId: number) => {
    startPreview(Number(userId));
    return getAuthState(await getIdentity());
  });

  handle('auth:preview-stop', 'public', async () => {
    stopPreview();
    return getAuthState(await getIdentity());
  });

  // "Request access" (No-access screen) or "Request a change" (Help): an email draft to all active admins with the
  // person's details.
  handle('auth:request-access', 'public', async (_e, kind?: 'access' | 'change') => {
    const id = await getIdentity();
    const to = isOpen() ? activeAdmins().map(a => a.email).filter(Boolean).join(';') : '';
    const change = kind === 'change';
    const subject = change ? 'EPL Tool — request to change my access' : 'EPL Tool — access request';
    const body = [
      'Hello,',
      '',
      change ? 'Please change my access in EPL Tool as follows:' : 'Please give me access to EPL Tool (Settings → Users).',
      '',
      `Name: ${id.displayNameHint || '-'}`,
      `Windows account: ${id.account ?? '-'}`,
      `Email: ${id.email ?? '-'}`,
      '',
      'Thank you.',
    ].join('\r\n');
    await shell.openExternal(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    return { ok: true };
  });
}
