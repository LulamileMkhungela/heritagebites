/**
 * Build the storefront for GitHub Pages.
 *
 * Pages serves files, not Node. The Express API — pricing, orders, payments,
 * loyalty lookups, contact and quests — cannot run there, so this build does
 * three things instead of pretending otherwise:
 *
 *   1. builds the same React app with `VITE_STATIC_PREVIEW=1`, which switches
 *      every write off in the browser with an honest message and replaces the
 *      live checkout with a preview one;
 *   2. exports one read-only snapshot of the catalogue (`/api/catalog.json`) by
 *      asking the real server for it, so the preview cannot drift from the
 *      owner-approved menu, prices, policies or service rules;
 *   3. writes `404.html` (the SPA fallback Pages needs for /menu, /passport…)
 *      and `.nojekyll` so the assets are served as-is.
 *
 * Usage:
 *   VITE_BASE=/heritagebites/ npm run build:pages
 *
 * The base defaults to /heritagebites/; set it to "/" for a user/organisation
 * site (https://<user>.github.io) or whenever the repository name differs.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
/*
 * Pages publishes a folder in the repository, so the preview is built straight
 * into `web/` and committed. It is deliberately separate from `dist/` (which
 * Express serves), so the two deployment shapes never clobber each other.
 *
 * Why committed rather than built by a GitHub Actions job: Actions cannot run
 * on this account until its billing is sorted out, and Pages' "deploy from a
 * branch" mode works today. `HB_PAGES_DIR` overrides the folder for a dry run.
 */
const dir = process.env.HB_PAGES_DIR || 'web';
const dist = join(root, dir);

/*
 * A *relative* base on purpose: the same built folder then works whether Pages
 * publishes it at /heritagebites/web/, at /heritagebites/ (folder = /web), or
 * anywhere else. The app works out its mount point at runtime — see
 * `runtimeBase()` in src/lib/api.ts.
 */
const base = process.env.VITE_BASE || './';

/*
 * Where the folder is expected to live in the browser, used only for the
 * repository-root fallback page. Default matches a project site published from
 * the branch root, which is the case this fallback exists for.
 */
const sitePath = (process.env.HB_SITE_PATH || '/heritagebites/web/').replace(/\/?$/, '/');

const step = (label) => console.log(`\n▶ ${label}`);
const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};

const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`);
};

/* ----------------------------------------------------------------- build -- */

step(`Type-check and build the static preview (base: ${base})`);
run('npx', ['tsc', '-b']);
run('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
  VITE_BASE: base,
  VITE_STATIC_PREVIEW: '1',
  // A preview never talks to a live API, even if a stray env var says so.
  VITE_API_BASE: '',
});

if (!existsSync(join(dist, 'index.html'))) fail(`vite build produced no ${dir}/index.html`);

/* -------------------------------------------------- catalogue snapshot --- */

/*
 * The snapshot is produced by the application itself, on a throwaway data
 * directory, so it is the same payload /api/catalog would return — seeded
 * content only, no customer data. Nothing is copied out of data/runtime.
 */
step('Exporting a read-only catalogue snapshot');
const dataDir = mkdtempSync(join(tmpdir(), 'hb-pages-'));
const port = String(4300 + Math.floor(Math.random() * 200));
const child = spawn('node', ['server/index.js'], {
  cwd: root,
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: port,
    HB_DATA_DIR: dataDir,
    // Never forward anything from a build machine, even by accident.
    HB_CONTACT_FORMSPREE_URL: '',
    HB_ORDER_EMAIL_ENABLED: 'false',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let catalog = null;
  for (let attempt = 0; attempt < 60 && !catalog; attempt += 1) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/catalog`);
      if (res.ok) catalog = await res.json();
    } catch {
      /* the server is still booting */
    }
  }
  if (!catalog) fail('the API did not answer /api/catalog, so no snapshot was written');

  mkdirSync(join(dist, 'api'), { recursive: true });
  writeFileSync(join(dist, 'api', 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `  wrote ${dir}/api/catalog.json (${catalog.menu.length} dishes, ${catalog.categories.length} menus, ` +
      `${catalog.policies.length} policies)`,
  );
} finally {
  child.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}

/* ------------------------------------------------------------ search SEO -- */

/*
 * Pages serves files. `/menu` therefore has to *be* a file, or the visitor gets
 * the 404 fallback and the crawler gets nothing: one document per route, each
 * with its own title, description, canonical and structured data, is the
 * difference between eight indexable pages and one.
 *
 * The site address is passed in rather than guessed — `HB_SITE_URL`, falling back
 * to `VITE_SITE_URL`/`HB_PUBLIC_URL`. Without one, the script still writes
 * robots.txt and the per-route documents, and says clearly that it skipped the
 * sitemap because a sitemap of invented URLs is worse than none.
 */
step('Writing search metadata, one document per route');
run('node', ['scripts/build-seo.mjs', '--dir', dir, '--routes', '--relative-assets', '--catalog', `${dir}/api/catalog.json`], {
  HB_SITE_URL: process.env.HB_SITE_URL ?? process.env.VITE_SITE_URL ?? '',
});

/* ------------------------------------------------------- Pages plumbing -- */

step('Writing the Pages fallbacks and .nojekyll');
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`  ${dir}/404.html, ${dir}/.nojekyll`);

/*
 * Repository-root 404.html. A project site published from the branch root
 * answers every unknown path with this file; without it, a refresh on a deep
 * link shows GitHub's generic error page. It sends the visitor to the built
 * home rather than guessing at the route, so it can never loop.
 */
writeFileSync(
  join(root, '404.html'),
  `<!doctype html>
<html lang="en-ZA">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${sitePath}" />
    <title>Heritage Bites</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 2rem; background: #f8f4ec; color: #001938">
    <p>Taking you to <a href="${sitePath}">the Heritage Bites site</a>…</p>
  </body>
</html>
`,
);
console.log('  404.html at the repository root (deep-link fallback)');

/*
 * A .nojekyll at the repository root too. Pages runs this branch through
 * Jekyll unless it finds one, and Jekyll silently drops files and folders whose
 * names begin with an underscore. The built site is plain files; nothing here
 * should be parsed or pruned.
 */
writeFileSync(join(root, '.nojekyll'), '');

console.log(`
✔ Static preview built into ${dir}/

  Site base   ${base} (relative — works at any mount point)
  Preview     ordering, payments, loyalty lookup and messages are off
  Snapshot    ${dir}/api/catalog.json
  Fallbacks   ${dir}/404.html and 404.html at the repository root
  Publish     commit ${dir}/ and push.

  Two ways Pages can serve it:
    a) Settings → Pages → Deploy from a branch → main → /${dir}
       → https://<user>.github.io/<repo>/            (cleanest)
    b) already the case: Pages publishes the branch root
       → the source index.html hands over to ./${dir}/, and the root
         404.html catches deep links.

  Rebuild this folder whenever site content changes — the published site is
  these committed files, not a build GitHub runs for you.
`);
