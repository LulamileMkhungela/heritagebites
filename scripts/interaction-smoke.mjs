/**
 * Interaction smoke test.
 *
 * render-smoke.mjs proves pages paint. This one drives them: it clicks the
 * buttons, fills the form, and places a real order against the live API.
 * "All elements are clickable and interactive" is a claim about behaviour,
 * and behaviour needs to be exercised, not inferred.
 *
 * Usage: node scripts/interaction-smoke.mjs   (server must be on :4000)
 */
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:4000';

const bundle = (
  await build({
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
  })
).outputFiles[0].text;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const orderCount = async () => (await fetch(`${BASE}/api/health`).then((r) => r.json())).orders;

const results = [];
const step = (label, fn) =>
  (async () => {
    try {
      const detail = await fn();
      results.push(['PASS', label, detail ?? '']);
    } catch (e) {
      results.push(['FAIL', label, e.message]);
    }
  })();

function boot(path, { seedCart } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  /*
   * jsdom cannot leave the document. The checkout navigates twice by design — to
   * Yoco's payment page and to the order page — so those two notices are
   * expected, and anything else still counts as a runtime error.
   */
  vc.on('jsdomError', (e) => {
    if (/Not implemented: navigation/i.test(e.message)) return;
    errors.push(`jsdomError: ${e.message}`);
  });
  vc.on('error', (...a) => {
    const msg = a.join(' ');
    /*
     * jsdom cannot navigate, and the checkout legitimately navigates twice: to
     * Yoco's payment page (a browser redirect) and to the tracking page. Both
     * are reported as "Not implemented: navigation" and are expected here.
     */
    if (!/Not implemented: HTMLCanvasElement|Could not parse CSS|Not implemented: navigation/i.test(msg)) {
      errors.push(`console.error: ${msg}`);
    }
  });

  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: `${BASE}${path}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.fetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
    return fetch(url, init);
  };
  w.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

  /* Record scroll intent. jsdom has no layout, so the only way to assert that
     an anchor link actually jumps somewhere is to watch what gets called. */
  const scrolls = [];
  const observers = [];
  w.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  };
  w.scrollTo = (o) => scrolls.push({ kind: 'scrollTo', arg: o });
  w.HTMLElement.prototype.scrollIntoView = function () {
    scrolls.push({ kind: 'scrollIntoView', id: this.id || this.tagName });
    for (const observer of observers) {
      if (observer.targets.includes(this)) observer.callback([{ target: this, isIntersecting: true, intersectionRatio: 1 }], observer);
    }
  };
  w.confirm = () => true;
  w.alert = () => {};
  if (seedCart) w.localStorage.setItem('hb.cart', JSON.stringify(seedCart));

  w.eval(bundle);

  const doc = w.document;
  const text = () => doc.body.textContent ?? '';
  const all = () => [...doc.querySelectorAll('*')];
  const byText = (sel, re) => all().filter((el) => el.matches?.(sel) && re.test(el.textContent ?? ''));
  /** Matches on aria-label, which for icon cards is NOT in textContent. */
  const byLabel = (sel, re) => all().filter((el) => el.matches?.(sel) && re.test(el.getAttribute('aria-label') ?? ''));
  const click = (el) => {
    if (!el) throw new Error('nothing to click');
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
  };
  const waitFor = async (fn, label, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await fn()) return;  // awaited: an async predicate returns a truthy Promise
      await sleep(120);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const setInput = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };

  /* Dispatch from the focused element the way a real keypress does. Firing on
     window gives an event path of [window], which never reaches a capture
     listener on document — an earlier draft of the overlay test did that and
     reported a close that had not actually happened. */
  const press = (k) =>
    (doc.activeElement || doc.body).dispatchEvent(
      new w.KeyboardEvent('keydown', { key: k, bubbles: true }),
    );
  const dialogs = () => [...doc.querySelectorAll('[role="dialog"]')];
  const focusInsideDialog = () => {
    const d = dialogs()[0];
    return d ? d.contains(doc.activeElement) : false;
  };

  return { w, doc, text, all, byText, byLabel, click, waitFor, setInput, scrolls, press, dialogs, focusInsideDialog, errors, close: () => w.close() };
}

/* ------------------------------------------------------------------ */
/* Flow 1: browse -> open dish -> add to basket -> basket reflects it  */
/* ------------------------------------------------------------------ */

const s1 = boot('/menu');
await s1.waitFor(() => /The full menu/i.test(s1.text()), 'menu page');

const arch = boot('/menu');
await arch.waitFor(() => /Heritage Pots/i.test(arch.text()), 'archive sections', 15000);

await step('the menu sells exactly the two approved plate categories', async () => {
  for (const c of ['Traditional Plates', 'Contemporary Plates']) {
    if (!s1.text().includes(c)) throw new Error(`missing category: ${c}`);
  }
  /*
   * The old categories are back by the owner's request, but only as the
   * view-only archive below the menu — never as a sellable section or a
   * category chip. An archived name appearing in the sticky category nav would
   * mean it had leaked back into the menu proper.
   */
  const nav = s1.doc.querySelector('nav[aria-label="Meal categories"]');
  const navText = nav?.textContent ?? '';
  for (const name of [/Heritage Pots/, /Kasi Fast Food/, /Morning Heritage/, /Sides & Relishes/]) {
    if (!name.test(navText)) throw new Error(`the archive category chip is missing from the menu nav: ${name}`);
  }
  /*
   * Modern Favourites was dropped by the owner: every dish in it — short ribs,
   * wings — is already a Contemporary plate, and a "coming soon" tag on food
   * that is on sale today is just confusing.
   */
  if (/Modern Favourites/.test(navText)) throw new Error('the duplicated Modern Favourites category is still in the nav');
  if (/Cold & Warm/.test(navText)) throw new Error('the unapproved drinks category must stay commented out');

  const sellableSections = s1.doc.querySelectorAll('main > section[data-sellable]');
  if (sellableSections.length !== 2) {
    throw new Error(`expected 2 sellable sections, found ${sellableSections.length}`);
  }
  const archiveSections = [...arch.doc.querySelectorAll('main > section')].filter((section) =>
    section.querySelector('[data-coming-soon]'),
  );
  if (archiveSections.length !== 4) {
    throw new Error(`expected 4 archive sections, found ${archiveSections.length}`);
  }
  return '2 sellable sections plus 4 archive chips';
});

await step('a category heading carries its plate count inline and folds its section', async () => {
  const heading = arch.doc.getElementById('menu-heading-traditional');
  const toggle = heading?.querySelector('button');
  if (!toggle) throw new Error('the Traditional Plates heading is not a fold control');
  /*
   * The owner asked for the count on the same line as the category name. It used
   * to sit at the far right of a wrapping row, which on a phone dropped it onto
   * its own line under the heading.
   */
  if (!/^Traditional Plates\s*\d+\s+plates?$/i.test((toggle.textContent ?? '').replace(/\s+/g, ' ').trim())) {
    throw new Error(`the plate count is not inline with the category name: "${toggle.textContent}"`);
  }

  const panel = () => arch.doc.getElementById('menu-panel-traditional');
  if (!panel() || panel().hasAttribute('hidden')) throw new Error('categories should start open');
  arch.click(toggle);
  await sleep(60);
  if (toggle.getAttribute('aria-expanded') !== 'false') throw new Error('tapping the heading did not mark the section collapsed');
  if (!panel().hasAttribute('hidden')) throw new Error('the collapsed section is still on screen');
  arch.click(toggle);
  await sleep(60);
  if (panel().hasAttribute('hidden')) throw new Error('tapping the heading again did not reopen the section');
  return 'count inline with the name; section folds and unfolds';
});

await step('every WhatsApp link opens with a written message, never an empty box', async () => {
  /*
   * The owner's complaint was a "send on WhatsApp" button that opened an empty
   * chat. That bug was one link built by hand, so this walks the whole site and
   * checks every wa.me href: a message has to be there, and a number has to be
   * there too (except the receipt link, which deliberately has no recipient).
   */
  const pages = ['/', '/menu', '/specials', '/contact', '/passport', '/quest'];
  const empty = [];
  for (const path of pages) {
    const session = boot(path);
    await session.waitFor(() => session.doc.querySelectorAll('a[href^="https://wa.me/"]').length > 0, `WhatsApp links on ${path}`, 20000);
    const links = await Promise.all(
      [...session.doc.querySelectorAll('a[href^="https://wa.me/"]')].map((a) => {
        const url = new URL(a.href);
        return { href: a.href, text: url.searchParams.get('text') ?? '', label: (a.textContent ?? '').trim().slice(0, 30) };
      }),
    );
    for (const link of links) {
      if (!link.text.trim()) empty.push(`${path} → "${link.label}" (${link.href.slice(0, 60)})`);
    }
    session.close();
  }
  if (empty.length) throw new Error(`WhatsApp link(s) open an empty message: ${empty.join(' | ')}`);
  return `${pages.length} pages, every WhatsApp link pre-filled`;
});

await step('the phone menu closes when the customer taps away from it', async () => {
  const toggle = s1.byLabel('button', /Toggle navigation/i)[0];
  if (!toggle) throw new Error('the hamburger button is missing');
  const panel = () => [...s1.doc.querySelectorAll('header nav')].find((n) => /Loyalty card/.test(n.textContent ?? ''));
  s1.click(toggle);
  await sleep(60);
  if (!panel()) throw new Error('the hamburger did not open the menu');
  s1.doc.body.dispatchEvent(new s1.w.MouseEvent('pointerdown', { bubbles: true }));
  await sleep(60);
  if (panel()) throw new Error('tapping away from the open menu did not close it');
  return 'the dropdown closes on an outside tap';
});

/*
  Helpers scoped to the search dialog. The palette is an overlay on top of the
  menu page, so an unscoped text match happily finds the dish cards *behind* it
  and reports success while the palette is still showing its empty state. Three
  separate assertions here would have false-passed without this.
*/
const dialog = () => s1.doc.querySelector('[role="dialog"][aria-label="Search the menu"]');
const inDialog = (sel, re) =>
  [...(dialog()?.querySelectorAll(sel) ?? [])].filter((el) => re.test(el.textContent ?? ''));
const dialogText = () => dialog()?.textContent ?? '';
const dialogInput = () => dialog()?.querySelector('input[aria-label="Search dishes"]');

await step('⌘K opens search and typing returns meal suggestions', async () => {
  // The palette is bound to a keydown on window, not a click.
  s1.w.dispatchEvent(
    new s1.w.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
  );
  await s1.waitFor(() => Boolean(dialogInput()), 'search palette to open on ⌘K', 8000);

  if (!/Try one of these/i.test(dialogText())) throw new Error('suggestion chips not shown on empty query');

  s1.setInput(dialogInput(), 'mogodu');
  // Debounced 180ms, then a server round trip.
  await s1.waitFor(() => /Mogodu Plate/i.test(dialogText()), 'results for "mogodu" inside the dialog', 10000);
  if (!/R\s?100/i.test(dialogText())) throw new Error('result does not show the plate price');
  if (!inDialog('button', /\+\s?Add/i).length) throw new Error('result has no "+ Add" control');

  // A nonsense query must say so rather than silently showing nothing.
  s1.setInput(dialogInput(), 'zzzqqq');
  await s1.waitFor(() => /Nothing matches/i.test(dialogText()), 'empty-state message', 10000);

  return 'opened, suggested, priced, empty-state';
});

await step('picking a search result opens that dish on the menu', async () => {
  const input = dialogInput();
  if (!input) throw new Error('search palette closed unexpectedly');
  s1.setInput(input, 'smiley');

  const result = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const hit = inDialog('button', /Smiley Plate/i)[0];
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error(`no "Smiley Plate" result inside the dialog. dialog text: ${dialogText().slice(0, 120)}`);
  })();

  s1.click(result);
  await s1.waitFor(() => s1.w.location.pathname === '/menu', 'navigation to /menu', 10000);
  // The deep link opens the dish sheet; assert the sheet actually opened.
  await s1.waitFor(() => /Add to basket|Choose|Serves/i.test(s1.text()), 'dish sheet to open', 10000);
  return s1.w.location.pathname + s1.w.location.search;
});

await step('overlays trap focus and close on Escape', async () => {
  const checked = [];

  /* All three overlays advertise role="dialog" aria-modal="true", which tells
     assistive tech the page behind is inert. Without focus actually moving in
     and Escape being handled, a keyboard user tabs straight through the dialog
     into the content it claims to block. */

  // 1. dish sheet
  const card = s1.byLabel('button, a, article, div', /Mogodu/i)[0];
  if (!card) throw new Error('no dish card to open');
  s1.click(card);
  await s1.waitFor(() => s1.dialogs().length > 0, 'dish sheet to open', 8000);
  await s1.waitFor(() => s1.focusInsideDialog(), 'focus to move into the dish sheet', 8000);
  s1.press('Escape');
  await s1.waitFor(() => s1.dialogs().length === 0, 'dish sheet to close on Escape', 8000);
  checked.push('dish sheet');

  // 2. basket drawer
  const basket = [...s1.doc.querySelectorAll('button, a')].find((e) =>
    /Basket/i.test(e.getAttribute('aria-label') ?? ''),
  );
  if (!basket) throw new Error('no basket control');
  s1.click(basket);
  await s1.waitFor(() => s1.dialogs().some((d) => d.getAttribute('aria-label') === 'Your basket'), 'basket to open', 8000);
  await s1.waitFor(() => s1.focusInsideDialog(), 'focus to move into the basket', 8000);
  s1.press('Escape');
  await s1.waitFor(() => s1.dialogs().length === 0, 'basket to close on Escape', 8000);
  checked.push('basket');

  // 3. search palette
  s1.w.dispatchEvent(new s1.w.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  await s1.waitFor(() => s1.dialogs().some((d) => d.getAttribute('aria-label') === 'Search the menu'), 'search to open', 8000);
  await s1.waitFor(() => s1.focusInsideDialog(), 'focus to move into search', 8000);
  s1.press('Escape');
  await s1.waitFor(() => s1.dialogs().length === 0, 'search to close on Escape', 8000);
  checked.push('search');

  return checked.join(', ');
});

await step('About Us contains vision, mission and story without separate nav links', async () => {
  const about = s1.byText('a[href="/about"]', /About Us/i)[0];
  if (!about) throw new Error('About Us link not found');
  s1.click(about);
  await s1.waitFor(() => /Every bite tells a story/i.test(s1.text()), 'About Us page', 10000);

  const checked = ['vision', 'mission', 'story'];
  for (const id of checked) {
    if (!s1.doc.getElementById(id)) throw new Error(`About Us is missing its ${id} section`);
    if (s1.doc.querySelector(`nav a[href="/about#${id}"]`)) throw new Error(`${id} should not be a separate top-nav link`);
  }

  s1.click(s1.byText('a[href="/menu"]', /Offering|Meals/i)[0]);
  await s1.waitFor(() => /The full menu/i.test(s1.text()), 'return to the menu', 15000);
  return 'About Us has all three sections; top nav stays simple';
});

await step('the kitchen archive reads like the menu but cannot be ordered', async () => {
  const blocks = [...arch.doc.querySelectorAll('[data-coming-soon]')];
  if (!blocks.length) throw new Error('the archive sections are missing');
  if (blocks.length !== 4) throw new Error(`expected 4 archive sections, found ${blocks.length}`);
  const block = blocks[0];
  const archiveSections = blocks.map((grid) => grid.closest('section'));

  /*
    The owner changed the brief: archive cards now show the same things a
    sellable dish does — photo, name, price and a description — and the only
    thing marking them as unavailable is the "Coming soon" tag on the photo. So
    the guard is no longer "no price", it is "no way to order": nothing inside a
    card grid may be a control, a link or a dish sheet.
  */
  for (const grid of blocks) {
    if (!/R\s?\d/.test(grid.textContent ?? '')) throw new Error('an archive card is missing its guide price');
    if (!/Coming soon/i.test(grid.textContent ?? '')) throw new Error('archive cards are missing their "Coming soon" tag');
    const interactive = grid.querySelectorAll('a, button, input, select, textarea, [role="link"], [role="button"], [onclick]');
    if (interactive.length) throw new Error(`the archive must not be orderable, but a card grid holds ${interactive.length} control(s)`);
  }
  if (arch.doc.querySelectorAll('[data-coming-soon] a').length) throw new Error('an archive card contains a link');

  const body = archiveSections.map((section) => section?.textContent ?? '').join(' ');
  for (const name of [/Heritage Pots/, /Kasi Fast Food/, /Morning Heritage/, /Sides & Relishes/]) {
    if (!name.test(body)) throw new Error(`archive category missing: ${name}`);
  }
  if (/Cold & Warm|Mageu|Rooibos/i.test(body)) throw new Error('unapproved drinks must stay commented out');
  /*
   * Dishes that are already on sale have no business in a "coming soon"
   * section — the owner's complaint. Mogodu, Tshotlo, short rib and wings are
   * all orderable plates today.
   */
  for (const dupe of [/Mogodu & Samp/, /Tshotlo/, /Short Ribs/, /Flame-Grilled Wings/]) {
    if (dupe.test(body)) throw new Error(`a dish that is already on the menu is still in the archive: ${dupe}`);
  }

  /*
   * "Coming soon" belongs to the photo. It was also a badge beside the category
   * heading and the word "soon" in every nav chip, which made the page shout.
   */
  for (const section of archiveSections) {
    const heading = section?.querySelector('h2')?.textContent ?? '';
    if (/coming soon/i.test(heading)) throw new Error('the category heading still carries a coming-soon badge');
  }
  const archiveChips = [...arch.doc.querySelectorAll('nav[aria-label="Meal categories"] button')]
    .filter((chip) => /Heritage Pots|Kasi Fast Food|Morning Heritage|Sides & Relishes/.test(chip.textContent ?? ''));
  for (const chip of archiveChips) {
    if (/soon/i.test(chip.textContent ?? '')) throw new Error(`an archive chip still says "soon": ${chip.textContent}`);
  }

  const placeholders = [...block.querySelectorAll('img')].filter((img) => img.getAttribute('src')?.includes('placeholder'));
  if (placeholders.length) throw new Error('archive cards are showing placeholder images instead of photos');

  return '4 categories, priced cards, 0 order controls';
});

await step('clicking an archive category chip jumps to its section', async () => {
  const chip = arch.byText('nav[aria-label="Meal categories"] button', /Heritage Pots/i)[0];
  if (!chip) throw new Error('no Heritage Pots chip in the category nav');
  arch.click(chip);
  await new Promise((r) => setTimeout(r, 200));
  if (chip.getAttribute('aria-pressed') !== 'true') throw new Error('the chip did not become the active category');
  if (!arch.doc.getElementById('menu-category-heritage-pots')) throw new Error('the archive section has no anchor to jump to');
  return 'chip selects Heritage Pots and its section exists';
});

await step('scrolling to a meal category highlights its sticky category chip', async () => {
  const chip = [...s1.doc.querySelectorAll('nav[aria-label="Meal categories"] button')]
    .find((button) => /Contemporary Plates/i.test(button.textContent ?? ''));
  const section = s1.doc.getElementById('menu-category-contemporary');
  if (!chip || !section) throw new Error('Contemporary category navigation is missing');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await s1.waitFor(() => chip.getAttribute('aria-pressed') === 'true', 'active category chip to update');
  return 'Contemporary Plates is selected when its section is in view';
});

await step('the menu can be sorted by price, with no filter chips', async () => {
  /*
   * Price order is the first thing people look for on a food menu. The prices
   * are read back off the rendered cards, so this checks what a customer sees
   * rather than the state behind it — including that the category sections are
   * reordered, not just the plates inside them.
   */
  const sorter = [...arch.doc.querySelectorAll('select')].find((el) => /sort/i.test(el.getAttribute('aria-label') ?? ''));
  if (!sorter) throw new Error('the menu has no sort control');

  const cardPrices = () => [...arch.doc.querySelectorAll('[data-sellable] article')]
    .map((card) => card.textContent ?? '')
    .map((text) => Number((/R\s?([\d ]+)[,.]00/.exec(text) ?? [])[1]?.replace(/\s/g, '') ?? NaN))
    .filter((n) => Number.isFinite(n));

  sorter.value = 'price-desc';
  sorter.dispatchEvent(new arch.w.Event('change', { bubbles: true }));
  await sleep(300);
  const high = cardPrices();
  if (high.length < 2) throw new Error(`expected priced cards, saw ${high.length}`);
  if (high[0] < high[high.length - 1]) throw new Error(`price: high to low is not descending: ${high.slice(0, 4)}`);

  sorter.value = 'price-asc';
  sorter.dispatchEvent(new arch.w.Event('change', { bubbles: true }));
  await sleep(300);
  const low = cardPrices();
  if (low[0] > low[low.length - 1]) throw new Error(`price: low to high is not ascending: ${low.slice(0, 4)}`);

  /*
   * The filter chips the owner asked for and then asked to drop ("Spicy",
   * "R100 or less", "Available today") must not creep back: this menu is small
   * enough that hiding plates costs more than it saves.
   */
  for (const label of [/R100 or less/i, /^Spicy$/i, /Available today/i, /Clear filters/i]) {
    if (arch.byText('button', label)[0]) throw new Error(`a removed filter chip is back: ${label}`);
  }

  return `${high.length} plates sorted both ways, no filter chips`;
});

await step('clicking a dish opens its detail sheet with the heritage story', async () => {
  const card = s1.byLabel('button[aria-label^="View "]', /Mogodu/)[0];
  if (!card) throw new Error('no dish card found');
  s1.click(card);
  await s1.waitFor(() => /Every bite tells a story/i.test(s1.text()), 'dish story panel');
  if (!/mogodu/i.test(s1.text()) || !/mo-GOH-doo/.test(s1.text())) throw new Error('pronunciation not shown');
  return 'story + pronunciation visible';
});

await step('choosing required options then adding puts the line in the basket', async () => {
  /* A plate needs one starch and one vegetable side. Take the first choice in
     each required group — the sheet paints its story a tick before its option
     buttons mount, so wait for them rather than reading synchronously. */
  await s1.waitFor(() => s1.byText('button[aria-pressed]', /^Pap$/)[0], 'the starch options to mount', 15000);
  const groups = [...s1.doc.querySelectorAll('[role="dialog"] fieldset')];
  let chosen = 0;
  for (const fs of groups) {
    if (!fs.querySelector('.text-ochre-deep')) continue;
    const opt = fs.querySelector('button[aria-pressed]');
    if (!opt) throw new Error('required group has no options');
    s1.click(opt);
    chosen++;
  }
  if (chosen < 2) throw new Error(`expected starch and side groups, found ${chosen}`);
  await sleep(150);
  await s1.waitFor(() => s1.byText('button', /Add to basket/)[0], 'the add button to mount', 15000);
  s1.click(s1.byText('button', /Add to basket/)[0]);
  /*
   * Adding deliberately no longer slides the drawer over the menu — a customer
   * ordering several plates was interrupted between each one. The pinned basket
   * bar is the feedback now, and the drawer opens when it is asked for.
   */
  await s1.waitFor(() => /added to basket/i.test(s1.text()), 'the basket bar to confirm the add', 8000);
  const openBasket = [...s1.doc.querySelectorAll('button, a')].find((e) =>
    /Your basket|Open your basket|^Basket/i.test(`${e.getAttribute('aria-label') ?? ''} ${e.textContent ?? ''}`),
  );
  if (!openBasket) throw new Error('no basket control');
  s1.click(openBasket);
  await s1.waitFor(() => /Your basket/i.test(s1.text()), 'basket drawer');
  if (!/Mogodu Plate/.test(s1.text())) throw new Error('added item not in basket');
  if (!/Pap/.test(s1.text()) || !/Braised cabbage/.test(s1.text())) {
    throw new Error('chosen starch and side are not carried into the basket line');
  }
  return 'plate + starch + side in basket';
});

await step('quantity stepper changes the line and the total', async () => {
  const before = s1.text();
  const inc = s1.byText('button[aria-label="Increase"]', /.+/)[0];
  s1.click(inc);
  await sleep(250);
  const after = s1.text();
  if (before === after) throw new Error('total did not change');
  return 'total updated';
});

/* ------------------------------------------------------------------ */
/* Flow 1a: the delivery address box and its area check                 */
/* ------------------------------------------------------------------ */

/*
 * The owner's report: choose Sandton, type a Rosebank address, and the order
 * used to go through labelled with whichever area matched first. Two things fix
 * it — suggestions from OpenStreetMap (so a picked address knows its own
 * suburb), and a check that the address agrees with the area the customer chose.
 *
 * The geocoder is stubbed here: this suite must not depend on a third-party
 * service being up, CORS-open, or reachable from CI, and the mapping itself is
 * covered by the Node tests in server/lib/address.test.js.
 */
const s7 = boot('/checkout', {
  seedCart: {
    state: {
      fulfilment: 'delivery',
      lines: [{
        key: 'mogodu-plate::starch=pap|veg=chakalaka',
        itemId: 'mogodu-plate',
        name: 'Mogodu Plate',
        image: '/img/plate-mogodu.jpg',
        unitPrice: 100,
        qty: 1,
        picks: [
          { optionId: 'starch', choiceId: 'pap', label: 'Pap', priceDelta: 0 },
          { optionId: 'veg', choiceId: 'chakalaka', label: 'Chakalaka', priceDelta: 0 },
        ],
        kind: 'menu',
      }],
    },
    version: 2,
  },
});

/*
 * What Photon really answers, in three shapes. This is a reproduction of the
 * owner's report rather than a happy path:
 *
 *  - "12 Oxford" resolves to house numbers, which carry a `suburb` tag.
 *  - "173 oxf" — a house number plus a *partial* street — finds nothing at all.
 *    That is the real behaviour that made the field look broken when typing and
 *    fine when pasting.
 *  - "oxf" on its own resolves to the street Oxford Road, which has no `suburb`
 *    tag, only a city. Placing it needs the coordinates.
 *
 * Plus a Pretoria street, which the kitchen does not deliver to, to prove
 * out-of-area results never reach the list.
 */
const house = (osmId, lon, lat, housenumber, street, suburb, city) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { osm_type: 'N', osm_id: osmId, housenumber, street, suburb, city, postcode: '2196' },
});

const PHOTON_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    house(111, 28.05, -26.1, '12', 'Oxford Road', 'Illovo', 'Sandton'),
    house(222, 28.04, -26.14, '15', 'Oxford Road', 'Rosebank', 'Johannesburg'),
    house(333, 28.19, -25.75, '9', 'Church Street', 'Pretoria Central', 'Pretoria'),
  ],
};

/** The street object Photon returns for a prefix: no housenumber, no suburb. */
const PHOTON_STREET_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [28.0425, -26.1425] },
      properties: { osm_type: 'W', osm_id: 444, name: 'Oxford Road', city: 'Johannesburg', postcode: '2196', osm_key: 'highway' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [28.19, -25.75] },
      properties: { osm_type: 'W', osm_id: 555, name: 'Church Street', city: 'Pretoria', postcode: '0002', osm_key: 'highway' },
    },
    /*
     * The owner's complaint: a Johannesburg CBD result with no suburb tag used to
     * slip through under a Sandton search because it was inside the envelope.
     */
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [28.0455, -26.2035] },
      properties: { osm_type: 'W', osm_id: 777, name: 'Oxford Road', city: 'Johannesburg', postcode: '2001', osm_key: 'highway' },
    },
  ],
};

s7.photonCalls = [];
const liveFetch = s7.w.fetch;
s7.w.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? '');
  if (url.startsWith('https://photon.komoot.io/')) {
    s7.photonCalls.push(url);
    const q = (new URL(url).searchParams.get('q') ?? '').trim().toLowerCase();
    /* A house number followed by a partial street name: nothing, as in real life. */
    const body = /^173\s+oxf/.test(q) ? { type: 'FeatureCollection', features: [] } : /^oxf/.test(q) ? PHOTON_STREET_FIXTURE : PHOTON_FIXTURE;
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  }
  return liveFetch(input, init);
};

await s7.waitFor(() => /Almost there/i.test(s7.text()), 'checkout page');

await step('the checkout only promises a receipt email when one can actually be sent', async () => {
  /*
   * The owner's question, turned into a test: this copy used to say "we email
   * your receipt ... as soon as the order is placed" on every deployment. With
   * no SMTP configured that email never arrives, so the page must not say it.
   *
   * The answer comes from the API (`notifications.customerEmail`), so the same
   * code is honest on a host with email set up and on one without.
   */
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  const canEmail = Boolean(health.notifications?.customerEmail);
  const text = s7.text();

  const emailInput = [...s7.doc.querySelectorAll('input')].find((el) => /you@example/.test(el.placeholder ?? ''));
  if (!emailInput) throw new Error('no email field on the checkout');
  s7.setInput(emailInput, 'thabo@example.co.za');
  await sleep(300);

  if (canEmail) {
    if (!/We email your receipt and a private tracking link/.test(s7.text())) {
      throw new Error('this server can send receipts but the checkout does not say so');
    }
    return 'email is configured, and the page promises it';
  }

  if (/We email your receipt and a private tracking link/.test(s7.text())) {
    throw new Error('the checkout promises a receipt email this server cannot send');
  }
  if (!/Email receipts are not switched on|tracking page after checkout is your record/.test(s7.text())) {
    throw new Error('the checkout does not tell the customer where their record actually is');
  }
  /* The kitchen notification is separate and still true: the order is queued. */
  if (!/The kitchen gets the order the moment you place it/.test(text)) {
    throw new Error('the kitchen-notification line went missing');
  }
  return 'no receipt email promised, and the customer is told what to keep';
});

await step('typing a delivery address offers OpenStreetMap suggestions', async () => {
  const addressInput = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo, Sandton/.test(el.placeholder ?? ''));
  if (!addressInput) throw new Error('no delivery address field');

  /* Focus first: the field only asks while it has the customer's attention. */
  addressInput.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(addressInput, '12 Oxford');

  await s7.waitFor(() => s7.photonCalls.length > 0, 'a geocoder request', 6000);
  const queried = new URL(s7.photonCalls[0]);
  if (queried.searchParams.get('q') !== '12 Oxford') throw new Error(`unexpected query: ${queried.searchParams.get('q')}`);
  /* The search is bounded to Rosebank/Sandton, and biased to Johannesburg. */
  if (!queried.searchParams.get('bbox')) throw new Error('the geocoder query is not limited to the delivery envelope');
  if (!queried.searchParams.get('lat') || !queried.searchParams.get('lon')) throw new Error('the geocoder query is not biased to Johannesburg');

  await s7.waitFor(() => s7.doc.querySelector('[role="listbox"][aria-label="Address suggestions"]'), 'the suggestion list', 6000);
  const options = [...s7.doc.querySelectorAll('[role="option"]')];
  /*
   * The fixture holds three results — Sandton, Rosebank and Pretoria. Only the
   * two the kitchen can drive to may be offered: an out-of-area address must not
   * appear and then be rejected after the customer has picked it.
   */
  if (options.length !== 2) throw new Error(`expected the 2 in-area suggestions, saw ${options.length}`);
  if (/Pretoria/.test(s7.doc.querySelector('[role="listbox"]').textContent ?? '')) {
    throw new Error('an address outside Rosebank and Sandton was offered');
  }
  if (!/Sandton delivery/.test(options[0].textContent ?? '')) throw new Error('the suggestions do not say which are inside the delivery area');
  if (!/OpenStreetMap/.test(s7.doc.querySelector('[role="listbox"]')?.parentElement?.textContent ?? '')) {
    throw new Error('OpenStreetMap attribution is missing');
  }
  return `2 suggestions from ${queried.host}`;
});

await step('Rosebank is preselected, and there is no empty "choose an area" row', async () => {
  /*
   * The owner's request: "rosebank must be selected by default and remove choose
   * an area". A blank select made the area a required decision before the
   * customer could see whether their plate could even reach them.
   */
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  if (!select) throw new Error('no delivery area select');

  const values = [...select.options].map((o) => o.value);
  if (values.join(',') !== 'Rosebank,Sandton') throw new Error(`unexpected area options: ${JSON.stringify(values)}`);
  if (values.includes('')) throw new Error('an empty "Choose an area" option is still offered');
  if (select.value !== 'Rosebank') throw new Error(`the checkout opens on "${select.value}", not Rosebank`);
  return 'Rosebank preselected, two areas, no empty row';
});

await step('the other delivery area is still searchable while Rosebank is selected', async () => {
  /*
   * Preselecting Rosebank must not hide Sandton streets: a Sandton customer types
   * their address first and reads the area off the result. Narrowing the geocoder
   * to the preselected area would leave them typing into an empty list — worse
   * than the "Choose an area" row this replaced.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '12 Oxford');

  await s7.waitFor(() => {
    const list = s7.doc.querySelector('[role="listbox"]');
    return list && /Oxford/.test(list.textContent ?? '');
  }, 'the suggestion list', 6000);

  const shown = [...s7.doc.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
  if (!shown.some((text) => /Illovo, Sandton/.test(text))) throw new Error('the Sandton address is missing while Rosebank is selected');
  if (!shown.some((text) => /Rosebank/.test(text))) throw new Error('the Rosebank address is missing');
  if (shown.some((text) => /Pretoria/.test(text))) throw new Error('an address outside the delivery areas was offered');
  return `${shown.length} in-area result(s), both areas`;
});

await step('typing a house number and a half-typed street still finds the address', async () => {
  /*
   * The owner's report, exactly: "paste 173 Oxford Rd and it detects it, type
   * 173 oxf and nothing comes up". Photon answers a house number plus a partial
   * street with nothing, and answers the partial street alone with the street
   * object — which carries no suburb tag. The field must survive both: retry
   * without the number, place the street by its coordinates, and put the number
   * back on the line.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '');
  await sleep(50);

  const before = s7.photonCalls.length;
  s7.setInput(input, '173 oxf');

  /* Two requests: "173 oxf" (empty), then "oxf" (the street). */
  await s7.waitFor(() => s7.photonCalls.length >= before + 2, 'the retry without the house number', 8000);
  const queries = s7.photonCalls.slice(before).map((u) => new URL(u).searchParams.get('q'));
  if (queries[0] !== '173 oxf' || queries[1] !== 'oxf') throw new Error(`unexpected queries: ${queries.join(' | ')}`);

  await s7.waitFor(() => {
    const list = s7.doc.querySelector('[role="listbox"]');
    return list && /Oxford/.test(list.textContent ?? '');
  }, 'a suggestion for the half-typed street', 8000);

  const options = [...s7.doc.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
  const rosebank = options.find((text) => /Oxford Road/.test(text) && /Rosebank/.test(text));
  if (!rosebank) throw new Error(`no Rosebank suggestion for "173 oxf": ${JSON.stringify(options)}`);
  /* The number the customer typed must survive the fallback. */
  if (!/^\s*173 Oxford Road/.test(rosebank)) throw new Error(`the house number was dropped: ${rosebank}`);
  if (/Pretoria/.test(options.join(' '))) throw new Error('an address outside the delivery areas was offered');
  /* Nor a Johannesburg CBD street that the map left untagged. */
  if (/2001|Johannesburg · 2001/.test(options.join(' '))) throw new Error('a Johannesburg CBD address was offered');
  if (options.length !== 1) throw new Error(`expected exactly the Rosebank street, saw ${JSON.stringify(options)}`);

  const button = [...s7.doc.querySelectorAll('[role="option"]')]
    .find((o) => /173 Oxford Road/.test(o.textContent ?? ''))
    ?.querySelector('button');
  button.dispatchEvent(new s7.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await sleep(200);

  if (input.value !== '173 Oxford Road, Rosebank, Johannesburg') throw new Error(`picking filled "${input.value}"`);
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  if (select.value !== 'Rosebank') throw new Error(`the delivery area was filled with "${select.value}"`);
  return 'half-typed street found, house number kept, area filled';
});

await step('picking a suggestion moves the delivery area to match the address', async () => {
  /*
   * Rosebank is the default at this point; the picked result is in Sandton. The
   * area must follow the address, otherwise the customer is told they contradicted
   * a select they never touched.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '12 Oxfor');
  await s7.waitFor(() => (s7.doc.querySelectorAll('[role="option"]').length ?? 0) >= 2, 'both areas offered again', 6000);

  const [sandton] = [...s7.doc.querySelectorAll('[role="option"]')];
  const button = sandton.querySelector('button');
  button.dispatchEvent(new s7.w.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: s7.w }));

  await s7.waitFor(() => {
    const input = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo/.test(el.placeholder ?? ''));
    return input?.value === '12 Oxford Road, Illovo, Sandton';
  }, 'the address to autofill', 4000);

  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Sandton'));
  if (!select) throw new Error('no delivery area select');
  if (select.value !== 'Sandton') throw new Error(`the area was not autofilled, it is "${select.value}"`);
  return 'address and area autofilled from the picked result';
});

await step('an address that contradicts the chosen area is refused with both names', async () => {
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Sandton'));
  /* The customer now switches the area instead of the address. */
  select.value = 'Rosebank';
  select.dispatchEvent(new s7.w.Event('change', { bubbles: true }));

  await s7.waitFor(() => /but you chose Rosebank|is in Sandton/.test(s7.text()), 'the mismatch message', 4000);
  const message = s7.text();
  if (!/Sandton/.test(message) || !/Rosebank/.test(message)) {
    throw new Error('the mismatch message does not name both areas');
  }

  /* And the order must not go through while it stands. */
  if (!s7.byText('button[type="submit"]', /Place order/i)[0]) throw new Error('no place-order button');
  s7.click(s7.byText('button[type="submit"]', /Place order/i)[0]);
  await sleep(400);
  if (/Order tracking/i.test(s7.text())) throw new Error('a mismatched delivery address placed an order');
  return 'refused, and nothing was ordered';
});

await step('an address with no suburb only asks the customer to check', async () => {
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo/.test(el.placeholder ?? ''));
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Sandton'));
  select.value = 'Sandton';
  select.dispatchEvent(new s7.w.Event('change', { bubbles: true }));
  s7.setInput(input, '9 Rivonia Road');

  await s7.waitFor(() => /Check the suburb/.test(s7.text()), 'the suburb hint', 4000);
  /* A warning, not an error: this address must still be submittable. */
  if (/but you chose/.test(s7.text())) throw new Error('a plain street address was treated as a mismatch');
  return 'warned, not blocked';
});

await step('address suggestions fail quietly when the geocoder is unreachable', async () => {
  s7.w.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? '');
    if (url.startsWith('https://photon.komoot.io/')) throw new Error('network down');
    return liveFetch(input, init);
  };
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Illovo/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '12 Katherine Street');
  await sleep(900);
  /* No crash, no stuck spinner, and the box still holds what was typed. */
  if (!/12 Katherine Street/.test(input.value)) throw new Error('the typed address was lost');
  if (/Looking up addresses…/.test(s7.text())) throw new Error('the field is stuck on "Looking up addresses"');
  return 'no suggestions, field still usable';
});

/* ------------------------------------------------------------------ */
/* Flow 1b: contact form + loyalty card lookup                          */
/* ------------------------------------------------------------------ */

const s3 = boot('/contact');
await s3.waitFor(() => /Send us a message/i.test(s3.text()), 'contact page');

await step('opening hours list only the days the kitchen cooks', async () => {
  /*
   * The contact card used to print all seven days: five greyed "Closed" rows
   * around two real windows. The footer already showed only the cooking days, so
   * the two disagreed and the card read as a business that is mostly shut.
   */
  const card = [...s3.doc.querySelectorAll('div')].find((el) => /^Opening hours/.test(el.textContent ?? '') && el.querySelector('ul'));
  if (!card) throw new Error('no opening-hours card on the contact page');
  const rows = [...card.querySelectorAll('li')].map((li) => li.textContent ?? '');

  if (/Closed/.test(rows.join(' '))) throw new Error(`a "Closed" row is still shown: ${JSON.stringify(rows)}`);
  if (rows.some((row) => /Sunday|Monday|Tuesday|Wednesday|Saturday/.test(row))) {
    throw new Error(`a day the kitchen does not cook is listed: ${JSON.stringify(rows)}`);
  }
  if (rows.length !== 2 || !rows.some((r) => /Thursday/.test(r)) || !rows.some((r) => /Friday/.test(r))) {
    throw new Error(`expected Thursday and Friday only, saw ${JSON.stringify(rows)}`);
  }
  return `${rows.length} cooking days, no closed rows`;
});

await step('only the asterisk on a required field is red', async () => {
  /*
   * Checked as markup, not computed colour: this harness loads the app with the
   * stylesheet stripped out, so every colour would read as black. What matters is
   * that the asterisk is its own element carrying the error colour, and that it
   * is not part of the label's text — the label must stay ink, because a red
   * "Your name" reads as an error before the customer has typed anything.
   * The rendered colour is verified in the browser screenshot.
   */
  const label = [...s3.doc.querySelectorAll('label')].find((el) => /Your name/.test(el.textContent ?? ''));
  if (!label) throw new Error('no name field on the contact form');
  const head = label.querySelector('span > span');
  const star = [...head.querySelectorAll('span')].find((el) => el.textContent === '*');
  if (!star) throw new Error('the name field is not marked required');

  if (!/text-chili/.test(star.className)) throw new Error(`the asterisk is not the error colour: "${star.className}"`);
  if (/\*/.test([...head.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''))) {
    throw new Error('the asterisk is still part of the label text');
  }
  if (!/text-ink\b/.test(head.className)) throw new Error(`the label is not ink-coloured: "${head.className}"`);
  /* The asterisk is decoration; a screen reader gets the word instead. */
  if (![...head.querySelectorAll('span')].some((el) => /sr-only/.test(el.className) && /required/i.test(el.textContent))) {
    throw new Error('the required marker is not announced to screen readers');
  }
  return 'asterisk carries the error colour, label stays ink';
});

await step('the contact form refuses a message with no name, body or reply channel', async () => {
  /*
   * The owner's rule, checked field by field in the browser: name, message, and
   * one way to reply (email or cell number). Each attempt changes exactly one
   * thing so a missing rule cannot hide behind another.
   */
  const byPh = (re) => [...s3.doc.querySelectorAll('input, textarea')].find((f) => re.test(f.placeholder ?? ''));
  const submit = () => s3.byText('button[type="submit"]', /Send|message/i)[0];
  const errorText = () => [...s3.doc.querySelectorAll('span')].map((el) => el.textContent ?? '').join(' ');

  /* 1. Everything empty. */
  s3.click(submit());
  await s3.waitFor(() => /tell us your name/i.test(errorText()), 'name required', 8000);
  if (!/add a message/i.test(errorText())) throw new Error('the message field has no required-message error');
  if (!/email address or a cell number/i.test(errorText())) throw new Error('the reply channel is not enforced');

  /* 2. Name + message, still nowhere to reply. */
  s3.setInput(byPh(/Thabo Mahlangu/), 'Smoke Test');
  s3.setInput(byPh(/Tell us what you need/), 'Can you cater for 40 on a Saturday?');
  s3.click(submit());
  await s3.waitFor(() => !/Message sent|Message received/i.test(s3.text()), 'still blocked', 4000);
  if (!/email address or a cell number/i.test(errorText())) {
    throw new Error('a name and a message alone were accepted with no way to reply');
  }

  /* 3. A junk number is refused rather than sent. */
  s3.setInput(byPh(/\+27 82 000 0000/), '123');
  s3.click(submit());
  await s3.waitFor(() => /South African cell number/i.test(errorText()), 'invalid number refused', 8000);

  /* 4. A junk email is refused too. */
  s3.setInput(byPh(/\+27 82 000 0000/), '');
  s3.setInput(byPh(/you@example\.co\.za/), 'not-an-email');
  s3.click(submit());
  await s3.waitFor(() => /email does not look right/i.test(errorText()), 'invalid email refused', 8000);

  return 'name, message and one reply channel all enforced';
});

await step('a complete contact message is accepted by the site', async () => {
  const byPh = (re) => [...s3.doc.querySelectorAll('input, textarea')].find((f) => re.test(f.placeholder ?? ''));
  s3.setInput(byPh(/Thabo Mahlangu/), 'Smoke Test');
  s3.setInput(byPh(/you@example\.co\.za/), 'smoke@example.co.za');
  s3.setInput(byPh(/Tell us what you need/), 'Can you cater for 40 on a Saturday?');
  s3.click(s3.byText('button[type="submit"]', /Send|message/i)[0]);
  // "Message sent" when the Formspree forward succeeded, "Message received"
  // when only the local copy was kept (the sandbox cannot reach formspree.io).
  await s3.waitFor(() => /Message sent|Message received/i.test(s3.text()), 'success state', 15000);
  if (!/call or WhatsApp/i.test(s3.text())) throw new Error('contact success state does not offer a faster route');

  /*
    The success panel used to place "Open WhatsApp" and "Send another" as an
    inline link next to an inline-flex button, with no gap — they touched and
    read as one smeared control. jsdom has no layout engine to measure that, so
    the guard is structural: both actions must sit in the same flex container
    with an explicit gap.
  */
  const sendAnother = s3.byText('button', /Send another/i)[0];
  const openWhatsApp = s3.byText('a', /Open WhatsApp/i)[0];
  if (!sendAnother || !openWhatsApp) throw new Error('contact success actions are missing');
  const row = sendAnother.parentElement;
  if (!row || row !== openWhatsApp.parentElement) throw new Error('contact success actions are not in one action row');
  if (!row.className.includes('flex')) throw new Error('contact success actions are not laid out as a flex row');
  if (!/gap-[2-9]/.test(row.className)) throw new Error('contact success actions have no gap between them');
  return 'request recorded; success actions are separately spaced';
});

/* ------------------------------------------------------------------ */
/* Flow 1c: customer quest                                             */
/* ------------------------------------------------------------------ */

const quest = boot('/quest');
await quest.waitFor(() => /Ask us to cook it/i.test(quest.text()), 'quest page');

await step('the customer-quest reference lists both menus and opens nothing', async () => {
  const ref = quest.doc.querySelector('[data-quest-reference]');
  if (!ref) throw new Error('the view-only reference block is missing');

  /*
    The owner asked for the categories back as a look, not a shop: no click, no
    dish detail. jsdom cannot test "feels clickable", but it can prove the block
    holds nothing interactive at all — no anchors, buttons, form fields or
    inline handlers — and no food photography to tap through to.
  */
  const interactive = ref.querySelectorAll('a, button, input, select, textarea, [role="link"], [role="button"], [onclick]');
  if (interactive.length) {
    throw new Error(`the reference must be view-only, but it contains ${interactive.length} interactive element(s)`);
  }
  if (ref.querySelector('img')) throw new Error('the reference must not show dish photos');
  if (ref.getAttribute('aria-disabled') !== 'true') throw new Error('the reference is not marked as non-interactive');

  const text = ref.textContent;
  for (const expected of [/Traditional Plates/i, /Contemporary Plates/i, /Mogodu/, /Short rib/i, /Pap|Mabele/]) {
    if (!expected.test(text)) throw new Error(`the reference is missing ${expected}`);
  }
  return 'both menus listed; 0 links, 0 buttons, 0 dish pages';
});

await step('an incomplete quest is refused with a reason', async () => {
  const submit = quest.byText('button[type="submit"]', /Send my quest/i)[0];
  if (!submit) throw new Error('no submit button on the quest form');
  quest.click(submit);
  await quest.waitFor(() => /Please tell us your name/i.test(quest.text()), 'quest validation message', 8000);
  return 'blocked with a message';
});

await step('a complete quest is accepted and promises a person, not an order', async () => {
  const field = (re) => [...quest.doc.querySelectorAll('input, textarea')].find((f) => re.test(f.placeholder ?? ''));
  quest.setInput(field(/Thabo Mahlangu/), 'Smoke Quest');
  quest.setInput(field(/\+27 82 000 0000/), '+27 82 111 2233');
  quest.setInput(field(/Dombolo with tshotlo/), 'Dombolo with tshotlo and morogo for eight');
  quest.click(quest.byText('button[type="submit"]', /Send my quest/i)[0]);

  // "Quest sent" when the inbox forward worked, "Quest received" when only the
  // local copy was kept — the sandbox cannot reach formspree.io.
  await quest.waitFor(() => /Quest sent|Quest received/i.test(quest.text()), 'quest success state', 15000);
  if (!/not an order|nothing has been charged/i.test(quest.text())) {
    throw new Error('the quest success state must not read like an order');
  }

  const again = quest.byText('button', /Send another quest/i)[0];
  const openWhatsApp = quest.byText('a', /Open WhatsApp/i)[0];
  if (!again || !openWhatsApp) throw new Error('quest success actions are missing');
  const row = again.parentElement;
  if (!row || row !== openWhatsApp.parentElement || !row.className.includes('flex')) {
    throw new Error('quest success actions are not in one flex row');
  }
  if (!/gap-[2-9]/.test(row.className)) throw new Error('quest success actions have no gap between them');
  return 'quest recorded; two separately spaced next steps';
});

await step('the loyalty card looks up stamps by cell number', async () => {
  const s4 = boot('/passport');
  await s4.waitFor(() => /Your loyalty card/i.test(s4.text()), 'loyalty card page');

  const input = [...s4.doc.querySelectorAll('input')].find((f) => /\+27 82/.test(f.placeholder ?? ''));
  if (!input) throw new Error('no phone input on the passport page');
  const submit = () => s4.byText('button[type="submit"]', /Find my card/i)[0];

  /*
    A number that has never ordered must say so rather than showing a blank
    card. The number has to be unique per run: this suite also checks out real
    orders, and reusing one number meant the "empty" case was only true on the
    first run after a data reset — every later run found accumulated stamps and
    the step failed.
  */
  const fresh = `+27 82 ${String(Date.now()).slice(-8)}`;
  s4.setInput(input, fresh);
  s4.click(submit());
  await s4.waitFor(() => /No orders against this number|No stamps yet/i.test(s4.text()), 'empty-card result', 15000);
  if (!/Stamp|stamp/i.test(s4.text())) throw new Error('stamp card did not render');

  /*
    Now a number that HAS ordered. Seed one order over the API rather than
    depending on whatever the checkout step happened to use, so this assertion
    is about the passport and not about test ordering.
  */
  const loyal = `+27 83 ${String(Date.now()).slice(-8)}`;
  const placed = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'card',
      fulfilment: 'collection',
      customer: { name: 'Passport Test', phone: loyal, email: 'passport@example.co.za' },
      items: [{ itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } }],
      /* No card fields: this site never takes a card number, it hands off to Yoco. */
      payment: { method: 'card' },
    }),
  }).then((r) => r.json());
  if (!placed.order?.code) throw new Error('could not seed an order for the passport check');

  s4.setInput(input, loyal);
  s4.click(submit());
  await s4.waitFor(() => /Passport Test/.test(s4.text()), 'named card for the loyal number', 15000);
  if (/No orders against this number/.test(s4.text())) throw new Error('loyal number still shows the empty state');

  const api = await fetch(`${BASE}/api/passport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: loyal }),
  }).then((r) => r.json());
  if (!api.found || api.stamps < 1) throw new Error(`API says ${api.stamps} stamps for a number that just ordered`);

  s4.close();
  return `empty state for a new number, ${api.stamps} stamp(s) for one that ordered`;
});

/* ------------------------------------------------------------------ */
/* Flow 1c: Build Your Heritage Plate configurator                     */
/* ------------------------------------------------------------------ */

const s5 = boot('/menu?builder=traditional');
await s5.waitFor(() => /Traditional Plate/i.test(s5.text()) && /Choose your protein/i.test(s5.text()), 'plate builder');

/* The builder is a dialog on top of the menu, so every control has to be read
   from inside it — the menu cards behind it also have buttons reading "Choose". */
const builderDialog = () => s5.doc.querySelector('[role="dialog"][aria-label="Traditional Plate"]');
const builderAdd = () => [...(builderDialog()?.querySelectorAll('button') ?? [])]
  .find((b) => /Add plate|Pick a/i.test(b.textContent ?? ''));

await step('the plate builder requires its mandatory groups before adding', async () => {
  const addBtn = builderAdd;
  if (!addBtn()) throw new Error('no add-plate control');

  // With nothing picked the button must name what is missing, and be disabled.
  if (!addBtn().disabled) throw new Error('add-plate is enabled with nothing chosen');
  if (!/Pick a /i.test(addBtn().textContent ?? '')) throw new Error('button does not name the missing group');

  // Pick one item from every required group.
  const groups = [...(builderDialog()?.querySelectorAll('fieldset') ?? [])];
  let chosen = 0;
  for (const fs of groups) {
    const required = Boolean(fs.querySelector('.text-ochre-deep'));
    if (!required) continue;
    const opt = [...fs.querySelectorAll('button[aria-pressed]')][0];
    if (!opt) throw new Error('required group has no options');
    s5.click(opt);
    chosen++;
  }
  if (chosen === 0) throw new Error('found no required groups in the builder');

  await s5.waitFor(() => /Add plate/i.test(builderAdd()?.textContent ?? ''), 'button to become Add plate', 8000);
  if (addBtn().disabled) throw new Error('add-plate still disabled after choosing every required group');
  return `${chosen} required group(s) satisfied`;
});

await step('a configured plate lands in the basket at the fixed plate price', async () => {
  const addBtn = builderAdd();
  if (!addBtn) throw new Error('no add-plate control after configuring the plate');
  const label = addBtn.textContent ?? '';
  const price = (label.match(/R\s?[\d\s]+[.,]\d{2}/) ?? [])[0];

  s5.click(addBtn);
  // The builder closes on add; the basket line should carry the plate.
  await s5.waitFor(() => /Traditional Plate/i.test(s5.text()), 'plate in the basket', 8000);
  if (price && !s5.text().includes(price.replace(/\s/g, ''))) {
    // Compare loosely: the basket may render the price without the same spacing.
    const digits = price.replace(/[^\d]/g, '');
    if (!s5.text().replace(/[^\d]/g, '').includes(digits)) {
      throw new Error(`basket does not show the plate price ${price}`);
    }
  }
  s5.close();
  return price ? `plate added at ${price}` : 'plate added';
});

/* ------------------------------------------------------------------ */
/* Flow 2: checkout -> pay with a good card -> land on the tracking page */
/* ------------------------------------------------------------------ */

await step('checkout link from the basket navigates to /checkout', async () => {
  const link = s1.byText('a[href="/checkout"]', /Checkout/i)[0];
  s1.click(link);
  await s1.waitFor(() => /Almost there/i.test(s1.text()), 'checkout page');
  return s1.w.location.pathname;
});

await step('validation blocks an empty order', async () => {
  const submit = s1.byText('button[type="submit"]', /Place order/i)[0];
  s1.click(submit);
  await sleep(400);
  if (!/We need a name/i.test(s1.text())) throw new Error('name validation did not fire');
  return 'blocked with a message';
});

await step('an online order without an email is blocked, because the receipt has nowhere to go', async () => {
  const ordersBefore = await orderCount();

  const byPlaceholder = (re) => [...s1.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s1.setInput(byPlaceholder(/Thabo Mahlangu/), 'Interaction Test');
  s1.setInput(byPlaceholder(/\+27 82/), '+27 82 000 7777');

  /*
   * There is no card field to fill in any more: the whole card form is gone, and
   * money is taken on Yoco's own page. If a placeholder like "4242" is still on
   * screen, the old form has crept back.
   */
  const cardFields = [...s1.doc.querySelectorAll('input')].filter((f) => /4242 4242|MM\/YY|^123$|T MAHLANGU/.test(f.placeholder ?? ''));
  if (cardFields.length) throw new Error(`card fields are still on the checkout: ${cardFields.map((f) => f.placeholder).join(', ')}`);

  s1.click(s1.byText('button[type="submit"]', /Place order/i)[0]);
  await s1.waitFor(() => /need an email/i.test(s1.text()), 'email requirement', 10000);

  const ordersAfter = await orderCount();
  if (ordersAfter !== ordersBefore) throw new Error(`an order was created without an email: ${ordersBefore} -> ${ordersAfter}`);
  return 'blocked with an email requirement, and no card fields exist';
});

await step('placing an online order saves it and hands the customer to Yoco', async () => {
  /*
   * The money path, end to end, without a card: the order is created as
   * awaiting-payment, and the page sends the customer to the Yoco payment page
   * the business configured. Nothing here can charge anyone — that is the point
   * of the change — so what is asserted is the hand-off, not an approval.
   */
  const payments = await fetch(`${BASE}/api/catalog`).then((r) => r.json()).then((c) => c.payments);
  if (!payments.online) throw new Error('this server has no Yoco configuration, so the paid path cannot be exercised');

  const ordersBefore = await orderCount();
  const byPlaceholder = (re) => [...s1.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s1.setInput(byPlaceholder(/you@example/), 'interaction@example.co.za');
  await sleep(300);

  s1.click(s1.byText('button[type="submit"]', /Place order/i)[0]);

  /* The panel stays on screen even though the redirect is attempted. */
  await s1.waitFor(() => /is saved/i.test(s1.text()) && /Continue to Yoco payment/i.test(s1.text()), 'the Yoco hand-off page', 25000);

  const payLink = [...s1.doc.querySelectorAll('a')].find((a) => /Continue to Yoco payment/i.test(a.textContent ?? ''));
  if (!payLink) throw new Error('no link to continue to Yoco');
  const url = new URL(payLink.href);
  const expected = new URL(payments.mode === 'api' ? 'https://pay.yoco.com/' : 'https://pay.yoco.com/heritagebites');
  if (url.host !== expected.host) throw new Error(`the payment page is not Yoco: ${url.host}`);

  /*
   * The hand-off replaces the whole page (the basket is gone by then), so the
   * order code is read from the heading rather than from a small panel.
   */
  const code = (s1.text().match(/HB-\d{4}[A-Z]/) ?? [])[0];
  if (!code) throw new Error('the hand-off does not name the order it belongs to');
  /* In link mode the order code travels with the payment so a person can match them. */
  if (payments.mode === 'link' && url.searchParams.get('reference') !== code) {
    throw new Error(`the payment link does not carry the order code: ${url.href}`);
  }

  const ordersAfter = await orderCount();
  if (ordersAfter !== ordersBefore + 1) throw new Error(`expected one new order, ${ordersBefore} -> ${ordersAfter}`);

  s1.__code = code;
  /* The checkout parks the token, because Yoco returns without it. */
  s1.__trackingToken = s1.w.localStorage.getItem(`hb.track.${code}`) ?? '';
  if (!s1.__trackingToken) throw new Error('the checkout did not keep the tracking token for the return trip');
  return `${code} awaiting payment at ${url.host}`;
});

await step('the order page says the payment has not arrived, and offers to finish it', async () => {
  /*
   * The state a customer is in if they close the Yoco tab. The page must not
   * look like a completed order: nothing is cooked until the money lands, and
   * the only thing that marks it paid is the signed webhook.
   */
  const code = s1.__code;
  const view = boot(`/order/${code}?token=${encodeURIComponent(s1.__trackingToken)}`);
  await view.waitFor(() => /Order tracking/i.test(view.text()), 'the tracking page', 20000);

  if (!/Awaiting payment/i.test(view.text())) throw new Error('an unpaid order does not say it is unpaid');
  if (!/Payment not completed/i.test(view.text())) throw new Error('the resume-payment panel is missing');
  const again = [...view.doc.querySelectorAll('a')].find((a) => /Pay now on Yoco/i.test(a.textContent ?? ''));
  if (!again) throw new Error('no way to finish the payment');
  if (!/heritagebites|yoco/i.test(new URL(again.href).host)) throw new Error(`resume link is not the payment page: ${again.href}`);

  /* It is genuinely unpaid on the server, not just in the page's head. */
  const tracked = await fetch(`${BASE}/api/orders/${code}?token=${encodeURIComponent(s1.__trackingToken)}`).then((r) => r.json());
  if (tracked.order.payment.status !== 'awaiting_payment') {
    throw new Error(`the server thinks the order is ${tracked.order.payment.status}`);
  }
  view.close();
  return 'unpaid state shown, with a way back to Yoco';
});

/*
 * The receipt/ticket checks below all read the tracking page for the order above.
 * Booted lazily, inside the steps, so a failure in the checkout step is reported
 * as that failure rather than as a mysterious crash here.
 */
let s1Order = null;
async function orderPage() {
  if (s1Order) return s1Order;
  if (!s1.__code || !s1.__trackingToken) throw new Error('no order came out of the checkout steps');
  s1Order = boot(`/order/${s1.__code}?token=${encodeURIComponent(s1.__trackingToken)}`);
  await s1Order.waitFor(() => /Order tracking/i.test(s1Order.text()), 'the order page for the receipt checks', 20000);
  s1Order.__code = s1.__code;
  s1Order.__trackingToken = s1.__trackingToken;
  return s1Order;
}

await step('the receipt destination is shown masked, or not claimed at all', async () => {
  await orderPage();
  /*
   * Whether a receipt was queued depends on the server having SMTP configured, so
   * this checks the two honest outcomes rather than assuming one: either the page
   * names a masked address, or it says nothing about a receipt. What it must never
   * do is claim a receipt and print the full address.
   */
  const text = s1Order.text();
  if (/interaction@example\.co\.za/.test(text)) throw new Error('the full email address is exposed on the page');

  if (/Receipt (emailed to|on its way to)|could not email your receipt/i.test(text)) {
    if (!/i\*+@example\.co\.za/.test(text)) throw new Error('the masked receipt address is missing');
    return 'masked receipt address shown';
  }
  if (/receipt/i.test(text) && /emailed to/i.test(text)) {
    throw new Error('the page claims a receipt was sent without a masked address');
  }
  return 'no receipt claimed (no SMTP on this server), and no address leaked';
});

await step('the tracking page offers manual WhatsApp updates, an order ticket and a shareable receipt', async () => {
  await orderPage();
  const links = [...s1Order.doc.querySelectorAll('a[href^="https://wa.me/"]')];
  if (links.length < 3) throw new Error('expected update-request, order-message and keep-receipt links');

  /*
   * Two kinds of link are legitimate here: the ones that message the kitchen
   * (which must always be the business number) and the share link that opens
   * WhatsApp with no recipient so the customer can keep the receipt in a chat
   * of their own choosing. A share link pointing at a *wrong* number never is.
   */
  const business = links.filter((a) => /wa\.me\/27670137587/.test(a.href));
  const share = links.filter((a) => !/wa\.me\/27670137587/.test(a.href));
  if (business.length < 2) throw new Error('wrong WhatsApp number');
  if (share.length !== 1 || !/^https:\/\/wa\.me\/\?text=/.test(share[0].href)) {
    throw new Error('unexpected WhatsApp link target');
  }

  const body = (a) => new URL(a.href).searchParams.get('text') ?? '';
  if (!body(share[0]).includes(s1Order.__code)) throw new Error('shareable receipt is missing the order code');

  const updates = business.find((a) => body(a).includes('please send me WhatsApp updates'));
  if (!updates || !body(updates).includes(s1Order.__code)) throw new Error('manual update request is missing the order code');

  const ticket = business.find((a) => body(a).includes('Heritage Bites order'));
  if (!ticket || !body(ticket).includes(s1Order.__code)) throw new Error('order ticket body missing');
  if (!/not automatic|a person, not a bot/i.test(s1Order.text())) throw new Error('page does not clarify that WhatsApp updates are manual');
  return 'manual update request + pre-filled order ticket';
});

await step('a verified Yoco payment marks the order paid, and then it cannot self-cancel', async () => {
  await orderPage();
  const code = s1.__code;

  /*
   * This is the whole safety property of the new payment path: a return URL
   * cannot mark an order paid, and a webhook cannot either unless it is signed
   * with the business's webhook secret. The secret is supplied to this script by
   * the same environment that starts the server, so the signature here is the
   * real one Yoco would send.
   */
  const secret = process.env.HB_YOCO_WEBHOOK_SECRET ?? '';
  if (!secret) {
    /* Without the secret this cannot be exercised honestly, so say so loudly. */
    throw new Error('start the server with HB_YOCO_WEBHOOK_SECRET and export it here to test the paid path');
  }

  const body = JSON.stringify({
    type: 'payment.succeeded',
    payload: {
      id: 'pay_interaction_1',
      amount: 13000,
      currency: 'ZAR',
      status: 'succeeded',
      metadata: { orderCode: code },
      card: { brand: 'visa', last4: '4242' },
    },
  });
  const { createHmac } = await import('node:crypto');
  const msgId = 'msg_interaction_1';
  const timestamp = Math.floor(Date.now() / 1000);
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${msgId}.${timestamp}.${body}`).digest('base64');

  const posted = await fetch(`${BASE}/api/payments/yoco/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': msgId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${signature}`,
    },
    body,
  });
  if (posted.status !== 200) throw new Error(`signed webhook rejected with ${posted.status}: ${await posted.text()}`);

  const tracked = await fetch(`${BASE}/api/orders/${code}?token=${encodeURIComponent(s1.__trackingToken)}`).then((r) => r.json());
  if (tracked.order.payment.status !== 'approved') throw new Error('a signed webhook did not mark the order paid');
  if (tracked.order.payment.last4 !== '4242') throw new Error('the card details from Yoco were not kept');
  /* Paid money is not something a customer can unilaterally reverse. */
  if (tracked.order.canCancel) throw new Error('a paid order still offers self-cancellation');

  const response = await fetch(`${BASE}/api/orders/${code}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: s1.__trackingToken }),
  });
  if (response.status !== 409) throw new Error(`paid order cancellation returned ${response.status}, expected 409`);
  const result = await response.json();
  if (!/contact us.*refund/i.test(result.error)) throw new Error('server response does not explain the refund limitation');
  return `${code} marked paid by a signed webhook, then refused self-cancellation`;
});

/* --- session 6: paying without a card ------------------------------------
 * Cash is an available checkout method; a seeded cart lets us reach /checkout
 * cold and confirm a cash order works without card details.
 */
const s6 = boot('/checkout', {
  seedCart: {
    state: {
      lines: [{
        key: 'tshotlo-plate::starch=pap|veg=braised-cabbage',
        itemId: 'tshotlo-plate',
        name: 'Tshotlo Plate',
        image: '/img/plate-tshotlo.jpg',
        unitPrice: 100,
        qty: 2,
        picks: [
          { optionId: 'starch', choiceId: 'pap', label: 'Pap', priceDelta: 0 },
          { optionId: 'veg', choiceId: 'braised-cabbage', label: 'Braised cabbage', priceDelta: 0 },
        ],
        kind: 'menu',
      }],
      fulfilment: 'collection',
    },
    version: 2,
  },
});

await step('a cash order can be placed with no card details at all', async () => {
  await s6.waitFor(() => /Checkout/i.test(s6.text()), 'checkout to mount with the seeded basket', 20000);
  if (!/Tshotlo/i.test(s6.text())) throw new Error('seeded basket did not reach checkout');
  /*
   * Yoco itself takes instant EFT, so the word may appear inside the payment
   * blurb — what must not come back is EFT as a *separate* checkout option.
   */
  const methodButtons = [...s6.doc.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent ?? '');
  if (methodButtons.some((t) => /^EFT\b/i.test(t.trim()))) throw new Error('EFT is still a separate checkout option');

  /*
   * Choose cash. There is no card form to hide any more — the online option
   * sends the customer to Yoco instead — so what this checks is that choosing
   * cash leaves no card-like field on the page at all.
   */
  s6.click(s6.byText('button', /Cash on collection/i)[0]);
  await sleep(200);
  const suspicious = [...s6.doc.querySelectorAll('input')].filter((f) => /4242 4242|MM\/YY|^123$|T MAHLANGU/.test(f.placeholder ?? ''));
  if (suspicious.length) throw new Error(`card fields are still present: ${suspicious.map((f) => f.placeholder).join(', ')}`);

  const byPh = (re) => [...s6.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s6.setInput(byPh(/Thabo Mahlangu/), 'Cash Customer');
  s6.setInput(byPh(/\+27 82/), '+27 82 000 6600');
  await sleep(400);

  /*
   * The WhatsApp handoff used to open an empty chat: the link carried the
   * number and nothing else, so the customer had to retype the order. It now
   * has to carry the basket itself — dishes, quantities, line totals, the total
   * and the collection choice — pre-typed into the message.
   */
  const waLink = [...s6.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Order this on WhatsApp/i.test(a.textContent ?? ''));
  if (!waLink) throw new Error('checkout has no WhatsApp basket link');
  const waText = new URL(waLink.href).searchParams.get('text') ?? '';
  /* en-ZA writes the decimal as a comma: R200,00. */
  for (const wanted of [/Tshotlo Plate/, /2 ×/, /R200[,.]00/, /Total: R200[,.]00/, /Pap/, /Braised cabbage/]) {
    if (!wanted.test(waText)) throw new Error(`the WhatsApp message is missing the order data (${wanted}): ${waText.slice(0, 160)}`);
  }
  /*
   * The closing line used to read "I will send it through", which read as if the
   * customer still had a step left to take. It must now ask for a reply and
   * nothing else.
   */
  if (!/Please reply here to confirm this order/.test(waText)) {
    throw new Error(`the WhatsApp message does not close with the confirm-and-pay ask: ${waText.slice(-120)}`);
  }
  if (/I will send it through/.test(waText)) {
    throw new Error('the WhatsApp message still asks the customer to send it through');
  }

  const submit = s6.byText('button[type="submit"]', /Place order/i)[0];
  if (!submit) throw new Error('no submit button on a cash checkout');
  if (submit.disabled) throw new Error('cash checkout is locked without a card');
  s6.click(submit);

  await s6.waitFor(() => /Order tracking/i.test(s6.text()), 'tracking page for the cash order', 25000);
  const code = s6.w.location.pathname.split('/').pop();
  if (!/^HB-\d{4}[A-Z]$/.test(code)) throw new Error(`unexpected order code: ${code}`);

  // The customer must be told they have not paid yet.
  if (!/Payment on collection/i.test(s6.text())) {
    throw new Error('tracking page does not say payment is due on collection');
  }

  // And the kitchen must agree, server-side.
  const trackingToken = new URLSearchParams(s6.w.location.search).get('token');
  if (!trackingToken) throw new Error('cash checkout did not provide a secure tracking token');
  const order = await fetch(`${BASE}/api/orders/${code}?token=${encodeURIComponent(trackingToken)}`).then((r) => r.json());
  if (order.order.payment.status !== 'pending') {
    throw new Error(`cash order recorded as ${order.order.payment.status}, expected pending`);
  }
  if (order.order.payment.method !== 'cash-on-collection') {
    throw new Error(`payment method recorded as ${order.order.payment.method}`);
  }
  return `${code} unpaid, due on collection`;
});

/* ------------------------------------------------------------------ */
/* Flow 3: the basket bar and clearing the basket                        */
/* ------------------------------------------------------------------ */

/*
 * A basket with two plates in it, on the menu page: the bar is pinned to the
 * bottom of every page except checkout, and the drawer is where the whole basket
 * is visible — including the only control that empties it.
 */
const s8 = boot('/menu', {
  seedCart: {
    state: {
      lines: [
        {
          key: 'mogodu-plate::starch=pap|veg=braised-cabbage',
          itemId: 'mogodu-plate',
          name: 'Mogodu Plate',
          image: '/img/plate-mogodu.jpg',
          unitPrice: 100,
          qty: 2,
          picks: [{ optionId: 'starch', choiceId: 'pap', label: 'Pap', priceDelta: 0 }],
          kind: 'menu',
        },
        {
          key: 'short-rib-plate::starch=garlic-bread|veg=corn-ribs',
          itemId: 'short-rib-plate',
          name: 'BBQ Short Rib Plate',
          image: '/img/plate-short-rib.jpg',
          unitPrice: 130,
          qty: 1,
          picks: [{ optionId: 'starch', choiceId: 'garlic-bread', label: 'Garlic bread', priceDelta: 0 }],
          kind: 'menu',
        },
      ],
      /* Delivery is the default choice for a fresh basket. */
      fulfilment: 'delivery',
    },
    version: 2,
  },
});

await s8.waitFor(() => /3 plates/.test(s8.text()), 'the pinned basket bar', 20000);

await step('the basket bar describes the fulfilment that is actually chosen', async () => {
  if (!/3 plates · delivery/.test(s8.text())) throw new Error('the bar does not show the plate count and delivery');
  if (!/Delivery included/.test(s8.text())) throw new Error('a delivery basket should say delivery is included');

  /*
   * Switching to collection must change the second line too. It used to keep
   * saying "Delivery included", which is nonsense on a collection order — the
   * owner spotted exactly that on a three-plate basket.
   */
  const open = [...s8.doc.querySelectorAll('button')].find((b) => /Open your basket/i.test(b.getAttribute('aria-label') ?? ''));
  s8.click(open);
  await s8.waitFor(() => /Your basket/i.test(s8.text()), 'the basket drawer', 15000);

  const collection = [...s8.doc.querySelectorAll('button')].find((b) => /^collection$/i.test((b.textContent ?? '').trim()));
  if (!collection) throw new Error('no collection switch in the basket');
  s8.click(collection);
  await sleep(300);
  if (/Delivery included/.test(s8.text())) throw new Error('the drawer still claims delivery is included on a collection basket');
  if (!/Collection — nothing is added at checkout/.test(s8.text())) {
    throw new Error('the drawer does not say what a collection basket is charged');
  }

  /* Close the drawer: the bar must agree with it. */
  const close = [...s8.doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close');
  s8.click(close);
  await sleep(300);
  if (/Delivery included/.test(s8.text())) throw new Error('a collection basket still claims delivery is included');
  if (!/Collection — nothing extra/.test(s8.text())) throw new Error('a collection basket does not say what applies');
  if (!/3 plates · collection/.test(s8.text())) throw new Error('the bar does not show the collection choice');
  return 'delivery and collection each described correctly';
});

await step('the basket can be cleared from the bottom of the drawer', async () => {
  /* Open the drawer from the bar. */
  const open = [...s8.doc.querySelectorAll('button')].find((b) => /Open your basket/i.test(b.getAttribute('aria-label') ?? ''));
  if (!open) throw new Error('no basket bar to open');
  s8.click(open);
  await s8.waitFor(() => /Your basket/i.test(s8.text()), 'the basket drawer', 15000);

  const clearButton = () => [...s8.doc.querySelectorAll('button')].find((b) => /Clear basket|Tap again to clear/i.test(b.textContent ?? ''));
  if (!clearButton()) throw new Error('the drawer has no way to clear the basket');

  /*
   * Two taps. One tap would let a thumb wipe a basket somebody spent time
   * filling, so the first tap asks and names what will go.
   */
  s8.click(clearButton());
  await sleep(150);
  if (!/Tap again to clear 3 plates/i.test(clearButton()?.textContent ?? '')) {
    throw new Error(`the confirmation does not say what will be cleared: ${clearButton()?.textContent}`);
  }
  if (!/Mogodu/i.test(s8.text())) throw new Error('the basket emptied on the first tap');

  s8.click(clearButton());
  await s8.waitFor(() => /Nothing in the pot yet/i.test(s8.text()), 'the empty basket', 15000);
  await sleep(200);
  if (/Open your basket/i.test(s8.text())) throw new Error('the bar is still showing for an empty basket');
  return 'two taps, and the basket is empty';
});

/* ------------------------------------------------------------------ */

const failed = results.filter(([s]) => s === 'FAIL');
console.log('\n--- interaction smoke test (jsdom, live API) ---');
for (const [status, label, detail] of results) console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ''}`);

const errs = [...s1.errors, ...s3.errors, ...s5.errors, ...s6.errors, ...s8.errors];
if (errs.length) {
  console.log('\n--- runtime errors ---');
  for (const e of errs.slice(0, 10)) console.log(`  ${e}`);
}

const ok = failed.length === 0 && errs.length === 0;
console.log(`\n${ok ? 'ALL GREEN' : 'FAILURES'}: ${results.length - failed.length}/${results.length} interactions passed, ${errs.length} runtime errors\n`);
s1.close();
s3.close();
s5.close();
s6.close();
s8.close();
process.exit(ok ? 0 : 1);
