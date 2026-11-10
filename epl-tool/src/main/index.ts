import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { closeDatabase } from './database';
import { registerAllIpcHandlers } from './ipc';
import { guardDevTools, installAppMenu } from './menu';
import { getIdentity, initIdentity } from './auth';
import { isRealUserAdmin } from './currentUser';
import { initNotifications, showNotification } from './notify';
import { finishEditing, isEditing, onNotice, startBackgroundChecks, startup } from './sync/sync';

if (started) app.quit();

// Development only (ignored in packaged builds, like EPL_DEV_ACCOUNT): a separate profile — settings.json, Chromium data
// and the local copies of the shared database — so a test run never touches the real one, and two instances can run
// side by side.
const devProfile = app.isPackaged ? undefined : process.env.EPL_DEV_USER_DATA;
if (devProfile) {
  app.setPath('userData', path.join(devProfile, 'userData'));
  process.env.LOCALAPPDATA = path.join(devProfile, 'local');
}

const STARTUP_WAIT_MS = 8000;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    title: 'EPL Tool',
  });
  guardDevTools(mainWindow, isRealUserAdmin);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('ready', async () => {
  initIdentity({ allowOverride: !app.isPackaged });
  installAppMenu();
  initNotifications();
  onNotice(n => showNotification(n.title, n.body));
  registerAllIpcHandlers();

  // Reconnect the way this PC did last time (a local database, or a copy of the shared one) before the window asks for
  // it. The identity is needed first: opening may bootstrap the first admin (Migration 7). A slow OneDrive download must
  // not keep the window from opening: after a few seconds the screens show "Connecting…" until it is done.
  await getIdentity();
  await Promise.race([startup(), new Promise(r => setTimeout(r, STARTUP_WAIT_MS))]);
  startBackgroundChecks();

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Closing while editing a shared database: publish first. If that fails, the changes can stay on this PC (offered again
// at the next start) or the user cancels and keeps editing.
let quitting = false;
app.on('before-quit', event => {
  if (quitting || !isEditing()) return;
  event.preventDefault();
  void finishEditing().then(async r => {
    if (!r.ok && !r.conflict) {
      const choice = await dialog.showMessageBox({
        type: 'warning',
        title: 'EPL Tool',
        message: 'Your changes could not be published.',
        detail: `${r.error}\n\nIf you quit now, they stay on this computer and EPL Tool offers to publish them next time.`,
        buttons: ['Quit anyway', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });
      if (choice.response !== 0) return;
    }
    quitting = true;
    app.quit();
  });
});

app.on('quit', () => closeDatabase());
