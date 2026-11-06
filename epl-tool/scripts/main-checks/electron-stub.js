// Minimal stand-in for the electron module so main-process code can run under ELECTRON_RUN_AS_NODE.
const handlers = new Map();
const state = { userData: process.env.TEST_USERDATA, nextOpen: null, nextSave: null, opened: [] };

const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };

module.exports = {
  handlers,
  __state: state,
  app: { getPath: () => state.userData, isPackaged: false },
  ipcMain,
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [state.nextOpen] }),
    showSaveDialog: async () => (state.nextSave ? { canceled: false, filePath: state.nextSave } : { canceled: true }),
  },
  shell: { openPath: async () => '', openExternal: async url => { state.opened.push(url); } },
  BrowserWindow: class {},
  Menu: { setApplicationMenu() {}, buildFromTemplate() { return {}; } },
};
