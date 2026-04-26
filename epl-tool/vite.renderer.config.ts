import { defineConfig } from 'vite';

// https://vitejs.dev/config
// PostCSS with Tailwind v3 is configured via postcss.config.cjs
export default defineConfig({
  css: {
    postcss: './postcss.config.cjs',
  },
  resolve: {
    alias: {
      '@': '/src/renderer',
      '@types-app': '/src/types',
    },
  },
});
