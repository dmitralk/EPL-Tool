// Shared-database mode (multi-user study §5, dev-plan Phase C). Plain constants and helpers used by the main process, the
// screens and Help, so the delays shown to users are the ones the code uses.

// How often the app checks the shared folder for newer data (read mode) or for someone else's publish (edit mode).
export const CHANGE_CHECK_SECONDS = 30;

// A change is published automatically this long after the last change (edit mode).
export const AUTO_PUBLISH_SECONDS = 60;

// "about a minute", "30 seconds": delays as shown on screens and in Help.
export function describeSeconds(seconds: number): string {
  if (seconds === 60) return 'about a minute';
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

// Oldest app version allowed to edit a database published by this version (written to the manifest as minAppVersion).
// Raise it when older versions must stop editing (e.g. they would write data this version can't read).
// 0.8.0: v0.7 apps don't know the edit slot, so they must not edit next to it (decided 9 Nov 2026).
export const MIN_EDIT_APP_VERSION = '0.8.0';

// Edit slot (multi-user study §5.5, decided 5 + 9 Nov 2026).
export const SLOT_HEARTBEAT_SECONDS = 180;       // the holder rewrites its claim this often
export const SLOT_WAIT_SECONDS = 45;             // waiting window after writing a claim (OneDrive carries competing claims)
export const SLOT_TAKEOVER_MINUTES = 15;         // a claim without heartbeat for this long is inactive (others may take over)
export const IDLE_RELEASE_MINUTES = 30;          // no change and nothing open for this long → publish and release
export const IDLE_WARNING_MINUTES = 2;           // warning shown this long before the release
export const CLAIM_CLEANUP_DAYS = 7;             // other people's claims without heartbeat for this long are deleted

// Compares dotted version numbers ("0.10.1" > "0.9.3"); missing parts count as 0, anything after "-" is ignored.
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => String(v ?? '').split('-')[0].split('.').map(p => parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Installer/ next to the shared database (dev-plan Phase E): the version of a setup file, read from its name — the built
// "EPL Tool-0.8.1 Setup.exe" or the GitHub download "EPL.Tool-0.8.1.Setup.exe" — or null when it isn't one.
export function installerVersion(fileName: string): string | null {
  const m = /(?:^|[^\d.])(\d+\.\d+\.\d+)[ .]Setup\.exe$/i.exec(String(fileName ?? ''));
  return m ? m[1] : null;
}

// How many installers stay in Installer/ (each is about 140 MB): the newest ones.
export const INSTALLERS_KEPT = 2;
