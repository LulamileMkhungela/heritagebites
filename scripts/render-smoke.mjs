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

/*
 * The footer is the page every route ends on, so its contact details have to be
 * links rather than text: a customer reading the number on a phone expects to be
 * able to tap it. The payment placeholder that used to sit here is gone, and the
 * socials are placeholders until the real profiles exist.
 */
await check('footer contact details are tappable and the socials are placeholders', async () => {
  const doc = window.document;
  /* The basket drawer has its own <footer>, so find the page footer by content. */
  const footer = [...doc.querySelectorAll('footer')].find((f) => f.querySelector('a[href^="tel:"]'));
  if (!footer) throw new Error('the page footer has no tel: link');
  const tel = footer.querySelector('a[href^="tel:"]');
  const mailto = footer.querySelector('a[href^="mailto:"]');
  if (tel.getAttribute('href') !== 'tel:+27670137587') {
    throw new Error(`unexpected tel target: ${tel.getAttribute('href')}`);
  }
  /* The visible label is two words; the number lives in the target and the aria-label. */
  if ((tel.textContent ?? '').trim() !== 'Call us') throw new Error(`the phone pill should read just "Call us", saw "${(tel.textContent ?? '').trim()}"`);
  if (!/\+27 67 013 7587/.test(tel.getAttribute('aria-label') ?? '')) throw new Error('the phone pill has no readable number for screen readers');
  if (!mailto) throw new Error('the footer email is not a mailto: link');
  if (mailto.getAttribute('href') !== 'mailto:heritagebitesfood@gmail.com') {
    throw new Error(`unexpected mailto target: ${mailto.getAttribute('href')}`);
  }
  for (const label of ['Instagram', 'Facebook', 'TikTok']) {
    const link = footer.querySelector(`a[aria-label="${label}"]`);
    if (!link) throw new Error(`footer has no ${label} link`);
    if (link.getAttribute('href') !== '#') throw new Error(`${label} should still be href="#"`);
  }
  if (/Card payments are processed by Yoco|never receives them/.test(text())) {
    throw new Error('the removed payment placeholder is still on the page');
  }

  /*
   * "Closed the rest of the week" sat under the Thursday and Friday rows and
   * read as "we have shut for the week". Whatever day this runs on, the hours
   * block must say where the service actually is: open now, or when the next
   * window starts.
   */
  if (/Closed the rest of the week/.test(footer.textContent ?? '')) {
    throw new Error('the ambiguous "Closed the rest of the week" note is back');
  }
  if (!/(Serving now · \d{2}:\d{2}–\d{2}:\d{2}|Closed now · next service \w+ \d{2}:\d{2}–\d{2}:\d{2}|Closed now · message us)/.test(
    footer.textContent ?? '',
  )) {
    throw new Error(`the footer hours block has no live service line: ${(footer.textContent ?? '').slice(-160)}`);
  }

  /* The contact pills say what the tap will do. */
  /*
   * The owner's wording: the pills are exactly "Call us" and "Email us" — the
   * number and the address must not be printed beside them, only dialled or
   * drafted. The aria-labels still name them for a screen reader.
   */
  if ((mailto.textContent ?? '').trim() !== 'Email us') throw new Error(`the email pill should read just "Email us", saw "${(mailto.textContent ?? '').trim()}"`);
  if (!/heritagebitesfood@gmail\.com/.test(mailto.getAttribute('aria-label') ?? '')) throw new Error('the email pill has no readable address for screen readers');
  if (/heritagebitesfood@gmail\.com/.test(footer.textContent ?? '')) throw new Error('the email address is still printed in the footer');

  /* "© 2026 Heritage Bites. All Rights Reserved. · Est. 2025" */
  if (!/© \d{4} Heritage Bites\. All Rights Reserved\. · Est\. 2025/.test(text())) {
    throw new Error('the copyright line is not in the agreed form');
  }
  /* The old fixed-price claims are gone: not every plate is R100 or R130. */
  for (const phrase of [/R100 a plate · delivery included/, /R130 a plate · delivery included/, /guide price/i]) {
    if (phrase.test(text())) throw new Error(`retired price wording is back: ${phrase}`);
  }

  /* The policies link closes the footer on the bottom line, opposite the copyright. */
  const policiesLink = [...footer.querySelectorAll('a')].find((a) => /Policies & terms/.test(a.textContent ?? ''));
  if (!policiesLink) throw new Error('the footer has no Policies & terms link');
  const copy = [...footer.querySelectorAll('span')].find((sp) => /©/.test(sp.textContent ?? ''));
  if (!copy) throw new Error('the footer has no copyright line');
  if (policiesLink.closest('ul')) throw new Error('Policies & terms is still inside a footer link list');
  const rowOf = (el) => Math.round(el.getBoundingClientRect().top);
  if (Math.abs(rowOf(policiesLink) - rowOf(copy)) > 24) {
    throw new Error('Policies & terms is not on the copyright line');
  }
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
  /* Owner enrolment. jsdom has no PushManager, so this also proves the page
     degrades to an explanation instead of throwing. */
  { path: '/alerts', expect: [/Enrol this device/i, /cannot receive/i], title: /^Order alerts — Heritage Bites$/ },
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
