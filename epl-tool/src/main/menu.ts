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

// Releases: DevTools only for admins (Ctrl+Shift+I / F12); opened any other way by someone else, they are closed again.
// The checks in the main process remain the real protection.
export function guardDevTools(win: BrowserWindow, isAdmin: () => boolean): void {
  const allowed = () => !app.isPackaged || isAdmin();
  win.webContents.on('devtools-opened', () => {
    if (!allowed()) win.webContents.closeDevTools();
  });
  if (!app.isPackaged) return;
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const shortcut = input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
    if (shortcut && allowed()) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
}
