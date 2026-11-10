import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { app, dialog, shell } from 'electron';
import { compareVersions, installerVersion } from '../../shared/sync';
import type { CentralStore } from './centralStore';
import {
  finishEditing, getInstallerInfo, getSharedStore, isEditing, noteInstallerPublished, whoAmI,
} from './sync';
import type { InstallerPick } from '../../types';

// Installer/ next to the shared database (dev-plan Phase E, decided 10 Nov 2026): an admin publishes the downloaded setup
// there (latest.json announces it); everybody else gets the update banner and installs it from there. The guard checks the
// roles (publishing: admins; installing and opening the folder: anybody on the user list).

function store(): CentralStore {
  const s = getSharedStore();
  if (!s) throw new Error('Connect to the shared database first.');
  return s;
}

const READ_ONLY_FOLDER = 'You have read-only access to the shared folder on SharePoint, so changes are not possible.';

async function describeSetup(s: CentralStore, file: string): Promise<InstallerPick> {
  const name = path.basename(file);
  const version = installerVersion(name);
  if (!version) {
    throw new Error(`"${name}" is not an EPL Tool setup: its name should look like "EPL Tool-0.8.1 Setup.exe".`);
  }
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) throw new Error(`"${name}" can't be read.`);
  const current = (await s.readInstallerInfo())?.version ?? null;
  if (current && compareVersions(version, current) < 0) {
    throw new Error(`EPL Tool ${current} is already published: an older setup (${version}) can't replace it.`);
  }
  return { file, name, version, size: stat.size, current };
}

// "Publish an installer…": the admin picks the setup; the screen confirms with the version found and the current one.
export async function pickInstaller(): Promise<InstallerPick | null> {
  const s = store();
  const r = await dialog.showOpenDialog({
    title: 'Choose the EPL Tool setup to publish (e.g. downloaded from the GitHub release)',
    properties: ['openFile'],
    filters: [{ name: 'EPL Tool setup', extensions: ['exe'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return describeSetup(s, r.filePaths[0]);
}

export async function publishInstaller(file: string): Promise<{ version: string; file: string }> {
  const s = store();
  const pick = await describeSetup(s, path.resolve(String(file ?? '')));
  if (!(await s.canWrite())) throw new Error(READ_ONLY_FOLDER);
  const info = await s.publishInstaller(pick.file, { version: pick.version, publishedBy: whoAmI().user });
  noteInstallerPublished(info);
  return { version: info.version, file: info.file };
}

export const updateDir = () => path.join(os.tmpdir(), 'epl-tool-update');

// [Install update]: finish editing first, copy the setup to this PC (checked against latest.json), start it like a
// double-click (SmartScreen behaves as documented) and close EPL Tool; Squirrel installs the new version and starts it.
export async function installUpdate(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const s = store();
  const info = getInstallerInfo();
  if (!info || compareVersions(info.version, app.getVersion()) <= 0) {
    return { ok: false, error: `No newer EPL Tool is published (this is version ${app.getVersion()}).` };
  }
  if (!app.isPackaged) {
    return { ok: false, error: 'Install update works in the installed EPL Tool only, not in a development run.' };
  }
  if (isEditing()) {
    const r = await finishEditing();
    if (!r.ok) return { ok: false, error: `Your changes must be published first: ${r.error}` };
  }
  const dest = path.join(updateDir(), info.file);
  try {
    await s.copyInstaller(info, dest);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const failed = await shell.openPath(dest);
  if (failed) return { ok: false, error: `The installer could not be started: ${failed}` };
  setTimeout(() => app.quit(), 1500);
  return { ok: true, version: info.version };
}

export async function openInstallerFolder(): Promise<{ ok: true } | { ok: false; error: string }> {
  const dir = store().installerDir;
  if (!(await fsp.stat(dir).then(st => st.isDirectory(), () => false))) {
    return { ok: false, error: 'There is no Installer folder next to the shared database yet.' };
  }
  const failed = await shell.openPath(dir);
  return failed ? { ok: false, error: failed } : { ok: true };
}
