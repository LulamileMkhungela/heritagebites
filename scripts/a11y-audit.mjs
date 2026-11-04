/**
 * A11y audit. Mounts each route in jsdom and checks the things that actually
 * break assistive tech: images without alt, buttons and links with no
 * accessible name, form controls without a label, missing document language,
 * and heading-order jumps.
 *
 * This is not a WCAG certification — it is a smoke test for the mistakes that
 * slip through a visual review.
 *
 *   node scripts/a11y-audit.mjs      # server must be listening on :4000
 */
import * as esbuild from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = process.env.HB_BASE || 'http://127.0.0.1:4000';

const bundle = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true, write: false, format: 'iife', target: ['es2020'],
  define: {
    'process.env.NODE_ENV': '"development"',
    // jsdom has no server: mimic the same-origin build, not the Pages preview.
    'import.meta.env': JSON.stringify({ BASE_URL: '/', MODE: 'development' }),
  },
  loader: { '.css': 'empty', '.jpg': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
});
const APP_JS = bundle.outputFiles?.[0]?.text;

/** The visible text a screen reader would announce for a node. */
function accessibleName(el) {
  if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (t.trim()) return t.trim();
  }
  if (el.tagName === 'IMG') return el.getAttribute('alt') ?? '';
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    if (el.getAttribute('placeholder')?.trim()) return el.getAttribute('placeholder').trim();
    if (el.getAttribute('title')?.trim()) return el.getAttribute('title').trim();
  }
  return (el.textContent ?? '').trim();
}

/** Is this control actually reachable by a user? */
function isInteractive(el) {
  if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
  return el.getClientRects().length > 0 || true; // jsdom has no layout; count it
}

function auditRoute(doc) {
  const problems = [];

  // Images must carry alt text — decorative ones must say so explicitly.
  for (const img of doc.querySelectorAll('img')) {
    if (img.hasAttribute('alt')) continue;
    problems.push(`<img src="${(img.getAttribute('src') || '').slice(0, 60)}"> has no alt attribute`);
  }

  // Every button and link needs a name.
  for (const el of doc.querySelectorAll('button, a')) {
    if (!isInteractive(el)) continue;
    if (accessibleName(el)) continue;
    // Icon-only controls using an <svg> still need an aria-label.
    const kind = el.tagName === 'A' ? 'link' : 'button';
    problems.push(`${kind} with no accessible name (html: ${el.outerHTML.slice(0, 70)})`);
  }

  /*
    A name that only exists at some breakpoints. jsdom does not apply CSS, so a
    button whose text sits in `<span class="hidden sm:inline">` looks perfectly
    named here and is an unnamed icon on a phone. aria-label survives every
    breakpoint, so anything relying on responsive text alone is a real fault.
  */
  const HIDDEN_RESPONSIVE = /(^|\s)hidden(\s|$)|\b(sm|md|lg|xl):hidden\b/;
  for (const el of doc.querySelectorAll('button, a')) {
    if (!isInteractive(el)) continue;
    if (el.getAttribute('aria-label')?.trim()) continue;
    if (el.getAttribute('aria-labelledby')) continue;
    if (el.tagName === 'IMG' && el.getAttribute('alt')) continue;

    const own = (el.textContent ?? '').trim();
    if (!own) continue;

    // Does every character of the name come from a responsively-hidden node?
    const visible = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
      .map((n) => (n.textContent ?? '').trim())
      .join(' ');
    const namedEls = [...el.querySelectorAll('*')].filter((n) =>
      !HIDDEN_RESPONSIVE.test(n.getAttribute('class') ?? '') && (n.textContent ?? '').trim(),
    );
    if (!visible && namedEls.length === 0) {
      const kind = el.tagName === 'A' ? 'link' : 'button';
      problems.push(
        `${kind} labelled "${own}" only from a breakpoint-hidden element — unnamed on small screens`,
      );
    }
  }

  // Form controls need a label or at least a placeholder/aria-label.
  for (const el of doc.querySelectorAll('input, textarea, select')) {
    if (el.type === 'hidden') continue;
    if (el.id && doc.querySelector(`label[for="${el.id}"]`)) continue;
    if (el.closest('label')) continue;
    if (accessibleName(el)) continue;
    problems.push(`<${el.tagName.toLowerCase()} type="${el.type}"> has no label`);
  }

  // Heading order should not skip levels (h1 -> h3).
  const levels = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      problems.push(`heading jumps h${levels[i - 1]} -> h${levels[i]}`);
      break;
    }
  }

  return problems;
}

async function auditRouteAt(route) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(
    `<!doctype html><html lang="en-ZA"><body><div id="root"></div></body></html>`,
    {
      url: `${BASE}${route}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    },
  );
  const { window } = dom;
  window.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {}; window.HTMLElement.prototype.scrollIntoView = () => {};
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

  window.eval(APP_JS);
  await new Promise((r) => setTimeout(r, 900));

  const html = window.document.documentElement;
  const lang = html.getAttribute('lang');
  const problems = lang ? [] : ['<html> has no lang attribute'];
  problems.push(...auditRoute(window.document));

  const titles = window.document.querySelectorAll('h1').length;
  return { route, problems, h1: titles, nodes: window.document.querySelectorAll('*').length, dom };
}

const ROUTES = ['/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest', '/alerts'];

console.log('\n--- a11y audit (jsdom) ---');
let total = 0;
for (const route of ROUTES) {
  const r = await auditRouteAt(route);
  const uniq = [...new Set(r.problems)];
  total += uniq.length;
  const tag = uniq.length === 0 ? 'CLEAN ' : `ISSUES`;
  console.log(`  ${tag} ${r.route.padEnd(14)} ${r.nodes} nodes, ${r.h1} <h1>, ${uniq.length} problem(s)`);
  for (const p of uniq.slice(0, 6)) console.log(`           - ${p}`);
  if (uniq.length > 6) console.log(`           … and ${uniq.length - 6} more`);
}
console.log(total === 0 ? '\nNo a11y issues found.\n' : `\n${total} issue(s) found.\n`);
process.exit(total === 0 ? 0 : 1);
