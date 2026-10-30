#!/usr/bin/env node
/**
 * Search metadata for whatever is being published.
 *
 * The React app sets its own `<head>` as the customer navigates, but three
 * audiences never run it: a crawler reading the HTML, a link unfurler in
 * WhatsApp, and `robots.txt` / `sitemap.xml`, which are files on disk. This
 * script produces all three from the single route table in `shared/seo.js`.
 *
 * It writes, into the built folder:
 *
 *   robots.txt            what may be crawled, and where the sitemap is
 *   sitemap.xml           the indexable pages, with absolute addresses
 *   <route>/index.html    one static document per route (--routes)
 *
 * Only the last one is Pages-specific: Pages serves files, so `/menu` has to be
 * a real file or it falls back to `404.html`. The Express host does not need it
 * — it answers every route from one shell and rewrites the head per request, so
 * it gets the same metadata without the duplicated HTML.
 *
 * ## The site address
 *
 * The address is never guessed. It comes from `--site-url`, `HB_SITE_URL`,
 * `HB_PUBLIC_URL` or `VITE_SITE_URL`, and if none of them is a real http(s)
 * address this script says so and writes what it can without inventing one:
 * `robots.txt` still works, and `sitemap.xml` is skipped, because a sitemap is
 * nothing but absolute URLs and a wrong domain in it is worse than no sitemap.
 *
 * Usage:
 *   node scripts/build-seo.mjs --dir dist --site-url https://example.co.za
 *   node scripts/build-seo.mjs --dir web --routes --catalog web/api/catalog.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEAD_END,
  HEAD_START,
  PAGES,
  headHtml,
  normaliseSiteUrl,
  robotsTxt,
  sitemapXml,
} from '../shared/seo.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* ------------------------------------------------------------------ args -- */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
};

const dir = String(flag('dir', 'dist'));
const outDir = join(root, dir);
const withRoutes = Boolean(flag('routes', false));
const catalogPath = flag('catalog', null);

/* Where this deployment is served from. First real answer wins. */
const configured =
  flag('site-url', null) ||
  process.env.HB_SITE_URL ||
  process.env.HB_PUBLIC_URL ||
  process.env.VITE_SITE_URL ||
  '';
const siteUrl = normaliseSiteUrl(configured);

const lastmod = new Date().toISOString().slice(0, 10);

if (!existsSync(join(outDir, 'index.html'))) {
  console.error(`\n✖ ${dir}/index.html does not exist — build the site first.\n`);
  process.exit(1);
}

if (!siteUrl) {
  console.warn(
    `\n! No usable site address was given${configured ? ` ("${configured}" is not a public http(s) URL)` : ''}.\n` +
      '  robots.txt will be written without a Sitemap line and no sitemap.xml will be\n' +
      '  created, because a sitemap of guessed URLs tells search engines about pages\n' +
      '  that are not yours. Pass --site-url https://<the real address> (or set\n' +
      '  HB_SITE_URL) to generate them.\n',
  );
}

/* ---------------------------------------------------------------- extras -- */

/*
 * The catalogue snapshot, when there is one, supplies two things the shell cannot
 * know: the shop's real settings (phone, areas, service window) for every page's
 * structured data, and the menu itself — so a plate can be understood as a dish
 * with a price rather than a line of text. The Express host has the live
 * catalogue instead and does this in the browser.
 */
let settings = {};
let menuExtras = [];
if (catalogPath && existsSync(join(root, String(catalogPath)))) {
  try {
    const catalog = JSON.parse(readFileSync(join(root, String(catalogPath)), 'utf8'));
    settings = catalog?.settings ?? {};
    const { menuJsonLd } = await import('../shared/seo.js');
    const node = menuJsonLd(siteUrl, catalog);
    if (node) menuExtras = [node];
  } catch (error) {
    console.warn(`! Could not read ${catalogPath} for the menu's structured data: ${error.message}`);
  }
}

/* -------------------------------------------------------------- the shell -- */

const shell = readFileSync(join(outDir, 'index.html'), 'utf8');
const start = shell.indexOf(HEAD_START);
const end = shell.indexOf(HEAD_END);
if (start === -1 || end === -1) {
  console.error(`\n✖ ${dir}/index.html has no ${HEAD_START} … ${HEAD_END} markers to replace.\n`);
  process.exit(1);
}

/** Replace the marked block with a route's metadata, keeping the rest of the file. */
const withHead = (html, path, extras = []) =>
  html.slice(0, start) +
  HEAD_START +
  '\n    ' +
  headHtml(path, { siteUrl, settings, jsonLd: extras }) +
  '\n    ' +
  HEAD_END +
  html.slice(end + HEAD_END.length);

/* The shell itself is the home page. */
const home = withHead(shell, '/');
writeFileSync(join(outDir, 'index.html'), home);

/* -------------------------------------------------------- one file a route -- */

let written = 0;
if (withRoutes) {
  for (const path of Object.keys(PAGES)) {
    if (path === '/') continue;
    const target = join(outDir, path.slice(1), 'index.html');
    mkdirSync(dirname(target), { recursive: true });

    /*
     * The built shell refers to `./assets/…` and `./favicon.svg` because it
     * normally sits at the folder root. A copy one level down would resolve
     * those inside the route's own folder, so the relative prefix is pushed up.
     */
    const nested = withHead(shell, path, path === '/menu' ? menuExtras : []).replace(
      /(\s(?:src|href)=")\.\//g,
      '$1../',
    );
    writeFileSync(target, nested);
    written += 1;
  }
}

/* ------------------------------------------------------ robots and sitemap -- */

writeFileSync(join(outDir, 'robots.txt'), robotsTxt(siteUrl));

const sitemap = sitemapXml(siteUrl, { lastmod });
if (sitemap) writeFileSync(join(outDir, 'sitemap.xml'), sitemap);

/* ----------------------------------------------------------------- report -- */

console.log(`\n✔ Search metadata written to ${dir}/`);
console.log(`  Site address  ${siteUrl ?? 'unknown — robots.txt only, no sitemap'}`);
console.log(`  Head tags     index.html${withRoutes ? ` + ${written} route file(s)` : ''}`);
console.log(`  robots.txt    ${siteUrl ? 'with Sitemap line' : 'no Sitemap line'}`);
console.log(`  sitemap.xml   ${sitemap ? `${Object.keys(PAGES).length} pages, lastmod ${lastmod}` : 'skipped (no site address)'}`);
console.log(`  Structured    Restaurant + WebSite + BreadcrumbList${menuExtras.length ? ' + Menu' : ''}\n`);
