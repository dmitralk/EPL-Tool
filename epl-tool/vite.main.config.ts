import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // better-sqlite3 has a native .node binary — cannot be bundled by Vite.
      // It is copied into the packaged app via the packageAfterCopy forge hook.
      external: ['better-sqlite3'],
    },
  },
});
