import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Shown beside the brand in the sidebar: package.json's version, plus the
// commit it was built from when git is available.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // Not a git checkout; the version alone is enough.
}

// Root is web/, and the build lands in web/dist where wrangler picks it up as
// the Worker's static assets.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit),
  },
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
