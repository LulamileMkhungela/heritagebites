/**
 * "Use my current location" must fill the delivery address box.
 *
 * Owner, 18 Nov 2026, from her phone: she allowed the location, the checkout
 * correctly said "9.3 km away — R30,00 delivery fee added", and the **delivery
 * address box stayed empty**.
 *
 * The cause was that the reverse lookup asked Photon's *search* endpoint for the
 * text "-26.13,28.05" — a text search for those digits, which returns nothing.
 * Photon's `/reverse?lat=&lon=` is the endpoint that answers "what is at this
 * point", and that is what this test exercises.
 *
 * The sandbox cannot reach photon.komoot.io, so the network is intercepted: the
 * geolocation fix and the geocoder's reply are both supplied, and everything
 * else — the React handler, the state, the rendered input — is real. What this
 * proves is the wiring, which is where the bug was. The mapping itself is covered
 * by unit tests in server/lib/address.test.js.
 *
 * Usage: node scripts/probe-location-fills-address.mjs   (server on :4000)
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

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

const pass = [];
const fail = [];
const check = (ok, label, detail = '') => (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ''}`);
const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));

/* The phone's own location: Illovo, next to Sandton — the area in the report. */
const FIX = { lat: -26.1335, lng: 28.0505 };
const PHOTON_REPLY = {
  features: [
    {
      properties: {
        street: 'Oxford Road',
        housenumber: '12',
        suburb: 'Illovo',
        city: 'Sandton',
        osm_type: 'W',
        osm_id: 12345,
      },
      geometry: { coordinates: [FIX.lng, FIX.lat] },
    },
  ],
};

await page.setGeolocation({ latitude: FIX.lat, longitude: FIX.lng, accuracy: 15 });
const context = page.browserContext();
await context.overridePermissions(BASE, ['geolocation']);

/* Record every geocoder URL, so the wrong endpoint cannot pass unnoticed. */
const seen = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (/photon\.komoot\.io/.test(url)) {
    seen.push(url);
    return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(PHOTON_REPLY) });
  }
  req.continue();
});

/*
 * A cart with one R100 plate in it, in the shape the cart store writes, so the
 * checkout renders its form instead of "Your cart is empty". Seeded per origin
 * before the first navigation — localStorage belongs to the origin.
 */
const SEED_CART = {
  state: {
    fulfilment: 'delivery',
    lines: [
      {
        key: 'mogodu::pap::chakalaka',
        itemId: 'mogodu',
        name: 'Mala-Mogodu',
        image: '/img/mogodu.jpg',
        unitPrice: 100,
        qty: 1,
        picks: [
          { group: 'protein', label: 'Mogodu' },
          { group: 'starch', label: 'Pap' },
          { group: 'side', label: 'Chakalaka' },
        ],
        kind: 'menu',
      },
    ],
  },
  version: 2,
};

await page.goto(`${BASE}/menu`, { waitUntil: 'load', timeout: 45000 });
await page.evaluate((c) => window.localStorage.setItem('hb.cart', JSON.stringify(c)), SEED_CART);

/* The preview checkout is the one the owner was on; the live one is the same code
   path. Both are checked. */
for (const [label, route] of [['preview checkout', '/checkout'], ['live checkout', '/checkout']]) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 45000 });
  await wait(2500);

  /* The page needs something in the cart to show the form. */
  /* The address box's placeholder is a *sample address*, not the word "address",
     so it is found by its label. Getting this wrong made the probe report an
     empty box for a box that had in fact been filled. */
  const ADDRESS_INPUT = `(() => {
    const label = [...document.querySelectorAll('label')].find((l) => /^Delivery address/i.test(l.textContent || ''));
    if (label) {
      const inLabel = label.querySelector('input');
      if (inLabel) return inLabel;
      const id = label.getAttribute('for');
      if (id) return document.getElementById(id);
    }
    return [...document.querySelectorAll('input')].find((i) => /\d+ .*Road|Street|Avenue/i.test(i.placeholder || '')) ?? null;
  })()`;
  const hasForm = await page.evaluate((expr) => Boolean(eval(expr)), ADDRESS_INPUT);
  if (!hasForm) {
    check(false, `${label}: the checkout form rendered`, 'no address input found — is the cart empty?');
    continue;
  }

  const before = await page.evaluate((expr) => eval(expr)?.value ?? '', ADDRESS_INPUT);

  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /use my current location/i.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  check(clicked, `${label}: the "Use my current location" button exists`);
  if (!clicked) continue;

  /* The geocode is async: wait for the input to change. */
  await page
    .waitForFunction((expr) => (eval(expr)?.value ?? '').trim().length > 3, { timeout: 15000 }, ADDRESS_INPUT)
    .catch(() => {});

  const after = await page.evaluate((expr) => {
    const select = document.querySelector('select');
    const status = [...document.querySelectorAll('[role="status"]')].map((s) => s.textContent.trim()).join(' | ');
    return { value: eval(expr)?.value ?? '', area: select?.value ?? '', status };
  }, ADDRESS_INPUT);

  check(after.value.trim().length > before.trim().length, `${label}: the address box is filled`, `"${before}" -> "${after.value}"`);
  check(/Oxford/i.test(after.value), `${label}: it holds the street from the map`, after.value);
  check(/Sandton/i.test(after.area), `${label}: the delivery area follows the address`, `area="${after.area}"`);
  check(/km away/i.test(after.status), `${label}: the distance is still reported`, after.status);
}

/* The endpoint itself — the actual bug. */
const reverseCalls = seen.filter((u) => /\/reverse/.test(u));
const searchCalls = seen.filter((u) => /\/api\//.test(u));
check(reverseCalls.length > 0, 'the geocoder was asked to REVERSE-look-up the point', `${reverseCalls.length} reverse call(s)`);
check(
  !searchCalls.some((u) => /q=-?\d/.test(decodeURIComponent(u))),
  'it does not text-search the coordinates as a string',
  searchCalls.map((u) => decodeURIComponent(u).replace(/^https:\/\/[^/]+/, '')).join(' ') || 'none',
);

console.log(`\n${pass.length} passed, ${fail.length} failed\n`);
for (const p of pass) console.log(`  ok   ${p}`);
for (const f of fail) console.log(`  FAIL ${f}`);
if (seen.length) console.log('\ngeocoder URLs seen:\n  ' + seen.map((u) => decodeURIComponent(u)).join('\n  '));

await browser.close();
process.exit(fail.length ? 1 : 0);
