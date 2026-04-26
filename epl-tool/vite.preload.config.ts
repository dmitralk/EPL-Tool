import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Preload entry is src/preload/index.ts — without this, Vite outputs
        // "index.js" which collides with the main process bundle in .vite/build/.
        entryFileNames: 'preload.js',
      },
    },
  },
});
