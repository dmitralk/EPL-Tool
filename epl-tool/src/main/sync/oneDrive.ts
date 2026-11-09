import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Every folder the OneDrive client syncs on this PC: the OneDrive root(s) from the environment and each synced SharePoint
// library from HKCU\Software\SyncEngines\Providers\OneDrive\<id>\MountPoint.
export async function syncedRoots(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const roots = new Set<string>();
  for (const key of ['OneDriveCommercial', 'OneDrive', 'OneDriveConsumer']) {
    const v = env[key]?.trim();
    if (v) roots.add(path.resolve(v));
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'reg', ['query', 'HKCU\\Software\\SyncEngines\\Providers\\OneDrive', '/s', '/v', 'MountPoint'],
        { windowsHide: true, timeout: 5000 },
      );
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^\s+MountPoint\s+REG_SZ\s+(.+?)\s*$/);
        if (m) roots.add(path.resolve(m[1]));
      }
    } catch {
      // no OneDrive sync engine registered
    }
  }
  return [...roots];
}

export function isUnder(file: string, root: string): boolean {
  const rel = path.relative(root.toLowerCase(), path.resolve(file).toLowerCase());
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function isInSyncedFolder(file: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  return (await syncedRoots(env)).some(root => isUnder(file, root));
}
