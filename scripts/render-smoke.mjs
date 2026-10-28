/**
 * Render smoke test.
 *
 * Bundles the real src/main.tsx with esbuild, mounts it in jsdom against the
 * live API on :4000, and asserts the app actually paints. This is the only
 * check that catches a component throwing during render — the HTTP checks
 * would still return 200 for an empty <div id="root">.
 *
 * Usage: node scripts/render-smoke.mjs   (server must be running on :4000)
 */
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:4000';
const TMP = join(process.cwd(), 'node_modules', '.smoke');
rmSync(TMP, { recursive: true, force: true });

/* 1. Bundle the real entry point. IIFE because jsdom does not execute module
      scripts, and this must be the same source the site ships. */
const result = await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.jpg': 'dataurl', '.svg': 'dataurl' },
  define: {
    'process.env.NODE_ENV': '"development"',
    // jsdom has no server: mimic the same-origin build, not the Pages preview.
    'import.meta.env': JSON.stringify({ BASE_URL: '/', MODE: 'development' }),
  },
  write: false,
  logLevel: 'silent',
});
const out = result.outputFiles.find((f) => f.path.endsWith('.js')) ?? result.outputFiles[0];
if (!out) throw new Error('esbuild produced no output');
const bundle = out.text;

/* 2. jsdom, with the browser APIs the app leans on. */
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM(
  `<!doctype html><html><head><title>Heritage Bites</title></head><body><div id="root"></div></body></html>`,
  { url: `${BASE}/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc },
);
const { window } = dom;

/* The app calls fetch('/api/...'); resolve those against the live server. */
window.fetch = (input, init) => {
  const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
  return fetch(url, init);
};
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.confirm = () => true;
window.alert = () => {};

/* 3. Mount. */
window.eval(bundle);

/* Wait for the catalogue fetch + React paint. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, label, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(150);
  }
  throw new Error(`timed out after ${timeout}ms waiting for: ${label}`);
};

const text = () => window.document.body.textContent ?? '';
const html = () => window.document.body.innerHTML;

const checks = [];
const check = async (label, fn) => {
  try {
    await fn();
    checks.push(['PASS', label]);
  } catch (e) {
    checks.push(['FAIL', `${label} — ${e.message}`]);
  }
};

await check('app mounts into #root', () =>
  waitFor(() => window.document.getElementById('root').children.length > 0, 'root to have children'),
);

await check('header + navigation render', async () => {
  await waitFor(() => /Heritage Bites/.test(text()), 'brand name');
  for (const label of ['Home', 'About Us', 'Offering / Meals', 'This Week', 'Contact']) {
    if (!text().includes(label)) throw new Error(`nav link missing: ${label}`);
  }
  for (const id of ['vision', 'mission', 'story']) {
    if (window.document.querySelector(`nav a[href="/about#${id}"]`)) throw new Error(`section link should not be in the top nav: ${id}`);
  }
  for (const phrase of ['Closed · opens', '323 Sisulu St', 'Pretoria Central', 'Kitchen console']) {
    if (text().includes(phrase)) throw new Error(`public header/footer still shows: ${phrase}`);
  }
  if (window.document.querySelector('a[href="/admin"]')) throw new Error('public header/footer still links to the staff console');
});

await check('hero renders with the real headline', async () => {
  await waitFor(() => /A taste of heritage/i.test(text()), 'hero headline');
  if (!html().includes('hero-feast')) throw new Error('hero image not referenced');
});

await check('catalogue loads from the API and dishes render', async () => {
  await waitFor(() => /Mogodu/.test(text()) && /Tshotlo/.test(text()), 'dish names from the API');
  if (!/Every Bite Tells a Story|Every bite tells a story/i.test(text())) {
    throw new Error('brand tagline not rendered');
  }
});

await check('this week service preview renders', async () => {
  await waitFor(() => /Cooked Thursdays/i.test(text()) && /Traditional Plate/i.test(text()), 'this week section');
});

await check('ordering channels render', async () => {
  await waitFor(() => /Uber Eats/.test(text()) && /WhatsApp/.test(text()), 'delivery partners');
});

await check('basket control renders', async () => {
  if (!/Basket/.test(text())) throw new Error('basket button missing');
});

/* 4. Route sweep — mount each route fresh and assert it paints real content.
      A page that throws during render still returns HTTP 200, so this is the
      only thing that catches it. Create a throwaway unpaid order so the secure
      tracking route has a valid code and token. */
const trackingResponse = await fetch(`${BASE}/api/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    channel: 'cash-on-collection',
    fulfilment: 'collection',
    customer: { name: 'Render Smoke', phone: `+27 82 ${String(Date.now()).slice(-8)}` },
    items: [{ itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } }],
    payment: { method: 'cash-on-collection' },
  }),
});
if (!trackingResponse.ok) throw new Error(`could not create render-smoke order: ${await trackingResponse.text()}`);
const tracking = await trackingResponse.json();
const orderCode = tracking.order.code;
const trackingPath = `/order/${orderCode}?token=${encodeURIComponent(tracking.trackingToken)}`;

/* `title` guards per-route <title>. A SPA otherwise ships the one title from
   index.html everywhere, so every tab and shared link reads the same thing. */
const ROUTES = [
  { path: '/', expect: [/A taste of heritage/i, /Cooked Thursdays/i], title: /^Traditional & Contemporary Plates — Heritage Bites$/ },
  { path: '/menu', expect: [/The full menu/i, /Traditional Plates/, /Contemporary Plates/, /Heritage Pots/, /Coming soon/i], title: /^Meals — Heritage Bites$/ },
  { path: '/specials', expect: [/Thursdays & Fridays/i, /R100|R130/], title: /^This Week — Heritage Bites$/ },
  { path: '/policies', expect: [/Privacy Policy/i, /Refund Policy/i, /Order Cancellation Policy/i], title: /^Policies & Terms — Heritage Bites$/ },
  { path: '/about', expect: [/Every bite tells a story/i, /Vision/i, /Mission/i, /How we started/i], title: /^About Us \| Our Story, Vision & Mission — Heritage Bites$/ },
  { path: '/contact', expect: [/Talk to a human/i], title: /^Contact — Heritage Bites$/ },
  { path: '/checkout', expect: [/basket is empty/i], title: /^Checkout — Heritage Bites$/ },
  { path: '/passport', expect: [/Your loyalty card/i], title: /^Loyalty card — Heritage Bites$/ },
  { path: '/quest', expect: [/Ask us to cook it/i, /What the kitchen cooks/i, /Send your quest/i], title: /^Customer quest — Heritage Bites$/ },
  { path: trackingPath, displayPath: '/order/[secure-link]', expect: [new RegExp(orderCode), /Order received/i], title: new RegExp(`^Order ${orderCode} — Heritage Bites$`) },
  { path: '/no-such-page', expect: [/This plate came back empty/i], title: /^Page not found — Heritage Bites$/ },
];

const routeResults = [];
for (const route of ROUTES) {
  const routeLabel = route.displayPath ?? route.path;
  const errors2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', (e) => errors2.push(`jsdomError: ${e.message}`));
  vc2.on('error', (...a) => errors2.push(`console.error: ${a.join(' ')}`));

  const d2 = new JSDOM(
    `<!doctype html><html lang="en-ZA"><head><title>Heritage Bites — South African Meals &amp; Weekly Specials</title></head><body><div id="root"></div></body></html>`,
    { url: `${BASE}${route.path}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc2 },
  );
  const w = d2.window;
  w.fetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
    return fetch(url, init);
  };
  w.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  w.alert = () => {};
  try {
    w.eval(bundle);
    const bodyText = () => w.document.body.textContent ?? '';
    await (async () => {
      const start = Date.now();
      while (Date.now() - start < 12000) {
        if (route.expect.every((re) => re.test(bodyText()))) return;
        await sleep(150);
      }
      throw new Error(`expected content not found: ${route.expect.map(String).join(', ')}`);
    })();

    if (route.title && !route.title.test(w.document.title)) {
      throw new Error(`document.title is "${w.document.title}", expected ${route.title}`);
    }
    routeResults.push(['PASS', routeLabel, '']);
  } catch (e) {
    routeResults.push(['FAIL', routeLabel, e.message]);
  }
  const realErrors = errors2.filter((e) => !/Not implemented: HTMLCanvasElement|Could not parse CSS/i.test(e));
  if (realErrors.length) routeResults.push(['FAIL', `${routeLabel} (runtime)`, realErrors[0]]);
  w.close();
}

/* 5. Report. */
const failed = checks.filter(([s]) => s === 'FAIL');
console.log('\n--- render smoke test (jsdom, live API) ---');
for (const [status, label] of checks) console.log(`  ${status}  ${label}`);

console.log('\n--- route sweep ---');
for (const [status, label, msg] of routeResults) console.log(`  ${status}  ${label}${msg ? ` — ${msg}` : ''}`);

if (errors.length) {
  console.log('\n--- runtime errors on / ---');
  for (const e of errors.slice(0, 12)) console.log(`  ${e}`);
}

const routeFails = routeResults.filter(([s]) => s === 'FAIL');
const failedPaths = new Set(routeFails.map(([, l]) => String(l).replace(' (runtime)', '')));
const ok = failed.length === 0 && routeFails.length === 0 && errors.length === 0;
const total = checks.length + ROUTES.length;
const passed = total - failed.length - failedPaths.size;
console.log(`\n${ok ? 'ALL GREEN' : 'FAILURES'}: ${passed}/${total} checks passed, ${errors.length} runtime errors on /\n`);
process.exit(ok ? 0 : 1);
