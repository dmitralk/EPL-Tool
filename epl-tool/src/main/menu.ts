import { app, BrowserWindow, Menu } from 'electron';

// Releases on Windows/Linux get no menu at all, so Ctrl+R, zoom and the DevTools shortcuts (which only exist as
// menu accelerators) are gone. macOS always shows a menu bar; it keeps the app and Edit menus that Cmd+Q/C/V need.
// Development keeps Electron's default menu, including DevTools.
export function installAppMenu(): void {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function isDevToolsAllowed(): boolean {
  return !app.isPackaged;
}

// Second line of defence: DevTools opened by any other route in a release are closed again.
export function guardDevTools(win: BrowserWindow): void {
  win.webContents.on('devtools-opened', () => {
    if (!isDevToolsAllowed()) win.webContents.closeDevTools();
  });
}
