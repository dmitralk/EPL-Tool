import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { openDatabase, closeDatabase, getDb } from './database';
import { registerAllIpcHandlers } from './ipc';

if (started) app.quit();

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

app.on('ready', () => {
  registerAllIpcHandlers();
  createWindow();

  // Try to restore last used database
  try {
    const savedPath = getSavedDbPath();
    if (savedPath) {
      openDatabase(savedPath);
    }
  } catch {
    // ignore — user will be prompted via DatabaseSelector screen
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('quit', () => closeDatabase());

function getSavedDbPath(): string | null {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const fs = require('fs');
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return data.lastDbPath || null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveDbPath(dbPath: string) {
  try {
    const fs = require('fs');
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const data: Record<string, string> = {};
    if (fs.existsSync(settingsPath)) {
      Object.assign(data, JSON.parse(fs.readFileSync(settingsPath, 'utf-8')));
    }
    data.lastDbPath = dbPath;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  } catch {
    // ignore
  }
}
