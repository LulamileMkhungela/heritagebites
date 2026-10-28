/**
 * Capture every screen of the built site with a real browser.
 *
 * No Chromium is installed in the sandbox and the Playwright/Chrome CDNs are
 * blocked, so this uses @sparticuz/chromium (which ships the headless shell and
 * the missing host libraries inside the npm tarball) plus the system libraries
 * extracted from chrome-aws-lambda. Fonts are self-hosted copies of the three
 * families the site uses, because the sandbox has no fontconfig entries at all
 * and Google Fonts is unreachable — without them every shot renders in a serif
 * fallback and the screenshots would misrepresent the design.
 *
 * Run:  node scripts/capture-screens.mjs
 * Out:  docs/screens/<slug>-desktop.png, <slug>-mobile.png, docs/screens/*.pdf
 */
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { decodePng } from './lib/png.mjs';
import { prepareRuntime } from './lib/chromium-runtime.mjs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, 'docs', 'screens');
const TMP = '/tmp/hb-capture';
const BASE = process.env.HB_BASE ?? 'http://127.0.0.1:4000';

const trackingResponse = await fetch(`${BASE}/api/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    channel: 'cash-on-collection',
    fulfilment: 'collection',
    customer: { name: 'Screen Preview', phone: `+27 82 ${String(Date.now()).slice(-8)}` },
    items: [{ itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } }],
    payment: { method: 'cash-on-collection' },
  }),
});
if (!trackingResponse.ok) throw new Error(`could not create screenshot order: ${await trackingResponse.text()}`);
const trackingOrder = await trackingResponse.json();
const trackingPath = `/order/${trackingOrder.order.code}?token=${encodeURIComponent(trackingOrder.trackingToken)}`;

/* -------------------------------------------------------------- screens */
/*
 * Each entry is one screen of the product. `notes` is what the reader is meant
 * to see there — it becomes the caption and the "what to look for" line in the
 * PDF, so the document explains the product rather than just showing it.
 */
const CHECKOUT_CART = {
  state: {
    lines: [{
      key: 'tshotlo-plate::starch=pap|veg=braised-cabbage',
      itemId: 'tshotlo-plate',
      name: 'Tshotlo Plate',
      image: '/img/plate-tshotlo.jpg',
      unitPrice: 100,
      qty: 1,
      picks: [
        { optionId: 'starch', choiceId: 'pap', label: 'Pap', priceDelta: 0 },
        { optionId: 'veg', choiceId: 'braised-cabbage', label: 'Braised cabbage', priceDelta: 0 },
      ],
      kind: 'menu',
    }],
    fulfilment: 'delivery',
  },
  version: 2,
};

const SCREENS = [
  { slug: '01-home', path: '/', title: 'Home', view: 'desktop',
    notes: 'Hero, ordering actions, the Thursday/Friday service window, both plate menus, delivery rules and the loyalty card.',
    look: 'The moving meal ticker shows names without prices; the public header has no status strip or address.' },
  { slug: '02-home-mobile', path: '/', title: 'Home on a phone', view: 'mobile',
    notes: 'The home page at 390×844, showing the responsive public storefront.',
    look: 'Navigation collapses, basket remains available, and hero copy reflows for a phone.' },
  { slug: '03-menu', path: '/menu', title: 'Meals', view: 'desktop',
    notes: 'The Traditional and Contemporary plate menus, with meal search, category navigation and both plate builders.',
    look: 'The sticky category chips highlight the section currently in view.' },
  { slug: '04-menu-dish', path: '/menu?item=mogodu-plate', title: 'Dish details', view: 'desktop',
    notes: 'Dish photo, story, starch and vegetable-side choices, all included in the R100 plate price.',
    look: 'The details use the current menu information without nutrition or unsupported dietary claims.' },
  { slug: '05-plate-builder', path: '/menu?builder=traditional', title: 'Build a Traditional Plate', view: 'desktop',
    notes: 'The plate builder lets customers choose a protein, a starch and a vegetable side at the fixed R100 plate price.',
    look: 'Every component is included in the plate price, and delivery is included in turn.' },
  { slug: '06-specials', path: '/specials', title: 'This week', view: 'desktop',
    notes: 'The real service week: Thursday and Friday 12:00–13:30, both plate menus, delivery areas, minimum order and collection point.',
    look: 'No day-of-week promotions are invented; specials are announced on WhatsApp.' },
  { slug: '07-about', path: '/about', title: 'About Us', view: 'desktop',
    notes: 'How We Started, Vision, Mission, values and story timeline within About Us.',
    look: 'Vision, Mission and How We Started are grouped under About Us rather than separate top-level links.' },
  { slug: '08-contact', path: '/contact', title: 'Contact', view: 'desktop',
    notes: 'Phone, WhatsApp, email, Thursday/Friday hours, delivery rules and the enquiry form, without a public business address.',
    look: 'The form delivers to the business inbox; the exact collection point is confirmed by WhatsApp rather than published.' },
  { slug: '09-loyalty-card', path: '/passport', title: 'Loyalty card', view: 'desktop',
    notes: 'A simple loyalty card lookup by cell number, with stamp balance and reward details.',
    look: 'The feature is called a loyalty card throughout the public site.' },
  { slug: '10-checkout-empty', path: '/checkout', title: 'Checkout — empty basket', view: 'desktop',
    notes: 'The empty state shown when a customer reaches checkout without items.',
    look: 'A clear route back to the menu, not a dead end.' },
  { slug: '11-checkout-filled', path: '/checkout', title: 'Checkout — collection', view: 'desktop', seedCart: CHECKOUT_CART, viewport: { width: 1440, height: 1560 },
    notes: 'A populated checkout with customer fields, collection selection, order summary and the current payment form.',
    look: 'Delivery is included in the total, the service window is stated, and updates remain manual by phone or WhatsApp.' },
  { slug: '12-checkout-mobile', path: '/checkout', title: 'Checkout on a phone', view: 'mobile', seedCart: CHECKOUT_CART,
    notes: 'The populated collection checkout rendered at 390×844.',
    look: 'Fields and totals remain usable in the mobile layout.' },
  { slug: '13-order-tracking', path: '/order/[secure-link]', tracking: true, title: 'Order receipt and details', view: 'desktop', viewport: { width: 1440, height: 1200 },
    notes: 'Secure order receipt, item summary, payment and contact details.',
    look: 'No live progress or automatic messages are claimed; the customer is told to contact the restaurant for a manual update.' },
  { slug: '14-order-tracking-mobile', path: '/order/[secure-link]', tracking: true, title: 'Order receipt on a phone', view: 'mobile', viewport: { width: 390, height: 1600 },
    notes: 'The secure order page at 390px, with details and direct contact actions.',
    look: 'Order and contact information remains legible at phone width.' },
  { slug: '15-not-found', path: '/no-such-page', title: 'Not found', view: 'desktop',
    notes: 'The 404 route with the storefront shell, rather than a browser error page.',
    look: 'A clear way back to the menu.' },
  { slug: '16-customer-quest', path: '/quest', title: 'Customer quest', view: 'desktop', viewport: { width: 1440, height: 1500 },
    notes: 'The customer-quest page: both plate menus as a view-only reference, then the request form.',
    look: 'The reference contains no links, no buttons and no dish photos — nothing in it opens. A submitted quest is a request, not an order.' },
  { slug: '17-customer-quest-mobile', path: '/quest', title: 'Customer quest on a phone', view: 'mobile', viewport: { width: 390, height: 1900 },
    notes: 'The quest page at 390px: the view-only reference stacks above the request form.',
    look: 'The reference stays readable and still opens nothing on a phone.' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * A page.evaluate can hang for minutes on this host when a font request never
 * settles — `document.fonts.ready` then waits forever and the whole run stalls
 * on the protocol timeout. Every step that can block gets a ceiling, so a bad
 * screen fails and moves on instead of costing the run.
 */
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    // Do not keep the process alive for the loser of the race.
    if (typeof t.unref === 'function') t.unref();
  }),
]);

/*
 * HB_ONLY=01-home,02-home-mobile re-shoots just those screens without wiping
 * the other files, for iterating on a single page. Without it the whole set is
 * captured and docs/screens is recreated from scratch.
 */
const ONLY = (process.env.HB_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TARGETS = ONLY.length ? SCREENS.filter((s) => ONLY.includes(s.slug)) : SCREENS;
if (ONLY.length && TARGETS.length !== ONLY.length) {
  const unknown = ONLY.filter((slug) => !SCREENS.some((s) => s.slug === slug));
  throw new Error(`HB_ONLY names unknown screens: ${unknown.join(', ')}`);
}

/*
 * Screens are shot from one browser at a time, sequentially, with recovery.
 *
 * Launching a fresh headless shell per screen does not work on this host: the
 * fifth or sixth launch dies before it produces a page ("Code: null", empty
 * stderr). Carrying one browser too far does not work either — after a dozen
 * image-heavy pages the renderer is killed mid-screenshot ("Session closed"),
 * taking the browser with it. So: a browser per small batch, and if one dies,
 * relaunch and carry on with whatever is left instead of abandoning the run.
 */
function makeBrowser(runtime) {
  return puppeteer.launch({
    /*
     * --disable-dev-shm-usage is not optional: without it the shell hits the
     * 64 MB /dev/shm limit and the renderer dies mid-screenshot.
     */
    /*
     * Do NOT run with --font-render-hinting=none. It silently drops every
     * semibold Manrope glyph in this headless shell — chips, filter pills and
     * add buttons render as empty shapes while their layout boxes measure
     * correctly. @sparticuz/chromium ships that flag in its default args, so
     * spreading `chromium.args` wholesale quietly reintroduced it and put
     * blank "ORDER ONLINE" / "VIEW THE MENU" pills back into the screenshots.
     * Filter it out; the sweep after capture fails the run if any caption ends
     * up with a button whose label did not paint.
     */
    args: [
      ...chromium.args.filter((a) => a !== '--font-render-hinting=none'),
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
    ],
    executablePath: runtime.exe,
    headless: 'shell',
    protocolTimeout: 240000,
    env: { ...process.env, LD_LIBRARY_PATH: runtime.libPath, FONTCONFIG_PATH: dirname(runtime.fontsConf) },
  });
}

const DEAD = /Connection closed|Target closed|Session closed|detached Frame|browser has disconnected|Protocol error \(Page\.(navigate|captureScreenshot)\)/;

async function captureBatch(runtime, screens, results, failed) {
  let browser = await makeBrowser(runtime);

  try {
    for (const screen of screens) {
      let page;
      try {
        page = await browser.newPage();
      } catch {
        // The browser is gone. Start a fresh one and retry this screen on it.
        await browser.close().catch(() => {});
        browser = await makeBrowser(runtime);
        page = await browser.newPage();
      }

      try {
        /*
         * The site self-hosts its fonts now, so nothing outside this origin is
         * needed — but abort any Google request anyway so a stale browser
         * profile cannot reintroduce a third-party font dependency.
         */
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const u = req.url();
          try {
            if (u.startsWith('https://fonts.googleapis.com') || u.startsWith('https://fonts.gstatic.com')) req.abort();
            else req.continue();
          } catch { /* the page closed mid-flight */ }
        });

        const desktop = screen.view !== 'mobile';
        const vp = screen.viewport ?? (desktop ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
        await page.setViewport({ ...vp, deviceScaleFactor: 1 });


        if (screen.seedCart) {
          await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
          await page.evaluate((cart) => localStorage.setItem('hb.cart', JSON.stringify(cart)), screen.seedCart);
        }
        const destination = screen.tracking ? trackingPath : screen.path;
        await page.goto(`${BASE}${destination}`, { waitUntil: 'load', timeout: 45000 });
        await page.waitForFunction(
          () => Boolean(document.querySelector('#root')?.innerText?.trim()),
          { timeout: 20000 },
        );

        /*
         * Wait for the page to be finished, and prove it before shooting.
         *
         * This sandbox has no system fonts at all. Any element still painting in
         * a fallback family therefore renders as invisible glyphs — which is
         * what produced screenshots full of blank pills and unlabelled buttons.
         * `document.fonts.ready` alone was not enough: it can resolve before the
         * lazy @font-face loads have even started. So every face the design uses
         * is loaded explicitly, and the shot is refused until `fonts.check()`
         * confirms each one is live. That is a capture artifact, not a site bug:
         * a real browser falls back to a real system font instead of nothing.
         */
        /*
         * Load every face the design uses, and refuse to shoot until each one
         * reports loaded.
         *
         * This host has no system fonts, so a face that fails to load does not
         * fall back to something readable — it draws nothing, and the controls
         * photograph as empty pills. That failure is intermittent here (the
         * shell reports faces as `error` under load), and it is invisible to a
         * layout check because the boxes still measure. So the gate is the font
         * set itself, reloading the page when a face errors.
         */
        const FACES = [
          '400 16px Fraunces', '500 16px Fraunces', '600 16px Fraunces', '700 16px Fraunces',
          '300 16px Manrope', '400 16px Manrope', '500 16px Manrope', '600 16px Manrope', '700 16px Manrope',
          '400 16px "IBM Plex Mono"', '500 16px "IBM Plex Mono"', '600 16px "IBM Plex Mono"',
        ];
        const loadFaces = () => withTimeout(page.evaluate(async (specs) => {
          await Promise.all(specs.map((spec) => document.fonts.load(spec).catch(() => null)));
          await document.fonts.ready;
          /*
           * Wait for images that are already being fetched — never for lazy
           * ones. A `loading="lazy"` image below the fold is `complete === false`
           * and stays that way until it is scrolled to, so awaiting its onload
           * hangs forever (and did: the whole capture stalled on the long home
           * page). Lazy images that do not paint are not part of the viewport
           * being captured anyway.
           */
          await Promise.race([
            Promise.all(
              [...document.images]
                .filter((img) => !img.complete && img.loading !== 'lazy')
                .map((img) => new Promise((res) => { img.onload = img.onerror = res; })),
            ),
            new Promise((res) => setTimeout(res, 8000)),
          ]);
          const missing = specs.filter((spec) => !document.fonts.check(spec));
          const errored = [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family}:${f.weight}`);
          return { missing, errored };
        }, FACES), 20000, 'font load');

        await wait(350); // let the preloads in index.html land first
        let fonts = await loadFaces();
        for (let attempt = 0; attempt < 3 && (fonts.missing.length || fonts.errored.length); attempt += 1) {
          console.log(`    retry     ${screen.slug}: ${fonts.missing.length} faces missing, ${fonts.errored.length} errored`);
          await wait(900);
          await page.reload({ waitUntil: 'load', timeout: 45000 });
          await wait(700);
          fonts = await loadFaces();
        }
        if (fonts.missing.length) {
          throw new Error(`fonts did not load: ${fonts.missing.join(', ')}${fonts.errored.length ? ` (errored: ${fonts.errored.join(', ')})` : ''}`);
        }

        await wait(1200);
        if (screen.action) await screen.action(page);
        await wait(500);

        const file = join(OUT, `${screen.slug}.png`);

        /*
         * Last line of defence: check the pixels, not the DOM.
         *
         * The renderer intermittently photographs text as blank even though the
         * layout measured correctly and the faces report loaded — the DOM checks
         * above cannot see that, because they run before rasterisation. So a few
         * visible labelled controls inside the viewport are used as witnesses:
         * a painted control shows more than a flat fill, a blank one does not.
         * Retake a few times before giving up, because the fault is transient.
         */
        const witnesses = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('button, a')) {
            const text = (el.textContent ?? '').trim();
            if (text.length < 4) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 60 || r.height < 24) continue;
            if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            const cs = getComputedStyle(el);
            if (cs.backgroundImage !== 'none') continue; // photos behind: not a clean witness
            out.push({ text: text.slice(0, 20), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
            if (out.length === 4) break;
          }
          return out;
        });
        if (witnesses.length === 0) throw new Error('no visible labelled controls; refusing to save an empty screenshot');

        const coloursIn = (png, box) => {
          const seen = new Set();
          const x1 = Math.min(box.x + box.w, png.width);
          const y1 = Math.min(box.y + box.h, png.height);
          for (let y = Math.max(0, box.y); y < y1; y += 2) {
            for (let x = Math.max(0, box.x); x < x1; x += 2) {
              const i = (y * png.width + x) * 3;
              seen.add((png.rgb[i] << 16) | (png.rgb[i + 1] << 8) | png.rgb[i + 2]);
              if (seen.size > 3) return seen.size;
            }
          }
          return seen.size;
        };

        let blank = [];
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await withTimeout(page.screenshot({ path: file }), 45000, 'screenshot');
          const png = decodePng(readFileSync(file));
          blank = witnesses.filter((b) => coloursIn(png, b) <= 2);
          if (process.env.HB_DEBUG) {
            console.log('    debug attempt', attempt, 'png', png.width + 'x' + png.height,
              JSON.stringify(witnesses.map((b) => [b.text, coloursIn(png, b)])));
          }
          if (!blank.length) break;
          await wait(800);
        }
        if (blank.length) {
          throw new Error(`blank control in screenshot: ${blank.map((b) => b.text).join(', ')}`);
        }
        const { seedCart: _seedCart, tracking: _tracking, ...manifestScreen } = screen;
        results.push({ ...manifestScreen, file: `${screen.slug}.png`, title: await page.title(), bytes: statSync(file).size });
        console.log(`  captured  ${screen.slug.padEnd(24)} ${screen.title}`);
        /*
         * Close the tab before moving on. Leaving every captured page open was
         * what made this flaky: renderer memory piled up, and later pages
         * reported their webfonts as `error` and photographed as blank pills.
         * Six consecutive screens on one browser are stable with this in place.
         */
        await page.close().catch(() => {});
      } catch (e) {
        failed.push({ slug: screen.slug, error: e.message.split('\n')[0] });
        console.log(`  failed    ${screen.slug.padEnd(24)} ${e.message.split('\n')[0]}`);
        await page?.close().catch(() => {});
        if (DEAD.test(e.message)) {
          await browser.close().catch(() => {});
          browser = await makeBrowser(runtime);
        }
      } finally {
        await page.close().catch(() => {});
        await wait(200);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run() {
  const runtime = await prepareRuntime();
  if (!ONLY.length) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const BATCH = 3;
  const results = [];
  let failed = [];

  for (let i = 0; i < TARGETS.length; i += BATCH) {
    await captureBatch(runtime, TARGETS.slice(i, i + BATCH), results, failed);
    await wait(700);
  }

  /* Anything that failed gets another go, in fresh browsers, twice. */
  for (let pass = 0; pass < 2 && failed.length; pass += 1) {
    console.log(`\n  retrying ${failed.length} screen(s), pass ${pass + 1}`);
    await wait(1200);
    const retryScreens = TARGETS.filter((s) => failed.some((f) => f.slug === s.slug));
    const stillFailing = [];
    for (let i = 0; i < retryScreens.length; i += 2) {
      await captureBatch(runtime, retryScreens.slice(i, i + 2), results, stillFailing);
      await wait(600);
    }
    failed = stillFailing;
  }

  /*
   * A partial run (HB_ONLY) must not throw away the other screens' entries:
   * merge the fresh results over whatever manifest is already on disk, keeping
   * the canonical screen order.
   */
  let merged = results;
  if (ONLY.length) {
    try {
      const prev = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')).screens ?? [];
      const bySlug = new Map([...prev, ...results].map((s) => [s.slug, s]));
      merged = SCREENS.map((s) => bySlug.get(s.slug)).filter(Boolean);
    } catch { /* no previous manifest: fall back to this run only */ }
  }
  merged.sort((a, b) => SCREENS.findIndex((s) => s.slug === a.slug) - SCREENS.findIndex((s) => s.slug === b.slug));
  writeFileSync(
    join(OUT, 'manifest.json'),
    JSON.stringify({ captured: new Date().toISOString(), screens: merged, failed: failed.map((f) => f.slug) }, null, 2),
  );
  console.log(`\n${results.length} screens captured, ${failed.length} failed → docs/screens/`);
  if (failed.length) {
    console.log(`still failing: ${failed.map((f) => f.slug).join(', ')}`);
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error('capture failed:', e.message);
  process.exit(1);
});
