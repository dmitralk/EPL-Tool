import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // better-sqlite3 has a native .node binary — cannot be bundled by Vite.
      // It is copied via the packageAfterCopy hook.
      external: ['better-sqlite3'],
    },
  },
});
