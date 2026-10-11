// SPDX-License-Identifier: GPL-2.0-or-later
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const PAGES = ['presenter', 'dock', 'control'] as const;
const SERVER = process.env.OLC_SERVER ?? 'http://127.0.0.1:4460';

/** Dev only: answer /presenter like /presenter/ (Vite's MPA fallback needs the slash; the real server serves both). */
function pageWithoutSlash(): Plugin {
  return {
    name: 'olc-page-without-slash',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = req.url === undefined ? null : /^\/(presenter|dock|control)(\?.*)?$/.exec(req.url);
        if (m !== null) req.url = `/${m[1]}/${m[2] ?? ''}`;
        next();
      });
    },
  };
}

export default defineConfig({
  root,
  appType: 'mpa',
  plugins: [react(), pageWithoutSlash()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    // OBS 30 docks run CEF 103 (Chromium 103): keep the output parseable there.
    target: ['chrome103', 'edge103', 'firefox115', 'safari16'],
    rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, resolve(root, p, 'index.html')])) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The dev pages talk to the real server; the Host/Origin guard accepts localhost.
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
