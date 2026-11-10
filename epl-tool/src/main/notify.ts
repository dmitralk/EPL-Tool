import { app, BrowserWindow, Notification } from 'electron';

// Windows notifications (dev-plan Phase D, decision 9): the edit slot is free, editing ended (released after the idle time,
// slot lost), changes not published. The installed app gets its Windows id from Squirrel (Electron detects it and calls
// setAppUserModelId itself); `npm start` uses the Electron executable, which Windows only shows notifications for when it
// is pinned to Start. Skipped silently where notifications aren't supported — the banners show the same events anyway.

const shown = new Set<Notification>();   // keeps a reference so the click handler survives garbage collection

export function initNotifications(): void {
  if (process.platform === 'win32' && !app.isPackaged) app.setAppUserModelId(process.execPath);
}

export function showNotification(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    const forget = () => { shown.delete(n); };
    n.on('click', () => {
      forget();
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    n.on('close', forget);
    n.on('failed', forget);
    shown.add(n);
    n.show();
  } catch {
    // never let a notification break anything
  }
}
