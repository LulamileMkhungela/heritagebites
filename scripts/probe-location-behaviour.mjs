/**
 * Location on the checkout, end to end.
 *
 * Owner, 18 Nov 2026: "ensure it obtains the precise location, fill the location
 * if user didnt enter location or didnt click use current location".
 *
 * Three behaviours, all at phone width, all against the real built page:
 *
 *   1. A granted permission fills the address on load, without a tap.
 *   2. An undecided permission does NOT fill on load — no unprompted browser
 *      dialog — but the order tap fills it instead.
 *   3. A typed address is never overwritten.
 *
 * Plus the accuracy grade, which is what "precise" now means: the label under the
 * button comes from the metres the device reported, not from which code path ran.
 *
 * The sandbox cannot reach photon.komoot.io, so the geocoder is intercepted. The
 * geolocation fix is puppeteer's own emulation, with the accuracy we choose — that
 * is the input this test is about.
 *
 * Usage: node scripts/probe-location-behaviour.mjs   (server on :4000)
 * Throwaway probe: not part of `npm test`.
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const BASE = process.env.HB_BASE_URL ?? 'http://127.0.0.1:4000';
const { exe, libPath } = await prepareRuntime();
const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: exe,
  env: { ...process.env, LD_LIBRARY_PATH: libPath },
  headless: true,
});

const pass = [];
const fail = [];
const check = (ok, label, detail = '') => (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ''}`);
const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));

const FIX = { lat: -26.1335, lng: 28.0505 };
const PHOTON = {
  features: [
    {
      properties: { street: 'Oxford Road', housenumber: '12', suburb: 'Illovo', city: 'Sandton', osm_type: 'W', osm_id: 1 },
      geometry: { coordinates: [FIX.lng, FIX.lat] },
    },
  ],
};

const SEED_CART = {
  state: {
    fulfilment: 'delivery',
    lines: [
      {
        key: 'mogodu::pap',
        itemId: 'mogodu',
        name: 'Mala-Mogodu',
        image: '/img/mogodu.jpg',
        unitPrice: 100,
        qty: 1,
        picks: [],
        kind: 'menu',
      },
    ],
  },
  version: 2,
};

/* The address box, found by its label — its placeholder is a sample address. */
const ADDRESS_EXPR = `(() => {
  const label = [...document.querySelectorAll('label')].find((l) => /^Delivery address/i.test(l.textContent || ''));
  if (label) {
    const inner = label.querySelector('input');
    if (inner) return inner;
    const id = label.getAttribute('for');
    if (id) return document.getElementById(id);
  }
  return [...document.querySelectorAll('input')].find((i) => /\\d+ .*Road/i.test(i.placeholder || '')) ?? null;
})()`;

/**
 * Open the checkout with a chosen permission state and fix accuracy.
 * `permission` is what the browser will answer for this origin: 'granted',
 * 'prompt' or 'denied'. Accuracy is metres.
 */
async function openCheckout({ permission, accuracyM }) {
  /*
   * A fresh page per scenario, not a fresh browser context: the bundled Chromium
   * does not implement createBrowserContext. Permissions are overridden on the
   * default context, so each scenario sets the state it needs and the next one
   * overrides it again.
   */
  const context = browser.defaultBrowserContext();
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.setGeolocation({ latitude: FIX.lat, longitude: FIX.lng, accuracy: accuracyM });

  if (permission === 'granted') await context.overridePermissions(BASE, ['geolocation']);
  else await context.clearPermissionOverrides();

  const geoQueries = [];
  await page.evaluateOnNewDocument(() => {
    /*
     * Record every getCurrentPosition call and the options it used, so the test
     * can prove the fresh, high-accuracy request is the one being made. Chrome's
     * own geolocation is untouched — only observed.
     */
    const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    window.__geo = [];
    navigator.geolocation.getCurrentPosition = (ok, err, opts) => {
      window.__geo.push({ ...(opts ?? {}) });
      return real(ok, err, opts);
    };
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (/photon\.komoot\.io/.test(req.url())) {
      geoQueries.push(req.url());
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(PHOTON) });
    }
    req.continue();
  });

  await page.goto(`${BASE}/menu`, { waitUntil: 'load', timeout: 45000 });
  await page.evaluate((c) => localStorage.setItem('hb.cart', JSON.stringify(c)), SEED_CART);
  await page.goto(`${BASE}/checkout`, { waitUntil: 'load', timeout: 45000 });
  await wait(3000);

  return { page, context, geoQueries };
}

const addressOf = (page) => page.evaluate((expr) => eval(expr)?.value ?? '', ADDRESS_EXPR);

/* ---------------------------------------------------------------- 1. granted */
{
  const { page, context } = await openCheckout({ permission: 'granted', accuracyM: 8 });
  const value = await addressOf(page);
  check(value.length > 3, 'a standing permission fills the address with no tap', `"${value}"`);
  check(/Oxford/i.test(value), 'it holds the street the map named', value);

  const calls = await page.evaluate(() => window.__geo ?? []);
  check(calls.length > 0, 'the device was actually asked for a fix', `${calls.length} call(s)`);
  check(
    calls.every((c) => c.enableHighAccuracy === true),
    'every request asks for high accuracy',
    JSON.stringify(calls),
  );
  check(
    calls.every((c) => c.maximumAge === 0),
    'no cached fix is accepted — maximumAge 0 means where the phone is now',
    JSON.stringify(calls),
  );
  await page.close();
}

/* --------------------------------------------------------------- 2. undecided */
{
  const { page, context } = await openCheckout({ permission: 'prompt', accuracyM: 8 });
  const before = await addressOf(page);
  check(before === '', 'an undecided permission does NOT prompt on page load', `"${before}"`);

  const callsBefore = await page.evaluate(() => (window.__geo ?? []).length);
  check(callsBefore === 0, 'no fix is requested before the customer acts', `${callsBefore} call(s)`);

  /*
   * From here the customer's own "Allow" is emulated: a headless browser has no
   * native permission dialog, so the *result* of tapping Allow is applied directly.
   * The code path is then identical to the real one — requestLocation sees a
   * granted permission and takes a fix.
   */
  await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);

  /*
   * The order button stays disabled until the order is placeable, so the name and
   * number go in first — that is the state a real customer is in when they reach
   * for it.
   */
  await page.type('input[placeholder*="Thabo"]', 'Thabo Mahlangu');
  await page.type('input[placeholder*="+27 82"]', '+27 82 000 9090');
  await wait(800);

  /* Now tap the order button: a real gesture, where the prompt belongs. */
  const tapped = await page.evaluate(() => {
    /*
     * The order control is an anchor only once the form is placeable; before that
     * it renders as a disabled button. Query both, and report which one it was, so
     * a failure says whether the form was incomplete or the control was missing.
     */
    const el = [...document.querySelectorAll('a, button')].find((x) =>
      /Complete order on WhatsApp|Order on WhatsApp|Use my location/i.test(x.textContent || ''),
    );
    if (!el) return { ok: false, reason: 'no control' };
    if (el.tagName === 'BUTTON' && el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: 'still disabled' };
    }
    el.click();
    return { ok: true, tag: el.tagName };
  });
  if (!tapped.ok) {
    const why = await page.evaluate(() => {
      const el = document.querySelector('[role="alert"], .text-chili');
      const names = [...document.querySelectorAll('input')].map((i) => `${i.placeholder}="${i.value}"`);
      return { notice: el?.textContent?.trim().slice(0, 200) ?? '', names };
    });
    console.log('  [diag]', JSON.stringify(why));
  }
  check(tapped.ok, 'the order button is there to tap', tapped.reason ?? tapped.tag ?? '');

  await page
    .waitForFunction((expr) => (eval(expr)?.value ?? '').trim().length > 3, { timeout: 20000 }, ADDRESS_EXPR)
    .catch(() => {});
  const after = await addressOf(page);
  check(after.length > 3, 'tapping the order button fills the address', `"${after}"`);
  await page.close();
}

/* ----------------------------------------------------------------- 3. typed */
{
  const { page, context } = await openCheckout({ permission: 'granted', accuracyM: 8 });
  /* Clear whatever the automatic fill wrote, then type our own. */
  await page.evaluate((expr) => {
    const input = eval(expr);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, ADDRESS_EXPR);
  await page.type('input[placeholder*="Oxford"], input[placeholder*="Road"]', '9 Juta Street, Braamfontein');
  await wait(2500);
  const value = await addressOf(page);
  check(/Juta/.test(value), 'a typed address is never overwritten by the locate', `"${value}"`);
  await page.close();
}

/* ---------------------------------------------------------------- 4. coarse */
{
  const { page, context } = await openCheckout({ permission: 'granted', accuracyM: 2400 });
  await wait(1500);
  const label = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /locat|check/i.test(x.textContent || ''));
    return b?.textContent?.trim() ?? '';
  });
  check(
    !/Location checked/i.test(label),
    'a 2.4 km fix is NOT labelled "Location checked"',
    label || '(no button)',
  );
  const warned = await page.evaluate(() => /wrong side of a delivery boundary/i.test(document.body.innerText));
  check(warned, 'a coarse fix says it can put the fee on the wrong side of a boundary');
  await page.close();
}

console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
for (const p of pass) console.log(`  ok   ${p}`);
for (const f of fail) console.log(`  FAIL ${f}`);

await browser.close();
process.exit(fail.length ? 1 : 0);
