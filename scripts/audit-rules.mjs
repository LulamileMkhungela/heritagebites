/**
 * The owner's standing rules, checked against the *rendered* site.
 *
 * Every rule here was an instruction, and most of them have been broken at least
 * once by a later change — a rest-day rewrite, a rename, a copy block. So they are
 * read off live pages rather than grepped from source: what matters is what a
 * customer sees, not what the file says.
 *
 * Usage: node scripts/audit-rules.mjs   (server on :4000)
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const BASE = process.env.HB_BASE_URL ?? 'http://127.0.0.1:4000';
const ROUTES = ['/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest'];

const { exe, libPath } = await prepareRuntime();
const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: exe,
  env: { ...process.env, LD_LIBRARY_PATH: libPath },
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const text = {};
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1500));
  text[route] = await page.evaluate(() => document.body.innerText);
}

const warnings = [];
const ok = [];
const rule = (label, fn) => {
  const hits = fn();
  if (!hits.length) ok.push(label);
  else warnings.push(`${label} — ${hits.join('; ')}`);
};

const all = Object.entries(text);
const where = (re) => all.filter(([, t]) => re.test(t)).map(([r]) => r);
const grep = (re) =>
  all.flatMap(([r, t]) => (t.match(re) ? [...t.matchAll(re)].slice(0, 2).map((m) => `${r}: "${m[0].slice(0, 40)}"`) : []));

/* ---------------------------------------------------------------- */
/* 1. "cart", never "basket"                                         */
/* ---------------------------------------------------------------- */
rule('says cart, never basket', () => where(/\bbasket/i));

/* 2. "request", never "quest" (customer-facing) */
rule('says request, never quest', () => where(/\bquests?\b/i));

/* 3. delivery only — no collection anywhere */
/*
 * The policies page says "there is no collection point to meet at" — an honest
 * sentence *denying* collection. A rule that greps for the phrase flags the one
 * place that does the right thing, so the negative statements are stripped first.
 */
rule('offers no collection point', () =>
  where(/collection point|collect from|pick up from/i).filter((r) => {
    const stripped = text[r]
      .replace(/there is no collection[^.]*\./gi, '')
      .replace(/no collection point[^.]*\./gi, '')
      .replace(/collection was removed[^.]*\./gi, '');
    return /collection point|collect from|pick up from/i.test(stripped);
  }));

/* 4. the copy blocks that had to go */
rule('has no prep-time or delivery-estimate row', () => where(/prep time|estimated delivery|delivery estimate/i));
rule('has no minimum-order paragraph', () => where(/minimum order of R|R100 minimum.*spend/i));
rule('has no "no email receipts" line', () => where(/no email receipts/i));

/* 5. no language / native-name labels on meals */
rule('shows no language labels on meals', () => where(/\b(Sepedi|Setswana|isiZulu|Zulu|Sotho)\b/));

/* 6. plate names drop the word "Plate" (except two) */
rule('plate names drop the word Plate', () =>
  grep(/\b(Mala-Mogodu Plate|Tshotlo Plate|Smiley Plate|Tlhakwana Plate)\b/g));

/* 7. the back-to-top button is not in the way at the top */
/* (checked interactively elsewhere) */

/* 8. display name is "HeritageBites" in app chrome, "Heritage Bites" in prose */
rule('does not use "HeritageBites" as prose in body copy', () => grep(/\bHeritageBites\b/g).filter((h) => !/passport|alerts/.test(h)));

/* ---------------------------------------------------------------- */
/* Per-page checks                                                   */
/* ---------------------------------------------------------------- */
const menu = text['/menu'] ?? '';
rule('menu offers the stepper price on starch rows', () =>
  /extra portion/i.test(menu) ? [] : ['the extra-portion price is not stated on the menu page']);

rule('menu no longer promises "as many as you like"', () =>
  /as many starches/i.test(menu) ? ['/menu: stale "as many starches" promise'] : []);

const home = text['/'] ?? '';
rule('home no longer promises "as many as you like"', () =>
  /as many starches/i.test(home) ? ['/: stale "as many starches" promise'] : []);

/* The rest-day copy, whichever day it is */
const specials = text['/specials'] ?? '';
if (/rest day|not cooking/i.test(specials)) {
  rule('rest-day copy names the cooking days', () => (/Thursdays?\s*(and|&)\s*Fridays?/i.test(specials) ? [] : ['/specials: no cooking days']));
  rule('rest-day copy says ordering is not blocked', () =>
    /still (schedule|order)|nothing is blocked|can still order/i.test(specials) ? [] : ['/specials: does not say ordering continues']);
  rule('rest-day copy mentions the 24-hour lead time', () => (/24 hours/i.test(specials) ? [] : ['/specials: no 24 hours']));
  rule('rest-day copy offers catering on WhatsApp', () => (/catering/i.test(specials) && /whatsapp/i.test(specials) ? [] : ['/specials: no catering/WhatsApp']));
}

/* Checkout must not offer to complete below the minimum */
const checkout = text['/checkout'] ?? '';
rule('empty checkout does not offer to order', () =>
  /complete order|place order/i.test(checkout) && /cart is empty/i.test(checkout) ? ['/checkout: offers to order with an empty cart'] : []);

console.log(`\n${ok.length} rule(s) hold, ${warnings.length} problem(s)\n`);
for (const o of ok) console.log(`  ok    ${o}`);
for (const w of warnings) console.log(`  FAIL  ${w}`);

await browser.close();
process.exit(warnings.length ? 1 : 0);
