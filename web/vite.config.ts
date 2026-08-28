import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root is web/, and the build lands in web/dist where wrangler picks it up as
// the Worker's static assets.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // `npm run dev:web` alone gives HMR; proxy the data routes to `wrangler dev`
    // so the two can run side by side.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/v1': 'http://127.0.0.1:8787',
    },
  },
});
