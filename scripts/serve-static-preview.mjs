/**
 * Serve the GitHub Pages build exactly as Pages would.
 *
 * Pages is a static file host: a sub-path base (/heritagebites/), no API, and
 * an unknown route answered with 404.html. This server reproduces that locally
 * so the preview can be checked before it is published — and so a broken base
 * path or a stray /api call is caught here rather than in front of the client.
 *
 * Run:  npm run build:pages && npm run preview:pages
 * Port: 5055 by default (PORT overrides), bound to 0.0.0.0.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', process.env.HB_PAGES_DIR || 'web');
const base = (process.env.VITE_BASE || '/heritagebites/').replace(/\/?$/, '/');
const port = Number(process.env.PORT || 5055);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const send = (res, file, status = 200) => {
  /* A rebuild can empty dist/ underneath a running server; a missing file must
     answer 404, not crash the process with an unhandled stream error. */
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not built yet — run npm run build:pages');
    return;
  }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  const stream = createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

  /* Pages would 404 the bare root of a project site; redirect instead so the
     sandbox preview lands on the real app. */
  if (url === '/') {
    res.writeHead(302, { Location: base });
    res.end('Redirecting to the site');
    return;
  }
  if (!url.startsWith(base)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not found. The preview lives at ${base}`);
    return;
  }

  const trimmed = normalize(url.slice(base.length)).replace(/^(\.\.[/\\])+/, '');
  const relative = trimmed === '.' ? '' : trimmed;

  /* The site root is index.html, exactly as Pages serves it. */
  if (!relative) {
    send(res, join(dist, 'index.html'));
    return;
  }

  const candidate = join(dist, relative);
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    send(res, candidate);
    return;
  }
  /* An asset that does not exist is a genuine 404 — never the app shell. */
  if (extname(relative)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  /* Everything else is a client route: Pages answers with 404.html. */
  send(res, join(dist, '404.html'), 404);
}).listen(port, '0.0.0.0', () => {
  console.log(`[pages preview] serving ${process.env.HB_PAGES_DIR || 'web'} at http://0.0.0.0:${port}${base}`);
  console.log('[pages preview] no API: ordering, payments, lookups and messages are off by design');
});
