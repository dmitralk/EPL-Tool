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
export const MIN_EDIT_APP_VERSION = '0.7.0';

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
