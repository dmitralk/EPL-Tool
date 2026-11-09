import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { closeDatabase } from './database';
import { registerAllIpcHandlers } from './ipc';
import { guardDevTools, installAppMenu } from './menu';
import { getIdentity, initIdentity } from './auth';
import { isRealUserAdmin } from './currentUser';
import { startBackgroundChecks, startup } from './sync/sync';

if (started) app.quit();

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

app.on('quit', () => closeDatabase());
