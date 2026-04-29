import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // better-sqlite3 has a native .node binary — cannot be bundled by Vite.
      // xlsx uses require('fs') internally; bundling breaks that call so xlsx
      // throws "Cannot access file". Both are copied via the packageAfterCopy hook.
      external: ['better-sqlite3', 'xlsx'],
    },
  },
});
