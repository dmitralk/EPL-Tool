import path from 'path';
import { app } from 'electron';

// Local copies of the shared database live in %LOCALAPPDATA%\epl-tool (decided 9 Nov 2026): not roamed with the Windows
// profile and never synced. settings.json stays in %APPDATA%\epl-tool (app.getPath('userData')).
export function localDataDir(): string {
  const userData = app.getPath('userData');
  const local = process.env.LOCALAPPDATA;
  return local ? path.join(local, path.basename(userData)) : path.join(userData, 'local');
}

// Read copy of the shared database (+ cache.json describing where it came from).
export function cacheDir(): string {
  return path.join(localDataDir(), 'cache');
}

// Working copy while editing (+ session.json).
export function workDir(): string {
  return path.join(localDataDir(), 'work');
}
