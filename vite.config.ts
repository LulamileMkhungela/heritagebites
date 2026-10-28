import { defineConfig } from 'vite';

/*
 * Vite is configured in Node, but this project deliberately does not pull in
 * @types/node just to read one environment variable, so the one global it needs
 * is declared here.
 */
declare const process: { env: Record<string, string | undefined> };
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The sandbox preview serves this dev server under https://{port}-{sandboxId}.e2b.app
// so we bind to every interface and allow any host/origin. All API calls from the
// browser are relative ("/api/...") and proxied to the Express backend, so the
// browser never needs to know where the backend lives.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  /*
   * GitHub Pages serves a project site from /<repo>/, so assets and routes need
   * that prefix. Express keeps the default "/". `npm run build:pages` sets it.
   */
  base: process.env.VITE_BASE || '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
});
