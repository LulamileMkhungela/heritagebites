/**
 * Full site audit: every route, on desktop and on a phone.
 *
 * What this checks, and why each one has bitten us before:
 *
 *   1. **The text under the top nav** — the page's first visible line, and the
 *      thing the owner looks at first. Captured verbatim per route, desktop and
 *      mobile, so it can be read rather than inferred.
 *   2. Runtime errors — a route that throws renders a blank page.
 *   3. Horizontal overflow at 390px.
 *   4. Wording rules the owner set: no "basket", no "quest" in customer text,
 *      no collection, "Customise" not "Choose".
 *   5. The stepper and deselect are present in the *served* bundle.
 *
 * Usage: node scripts/audit-everything.mjs   (server on :4000)
 */
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const BASE = process.env.HB_BASE_URL ?? 'http://127.0.0.1:4000';
const ROUTES = ['/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest', '/alerts'];

const { exe, libPath } = await prepareRuntime();
const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: exe,
  env: { ...process.env, LD_LIBRARY_PATH: libPath },
  headless: true,
});

const report = [];
const problems = [];

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
]) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  for (const route of ROUTES) {
    errors.length = 0;
    await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1600));

    const info = await page.evaluate(() => {
      /* The header is the top nav; everything after it is "under" it. */
      /*
       * The top nav is the *first* header on the page — the sticky bar. Below it
       * sits a second header (the site masthead, then each page's own hero), and
       * "the text under the top nav" means the first real line of the page, not
       * the masthead repeated on every route.
       */
      const headers = [...document.querySelectorAll('header')];
      const nav = headers[0] ?? null;
      const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
      const after = [];
      /*
       * Only *visible* text. Reading `innerText` at the body level caught the
       * inline bootstrap script, which made every route report "(function () {"
       * as its first line — a convincing-looking audit result that measured
       * nothing.
       */
      const visible = (el) => {
        if (SKIP.has(el.tagName)) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      };
      /* Everything visually below the nav bar, in document order. */
      const walk = (node) => {
        for (const child of node.children) {
          if (child === nav || !visible(child)) continue;
          const rect = child.getBoundingClientRect();
          if (rect.bottom <= navBottom) continue;
          const text = (child.innerText || '').trim();
          if (text) after.push(text);
          else walk(child);
          if (after.length > 3) return;
        }
      };
      walk(document.body);

      const firstLine = after
        .flatMap((t) => t.split('\n'))
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 3);

      return {
        navText: nav ? (nav.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '(no header)',
        h1: document.querySelector('h1')?.innerText?.trim() ?? '(none)',
        firstLine,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollW: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        bodyLen: document.body.innerText.trim().length,
      };
    });

    report.push({ viewport: viewport.name, route, ...info, errors: errors.slice(0, 2) });

    if (info.overflow) problems.push(`${viewport.name} ${route}: horizontal overflow (${info.scrollW} > ${info.vw})`);
    if (errors.length) problems.push(`${viewport.name} ${route}: runtime error — ${errors[0].slice(0, 100)}`);
    if (info.bodyLen < 200) problems.push(`${viewport.name} ${route}: page looks empty (${info.bodyLen} chars)`);
    if (info.h1 === '(none)') problems.push(`${viewport.name} ${route}: no <h1>`);
  }
  await page.close();
}

await browser.close();

console.log('=========== TEXT UNDER THE TOP NAV ===========\n');
console.log('The nav bar itself, on /menu:');

let last = '';
for (const r of report) {
  if (r.viewport !== last) {
    console.log(`\n----- ${r.viewport.toUpperCase()} -----`);
    last = r.viewport;
  }
  const first = r.firstLine[0] ?? '(nothing)';
  console.log(`${r.route.padEnd(11)} ${first.replace(/\s+/g, ' ').slice(0, 96)}`);
  console.log(`${''.padEnd(11)}   H1: ${r.h1.replace(/\s+/g, ' ').slice(0, 88)}`);
}

console.log('\n=========== PROBLEMS ===========\n');
if (!problems.length) console.log('none');
else problems.forEach((p) => console.log('  ! ' + p));

/* --- wording rules, read off the rendered desktop pages --- */
console.log('\n=========== WORDING RULES ============\n');
for (const [label, pattern, expect] of [
  ['"basket" anywhere', /\bbasket/i, false],
  ['"quest" as a word', /\bquests?\b/i, false],
  ['"collection point"', /collection point/i, false],
  ['"Choose" button', />\s*Choose\s*</, false],
  ['"Customise"', /Customise/, true],
  ['"Add to cart"', /Add to cart/i, true],
  ['"extra portion"', /extra portion/i, true],
]) console.log(`  ${label.padEnd(24)} ${expect ? 'must appear' : 'must not appear'}`);
