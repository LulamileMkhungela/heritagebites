/**
 * Pages preview smoke test.
 *
 * The static preview is a second deployment shape, and the things that break it
 * are quiet: a missing base path, an image that 404s only under /heritagebites/,
 * a write that is not switched off, a catalogue snapshot that was never copied.
 * This drives the actual build in a real browser and fails loudly.
 *
 * Run:
 *   VITE_BASE=/heritagebites/ npm run build:pages
 *   npm run preview:pages &
 *   HB_BASE=http://127.0.0.1:5055/heritagebites/ node scripts/pages-smoke.mjs
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const BASE = (process.env.HB_BASE || 'http://127.0.0.1:5055/heritagebites/').replace(/\/?$/, '/');
const results = [];
let failed = 0;

const check = async (label, fn) => {
  try {
    const detail = await fn();
    results.push(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failed += 1;
    results.push(`  FAIL  ${label} — ${error.message}`);
  }
};

const runtime = await prepareRuntime();
const browser = await puppeteer.launch({
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
  env: { ...process.env, LD_LIBRARY_PATH: runtime.libPath },
});

const page = await browser.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error}`));
page.on('response', (res) => {
  const url = res.url();
  if (res.status() < 400) return;
  /* Deep links are answered with 404.html by Pages — that is the fallback working. */
  if (res.status() === 404 && url.startsWith(BASE) && !/\.[a-z0-9]+$/i.test(url)) return;
  problems.push(`${res.status()} ${url}`);
});

const text = () => page.evaluate(() => document.body.innerText);
const goto = async (path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 700));
};

await page.setViewport({ width: 1440, height: 1000 });

await check('the catalogue snapshot loads and the site paints', async () => {
  await goto('');
  const body = await text();
  if (!/A taste of heritage/i.test(body)) throw new Error('home page did not render');
  if (!/Mogodu/i.test(body)) throw new Error('no dishes rendered — the catalogue snapshot is missing');
  if (!/R100,00/.test(body)) throw new Error('plate prices are missing from the preview');
  return 'catalogue + prices present';
});

await check('the preview says what it is, on every page', async () => {
  const body = await text();
  if (!/switched off on this preview/i.test(body)) throw new Error('no preview notice on the home page');
  await goto('quest');
  if (!/switched off on this preview/i.test(await text())) throw new Error('no preview notice on /quest');
  return 'notice present';
});

await check('the service strip is computed live, not frozen at build time', async () => {
  const body = await text();
  if (!/(rest day|Serving now|Not cooking yet|window has closed)/i.test(body)) {
    throw new Error('no service status rendered');
  }
  return 'live status rendered';
});

await check('every image resolves under the deployment base path', async () => {
  const broken = [];
  for (const path of ['', 'menu', 'specials', 'about', 'contact', 'policies', 'quest']) {
    await goto(path);
    /*
     * Cards below the fold are `loading="lazy"`, so a check made at the top of
     * a long page reports images that simply have not been requested yet. Walk
     * the page first, the way a reader would, then measure.
     */
    await page.evaluate(() => {
      /* Lazy cards at the bottom of a long page are still unrequested when a
         quick scroll passes them; force the load instead of guessing timings. */
      for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
    });
    await page.evaluate(() => Promise.all(
      [...document.images].filter((i) => !i.complete).map((i) => new Promise((resolve) => {
        i.addEventListener('load', resolve, { once: true });
        i.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 4000);
      })),
    ));
    await new Promise((r) => setTimeout(r, 400));
    const bad = await page.evaluate(() =>
      [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src')),
    );
    if (bad.length) broken.push(`${path || '/'}: ${bad.join(', ')}`);
  }
  if (broken.length) throw new Error(broken.join(' | '));
  return 'no broken images on 7 routes';
});

await check('checkout is a preview that prices the basket without charging', async () => {
  await goto('');
  await page.evaluate(() => {
    localStorage.setItem(
      'hb.cart',
      JSON.stringify({
        state: {
          lines: [
            {
              key: 'mogodu-plate::',
              itemId: 'mogodu-plate',
              name: 'Mogodu Plate',
              image: '/img/plate-mogodu.jpg',
              unitPrice: 100,
              qty: 2,
              picks: [],
              kind: 'menu',
            },
          ],
          fulfilment: 'collection',
        },
        version: 2,
      }),
    );
  });
  await goto('checkout');
  const body = await text();
  if (!/Preview checkout/i.test(body)) throw new Error('checkout is not in preview mode');
  if (!/R200,00/.test(body)) throw new Error('the preview basket total is wrong');
  if (/Place order|Pay now/i.test(body)) throw new Error('a live order button is still on the preview checkout');
  return 'R200,00 basket, no live order button';
});

await check('a customer cannot submit a quest or an enquiry on the preview', async () => {
  await goto('quest');
  await page.evaluate(() => {
    const field = (re) => [...document.querySelectorAll('input, textarea')].find((f) => re.test(f.placeholder ?? ''));
    const setValue = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(field(/Thabo Mahlangu/), 'Preview Test');
    setValue(field(/\+27 82 000 0000/), '+27 82 555 0000');
    setValue(field(/Dombolo with tshotlo/), 'A dish that is not on the menu');
    const submit = [...document.querySelectorAll('button[type="submit"]')].find((b) => /Send my quest/i.test(b.textContent ?? ''));
    submit?.click();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const body = await text();
  if (/Quest sent|Quest received/i.test(body)) throw new Error('the preview claimed a quest was delivered');
  if (!/switched off|preview/i.test(body)) throw new Error('no explanation after a blocked submit');
  return 'blocked, with an explanation';
});

await check('the loyalty lookup is replaced by guidance, not a dead form', async () => {
  await goto('passport');
  const body = await text();
  if (!/Stamp lookups need the live site/i.test(body)) throw new Error('no preview guidance on the loyalty page');
  return 'guidance shown';
});

await check('no runtime errors and no broken assets across the run', async () => {
  if (problems.length) throw new Error(problems.slice(0, 6).join(' | '));
  return 'clean';
});

await browser.close();

console.log('\n--- GitHub Pages preview smoke ---');
console.log(results.join('\n'));
if (failed) {
  console.log(`\nFAILURES: ${failed} check(s) failed\n`);
  process.exit(1);
}
console.log(`\nALL GREEN: ${results.length} checks passed against ${BASE}\n`);
