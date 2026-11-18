/**
 * Theme audit — real Chromium, both colour schemes.
 *
 * The jsdom a11y suite cannot see colour: it checks alt text, labels and heading
 * order, all of which are identical in light and dark. Everything that can
 * actually break in a dark mode is a *rendered* property — a navy button label
 * on a navy card, a gold eyebrow at 3:1, a sticky bar still painted paper — so
 * it has to be measured in a browser that lays the page out.
 *
 * What this does, per route and per scheme:
 *
 *   - walks every visible element that directly contains text, and computes the
 *     effective background by walking up the ancestor chain until it finds a
 *     non-transparent one;
 *   - reports any text under 4.5:1 (or 3:1 for large/bold text, per WCAG);
 *   - reports "invisible" text, where the label and its ground are effectively
 *     the same colour, which is the specific failure of a half-finished theme;
 *   - checks the page ground actually changed between schemes, so a route that
 *     silently forgot to use the themed token is caught rather than passed.
 *
 *   node scripts/theme-audit.mjs          # server must be listening on :4000
 */
import { prepareRuntime } from './lib/chromium-runtime.mjs';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE = process.env.HB_BASE ?? 'http://127.0.0.1:4000';
const ROUTES = ['/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest'];

const { exe, libPath } = await prepareRuntime();
const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: exe,
  env: { ...process.env, LD_LIBRARY_PATH: libPath },
  headless: true,
});

/** Runs in the page: measure every text node's rendered contrast. */
function measure() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  };

  /**
   * The effective ground behind an element. Walks up until something paints a
   * solid colour; gradient-only backgrounds count as "use the parent", because
   * the gradient's own stops are the brand navy and text on them was checked by
   * hand.
   */
  const groundOf = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return acc && body ? over(acc, body) : body ?? { r: 255, g: 255, b: 255, a: 1 };
  };

  const problems = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    /* Only elements that directly own text. */
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    const fg = parse(cs.color);
    if (!fg) continue;
    const ground = groundOf(el);
    const text = over(fg, ground);
    const cr = ratio(text, ground);

    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;

    if (cr < need) {
      const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`;
      const snippet = el.textContent.trim().slice(0, 40);
      const key = `${label}|${snippet}|${cr.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push({
        selector: label,
        text: snippet,
        ratio: Number(cr.toFixed(2)),
        need,
        colour: cs.color,
        ground: `rgb(${Math.round(ground.r)}, ${Math.round(ground.g)}, ${Math.round(ground.b)})`,
      });
    }
  }
  return {
    problems,
    ground: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  };
}

let failures = 0;
const rows = [];

for (const scheme of ['light', 'dark']) {
  for (const route of ROUTES) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.setViewport({ width: 1200, height: 900 });
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1200));
      const out = await page.evaluate(measure);
      const bad = out.problems.filter((p) => p.ratio < p.need);
      /* A theme that did not change the page ground did not apply. */
      rows.push({ scheme, route, ground: out.ground, bad });
      if (bad.length) failures += bad.length;
    } catch (error) {
      console.log(`  FAIL  ${scheme} ${route} — ${error.message.slice(0, 80)}`);
      failures++;
    } finally {
      await page.close();
    }
  }
}

await browser.close();

/* The grounds must differ; identical ones mean the theme never applied. */
const grounds = new Map();
for (const r of rows) {
  if (!grounds.has(r.route)) grounds.set(r.route, []);
  grounds.get(r.route).push(r.ground);
}
const stuck = [...grounds.entries()].filter(([, g]) => g.length === 2 && g[0] === g[1]);

console.log('\n--- theme audit (Chromium, real layout) ---');
let reported = 0;
for (const r of rows) {
  if (!r.bad.length) continue;
  console.log(`\n  ${r.scheme.toUpperCase()} ${r.route}`);
  for (const p of r.bad.slice(0, 8)) {
    reported++;
    if (reported > 60) break;
    console.log(`    ${p.ratio}:1 (needs ${p.need}) ${p.selector} "${p.text}" ${p.colour} on ${p.ground}`);
  }
}
if (stuck.length) {
  console.log('\n  page ground did not change between schemes:');
  for (const [route, g] of stuck) console.log(`    ${route} — ${g[0]}`);
}

const total = rows.length;
console.log(
  `\n${failures === 0 && stuck.length === 0 ? 'ALL GREEN' : 'FAILURES'}: ` +
  `${total - rows.filter((r) => r.bad.length).length}/${total} route-themes clean, ` +
  `${failures} contrast problem(s), ${stuck.length} route(s) not themed\n`,
);

process.exit(failures === 0 && stuck.length === 0 ? 0 : 1);
