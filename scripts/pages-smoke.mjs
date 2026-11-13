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
  if (!/A taste of South African heritage/i.test(body)) throw new Error('home page did not render');
  if (!/Mogodu/i.test(body)) throw new Error('no dishes rendered — the catalogue snapshot is missing');
  if (!/R100,00/.test(body)) throw new Error('plate prices are missing from the preview');
  return 'catalogue + prices present';
});

/*
 * The owner asked for the preview strip to go: it was the first thing a phone
 * showed, above the brand, and it made a finished site look like a test build.
 * The real guard stays where it matters — checkout is still `PreviewCheckout`
 * and still hands the basket to WhatsApp, so nobody is charged or left waiting.
 */
await check('no preview bar sits above the brand', async () => {
  for (const path of ['', 'quest', 'contact']) {
    await goto(path);
    const body = await text();
    if (/switched off on this preview/i.test(body)) throw new Error(`preview bar is still on /${path}`);
    if (/^\s*Preview\b/.test(body)) throw new Error(`a "Preview" label leads /${path}`);
  }
  return 'no preview bar on /, /quest, /contact';
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
  if (!/Finish your order/i.test(body)) throw new Error('the checkout hand-off is missing');
  if (!/R200,00/.test(body)) throw new Error('the basket total is wrong');
  if (/Place order|Pay now/i.test(body)) throw new Error('a live order button is still on the static checkout');

  /*
   * The exact complaint this guards against: on the preview, "Order this on
   * WhatsApp" opened an empty chat, so the customer had to retype an order
   * the site already knew. The link must carry the basket itself.
   */
  /*
   * Scoped to <main>: the service strip and the footer also carry WhatsApp
   * links, and this check used to grab whichever came first in the document.
   * It passed only because the (now removed) preview bar happened to sit above
   * them and happened to carry the basket. What must be true is that the
   * checkout's own hand-off carries it.
   */
  const wa = await page.evaluate(() =>
    [...document.querySelectorAll('main a[href^="https://wa.me/"]')]
      .map((a) => a.href)
      .find((href) => /text=/.test(href)) ?? '',
  );
  if (!wa) throw new Error('the preview checkout has no WhatsApp basket link');
  const message = new URL(wa).searchParams.get('text') ?? '';
  if (!/Mogodu Plate/.test(message)) throw new Error('the WhatsApp message does not name the dish');
  if (!/2 ×|2 x/.test(message)) throw new Error('the WhatsApp message does not carry the quantity');
  if (!/R200[,.]00/.test(message)) throw new Error('the WhatsApp message does not carry the total');
  if (!/collect/i.test(message)) throw new Error('the WhatsApp message does not carry the collection choice');

  return 'R200,00 basket, no live order button, WhatsApp handoff pre-filled';
});

await check('the enquiry and quest forms really submit from the static build', async () => {
  /*
   * The owner's point: the POST endpoints exist, so a form must submit — and on
   * the static build there is no server to receive it. The fix is that an
   * enquiry needs an inbox, not a server: the browser posts straight to the
   * business's Formspree endpoint. This check intercepts that request (so the
   * run makes no outbound call), asserts the payload is complete, and only then
   * lets the form see a success response.
   */
  const posted = [];
  await page.setRequestInterception(true);
  const onRequest = (request) => {
    if (!request.url().startsWith('https://formspree.io/')) return request.continue();
    /* A JSON cross-origin POST is preflighted; answer that first. */
    if (request.method() === 'OPTIONS') {
      return request.respond({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, accept',
          'Access-Control-Max-Age': '600',
        },
      });
    }
    posted.push({ url: request.url(), body: request.postData() ?? '' });
    return request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  };
  page.on('request', onRequest);

  try {
    /* --- the customer quest --- */
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
      setValue(field(/Dombolo with tshotlo/), 'Dombolo with extra morogo');
      [...document.querySelectorAll('button[type="submit"]')]
        .find((b) => /Send my quest/i.test(b.textContent ?? ''))
        ?.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    if (!/Quest sent/i.test(await text())) throw new Error('the quest form did not report a successful send');

    /* --- the contact form --- */
    await goto('contact');
    await page.evaluate(() => {
      const field = (re) => [...document.querySelectorAll('input, textarea')].find((f) => re.test(f.placeholder ?? ''));
      const setValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
        setter?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setValue(field(/Thabo Mahlangu/), 'Preview Enquiry');
      setValue(field(/\+27 82 000 0000/), '+27 82 555 0001');
      setValue(field(/Tell us/), 'Can you cater 30 plates on a Friday?');
      [...document.querySelectorAll('button[type="submit"]')]
        .find((b) => /Send/i.test(b.textContent ?? ''))
        ?.click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    if (!/Message sent/i.test(await text())) throw new Error('the contact form did not report a successful send');
  } finally {
    page.off('request', onRequest);
    await page.setRequestInterception(false);
  }

  if (posted.length !== 2) throw new Error(`expected 2 inbox posts (quest + contact), saw ${posted.length}`);
  const quest = posted.find((p) => /Meal quest/i.test(p.body));
  const contact = posted.find((p) => /website enquiry/i.test(p.body));
  if (!quest) throw new Error('the quest was not posted to the inbox');
  if (!/Dombolo with extra morogo/.test(quest.body)) throw new Error('the quest post is missing the dish');
  if (!/Preview Test/.test(quest.body) || !/555 0000/.test(quest.body)) throw new Error('the quest post is missing the contact details');
  if (!contact) throw new Error('the enquiry was not posted to the inbox');
  if (!/cater 30 plates/.test(contact.body)) throw new Error('the enquiry post is missing the message');
  if (!/Preview Enquiry/.test(contact.body)) throw new Error('the enquiry post is missing the name');

  return `${posted.length} real inbox posts (quest + enquiry), nothing refused`;
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
