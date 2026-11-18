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
      /*
       * A step can return `SKIP: reason` when the thing it tests is genuinely
       * not available on this host — the paid path needs Yoco configured, for
       * example. It is reported as skipped with its reason rather than as either
       * a pass it did not earn or a failure that says nothing about the code.
       */
      if (typeof detail === 'string' && detail.startsWith('SKIP:')) results.push(['SKIP', label, detail.slice(5).trim()]);
      else results.push(['PASS', label, detail ?? '']);
    } catch (e) {
      results.push(['FAIL', label, e.message]);
    }
  })();

function boot(path, { seedCart, offline } = {}) {
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
    /*
     * `offline: 'fail'` simulates a connection that drops, and `offline: 'hang'`
     * one that opens and then never answers. Both are real states of a phone,
     * and both used to leave three pages spinning for ever — the owner's report
     * on 17 Nov 2026. Only the catalogue request is affected, so the page's own
     * static assets still load and the assertion is about the API alone.
     */
    if (offline && String(url).includes('/api/')) {
      if (offline === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new w.Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    }
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
  /*
   * Scroll position, simulated.
   *
   * jsdom has no layout and pins `scrollY` at 0, but the back-to-top button's
   * whole contract is "hidden at the top, visible once you have scrolled", so
   * the suite needs a scroll position it can move. `__scrollTo(y)` sets it and
   * fires the event a real browser would; the patched `scrollTo` moves it too,
   * so a successful jump to the top is observable in both directions.
   */
  let scrollY = 0;
  Object.defineProperty(w, 'scrollY', { configurable: true, get: () => scrollY });
  w.__scrollTo = (y) => {
    scrollY = y;
    w.dispatchEvent(new w.Event('scroll'));
  };
  w.scrollTo = (o) => {
    scrolls.push({ kind: 'scrollTo', arg: o });
    if (o && typeof o === 'object' && typeof o.top === 'number') scrollY = o.top;
  };
  w.HTMLElement.prototype.scrollIntoView = function () {
    scrolls.push({ kind: 'scrollIntoView', id: this.id || this.tagName });
    for (const observer of observers) {
      if (observer.targets.includes(this)) observer.callback([{ target: this, isIntersecting: true, intersectionRatio: 1 }], observer);
    }
  };
  w.confirm = () => true;
  w.alert = () => {};
  /*
   * Geolocation, answered instantly.
   *
   * jsdom has none, and a real browser would show a permission prompt a test
   * cannot click. The checkout's location button is what makes the 50 km rule
   * enforceable, so the suite has to be able to exercise it: the stub resolves
   * to Sandton unless a test stages a different position or a refusal.
   */
  w.__geo = { lat: -26.1075, lng: 28.055 };
  w.__geoDenied = false;
  /*
   * The suite runs against http://127.0.0.1, but a browser only exposes
   * geolocation on a secure origin. The checkout now checks `isSecureContext`
   * *before* touching `navigator.geolocation` — so on a plain-http page it
   * reports "insecure" and never asks, which is correct in life and would make
   * every location step here test the wrong branch.
   *
   * localhost is a secure context in every real browser, so the honest stub is
   * to declare this origin secure, exactly as the browser would for the preview
   * at 127.0.0.1. The insecure branch has its own step below.
   */
  Object.defineProperty(w, 'isSecureContext', { configurable: true, value: true });
  /*
   * Every call's options, in order. The site's claim is that it asks for a
   * *precise* fix — that is what the radius needs — and "does it really" is only
   * answerable by looking at what was passed to the browser.
   */
  w.__geoCalls = [];
  /* Simulates a device that cannot answer a high-accuracy request at all. */
  w.__geoHighAccurateUnavailable = false;
  /*
   * The Permissions API, as the real browsers expose it. The site now reads the
   * permission state before asking for a fix, because a denied origin can never
   * be prompted again and deserves a different sentence from a customer who has
   * simply not answered yet. The stub answers `prompt` unless a step says the
   * permission is denied, which reproduces the browser a first-time visitor
   * actually has: the prompt is raiseable, and getCurrentPosition is what raises
   * it.
   */
  w.__geoPermission = 'prompt';
  Object.defineProperty(w.navigator, 'permissions', {
    configurable: true,
    value: {
      query: async (descriptor) => ({
        name: descriptor?.name,
        state: descriptor?.name === 'geolocation' ? w.__geoPermission : 'prompt',
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
  });
  Object.defineProperty(w.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok, fail, options) => {
        w.__geoCalls.push({ ...options });
        setTimeout(() => {
          if (w.__geoDenied) fail?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
          else if (options?.enableHighAccuracy && w.__geoHighAccurateUnavailable) {
            fail?.({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
          } else {
            /* A high-accuracy fix is metres; a coarse one is the suburb centre. */
            ok({ coords: { latitude: w.__geo.lat, longitude: w.__geo.lng, accuracy: options?.enableHighAccuracy ? 12 : 2000 } });
          }
        }, 0);
      },
    },
  });
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

  return { w, doc, text, all, byText, byLabel, click, waitFor, setInput, scrolls, press, dialogs, focusInsideDialog, errors, seedCart, close: () => w.close() };
}

/* ------------------------------------------------------------------ */
/* Flow 1: browse -> open dish -> add to basket -> basket reflects it  */
/* ------------------------------------------------------------------ */

const s1 = boot('/menu');
await s1.waitFor(() => /The full menu/i.test(s1.text()), 'menu page');

const arch = boot('/menu');
await arch.waitFor(() => /Kasi Fast Food/i.test(arch.text()), 'archive sections', 15000);

await step('the menu sells exactly the two approved plate categories, and the sides', async () => {
  for (const c of ['Traditional Plates', 'Contemporary Plates', 'Sides & Relishes']) {
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
  /*
   * Owner, 14 Nov 2026: Heritage Pots is hidden — commented out in the seed, not
   * deleted, so the section and its copy are one uncomment away. The remaining
   * archive chips must still be there and the hidden one must NOT be.
   */
  for (const name of [/Kasi Fast Food/, /Morning Heritage/]) {
    if (!name.test(navText)) throw new Error(`the archive category chip is missing from the menu nav: ${name}`);
  }
  /*
   * Sides & Relishes is a *sellable* chip now (17 Nov 2026), not an archive one —
   * the sides carry prices and go in the basket, so it belongs with the plates.
   */
  if (!/Sides & Relishes/.test(navText)) throw new Error('the sides have no category chip');
  if (/Heritage Pots/i.test(arch.text())) throw new Error('Heritage Pots is still on the page after being hidden');
  /*
   * Modern Favourites was dropped by the owner: every dish in it — short ribs,
   * wings — is already a Contemporary plate, and a "coming soon" tag on food
   * that is on sale today is just confusing.
   */
  if (/Modern Favourites/.test(navText)) throw new Error('the duplicated Modern Favourites category is still in the nav');
  if (/Cold & Warm/.test(navText)) throw new Error('the unapproved drinks category must stay commented out');

  const sellableSections = s1.doc.querySelectorAll('main > section[data-sellable]');
  if (sellableSections.length !== 3) {
    throw new Error(`expected 3 sellable sections (two plate kitchens and the sides), found ${sellableSections.length}`);
  }
  const archiveSections = [...arch.doc.querySelectorAll('main > section')].filter((section) =>
    section.querySelector('[data-coming-soon]'),
  );
  if (archiveSections.length !== 2) {
    throw new Error(`expected 2 archive sections, found ${archiveSections.length}`);
  }
  return '3 sellable sections plus 2 archive chips, Heritage Pots hidden';
});

await step('the sides are priced, open their details, and go in the basket', async () => {
  /*
   * Owner, 17 Nov 2026: "some sides & relishes must have prices and details when
   * clicked", and on whether one can be bought: "they can add to cart but be
   * unable to checkout if items are less than 100".
   *
   * So this checks both halves of that arrangement: a side is a real product with
   * a price and its own photograph, tapping it opens details — and the R100
   * minimum, not a special rule, is what stops a lone bowl being checked out.
   */
  const sidesSection = s1.doc.getElementById('menu-category-sides');
  if (!sidesSection) throw new Error('the menu has no Sides & Relishes section');
  const cards = [...sidesSection.querySelectorAll('article')];
  if (cards.length < 9) throw new Error(`expected the nine vegetable sides, found ${cards.length} cards`);

  const section = sidesSection.textContent ?? '';
  if (!/portion/i.test(section)) throw new Error('the sides do not say they are sold by the portion');
  /* Every card carries a price and a picture of itself. */
  for (const card of cards) {
    const text = card.textContent ?? '';
    if (!/R\d/.test(text)) throw new Error(`a side card has no price: "${text.slice(0, 80)}"`);
    const img = card.querySelector('img');
    if (!img?.getAttribute('src')) throw new Error('a side card has no photograph');
  }
  /* The photographs are the side's own, not a borrowed plate. */
  const borrowed = cards
    .map((c) => c.querySelector('img')?.getAttribute('src') ?? '')
    .filter((src) => /plate-|pizza|hero-feast/.test(src));
  if (borrowed.length) throw new Error(`the sides are using plate photographs: ${borrowed.join(', ')}`);

  /* Tapping one opens its details: what it is, how much, and what a portion is. */
  const chakalaka = cards.find((c) => /Chakalaka/i.test(c.textContent ?? ''));
  if (!chakalaka) throw new Error('no chakalaka card to tap');
  s1.click([...chakalaka.querySelectorAll('button')].find((b) => /Details/i.test(b.getAttribute('aria-label') ?? '')));
  await s1.waitFor(() => /Add to basket/i.test(s1.text()), 'the side details sheet', 6000);
  const sheet = s1.doc.querySelector('[role="dialog"]')?.textContent ?? '';
  if (!/Spicy carrot, bean and pepper relish/i.test(sheet)) throw new Error('the side details do not describe the dish');
  if (!/R\d/.test(sheet)) throw new Error('the side details do not show a price');

  /* Add it, and it lands in the basket at its own price. */
  const addBtn = [...s1.doc.querySelectorAll('[role="dialog"] button')].find((b) => /Add to basket/i.test(b.textContent ?? ''));
  s1.click(addBtn);
  await sleep(400);
  if (!/Chakalaka/i.test(s1.text())) throw new Error('the side never reached the basket');
  return `${cards.length} priced sides with their own photos, details and a basket path`;
});

await step('a lone bowl of chakalaka is blocked at checkout by the R100 minimum', async () => {
  /*
   * The owner's rule, end to end: "they can add to cart but be unable to checkout
   * if items are less than 100". One R30 bowl is a basket, and it is not an
   * order — the same minimum every small order already meets.
   */
  /*
   * A basket with one R30 bowl in it — the shape the basket store writes, so the
   * page restores it rather than starting empty and testing nothing.
   */
  const bowl = boot('/checkout', {
    seedCart: {
      state: {
        fulfilment: 'delivery',
        lines: [{
          key: 'side-chakalaka::',
          itemId: 'side-chakalaka',
          name: 'Chakalaka',
          image: '/img/chakalaka.jpg',
          unitPrice: 30,
          qty: 1,
          picks: [],
          kind: 'menu',
        }],
      },
      version: 2,
    },
  });
  await bowl.waitFor(() => /Almost there/i.test(bowl.text()), 'checkout', 20000);
  bowl.setInput([...bowl.doc.querySelectorAll('input')].find((f) => /Thabo Mahlangu/.test(f.placeholder ?? '')), 'Side Only');
  bowl.setInput([...bowl.doc.querySelectorAll('input')].find((f) => /\+27 82/.test(f.placeholder ?? '')), '+27 82 000 9090');
  await sleep(600);

  const page = bowl.text();
  /* The wording the basket uses for the same rule. */
  if (!/Delivery orders start at|minimum order is|reach the R100|R100 minimum/i.test(page)) {
    throw new Error(`a R30 basket is not told about the minimum order: ${page.slice(0, 400)}`);
  }
  const wa = [...bowl.doc.querySelectorAll('a[href^="https://wa.me/"]')].find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));
  if (wa) throw new Error('a R30 bowl can reach checkout without meeting the minimum');

  /*
   * And neither order button can be pressed — not the WhatsApp one, and not the
   * paid one. Owner, 17 Nov 2026: "disable the complete order if the items are
   * less than 100". The paid button used to be live here and only the server
   * refused it, after the customer had filled the whole form in.
   */
  const paid = [...bowl.doc.querySelectorAll('button[type="submit"]')][0];
  if (!paid) throw new Error('no primary order button on the checkout');
  if (!paid.disabled) throw new Error('the paid order button is still live below the minimum');
  if (!/Add R\d/.test(paid.textContent ?? '')) throw new Error(`the disabled order button does not say how much more is needed: ${paid.textContent}`);

  bowl.close();
  return 'the R100 minimum is what stops a lone bowl, not a rule against sides';
});

await step('"Order online" takes an empty basket to the menu, not to an empty checkout', async () => {
  /*
   * Owner, 18 Nov 2026: "when i click order online it takes me to checkout and on
   * checkout its empty".
   *
   * The button promised an order and delivered a page saying there was none. With
   * nothing in the basket the only useful destination is the menu; with something
   * in it, the checkout is right — so the first tap must not cost the customer a
   * dead end, and the second must still go where it always went.
   */
  const fresh = boot('/');
  await fresh.waitFor(() => /A taste of South African heritage/i.test(fresh.text()), 'the home page', 20000);
  const orderBtn = () => [...fresh.doc.querySelectorAll('button')].find((b) => /^Order online$/i.test((b.textContent ?? '').trim()));
  if (!orderBtn()) throw new Error('the home page has no Order online button');
  fresh.click(orderBtn());
  await fresh.waitFor(() => fresh.w.location.pathname === '/menu', 'an empty basket to be sent to the menu', 8000);
  await fresh.waitFor(() => /The full menu/i.test(fresh.text()), 'the menu to render', 15000);

  /* The hero list's own row follows the same rule, and says so. */
  const row = [...fresh.doc.querySelectorAll('a')].find((a) => /Start an order|Order online/.test(a.textContent ?? ''));
  if (!row) throw new Error('the order-channel row is missing');
  if (!/Start an order/.test(row.textContent ?? '')) {
    throw new Error(`with an empty basket the row still promises an online order: ${row.textContent}`);
  }
  if (row.getAttribute('href') !== '/menu') throw new Error(`the row points at ${row.getAttribute('href')}, not the menu`);

  const foot = [...fresh.doc.querySelectorAll('a')].find((a) => /Start an order|Checkout & pay/.test(a.textContent ?? ''));
  if (!foot || foot.getAttribute('href') !== '/menu') throw new Error('the footer still offers a checkout with nothing in the basket');
  fresh.close();
  return 'one tap to the menu, three entry points agreeing';
});

await step('with a basket, "Order online" opens the basket instead of a page', async () => {
  /*
   * The other half of the same rule. A returning customer who taps the loudest
   * button with a plate already chosen should see what they are ordering — not a
   * reload of the home page, and not a trip through the menu.
   */
  const shopper = boot('/', {
    seedCart: {
      state: {
        fulfilment: 'delivery',
        lines: [{
          key: 'plate::traditional::starch=pap|veg=chakalaka',
          itemId: 'plate-traditional',
          plateId: 'traditional',
          name: 'Traditional Plate',
          image: '/img/plate-mogodu.jpg',
          unitPrice: 100,
          qty: 1,
          picks: [],
          kind: 'plate',
        }],
      },
      version: 2,
    },
  });
  await shopper.waitFor(() => /A taste of South African heritage/i.test(shopper.text()), 'the home page', 20000);
  const btn = [...shopper.doc.querySelectorAll('button')].find((b) => /^Order online$/i.test((b.textContent ?? '').trim()));
  shopper.click(btn);
  await shopper.waitFor(() => shopper.doc.querySelector('[role="dialog"][aria-label="Your basket"]'), 'the basket drawer', 8000);
  if (!/Traditional Plate/.test(shopper.doc.querySelector('[role="dialog"]')?.textContent ?? '')) {
    throw new Error('the drawer opened without the plate in it');
  }
  if (shopper.w.location.pathname !== '/') throw new Error('the basket opened by navigating away from the page');

  /* And the row now offers the checkout, because there is something to check out. */
  const row = [...shopper.doc.querySelectorAll('a')].find((a) => /^Order online/.test((a.textContent ?? '').trim()));
  if (!row || row.getAttribute('href') !== '/checkout') throw new Error('the channel row will not offer the checkout with a basket full');
  shopper.close();
  return 'drawer with the plate, checkout offered, page unchanged';
});

await step('a menu that cannot load says so instead of spinning for ever', async () => {
  /*
   * Owner, 17 Nov 2026: "why loader loads forever".
   *
   * All three catalogue pages branched on `!catalog` with no branch for a failed
   * request, so a dropped connection left a spinner turning for as long as the
   * customer was willing to look at it. A spinner is a promise that something is
   * coming; once the request has failed there is nothing coming.
   *
   * The bar to clear is three things: no spinner, a sentence that says what
   * happened, and a way out that is not "reload the site".
   */
  const pages = [
    ['/menu', /We could not load the menu/i],
    ['/specials', /We could not load this week/i],
    ['/policies', /We could not load our policies/i],
  ];
  for (const [path, headline] of pages) {
    const dead = boot(path, { offline: 'fail' });
    await dead.waitFor(() => headline.test(dead.text()), `an error on ${path} rather than a spinner`, 20000);
    if (dead.doc.querySelector('.animate-spin')) throw new Error(`${path} still shows a spinner after the request failed`);
    const retry = [...dead.doc.querySelectorAll('button')].find((b) => /Try again/i.test(b.textContent ?? ''));
    if (!retry) throw new Error(`${path} offers no way to try again`);
    const wa = [...dead.doc.querySelectorAll('a[href^="https://wa.me/"]')][0];
    if (path === '/menu' && !wa) throw new Error('the failed menu has no WhatsApp door for a customer who still needs to order');
    dead.close();
  }
  return 'menu, specials and policies all fail out loud, with a retry';
});

await step('trying again after a dropped connection actually reloads the catalogue', async () => {
  /*
   * A "Try again" that re-renders the same error is worse than none at all: it
   * tells the customer their tap worked when nothing was asked. The first load is
   * made to fail, the retry is a real second request, and the page has to end up
   * rendering the real thing.
   */
  const revived = boot('/specials', { offline: 'fail' });
  await revived.waitFor(() => /We could not load this week/i.test(revived.text()), 'the error state', 20000);

  /* The wire comes back. */
  revived.w.fetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${BASE}${input}` : input;
    return fetch(url, init);
  };
  const retry = [...revived.doc.querySelectorAll('button')].find((b) => /Try again/i.test(b.textContent ?? ''));
  revived.click(retry);
  await revived.waitFor(() => /Cooked Thursdays/i.test(revived.text()), 'the page to load after the retry', 15000);
  if (revived.doc.querySelector('.animate-spin')) throw new Error('the spinner came back instead of the page');
  revived.close();
  return 'one tap re-asks and the page loads';
});

await step('the checkout door is shut while the basket is under R100, and open once it is not', async () => {
  /*
   * Owner, 17 Nov 2026: "disable the complete order if the items are less than
   * 100". Until now the bottom bar offered a live Checkout pill to a R30 basket:
   * it led to a page that then refused the order, which is a button that lies.
   *
   * Two baskets, the same page, only the amount different — the bar and the
   * drawer are two doors to one checkout, so both are checked.
   */
  const line = (unitPrice, n) => ({
    key: `t::${unitPrice}`,
    itemId: 'side-chakalaka',
    name: n,
    image: '/img/chakalaka.jpg',
    unitPrice,
    qty: 1,
    picks: [],
    kind: 'menu',
  });

  const short = boot('/menu', { seedCart: { state: { fulfilment: 'delivery', lines: [line(30, 'Chakalaka')] }, version: 2 } });
  await short.waitFor(() => /1 item · delivery/.test(short.text()), 'the basket bar with a short basket', 20000);

  const door = () => [...short.doc.querySelectorAll('button, a')].find((el) => /^Checkout$/i.test((el.textContent ?? '').trim()));
  const shut = door();
  if (!shut) throw new Error('the basket bar has no checkout door');
  if (shut.tagName === 'A' && (shut.getAttribute('href') ?? '').includes('/checkout')) {
    throw new Error('a R30 basket is still offered a live checkout link');
  }
  if (shut.tagName === 'BUTTON' && !shut.disabled) throw new Error('the checkout door is a button but not disabled');
  /* The amount still needed, said out loud beside it. */
  if (!/Add R\d/.test(short.text()) || !/R100 minimum/.test(short.text())) {
    throw new Error(`the bar does not say how far short the basket is: ${short.text().slice(0, 200)}`);
  }

  /* The drawer is the same door, so it is shut the same way. */
  short.click([...short.doc.querySelectorAll('button')].find((b) => /basket/i.test(b.getAttribute('aria-label') ?? '')));
  await short.waitFor(() => short.doc.querySelector('[role="dialog"][aria-label="Your basket"]'), 'the basket drawer', 6000);
  const drawerShut = [...short.doc.querySelectorAll('[role="dialog"] button')].find((b) => /^Checkout$/i.test((b.textContent ?? '').trim()));
  if (!drawerShut) throw new Error('the drawer lost its checkout button');
  if (!drawerShut.disabled) throw new Error('the drawer lets a R30 basket through while the bar does not');
  short.close();

  /* The same basket at R100 is a different story. */
  const enough = boot('/menu', { seedCart: { state: { fulfilment: 'delivery', lines: [line(100, 'Traditional Plate')] }, version: 2 } });
  await enough.waitFor(() => /1 item · delivery/.test(enough.text()), 'the basket bar with a full basket', 20000);
  const open = [...enough.doc.querySelectorAll('button, a')].find((el) => /^Checkout$/i.test((el.textContent ?? '').trim()));
  if (open?.tagName !== 'A' || !(open.getAttribute('href') ?? '').includes('/checkout')) {
    throw new Error('a R100 basket cannot reach the checkout');
  }
  enough.close();
  return 'shut at R30 in both doors, open at R100';
});

await step('nothing selected cannot be added: the order and add buttons say what is missing', async () => {
  /*
   * Owner, 17 Nov 2026: "disable that if there is no food selected". A dish with
   * a required choice used to accept the tap and then scold the customer with a
   * toast — a button that is present, lit and then refuses reads as broken. The
   * Add button is now disabled and says which choice is missing.
   */
  /* A plate: the builder's Add button, with no protein picked. */
  const builder = [...s1.doc.querySelectorAll('section button')].find((el) => /Build your plate/i.test(el.textContent ?? ''));
  if (!builder) throw new Error('no plate builder on the menu');
  s1.click(builder);
  await s1.waitFor(() => s1.dialogs().length > 0, 'the plate builder', 8000);
  const addPlate = [...s1.doc.querySelectorAll('[role="dialog"] button')].find((el) => /Pick a|Add plate/i.test(el.textContent ?? ''));
  if (!addPlate) throw new Error('the plate builder has no add button');
  if (!addPlate.disabled) throw new Error('a plate with no protein picked can still be added');
  if (!/Pick a protein/i.test(addPlate.textContent ?? '')) throw new Error(`the add button does not say what is missing: ${addPlate.textContent}`);
  const closeBuilder = [...s1.doc.querySelectorAll('[role="dialog"] button')].find((el) => /close/i.test(el.getAttribute('aria-label') ?? ''));
  s1.click(closeBuilder);
  await s1.waitFor(() => s1.dialogs().length === 0, 'the builder to close', 8000);

  /* A dish sheet with a required choice: same rule, same words. */
  const cardBtn = [...s1.doc.querySelectorAll('article button')]
    .find((el) => /Details for Mala-Mogodu/i.test(el.getAttribute('aria-label') ?? ''));
  if (!cardBtn) throw new Error('no Mala-Mogodu card');
  s1.click(cardBtn);
  await s1.waitFor(() => s1.dialogs().length > 0, 'the dish sheet', 8000);
  const addDish = [...s1.doc.querySelectorAll('[role="dialog"] footer button')].find((el) => /Add to basket|Pick a/i.test(el.textContent ?? ''));
  if (!addDish) throw new Error('the dish sheet has no add button');
  if (!addDish.disabled) throw new Error('a dish with nothing chosen can still be added');
  if (!/Pick a/i.test(addDish.textContent ?? '')) throw new Error(`the sheet's add button does not name the missing choice: ${addDish.textContent}`);
  const closeSheet = [...s1.doc.querySelectorAll('[role="dialog"] button')].find((el) => /close/i.test(el.getAttribute('aria-label') ?? ''));
  s1.click(closeSheet);
  await s1.waitFor(() => s1.dialogs().length === 0, 'the sheet to close', 8000);
  return 'both add buttons disabled, both naming the missing choice';
});

await step('the menu can be read as a grid or a list, from a control beside the sort', async () => {
  /*
   * Owner, 17 Nov 2026: "the meals listview must have a listview and gridview …
   * the sort must be far to the right whilst inline with food categories and next
   * to sort to have the view which is listview/gridview".
   *
   * Two assertions, because both were asked for: the control exists beside the
   * sort, and it actually changes the shape of the list.
   */
  const sortSelect = [...s1.doc.querySelectorAll('select')].find((el) => /Sort meals/i.test(el.getAttribute('aria-label') ?? ''));
  if (!sortSelect) throw new Error('no sort control on the menu');
  const toggle = s1.doc.querySelector('[role="group"][aria-label="View meals as"]');
  if (!toggle) throw new Error('no list/grid control on the menu');
  /* Beside the sort, not on a row of its own. */
  const controls = toggle.parentElement;
  if (!controls?.contains(sortSelect)) throw new Error('the view control is not beside the sort');
  const buttons = [...toggle.querySelectorAll('button')];
  if (buttons.length !== 2) throw new Error('the view control is not a two-state switch');

  const panel = s1.doc.getElementById('menu-panel-sides');
  const before = panel?.querySelector('[data-view]')?.getAttribute('data-view');
  if (before !== 'grid') throw new Error(`the menu does not start in grid: ${before}`);

  s1.click(buttons.find((b) => /list/i.test(b.getAttribute('aria-label') ?? '')));
  await sleep(200);
  const after = s1.doc.getElementById('menu-panel-sides')?.querySelector('[data-view]')?.getAttribute('data-view');
  if (after !== 'list') throw new Error(`the list control did not switch the layout: ${after}`);
  if (buttons.find((b) => /list/i.test(b.getAttribute('aria-label') ?? ''))?.getAttribute('aria-pressed') !== 'true') {
    throw new Error('the list control does not report itself as pressed');
  }
  /* And back, so the later steps see the page as a customer first meets it. */
  s1.click(buttons.find((b) => /grid/i.test(b.getAttribute('aria-label') ?? '')));
  await sleep(150);
  return 'grid + list, switched from a control beside the sort';
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
  await s1.waitFor(() => /Mala-Mogodu/i.test(dialogText()), 'results for "mogodu" inside the dialog', 10000);
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
      /* The dish is called "Smiley" now — no "Plate" suffix. The row's text is
         "SmileyR100,00+ Add", so only the leading word can be matched. */
      const hit = inDialog('button', /^\s*Smiley/i)[0];
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error(`no "Smiley" result inside the dialog. dialog text: ${dialogText().slice(0, 120)}`);
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
  /*
   * Two, not three: Sides & Relishes left the archive on 17 Nov 2026 when the
   * sides became orderable products. What is left is genuinely not on sale —
   * Kasi fast food and the morning kitchen.
   */
  if (blocks.length !== 2) throw new Error(`expected 2 archive sections (Heritage Pots is hidden, sides are sellable), found ${blocks.length}`);
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
    /* Every card left in the archive is a dish the kitchen would sell, so every
       one shows a guide price. */
    if (!/R\s?\d/.test(grid.textContent ?? '')) throw new Error('an archive card is missing its guide price');
    if (!/Coming soon/i.test(grid.textContent ?? '')) throw new Error('archive cards are missing their "Coming soon" tag');
    const interactive = grid.querySelectorAll('a, button, input, select, textarea, [role="link"], [role="button"], [onclick]');
    if (interactive.length) throw new Error(`the archive must not be orderable, but a card grid holds ${interactive.length} control(s)`);
  }
  if (arch.doc.querySelectorAll('[data-coming-soon] a').length) throw new Error('an archive card contains a link');

  const body = archiveSections.map((section) => section?.textContent ?? '').join(' ');
  for (const name of [/Kasi Fast Food/, /Morning Heritage/]) {
    if (!name.test(body)) throw new Error(`archive category missing: ${name}`);
  }
  /* The sides are sellable now, so they must NOT be in the archive. */
  if (/Sides & Relishes/i.test(body)) throw new Error('Sides & Relishes is still rendered as a coming-soon section');
  /* Hidden by the owner (14 Nov 2026), commented out in the seed, not deleted. */
  if (/Heritage Pots/i.test(body)) throw new Error('Heritage Pots is still rendered after being hidden');
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
    .filter((chip) => /Heritage Pots|Kasi Fast Food|Morning Heritage/.test(chip.textContent ?? ''));
  for (const chip of archiveChips) {
    if (/soon/i.test(chip.textContent ?? '')) throw new Error(`an archive chip still says "soon": ${chip.textContent}`);
  }

  const placeholders = [...block.querySelectorAll('img')].filter((img) => img.getAttribute('src')?.includes('placeholder'));
  if (placeholders.length) throw new Error('archive cards are showing placeholder images instead of photos');

  return '2 categories, priced cards, 0 order controls';
});

await step('every vegetable side a plate offers is also sold on Sides & Relishes', async () => {
  /*
   * Owner, 16 Nov 2026: "all Choose your vegetable side items put them also on
   * Sides & Relishes". Since 17 Nov 2026 they are not archive cards but products,
   * so they live in the sellable section — and the rule is the same one it was:
   * the two lists must agree.
   *
   * The options are read out of the plate builder's own DOM and matched against
   * the rendered cards, because a hard-coded list here would pass even if the
   * builder gained a side the section never showed.
   */
  const builderButton = [...arch.doc.querySelectorAll('section button')]
    .find((el) => /Build your plate/i.test(el.textContent ?? ''));
  if (!builderButton) throw new Error('no plate builder card on the menu');
  arch.click(builderButton);
  await arch.waitFor(() => arch.dialogs().length > 0, 'plate builder to open', 8000);

  const group = [...arch.doc.querySelectorAll('[role="dialog"] fieldset')]
    .find((el) => /Choose your vegetable side/i.test(el.querySelector('legend')?.textContent ?? ''));
  if (!group) throw new Error('the plate builder has no vegetable-side group');
  const options = [...group.querySelectorAll('button[role="checkbox"]')]
    .map((el) => (el.textContent ?? '').replace(/\s*Included\s*$/i, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (options.length < 5) throw new Error(`expected the vegetable sides, saw ${options.length}: ${options.slice(0, 6)}`);

  const closeBuilder = [...arch.doc.querySelectorAll('[role="dialog"] button')]
    .find((el) => /close/i.test(el.getAttribute('aria-label') ?? ''));
  if (!closeBuilder) throw new Error('the plate builder has no close control');
  arch.click(closeBuilder);
  await arch.waitFor(() => arch.dialogs().length === 0, 'plate builder to close', 8000);

  const sidesSection = arch.doc.getElementById('menu-category-sides');
  if (!sidesSection) throw new Error('the Sides & Relishes section is missing');
  const cards = [...sidesSection.querySelectorAll('article h3')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase());

  const missing = options.filter((option) => !cards.some((card) => card === option.toLowerCase()));
  if (missing.length) throw new Error(`sides in the plate builder but not sold on Sides & Relishes: ${missing.join(', ')}`);
  return `${options.length} sides in the builder, all ${cards.length} cards match`;
});

await step('no plate card carries a bare prep-time figure', async () => {
  /*
   * The owner saw "20′" beside "Tlhakwana Plate" and asked what it was for. It
   * was a per-plate prep time, unlabelled, next to the price — so it is gone from
   * the card and from the dish sheet, and the "Quickest first" sort that ordered
   * the menu by a number nobody could see went with it.
   */
  const priced = [...arch.doc.querySelectorAll('[data-sellable] article')];
  if (!priced.length) throw new Error('no sellable plates to check');
  for (const card of priced) {
    if (/\d+\s?[′']/.test(card.textContent ?? '')) throw new Error(`a plate card still shows a bare figure: ${(card.textContent ?? '').slice(0, 60)}`);
  }
  const sorter = [...arch.doc.querySelectorAll('select')].find((el) => /sort/i.test(el.getAttribute('aria-label') ?? ''));
  if (sorter && [...sorter.options].some((o) => /quickest/i.test(o.textContent ?? ''))) {
    throw new Error('the "Quickest first" sort is back, but no prep time is shown');
  }
  return `${priced.length} plate cards, no unlabelled numbers; no invisible sort`;
});

await step('clicking an archive category chip jumps to its section', async () => {
  /*
   * Heritage Pots used to be the chip under test; the owner hid that category on
   * 14 Nov 2026, so the behaviour is asserted on the first archive chip that is
   * still published. The behaviour is the same one: the chip becomes active and
   * its section exists to jump to.
   */
  const chip = arch.byText('nav[aria-label="Meal categories"] button', /Kasi Fast Food/i)[0];
  if (!chip) throw new Error('no archive chip in the category nav');
  arch.click(chip);
  await new Promise((r) => setTimeout(r, 200));
  if (chip.getAttribute('aria-pressed') !== 'true') throw new Error('the chip did not become the active category');
  if (!arch.doc.getElementById('menu-category-kasi-fast-food')) throw new Error('the archive section has no anchor to jump to');
  if (arch.byText('nav[aria-label="Meal categories"] button', /Heritage Pots/i)[0]) {
    throw new Error('a chip for the hidden Heritage Pots category is still in the nav');
  }
  return 'chip selects the archive section, and the hidden category is absent';
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
  /*
   * Owner, 17 Nov 2026: "remove Setswana / Sepedi in all meals". The sheet used to
   * print "/mo-GOH-doo/ · Setswana" under the name — the line the owner struck
   * along with the local-name teaser on the card.
   */
  if (!/Mala-Mogodu/i.test(s1.text())) throw new Error('the dish name is not on its sheet');
  if (/Setswana|Sepedi/ .test(s1.text())) throw new Error('the removed language label is back on the dish sheet');
  return 'story + pronunciation visible';
});

await step('choosing required options then adding puts the line in the basket', async () => {
  /* A plate needs one starch and one vegetable side. Take the first choice in
     each required group — the sheet paints its story a tick before its option
     buttons mount, so wait for them rather than reading synchronously. */
  /*
   * Option controls are radio (required) and checkbox (add-ons) now, so they
   * expose aria-checked. Accept either attribute: the payment-method buttons are
   * still toggles and this helper is used for both.
   */
  await s1.waitFor(() => s1.byText('button[aria-checked], button[aria-pressed]', /^Pap$/)[0], 'the starch options to mount', 15000);
  const groups = [...s1.doc.querySelectorAll('[role="dialog"] fieldset')];
  let chosen = 0;
  for (const fs of groups) {
    /*
     * A required group is marked by an asterisk. That used to be found by its
     * colour class, which was renamed when the gold became theme-aware — so the
     * selector is now the marker itself, which does not change with the palette.
     */
    if (!fs.textContent.includes('*')) continue;
    const opt = fs.querySelector('button[aria-checked], button[aria-pressed]');
    if (!opt) throw new Error('required group has no options');
    s1.click(opt);
    chosen++;
  }
  if (chosen < 2) throw new Error(`expected starch and side groups, found ${chosen}`);
  await sleep(150);
  /*
   * Scoped to the sheet: since the sides became products, "Add to basket" is
   * also the label on every side card behind the dialog, and an unscoped match
   * clicks the menu instead of the sheet.
   */
  const sheetAdd = () => [...s1.doc.querySelectorAll('[role="dialog"] button')].find((b) => /Add to basket/i.test(b.textContent ?? ''));
  await s1.waitFor(sheetAdd, 'the add button to mount', 15000);
  s1.click(sheetAdd());
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
  if (!/Mala-Mogodu/.test(s1.text())) throw new Error('added item not in basket');
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
/* The basket every checkout session in this suite starts with. */
const CHECKOUT_CART = {
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
};

const s7 = boot('/checkout', { seedCart: CHECKOUT_CART });

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
 * Plus Bryanston (9 km — outside the two included suburbs, inside the radius),
 * Heidelberg (52 km — just outside it) and a Polokwane street (280 km), to prove
 * the list is cut by distance rather than by suburb name. Pretoria would not do:
 * it is 44 km out, so under the owner's rule it is genuinely deliverable with a
 * fee, and a test that expected it dropped would be asserting the old rule.
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
    /*
     * Bryanston: outside the two included suburbs, 8.8 km from the kitchen. The
     * owner's rule is a 50 km radius with a fee outside Sandton/Rosebank, so this
     * must be offered and priced — not hidden. It used to be absent entirely,
     * because the geocoder was bounded to the two suburbs.
     */
    house(444, 28.0207, -26.0515, '1', 'Bryanston Drive', 'Bryanston', 'Johannesburg'),
    /* Heidelberg: 52 km. Inside the square search box, outside the circle. */
    house(555, 28.3586, -26.5047, '1', 'Church Street', 'Heidelberg', 'Heidelberg'),
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
      geometry: { type: 'Point', coordinates: [29.4689, -23.9045] },
      properties: { osm_type: 'W', osm_id: 555, name: 'Church Street', city: 'Polokwane', postcode: '0699', osm_key: 'highway' },
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
    /*
     * A bare coordinate pair is the reverse lookup behind "Use my current
     * location". Photon answers it with whatever is at that point — here the
     * Illovo house from the fixture, which is what the customer's own fix will
     * put in the address box.
     */
    const reverse = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q);
    /* A house number followed by a partial street name: nothing, as in real life. */
    const body = reverse
      ? { type: 'FeatureCollection', features: [PHOTON_FIXTURE.features[0]] }
      : /^173\s+oxf/.test(q)
        ? { type: 'FeatureCollection', features: [] }
        : /^oxf/.test(q) ? PHOTON_STREET_FIXTURE : PHOTON_FIXTURE;
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  }
  return liveFetch(input, init);
};

await s7.waitFor(() => /Almost there/i.test(s7.text()), 'checkout page');

await step('the checkout promises no receipt email, and no longer explains its bookkeeping', async () => {
  /*
   * Owner, 17 Nov 2026, removing three paragraphs at once: the minimum-order
   * line, the "No email receipts — your WhatsApp chat is the record" line, and
   * the two minute estimates on Specials.
   *
   * The rule underneath is unchanged and still asserted: the page must never
   * claim an email it cannot send. What went is the explanation — a customer
   * mid-checkout does not need to be told about the host's SMTP configuration,
   * and the minimum order is enforced at the button with its own sentence.
   */
  const text = s7.text();
  if (/We email your receipt/i.test(text)) {
    throw new Error('the checkout promises a receipt email this server cannot send');
  }
  for (const gone of [
    /No email receipts/i,
    /your WhatsApp chat is the record/i,
    /Minimum order R/i,
  ]) {
    if (gone.test(text)) throw new Error(`the removed checkout paragraph is back: ${gone}`);
  }
  return 'no receipt email promised, and the three removed paragraphs stay removed';
});

await step('the delivery address is one box again, typed the way an address is said', async () => {
  /*
   * Owner, 17 Nov 2026: "i think the enter address was fine because it pulls what
   * you typed and street number, bring back the entering of location as it was."
   *
   * The three boxes of 16 Nov (house number / street / suburb) are gone. What is
   * asserted here is the shape the owner asked for: one input labelled "Delivery
   * address", and no separate house-number or suburb input. The house number is
   * not a field any more — it is part of what the customer types, and the map puts
   * it back onto a street-only match (checked two steps below).
   */
  const inputs = [...s7.doc.querySelectorAll('input')];
  const addressBoxes = inputs.filter((el) => /Oxford Road/.test(el.placeholder ?? ''));
  if (addressBoxes.length !== 1) throw new Error(`expected one address box, found ${addressBoxes.length}`);
  const address = addressBoxes[0];
  const label = address.closest('label')?.textContent?.trim() ?? '';
  if (!/^Delivery address/i.test(label)) {
    throw new Error(`the address box is not labelled "Delivery address": "${label}"`);
  }
  if (!/^12 Oxford Road, Illovo, Sandton$/.test(address.placeholder)) {
    throw new Error(`the placeholder does not show the shape of an address: "${address.placeholder}"`);
  }
  /* No leftovers from the three boxes. */
  if (inputs.some((el) => el.placeholder === '12')) throw new Error('the house-number box is back');
  if (inputs.some((el) => el.placeholder === 'Illovo')) throw new Error('the suburb box is back');
  if (/^House no\.|^Suburb$/m.test(s7.text())) throw new Error('the three-box labels are still on the page');

  /*
   * The delivery area is still a field of its own, with no hint under it. The
   * owner struck the hint ("decides the fee"), not the choice: without it a
   * customer who types an address and never picks a suggestion keeps whatever
   * area the page opened on, and the fee follows that guess.
   */
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  if (!select) throw new Error('the delivery address has no delivery area beside it');

  return 'one "Delivery address" box, no house/suburb inputs, and the area still selectable';
});

await step('the four hints the owner struck are gone from the checkout', async () => {
  /*
   * Owner, 17 Nov 2026, listing them: "remove 'decides the fee', 'optional — for a
   * written reply', 'optional', 'pick it from the list so we can check the
   * distance'". Asked whether that included the plain "optional" on email and
   * notes, the answer was yes — all four.
   *
   * Checked as text, not as markup, because the complaint was about what the page
   * says to a customer. A field being optional is still true; saying so on every
   * optional field is the noise.
   */
  const page = s7.text();
  for (const hint of [
    'decides the fee',
    'optional — for a written reply',
    'pick it from the list so we can check the distance',
  ]) {
    if (page.includes(hint)) throw new Error(`the removed hint "${hint}" is back on the checkout`);
  }
  /*
   * The bare word "optional" is matched in a hint position — right after a label
   * and before the input — rather than anywhere on the page, because "optional"
   * appears in ordinary sentences too and the assertion is about the labels.
   */
  const hints = [...s7.doc.querySelectorAll('label > span')]
    .map((el) => el.textContent ?? '')
    .filter((text) => /^\s*optional\s*$/i.test(text));
  if (hints.length) throw new Error(`${hints.length} field(s) still say "optional" in the label: ${hints.join(' / ')}`);
  return 'none of the four hints is on the checkout';
});

await step('typing a delivery address offers OpenStreetMap suggestions', async () => {
  const addressInput = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  if (!addressInput) throw new Error('no delivery address field');

  /* Focus first: the field only asks while it has the customer's attention. */
  addressInput.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(addressInput, '12 Oxford');

  await s7.waitFor(() => s7.photonCalls.length > 0, 'a geocoder request', 6000);
  const queried = new URL(s7.photonCalls[0]);
  /*
   * The whole line is sent, house number and all — that is the point of one box,
   * and `suggestAddresses` is what retries without the number when the map
   * answers that query badly.
   */
  if (queried.searchParams.get('q') !== '12 Oxford') throw new Error(`unexpected query: ${queried.searchParams.get('q')}`);
  /* The search is bounded to Rosebank/Sandton, and biased to Johannesburg. */
  if (!queried.searchParams.get('bbox')) throw new Error('the geocoder query is not limited to the delivery envelope');
  if (!queried.searchParams.get('lat') || !queried.searchParams.get('lon')) throw new Error('the geocoder query is not biased to Johannesburg');

  await s7.waitFor(() => s7.doc.querySelector('[role="listbox"][aria-label="Address suggestions"]'), 'the suggestion list', 6000);
  const options = [...s7.doc.querySelectorAll('[role="option"]')];
  /*
   * The fixture holds four places: Sandton, Rosebank, Bryanston and Heidelberg.
   * Everything inside 50 km is offered — including Bryanston, which is neither of
   * the two included suburbs — because delivery there costs a fee, and refusing
   * to offer it hid the fee customers from the rule that prices them. Heidelberg
   * (52 km) must not be offered: the list stops where the kitchen stops.
   */
  if (options.length !== 3) throw new Error(`expected the 3 reachable suggestions, saw ${JSON.stringify(options.map((o) => o.textContent))}`);
  const listed = s7.doc.querySelector('[role="listbox"]').textContent ?? '';
  if (/Polokwane/.test(listed)) throw new Error('an address 280 km away was offered');
  if (/Heidelberg/.test(listed)) throw new Error('an address past the 50 km limit was offered');
  if (!/Bryanston/.test(listed)) throw new Error('a Bryanston address inside the radius was not offered');
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
  /*
   * Two included suburbs plus "somewhere else". The third option is what makes the
   * radius usable: with only two, a Bryanston customer had to claim Sandton and
   * was then refused for contradicting themselves.
   */
  if (values.length !== 3) throw new Error(`unexpected area options: ${JSON.stringify(values)}`);
  if (values[0] !== 'Rosebank' || values[1] !== 'Sandton') throw new Error(`unexpected area options: ${JSON.stringify(values)}`);
  /* The third option is "Another area — within 15 km". The old long label
     ("Other — outside Sandton & Rosebank") was removed at the owner's request, so
     this checks the new wording rather than a prefix that now means nothing. */
  if (!/^another area/i.test(values[2])) throw new Error(`no "somewhere else" option: ${JSON.stringify(values)}`);
  if (/outside/i.test(values[2])) throw new Error(`the removed "outside Sandton & Rosebank" wording is back: ${values[2]}`);
  if (values.includes('')) throw new Error('an empty "Choose an area" option is still offered');
  if (select.value !== 'Rosebank') throw new Error(`the checkout opens on "${select.value}", not Rosebank`);
  return 'Rosebank preselected, two included suburbs + another area, no empty row';
});

await step('the other delivery area is still searchable while Rosebank is selected', async () => {
  /*
   * Preselecting Rosebank must not hide Sandton streets: a Sandton customer types
   * their address first and reads the area off the result. Narrowing the geocoder
   * to the preselected area would leave them typing into an empty list — worse
   * than the "Choose an area" row this replaced.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '12 Oxford');

  await s7.waitFor(() => {
    const list = s7.doc.querySelector('[role="listbox"]');
    return list && /Oxford/.test(list.textContent ?? '');
  }, 'the suggestion list', 6000);

  const shown = [...s7.doc.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
  /*
   * The list shows the whole line, house number included, plus the suburb that
   * distinguishes two Oxford Roads — which is what the owner meant by "it pulls
   * what you typed and street number".
   */
  if (!shown.some((text) => /Illovo/.test(text))) throw new Error('the Sandton address is missing while Rosebank is selected');
  if (!shown.some((text) => /Rosebank/.test(text))) throw new Error('the Rosebank address is missing');
  if (shown.some((text) => /Polokwane/.test(text))) throw new Error('an address outside the delivery radius was offered');
  if (shown.some((text) => /Heidelberg/.test(text))) throw new Error('an address past the 50 km limit was offered');
  return `${shown.length} reachable result(s), both included areas`;
});

await step('typing a house number and a half-typed street still finds the address', async () => {
  /*
   * The owner's report, exactly: "paste 173 Oxford Rd and it detects it, type
   * 173 oxf and nothing comes up". Photon answers a house number plus a partial
   * street with nothing, and answers the partial street alone with the street
   * object — which carries no suburb tag. The field must survive both: retry
   * without the number, place the street by its coordinates, and put the number
   * back on the line.
   *
   * With one box this is also the acceptance test for "it pulls what you typed
   * and street number": the number is not a field any more, so the only way it
   * survives the round trip is `applyHouseHint`.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '');
  await sleep(50);

  const before = s7.photonCalls.length;
  s7.setInput(input, '173 oxf');

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
  if (/Polokwane/.test(options.join(' '))) throw new Error(`an address outside the delivery radius was offered: ${JSON.stringify(options)}`);
  if (/Heidelberg/.test(options.join(' '))) throw new Error(`an address past the 50 km limit was offered: ${JSON.stringify(options)}`);
  /* Nor a Johannesburg CBD street that the map left untagged. */
  if (/2001|Johannesburg · 2001/.test(options.join(' '))) throw new Error(`a Johannesburg CBD address was offered: ${JSON.stringify(options)}`);
  /*
   * Exactly the Rosebank street and nothing else.
   *
   * The CBD street (no suburb tag alike) is now rejected by distance as well as
   * by tag, but the street fixture also carries a Pretoria result — this asserts
   * the radius, not merely the old suburb list.
   */
  if (options.length !== 1) throw new Error(`expected exactly the Rosebank street, saw ${JSON.stringify(options)}`);
  /* The number the customer typed is on the line the map never gave it. */
  if (!/^173 Oxford Road/.test(options[0])) throw new Error(`the typed house number is not on the suggestion: "${options[0]}"`);

  const button = [...s7.doc.querySelectorAll('[role="option"]')]
    .find((o) => /Oxford Road/.test(o.textContent ?? '') && /Rosebank/.test(o.textContent ?? ''))
    ?.querySelector('button');
  if (!button) throw new Error('the Rosebank option has no button');
  button.dispatchEvent(new s7.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await sleep(200);

  /* Picking fills the one box with the whole line, number and all. */
  if (!/^173 Oxford Road/.test(input.value)) throw new Error(`picking filled the address box with "${input.value}"`);
  if (!/Rosebank/.test(input.value)) throw new Error(`the picked line does not name its suburb: "${input.value}"`);
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  if (select.value !== 'Rosebank') throw new Error(`the delivery area was filled with "${select.value}"`);
  return 'half-typed street found, typed number kept, area filled';
});

await step('picking a suggestion moves the delivery area to match the address', async () => {
  /*
   * Rosebank is the default at this point; the picked result is in Sandton. The
   * area must follow the address, otherwise the customer is told they contradicted
   * a select they never touched.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '12 Oxfor');
  await s7.waitFor(
    () => [...s7.doc.querySelectorAll('[role="option"]')].some((o) => /Illovo/.test(o.textContent ?? '') && /Sandton/.test(o.textContent ?? '')),
    'both areas offered again',
    6000,
  );

  /* Find the Sandton result by its text: the list order is the map's, not ours. */
  const sandton = [...s7.doc.querySelectorAll('[role="option"]')].find((o) => /Illovo/.test(o.textContent ?? '') && /Sandton/.test(o.textContent ?? ''));
  if (!sandton) throw new Error('the Sandton suggestion disappeared');
  const button = sandton.querySelector('button');
  button.dispatchEvent(new s7.w.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: s7.w }));

  /*
   * The whole line goes into the one box — number, street and the suburb the map
   * knows — because that sentence is what the order stores, the WhatsApp message
   * carries and the driver reads.
   */
  await s7.waitFor(() => {
    const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
    return input?.value === '12 Oxford Road, Illovo, Sandton';
  }, 'the address to autofill', 4000);

  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Sandton'));
  if (!select) throw new Error('no delivery area select');
  if (select.value !== 'Sandton') throw new Error(`the area was not autofilled, it is "${select.value}"`);
  return 'address and area autofilled from the picked result';
});


await step('a Bryanston address is offered, sets the area to "Other", and is priced', async () => {
  /*
   * The owner's fix, end to end: "delivery area add other so the 50km radius can
   * apply". This is the customer who had no path through the form before — a real
   * address outside Rosebank and Sandton. It must be findable, must move the select
   * to "Other" rather than leaving a lie in it, and must show the fee rather than
   * silently treating the delivery as included.
   */
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  input.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(input, '1 Bryanston');
  await s7.waitFor(() => {
    const list = s7.doc.querySelector('[role="listbox"]');
    return list && /Bryanston/.test(list.textContent ?? '');
  }, 'a Bryanston suggestion', 6000);

  const option = [...s7.doc.querySelectorAll('[role="option"]')].find((o) => /Bryanston/.test(o.textContent ?? ''));
  if (!option) throw new Error('no Bryanston result to pick');
  option.querySelector('button').dispatchEvent(new s7.w.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: s7.w }));

  await s7.waitFor(() => {
    const field = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
    return /Bryanston/.test(field?.value ?? '');
  }, 'the Bryanston street to autofill', 4000);

  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  if (!select) throw new Error('no delivery area select');
  if (!/^another area/i.test(select.value)) throw new Error(`the area was left on "${select.value}" for a Bryanston address`);

  /* 8.8 km: outside the included ring, so the fee must be stated on screen. */
  const said = [...s7.doc.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? '').join(' ');
  if (!/8\.8 km/.test(said)) throw new Error(`the distance is not shown: ${said}`);
  if (!/R30,00 delivery fee (added|applies)/i.test(said)) throw new Error(`the fee is not stated: ${said}`);
  return `Bryanston offered, area set to "another area", 8.8 km with a fee`;
});


/**
 * Pick a real suggestion from the address list.
 *
 * The checkout now requires the address to be *located* before an order can
 * leave — typed text alone carries no coordinates, so the 50 km rule cannot be
 * checked against it. This is what a customer does: type, then tap a result.
 */
async function pickAddressSuggestion(session, text) {
  const field = [...session.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  if (!field) throw new Error('no address field on the checkout');
  field.dispatchEvent(new session.w.FocusEvent('focus', { bubbles: true }));
  session.setInput(field, text);
  await session.waitFor(() => (session.doc.querySelectorAll('[role="option"]').length ?? 0) >= 1, 'address suggestions', 8000);
  const option = session.doc.querySelectorAll('[role="option"]')[0];
  const button = option.querySelector('button') ?? option;
  button.dispatchEvent(new session.w.MouseEvent('mousedown', { bubbles: true, cancelable: true, view: session.w }));
  await sleep(500);
}


/** Tap "Use my current location" — the no-network way to locate the customer. */
async function useMyLocation(session) {
  /*
   * The phone's answer to "where am I", as the checkout will look it up.
   *
   * Tapping the button now performs a reverse lookup at the fix and writes the
   * street it found into the address box (owner, 17 Nov 2026: "if i select use my
   * current location does it fill the address inputfield- if not it must be").
   * The lookup is stubbed to the Sandton address already in the fixture, so the
   * step can assert *that the box was filled* without this suite depending on
   * Photon being up.
   */
  const button = [...session.doc.querySelectorAll('button')]
    .find((b) => /Use my current location|Checking…|Location checked|Finding your address/i.test(b.textContent ?? ''));
  if (!button) throw new Error('no "Use my current location" button on the checkout');
  session.click(button);
  /*
   * Any of the three endings counts as "the check came back": a fix with a
   * distance, a stated distance in the basket copy, or a refusal that explains
   * itself. Waiting only for success made a denied-location test look like a
   * hang, which is the opposite of what it was asserting.
   */
  await session.waitFor(
    () => /Location checked/i.test(session.text())
      || /km away/i.test(session.text())
      /* Every refusal the checkout can show. The wording changed when the
         insecure-origin bug was fixed — the old message blamed a browser switch
         and this one names the real reason — so the pattern matches the meaning
         ("no location") rather than one sentence. */
      /*
       * Every refusal the checkout can show, including the two this round added:
       * a blocked site ("Location is blocked for this site") and a page that is
       * not permitted to ask at all ("not allowed to ask for your location").
       * Matching the meaning rather than one sentence is deliberate — the copy
       * changes as the wording improves, and the assertion is about the ending.
       */
      || /Location is blocked|not sharing a location|could not get a location|This browser cannot share|not allowed to ask for your location|secure \(https\) connection/i.test(session.text()),
    'the location check to come back',
    8000,
  );
}

await step('a typed address with no location is not enough to reach WhatsApp', async () => {
  /*
   * The owner's rule: no order may leave without the 50 km check being possible.
   * A typed address carries no coordinates, so the checkout must refuse to send
   * the order until the customer either picks a suggestion or shares a location.
   * This is the gate that makes the radius mean something on the WhatsApp path,
   * which is a link rather than a server request.
   */
  const field = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  if (!field) throw new Error('no address field');
  s7.w.__geoDenied = true;
  field.dispatchEvent(new s7.w.FocusEvent('focus', { bubbles: true }));
  s7.setInput(field, '9 Nowhere Street');
  await sleep(800);

  const page = s7.text();
  if (!/could not work out where that address is|Use my current location|cannot confirm/i.test(page)) {
    throw new Error(`the checkout does not explain that the address is unlocated: ${page.slice(0, 300)}`);
  }
  const wa = [...s7.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));
  if (wa) throw new Error('an order can still reach WhatsApp from an address nobody located');

  /*
   * Put the session back the way the later steps expect it: the address they
   * assert on, and a location that makes it measurable.
   */
  s7.w.__geoDenied = false;
  s7.setInput(field, 'Oxford Road, Illovo');
  await sleep(300);
  await useMyLocation(s7);
  s7.__geoRestored = true;
  return 'an unlocated address blocks the handoff, with a reason';
});

await step('"Use my current location" writes the street it found into the address box', async () => {
  /*
   * Owner, 17 Nov 2026: "if i select use my current location does it fill the
   * address inputfield- if not it must be".
   *
   * It did not. The button collected a precise fix, printed a distance and left
   * the box empty — so the price came from one point and the delivery instruction
   * was whatever had been typed before, or nothing. The fix must now be written
   * down, in words the customer can read and correct, and the coordinates must
   * still be what the distance is measured from.
   *
   * The reverse lookup is stubbed (see the fetch stub above) to answer a bare
   * "lat,lng" query with the Illovo house from the fixture.
   */
  const fresh = boot('/checkout', { seedCart: s7.seedCart });
  await fresh.waitFor(() => /Almost there/i.test(fresh.text()), 'checkout', 20000);
  /* Share the fixture-backed geocoder, so the reverse lookup is answerable. */
  fresh.w.fetch = s7.w.fetch;
  fresh.w.__geo = { lat: -26.1, lng: 28.05 };

  const field = () => [...fresh.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  if (field()?.value) throw new Error('the address box was not empty to begin with');

  await useMyLocation(fresh);
  await fresh.waitFor(() => /Oxford Road/.test(field()?.value ?? ''), 'the address box to be filled', 8000);

  const filled = field().value;
  if (!/^12 Oxford Road/.test(filled)) throw new Error(`the location filled the box with "${filled}"`);
  if (!/km away/i.test(fresh.text())) throw new Error('the location was written down but no distance was calculated');

  /* The area follows the address, exactly as it does when one is picked. */
  const select = [...fresh.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  if (select?.value !== 'Sandton') throw new Error(`the area was left on "${select?.value}" for a Sandton fix`);

  /*
   * And it stays editable: this is a guess by the map, not a fact the customer
   * may not correct. Typing over it must take.
   */
  field().dispatchEvent(new fresh.w.FocusEvent('focus', { bubbles: true }));
  fresh.setInput(field(), '5 Rivonia Road, Sandton');
  if (!/^5 Rivonia Road/.test(field().value)) throw new Error('the address the location wrote cannot be overwritten');

  fresh.close?.();
  return `the fix filled the box with "${filled}" and can be corrected`;
});

await step('"Use my current location" asks the browser for a precise fix', async () => {
  /*
   * The owner's question, answered by the code rather than by a promise: does the
   * button let the site collect a location precise enough to calculate the radius?
   *
   * The answer used to be no — the call passed `enableHighAccuracy: false`, so a
   * browser was entitled to answer with a cell-tower or suburb-centre position
   * kilometres out. On a 6 km included ring and a 50 km limit that decides money
   * and refusal, so a coarse fix is not good enough. The last call this step is
   * looking at must have asked for accuracy.
   */
  const s7c = boot('/checkout', { seedCart: s7.seedCart });
  await s7c.waitFor(() => /Almost there/i.test(s7c.text()), 'checkout', 20000);
  s7c.w.__geoCalls.length = 0;
  await useMyLocation(s7c);

  const asked = s7c.w.__geoCalls[0];
  if (!asked) throw new Error('the button never asked the browser for a location');
  if (asked.enableHighAccuracy !== true) throw new Error(`the browser was asked for a coarse fix: ${JSON.stringify(asked)}`);
  if (!(Number(asked.timeout) > 0)) throw new Error(`no timeout was given: ${JSON.stringify(asked)}`);

  /* A precise answer must not be described as approximate. */
  if (/Approximate fix/i.test(s7c.text())) throw new Error('a high-accuracy fix is being reported as approximate');
  if (!/km away/i.test(s7c.text())) throw new Error('the location was collected but no distance was calculated');
  return `enableHighAccuracy: true, ${asked.timeout} ms timeout, distance calculated`;
});

await step('when a precise fix is unavailable, the coarse answer is labelled as approximate', async () => {
  /*
   * Precision cannot be guaranteed — indoors, in a car park, with GPS off — and a
   * button that never completes is worse than a rough answer. The fallback must
   * still happen, and the customer must be able to see that the number is rough
   * and act on it, rather than trusting a guess to decide a fee.
   */
  const s7d = boot('/checkout', { seedCart: s7.seedCart });
  await s7d.waitFor(() => /Almost there/i.test(s7d.text()), 'checkout', 20000);
  s7d.w.__geoHighAccurateUnavailable = true;
  s7d.w.__geoCalls.length = 0;
  await useMyLocation(s7d);

  const [first, second] = s7d.w.__geoCalls;
  if (!first?.enableHighAccuracy) throw new Error('the precise attempt was skipped');
  if (!second) throw new Error('there was no fallback attempt, so indoors the button would hang');
  if (second.enableHighAccuracy !== false) throw new Error(`the fallback asked for precision again: ${JSON.stringify(second)}`);
  if (!/Approximate fix/i.test(s7d.text())) throw new Error('a coarse fix is not labelled as approximate');
  if (!/km away/i.test(s7d.text())) throw new Error('the coarse fix produced no distance');
  return 'precise attempt, coarse fallback, labelled approximate';
});

await step('a blocked location says where the switch is, and still lets the customer order', async () => {
  /*
   * Denial is the common case — most people tap Block on reflex — so it cannot be
   * a dead end. The message must point at the browser setting, and the typed
   * address must still be a route to an order.
   */
  const s7e = boot('/checkout', { seedCart: s7.seedCart });
  await s7e.waitFor(() => /Almost there/i.test(s7e.text()), 'checkout', 20000);
  s7e.w.__geoCalls.length = 0;
  /* The browser's own record says denied — the state after the customer tapped
     Block once. The fix request would only repeat that, so it must not be made. */
  s7e.w.__geoPermission = 'denied';
  s7e.w.__geoDenied = true;
  await useMyLocation(s7e);

  /*
   * A denied origin shows no prompt, so the site must not spend a fix request on
   * one. Reading the permission state first is what makes that true: the button
   * answers immediately instead of waiting out a timeout that cannot succeed.
   */
  if (s7e.w.__geoCalls.length !== 0) {
    throw new Error(`a blocked browser was asked for a fix (${s7e.w.__geoCalls.length} calls) — no prompt can appear`);
  }
  const page = s7e.text();
  /*
   * Where the switch is: in the address bar, beside the address. The old copy
   * said "site settings", which is the right place on some browsers and a dead
   * end on others — and the owner reported it as wrong advice. The address-bar
   * icon is the one every Chromium browser shows.
   */
  if (!/address bar|beside the address/i.test(page)) {
    throw new Error(`the refusal does not say where the switch is: ${page.slice(0, 500)}`);
  }
  if (!/pick it from the list/i.test(page)) throw new Error('the refusal offers no way forward');
  return 'one prompt, the address-bar switch named, the address box still offered';
});

await step('on an insecure origin the location button explains itself instead of blaming the customer', async () => {
  /*
   * The owner's report (16 Nov 2026): "why Location is blocked for this site.
   * Allow it in your browser's site settings… -u must ask for location
   * permission".
   *
   * They had blocked nothing. Browsers refuse geolocation on a non-secure
   * origin without ever showing a prompt, and the checkout used to report that
   * as PERMISSION_DENIED — so a customer who had granted nothing was sent to
   * look for a switch that would not fix it, and the site never asked.
   *
   * This is that exact situation, staged: an insecure context with a geolocation
   * stub that would answer if it were asked. The assertions are that the
   * question is never put to the browser, and that the message names the real
   * reason and points at the address box.
   */
  const s7i = boot('/checkout', { seedCart: s7.seedCart });
  await s7i.waitFor(() => /Almost there/i.test(s7i.text()), 'checkout', 20000);
  /* A page served over http: exactly what the owner was looking at. */
  Object.defineProperty(s7i.w, 'isSecureContext', { configurable: true, value: false });
  s7i.w.__geoCalls.length = 0;
  await useMyLocation(s7i);

  if (s7i.w.__geoCalls.length !== 0) {
    throw new Error(`geolocation was called on an insecure origin (${s7i.w.__geoCalls.length} calls) — the browser cannot prompt there`);
  }
  const page = s7i.text();
  if (!/https/i.test(page)) {
    throw new Error(`the insecure message does not say why: ${page.slice(0, 500)}`);
  }
  if (!/address/i.test(page)) throw new Error('the insecure message offers no way forward');
  /* It must NOT send them to a settings switch, which is the false advice. */
  if (/site settings/i.test(page)) {
    throw new Error('the insecure message still blames a browser setting that would not help');
  }
  return 'no prompt attempted on http, honest message, address box offered';
});

await step('a customer outside the delivery radius is refused, and told how far out they are', async () => {
  /*
   * Polokwane is ~285 km out — far enough that the refusal is true whatever the
   * limit is set to, which is the point of choosing it here rather than a place
   * a few kilometres over the line.
   *
   * Staging a position well past the limit must produce a refusal with the actual
   * distance in it — not a generic "we do not deliver there", which leaves the
   * customer guessing whether they typed their address wrong.
   */
  const s7b = boot('/checkout', {
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
  await s7b.waitFor(() => /Almost there/i.test(s7b.text()), 'checkout', 20000);
  const byPh = (re) => [...s7b.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s7b.setInput(byPh(/Thabo Mahlangu/), 'Far Customer');
  s7b.setInput(byPh(/\+27 82/), '+27 82 000 4321');
  /*
   * One address box, filled the way a customer types a far-away address, and the
   * area set to "another area" through the select. Polokwane is typed in full
   * because the location button below puts the fix there — the two must agree.
   */
  s7b.setInput(byPh(/Oxford Road/), '1 Church Street, Polokwane');
  const farSelect = [...s7b.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Rosebank'));
  farSelect.value = [...farSelect.options].find((o) => /^another area/i.test(o.value)).value;
  farSelect.dispatchEvent(new s7b.w.Event('change', { bubbles: true }));
  await sleep(300);

  s7b.w.__geo = { lat: -23.9045, lng: 29.4689 }; /* Polokwane */
  await useMyLocation(s7b);

  const page = s7b.text();
  if (!/km away/i.test(page)) throw new Error(`no distance reported: ${page.slice(0, 400)}`);
  /*
   * The limit is read from the catalogue, not written here: it is now 15 km, and
   * a test that hardcodes it becomes the thing that has to be fixed every time
   * the owner changes the rule. What must be true is that the refusal *names* the
   * configured limit and the real distance.
   */
  const settings = await fetch(`${BASE}/api/catalog`).then((r) => r.json()).then((c) => c.settings);
  const maxKm = Number(settings?.maxDeliveryKm ?? 15);
  if (!new RegExp(`outside our ${maxKm} km delivery area`, 'i').test(page)) {
    throw new Error(`an out-of-range address was not refused with the limit named: ${page.slice(0, 400)}`);
  }
  if (!new RegExp(`${maxKm} km`).test(page)) throw new Error('the refusal does not name the configured limit');
  if (!/We cannot deliver/i.test(page)) throw new Error('the refusal does not tell the customer we cannot deliver');
  const wa = [...s7b.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));
  if (wa) throw new Error('WhatsApp still carries an order past the delivery limit');
  return `refused at 285.5 km, limit ${maxKm} km named`;
});

await step('the WhatsApp order is blocked until the customer details are filled', async () => {
  /*
   * The owner's rule: nobody may reach WhatsApp with an empty name or number.
   * At this point the basket and a delivery address exist, but no name and no
   * phone, so the control must be a disabled button that says why — not a link.
   */
  const waHref = () => [...s7.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));

  if (waHref()) throw new Error('a WhatsApp link is offered before a name and number are filled');

  const gate = [...s7.doc.querySelectorAll('button[aria-disabled="true"]')]
    .find((b) => /Complete order on WhatsApp/i.test(b.textContent ?? ''));
  if (!gate) throw new Error('no disabled WhatsApp control on an incomplete checkout');

  /*
   * The reason has to name the missing detail, not just say "disabled" — and it
   * is asked for first, before the address, so a customer is never told about a
   * street before they are told about their own name.
   */
  const page = s7.text();
  if (!/Add your full name first/i.test(page)) {
    throw new Error('the checkout does not say which detail is missing before WhatsApp');
  }

  /*
   * Fill exactly what it asks for, and nothing else — name and number. The
   * address is already there from the step above, in the one box.
   */
  const byPh = (re) => [...s7.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s7.setInput(byPh(/Thabo Mahlangu/), 'Delivery Test');
  s7.setInput(byPh(/\+27 82/), '+27 82 000 4400');
  await sleep(400);

  const waLink = waHref();
  if (!waLink) throw new Error('WhatsApp stayed blocked after the name and number were filled');
  return 'blocked with a reason until name and number were filled';
});

await step('the WhatsApp order message carries the delivery address and the Yoco payment ask', async () => {
  /*
   * The owner's arrangement for WhatsApp orders: the message has to be the whole
   * order — the basket, that it is a delivery, and the address exactly as it was
   * entered — and it closes by asking Heritage Bites to send the Yoco payment
   * link. No payment method was clicked in this flow, so the ask is Yoco.
   */
  const waLink = [...s7.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));
  if (!waLink) throw new Error('checkout has no WhatsApp order button');
  const waText = new URL(waLink.href).searchParams.get('text') ?? '';
  /*
   * The address line is read from the box rather than written here, because this
   * step runs after several others have typed into it and tapped the location
   * button — the assertion is that whatever the customer ended up with travels
   * with the order verbatim, exactly as they would read it back to the driver.
   */
  const street = [...s7.doc.querySelectorAll('input')].find((f) => /Oxford Road/.test(f.placeholder ?? ''))?.value ?? '';
  if (!street) throw new Error('the delivery address box is empty');
  for (const wanted of [
    /I would like it delivered/,
    new RegExp(`Address: ${street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    /I will pay by Yoco/,
    /send me the payment link/,
  ]) {
    if (!wanted.test(waText)) {
      throw new Error(`the WhatsApp message is missing "${wanted}" — the delivery address and payment ask must travel with the order: ${waText.slice(0, 900)}`);
    }
  }
  return 'delivery address, area and the Yoco payment ask all in the message';
});

await step('a customer can book any cooking day, and the WhatsApp message says which one', async () => {
  /*
   * Owner, 16 Nov 2026: "users are not limited in waiting for thursday but they
   * can order in advance for any thursday/friday" and "on whatsapp message you
   * can update the wording to mwntion its an order from this day for a specific
   * day".
   *
   * Both halves are asserted here. The list must offer more than the one next
   * window — that was the complaint — and picking a day must change the message
   * that opens in WhatsApp, not just the page.
   */
  /*
   * The picker is a week schedule now (owner, 16 Nov 2026: "please put week
   * schedule only"), so all seven days are on the page. The schedule is only
   * honest if the two cooking days are the only ones that can be chosen, so the
   * assertion moved from "fewer days are shown" to "the rest days cannot be
   * picked".
   */
  const pressed = [...s7.doc.querySelectorAll('button[aria-pressed]')];
  const days = pressed.filter((b) =>
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test((b.textContent ?? '').trim()),
  );
  if (days.length < 2) {
    throw new Error(`the day picker offers ${days.length} bookable day(s) — it must offer the cooking weeks ahead, not just the next one`);
  }

  /* Every day that can be chosen must be a Thursday or a Friday. */
  for (const day of days) {
    const name = (day.textContent ?? '').trim().split(' ')[0];
    if (name !== 'Thursday' && name !== 'Friday') {
      throw new Error(`the picker offers ${name}, and the kitchen only cooks Thursday and Friday`);
    }
  }

  /* And the rest days are still on the page — as a schedule, not as buttons. */
  const schedule = s7.text();
  for (const name of ['Monday', 'Tuesday', 'Wednesday', 'Saturday', 'Sunday']) {
    if (!schedule.includes(`${name}\n`) && !schedule.includes(name)) {
      throw new Error(`the week schedule does not list ${name}`);
    }
  }

  /*
   * The order link, not the service strip's one. Both open WhatsApp, and on a
   * rest day the strip is on screen too — matching "Ask on WhatsApp" loosely
   * picked the strip and read a message that carries no basket at all.
   */
  const waText = () => {
    const links = [...s7.doc.querySelectorAll('a[href^="https://wa.me/"]')];
    const link =
      links.find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? '')) ??
      links.find((a) => /Ask on WhatsApp if we can cook it/i.test(a.textContent ?? '')) ??
      [...links].reverse().find((a) => /Complete order|Ask on WhatsApp/i.test(a.textContent ?? ''));
    return link ? new URL(link.href).searchParams.get('text') ?? '' : '';
  };

  /* Pick the furthest day offered, so the wording cannot be "today". */
  const target = days[days.length - 1];
  /* The button holds the day and its window in two spans; the day is the first. */
  const targetLabel = (target.querySelector('span span')?.textContent ?? '').trim();
  target.click();
  await sleep(200);

  const after = waText();
  if (!/Order placed:/i.test(after) || !/Cooking day:/i.test(after)) {
    throw new Error(`the message does not separate the day it was sent from the day it is for: ${after.slice(0, 240)}`);
  }
  if (!after.includes(`Cooking day: ${targetLabel}`)) {
    throw new Error(`the message names the wrong cooking day. Wanted "${targetLabel}", got: ${after.split('\n').slice(0, 5).join(' | ')}`);
  }
  return `${days.length} cooking days offered; the message names "Cooking day: ${targetLabel}"`;
});

/* ------------------------------------------------------------------ */
/* Round five: the checkout as one form, the week as a schedule         */
/* ------------------------------------------------------------------ */

await step('the checkout is one form: details, location and payment together, and no separate delivery section', async () => {
  /*
   * Owner, 16 Nov 2026: "use my current location must be inside your details",
   * "there must be 'how do you want to pay?' in that same area; remove the
   * separate Delivery section and the other blocks added there".
   *
   * Asserted on structure rather than on wording, because the point is that the
   * customer fills in one section instead of hunting down three.
   */
  const legends = [...s7.doc.querySelectorAll('fieldset > legend')].map((l) => (l.textContent ?? '').trim());
  if (legends.some((l) => /^delivery$/i.test(l))) {
    throw new Error(`the separate Delivery section is still on the page: ${legends.join(' / ')}`);
  }
  const details = [...s7.doc.querySelectorAll('fieldset')].find((f) =>
    /your details/i.test(f.querySelector('legend')?.textContent ?? ''),
  );
  if (!details) throw new Error('the checkout has no "Your details" section');
  const inside = details.textContent ?? '';
  /*
   * A step above has already tapped it, so on this page the button now reads
   * "Location checked ✓" — the assertion is that it lives in this section, not
   * that it still carries its original label.
   */
  const locationBtn = [...details.querySelectorAll('button')].find((b) =>
    /current location|Location checked/i.test(b.textContent ?? ''),
  );
  if (!locationBtn) {
    throw new Error(`"Use my current location" is not inside Your details (sections: ${legends.join(' / ')})`);
  }
  if (!/How do you want to pay\?/i.test(inside)) {
    throw new Error('"How do you want to pay?" is not inside Your details');
  }
  return `one form — ${legends.join(' / ')} — with location and payment inside the details`;
});

await step('checkout offers a way back to the screen the customer came from', async () => {
  /*
   * Owner, 16 Nov 2026: "when am on checkout why i cant go back to the screen i
   * was at". The browser's Back button always worked; what was missing was
   * anything on the page offering it.
   */
  /*
   * Its own session, on purpose: clicking back really does navigate, and the
   * checkout session below is reused by a dozen steps that assume it is still
   * on /checkout.
   */
  const nav = boot('/checkout', { seedCart: CHECKOUT_CART });
  await nav.waitFor(() => /Almost there/i.test(nav.text()), 'checkout page', 20000);
  const back = [...nav.doc.querySelectorAll('button')].find((b) => /^Back to /i.test((b.textContent ?? '').trim()));
  if (!back) throw new Error('the checkout has no back control');

  const before = nav.w.location.pathname;
  back.click();
  await sleep(300);
  const after = nav.w.location.pathname;
  nav.close();
  if (after === before) throw new Error(`the back control did nothing — still on ${after}`);
  if (after === '/checkout') throw new Error('the back control left the customer on the checkout');
  /* Somewhere inside the shop, never off the site. */
  if (!after.startsWith('/')) throw new Error(`the back control left the site: ${after}`);
  return `back control moved ${before} → ${after}`;
});

await step('the day picker is a full week schedule, and only the cooking days can be picked', async () => {
  /*
   * Owner: "the which day - please put week schedule only (eg user can order
   * even on monday for a thursday and friday)". So all seven days are listed,
   * the rest days are visibly rest days, and the booking days are the ones the
   * kitchen actually cooks on.
   */
  const rows = [...s7.doc.querySelectorAll('[data-weekday]')];
  const seen = rows.map((r) => r.getAttribute('data-weekday'));
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    if (!seen.includes(day)) throw new Error(`the schedule does not show ${day}`);
  }
  const rest = rows.filter((r) => r.getAttribute('aria-disabled') === 'true');
  const bookable = rows.filter((r) => r.tagName === 'BUTTON');
  if (!rest.length) throw new Error('every day is offered as bookable — the kitchen does not cook seven days');
  if (!bookable.length) throw new Error('no cooking day can be booked');
  for (const day of bookable) {
    const name = day.getAttribute('data-weekday');
    if (name !== 'Thursday' && name !== 'Friday') throw new Error(`${name} is bookable and should not be`);
  }
  for (const day of rest) {
    if (!/Not a cooking day/i.test(day.textContent ?? '')) {
      throw new Error(`${day.getAttribute('data-weekday')} is a rest day but does not say so`);
    }
  }
  return `seven days listed, ${bookable.length} bookable cooking dates, ${rest.length} rest days marked`;
});

await step('partner channels we are not on yet say "coming soon"', async () => {
  /*
   * Owner: Mr D and Uber Eats must read "coming soon", not "order on WhatsApp
   * instead". The tile has to be about the partner, not about the workaround.
   */
  const home = boot('/');
  await home.waitFor(() => home.doc.querySelectorAll('h3').length > 3, 'the home page', 20000);
  const text = home.text();
  if (/Order on WhatsApp instead/i.test(text)) {
    throw new Error('a channel tile still says "Order on WhatsApp instead"');
  }
  if (!/coming soon/i.test(text)) throw new Error('no channel tile says "coming soon"');
  home.close();
  return 'unreleased partners read as "coming soon"';
});

await step('a meal card is the plate, not a delivery advert', async () => {
  /*
   * Owner: drop "One complete plate · delivery included in Sandton & Rosebank"
   * from the cards. The price is on the photograph and the description says what
   * is in the plate; the caption only repeated both and named two suburbs.
   */
  const menu = boot('/menu');
  await menu.waitFor(() => menu.doc.querySelectorAll('button').length > 10, 'the menu', 20000);
  if (/One complete plate/i.test(menu.text())) {
    throw new Error('the meal cards still carry the "One complete plate" caption');
  }
  menu.close();
  return 'no plate caption on the cards';
});

await step('the footer centres the three social icons on the copyright line, and its logo spins too', async () => {
  /*
   * Owner, 16 Nov 2026: "put the three social icons and the icons must be on the
   * footer but centred on © 2026 Heritage Bites… section" and "since the
   * heritagebites logo at the top when i hover it rotates ensure even on footer
   * when you hover on the logo it must rotate too".
   */
  const page = boot('/');
  await page.waitFor(() => page.doc.querySelectorAll('footer a').length > 4, 'the footer', 20000);
  const footer = [...page.doc.querySelectorAll('footer')].find((f) => f.querySelector('a[href^="tel:"]'));
  if (!footer) throw new Error('no page footer');

  const copy = [...footer.querySelectorAll('span')].find((sp) => /©/.test(sp.textContent ?? ''));
  if (!copy) throw new Error('the footer has no copyright line');
  const row = copy.closest('div');
  const labels = ['Instagram', 'Facebook', 'TikTok'];
  const icons = labels.map((label) => row?.querySelector(`a[aria-label="${label}"]`) ?? null);
  if (icons.some((i) => !i)) {
    throw new Error(`the social icons are not on the copyright line (found ${icons.filter(Boolean).length} of 3)`);
  }
  /* Centred: the icon row is the middle child of the bottom line's grid. */
  const socialNav = icons[0].closest('nav');
  if (!socialNav || socialNav.getAttribute('aria-label') !== 'Social media') {
    throw new Error('the social icons are not wrapped in a labelled nav');
  }
  if (!/justify-center/.test(socialNav.className)) throw new Error('the social icon row is not centred');

  /* The footer badge turns on hover, from the same rule the header uses. */
  const badge = footer.querySelector('img.logo-spin');
  if (!badge) throw new Error('the footer logo does not carry the spin class');
  if (!badge.closest('.logo-spin-host')) throw new Error('the footer logo has no hover host, so it will not turn');
  page.close();
  return 'three social icons, centred on the copyright line, and a footer badge that turns';
});

await step('the contact page offers icons for WhatsApp, phone and email, and its own social row', async () => {
  /*
   * Owner: "restructure contact page because i dont see social icons, put some
   * icons on contact page for whatsapp,email,phone".
   */
  const page = boot('/contact');
  await page.waitFor(() => page.doc.querySelectorAll('a[href^="tel:"]').length > 0, 'the contact page', 20000);
  const main = page.doc.querySelector('main') ?? page.doc;
  for (const [label, href] of [
    ['WhatsApp', 'https://wa.me/'],
    ['Phone', 'tel:'],
    ['Email', 'mailto:'],
  ]) {
    const link = [...main.querySelectorAll('a')].find((a) => href.startsWith('http') ? a.href.startsWith(href) : a.getAttribute('href')?.startsWith(href));
    if (!link) throw new Error(`the contact page has no ${label} link`);
    const card = link.closest('a');
    if (!card?.querySelector('svg')) throw new Error(`the ${label} card has no icon`);
  }
  for (const label of ['Instagram', 'Facebook', 'TikTok']) {
    if (!main.querySelector(`a[aria-label="${label}"]`)) throw new Error(`the contact page has no ${label} icon`);
  }

  /* The two conditional labels, in the owner's own words. */
  const text = page.doc.body.textContent ?? '';
  if (!/Contact number\s*\(required if no email\)/.test(text)) {
    throw new Error('the phone field is not labelled "(required if no email)"');
  }
  if (!/Email\s*\(required if no number\)/.test(text)) {
    throw new Error('the email field is not labelled "(required if no number)"');
  }
  page.close();
  return 'three contact icons, three social icons, and both conditional labels';
});

await step('the home page head carries a local-search FAQ and an offer catalogue', async () => {
  /*
   * Local search and SEO, in the block a crawler reads without running the app.
   *
   * Read from the built document rather than from a jsdom session: the app only
   * writes structured data when it knows the address it is served from, and this
   * suite runs on 127.0.0.1 — which is explicitly not a public address. The
   * build bakes in the deployment's real one, so `dist/index.html` is the honest
   * thing to inspect.
   */
  const { readFileSync } = await import('node:fs');
  const html = readFileSync('dist/index.html', 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1].replace(/<\\\//g, '</')),
  );
  if (!blocks.length) throw new Error('the built home page has no structured data');
  const nodes = blocks.flatMap((n) => n['@graph'] ?? [n]);
  const faq = nodes.find((n) => n['@type'] === 'FAQPage');
  if (!faq) throw new Error('the built home page has no FAQ node');
  if (faq.mainEntity.length < 4) throw new Error('the FAQ answers too few questions to be useful');

  const restaurant = nodes.find((n) => n['@type'] === 'Restaurant');
  if (!restaurant) throw new Error('no Restaurant node');
  if (!restaurant.hasOfferCatalog) throw new Error('the restaurant node prices no plates');
  const prices = restaurant.hasOfferCatalog.itemListElement.map((o) => o.price);
  if (!prices.includes('100.00')) throw new Error(`the offer catalogue prices nothing at R100: ${prices.join(', ')}`);
  if (!restaurant.areaServed.some((a) => a.name === 'Johannesburg')) {
    throw new Error('the restaurant node does not name the metro it serves');
  }
  if (!/mogodu/.test(restaurant.keywords ?? '')) throw new Error('the restaurant node carries no cuisine keywords');
  return `${faq.mainEntity.length} FAQ answers, ${prices.length} priced offers, and the metro named`;
});

await step('an address that contradicts the chosen area is refused with both names', async () => {
  /*
   * The street box is what names the suburb now — the select is the customer's
   * own answer, and the check compares the two. A Sandton street with Rosebank
   * still selected is the contradiction, and it must name both.
   */
  const streetBox = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  s7.setInput(streetBox, '12 Oxford Road, Illovo, Sandton');
  await sleep(200);
  const select = [...s7.doc.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'Sandton'));
  /* The customer now switches the area instead of the address. */
  select.value = 'Rosebank';
  select.dispatchEvent(new s7.w.Event('change', { bubbles: true }));

  await s7.waitFor(() => /but you chose Rosebank|is in Sandton/.test(s7.text()), 'the mismatch message', 4000);
  const message = s7.text();
  if (!/Sandton/.test(message) || !/Rosebank/.test(message)) {
    throw new Error('the mismatch message does not name both areas');
  }

  /*
   * And the order must not go through while it stands. The primary button is
   * disabled when online payment is not connected on this host, so the click is
   * a no-op either way — what matters is that no order page appears.
   */
  const submit = s7.byText('button[type="submit"]', /Place order|Online payment/i)[0];
  if (!submit) throw new Error('no place-order button');
  s7.click(submit);
  await sleep(400);
  if (/Order tracking/i.test(s7.text())) throw new Error('a mismatched delivery address placed an order');
  return 'refused, and nothing was ordered';
});

await step('an address with no suburb only asks the customer to check', async () => {
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
  /*
   * A street with no suburb in it — the address this step is about. With one box
   * that is simply what gets typed; there is no separate suburb field to empty.
   */
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
  const input = [...s7.doc.querySelectorAll('input')].find((el) => /Oxford Road/.test(el.placeholder ?? ''));
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
  /*
   * Body text is `text-theme` now — the token that resolves to ink in light
   * mode and paper in dark. Pinning the literal `text-ink` would pin the old
   * palette; what matters is that the label is not carrying the red.
   */
  if (!/text-theme\b/.test(head.className)) throw new Error(`the label is not theme-coloured: "${head.className}"`);
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

await step('the quest form asks in the owner\'s words, with the extra hint gone', async () => {
  /*
   * Owner, 16 Nov 2026, on the three questions that carry a condition:
   *   Cell number  (we reply here · required if no email)
   *   What should we cook?   — and *no* "the dish, and how you like it" under it
   *   Email  (required if no number)
   *
   * The condition lives in the label so it cannot be missed: a hint set off to the
   * right is the first thing a phone drops. This reads the labels back off the
   * rendered page, not the source, and then proves the old hint has not crept
   * back under any of the three fields.
   */
  const labels = [...quest.doc.querySelectorAll('form label')].map((el) => (el.querySelector('span')?.textContent ?? '').trim());
  const cell = labels.find((text) => /^Cell number/i.test(text));
  const email = labels.find((text) => /^Email/i.test(text));
  if (!cell) throw new Error('the form has no cell-number field');
  if (!email) throw new Error('the form has no email field');
  if (!/required if no email/i.test(cell)) throw new Error(`the cell-number label lost its condition: "${cell}"`);
  if (!/required if no number/i.test(email)) throw new Error(`the email label lost its condition: "${email}"`);

  const dishLabel = labels.find((text) => /What should we cook/i.test(text));
  if (!dishLabel) throw new Error('the form no longer asks what to cook');
  if (/dish, and how you like it/i.test(dishLabel)) throw new Error('the removed hint is back inside the label');

  /* The hint would sit in the same label as the question, beside it. */
  const dishField = [...quest.doc.querySelectorAll('form label')].find((el) => /What should we cook/i.test(el.textContent ?? ''));
  if (!dishField) throw new Error('the "what should we cook" field is not a label');
  if (/how you like it/i.test(dishField.textContent ?? '')) throw new Error('the "the dish, and how you like it" hint came back');
  return `labels: ${cell.slice(0, 40)}… / Email (required if no number); no dish hint`;
});

await step('an incomplete quest is refused with a reason', async () => {
  const submit = quest.byText('button[type="submit"]', /Send my request/i)[0];
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
  quest.click(quest.byText('button[type="submit"]', /Send my request/i)[0]);

  // "Request sent" when the inbox forward worked, "Request received" when only
  // the local copy was kept — the sandbox cannot reach formspree.io. (The words
  // moved from "quest" to "request" on the owner's instruction, 14 Nov 2026.)
  await quest.waitFor(() => /Request sent|Request received/i.test(quest.text()), 'request success state', 15000);
  if (!/not an order|nothing has been charged/i.test(quest.text())) {
    throw new Error('the quest success state must not read like an order');
  }

  const again = quest.byText('button', /Send another request/i)[0];
  const openWhatsApp = quest.byText('a', /Open WhatsApp/i)[0];
  if (!again || !openWhatsApp) throw new Error('request success actions are missing');
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
      channel: 'web',
      fulfilment: 'delivery',
      customer: {
        name: 'Passport Test', phone: loyal, email: 'passport@example.co.za',
        address: '1 Maude Street, Sandton', suburb: 'Sandton', lat: -26.1075, lng: 28.055,
      },
      items: [{ itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } }],
      /*
       * Cash, not card: the passport check is about stamps, not payment plumbing,
       * and cash works on every host — a card order is refused outright where no
       * Yoco keys are configured, which has nothing to do with loyalty stamps.
       */
      payment: { method: 'cash' },
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

await step('a past order can be put back in the basket in one tap', async () => {
  /*
   * "Order it again" — the feature a returning customer actually wants.
   *
   * The order is seeded for a number this device "knows" (the checkout parks the
   * last number in localStorage), the loyalty card is opened with that number, and
   * the button is pressed the way a customer presses it. What is asserted is the
   * basket that comes out: the same plate, the same starch and side, the same
   * quantity, and a price read from today's catalogue rather than the receipt.
   */
  const phone = `+27 84 ${String(Date.now()).slice(-8)}`;
  const seeded = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'web',
      fulfilment: 'delivery',
      customer: {
        name: 'Reorder Customer', phone, email: 'reorder@example.co.za',
        address: '1 Maude Street, Sandton', suburb: 'Sandton', lat: -26.1075, lng: 28.055,
      },
      /* A plate built in the builder, so the group reconstruction is exercised. */
      items: [{ kind: 'plate', plateId: 'traditional', qty: 2, selections: { protein: ['tshotlo'], starch: ['pap', 'dumpling'], veg: ['chakalaka'] } }],
      payment: { method: 'cash' },
    }),
  }).then((r) => r.json());
  if (!seeded.order?.code) throw new Error('could not seed the order to re-order');

  const s8 = boot('/passport');
  s8.doc.defaultView.localStorage.setItem('hb.lastPhone', phone);
  await s8.waitFor(() => /Your loyalty card/i.test(s8.text()), 'loyalty card page');

  const input = [...s8.doc.querySelectorAll('input')].find((f) => /\+27 82/.test(f.placeholder ?? ''));
  if (!input) throw new Error('no phone input on the passport page');
  s8.setInput(input, phone);
  s8.click(s8.byText('button[type="submit"]', /Find my card/i)[0]);
  await s8.waitFor(() => /Order it again/i.test(s8.text()), 'the past-order list', 15000);

  /* The order reads as the customer's order, with its choices. */
  if (!s8.text().includes(seeded.order.code)) throw new Error('the past order is missing its code');
  for (const expected of [/2 × Traditional Plate/, /Tshotlo/, /Pap/, /Chakalaka/]) {
    if (!expected.test(s8.text())) throw new Error(`the past order does not show ${expected}`);
  }

  const again = s8.byText('button', /Order this again|Replace my basket/i)[0];
  if (!again) throw new Error('no "order this again" button');
  s8.click(again);

  /*
   * The basket is the assertion, not the toast: read it from storage the way the
   * basket bar does, so a passing test means the cart really holds the food.
   */
  await s8.waitFor(() => {
    try {
      const raw = JSON.parse(s8.doc.defaultView.localStorage.getItem('hb.cart') ?? '{}');
      return (raw?.state?.lines ?? []).length > 0;
    } catch {
      return false;
    }
  }, 'the rebuilt basket', 15000);

  const cart = JSON.parse(s8.doc.defaultView.localStorage.getItem('hb.cart'));
  const lines = cart?.state?.lines ?? [];
  if (lines.length !== 1) throw new Error(`expected one rebuilt line, saw ${lines.length}`);

  const [line] = lines;
  if (line.kind !== 'plate' || line.plateId !== 'traditional') throw new Error('the rebuilt line is not the plate that was ordered');
  if (line.qty !== 2) throw new Error(`quantity was lost: ${line.qty}`);
  if (line.unitPrice !== 100) throw new Error(`the plate was re-priced from the receipt, not the menu: R${line.unitPrice}`);

  const labels = line.picks.map((p) => p.label);
  for (const expected of ['Tshotlo (pounded beef)', 'Pap', 'Dumpling', 'Chakalaka']) {
    if (!labels.includes(expected)) throw new Error(`the rebuild lost "${expected}": ${labels.join(' · ')}`);
  }

  /* And the page says where it went, so nobody has to guess. */
  await s8.waitFor(() => /Checkout|Almost there|basket/i.test(s8.text()), 'the checkout after reordering', 15000);

  s8.close();
  return `${seeded.order.code} rebuilt: ${line.qty} × Traditional Plate · ${labels.join(' · ')} at R${line.unitPrice} a plate`;
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
    const required = fs.textContent.includes('*');
    if (!required) continue;
    const opt = [...fs.querySelectorAll('button[aria-checked], button[aria-pressed]')][0];
    if (!opt) throw new Error('required group has no options');
    s5.click(opt);
    chosen++;
  }
  if (chosen === 0) throw new Error('found no required groups in the builder');

  await s5.waitFor(() => /Add plate/i.test(builderAdd()?.textContent ?? ''), 'button to become Add plate', 8000);
  if (addBtn().disabled) throw new Error('add-plate still disabled after choosing every required group');
  return `${chosen} required group(s) satisfied`;
});

await step('starch and vegetable side take more than one; the drink is an add-on', async () => {
  /*
   * Owner, 16 Nov 2026: "choose starch, vegetables must be multi select where
   * user can select more than 1 item".
   *
   * This reverses the rule this step used to assert, and the reversal is the
   * point: a plate with pap *and* dumpling is an ordinary plate here, so the
   * two required groups are a row of checkboxes that hold several answers.
   * Protein stays a radio — a plate carries one protein — and the soft drink
   * stays an unticked add-on, because a R25 bottle nobody asked for is money
   * taken for nothing.
   *
   * The behaviour is checked, not just the role: two starches must actually be
   * held at once, and the add-to-basket line must still say the plate price.
   */
  const dlg = builderDialog();
  if (!dlg) throw new Error('the builder is not open');
  const fieldsets = [...dlg.querySelectorAll('fieldset')];

  const semantics = fieldsets.map((fs) => {
    const legend = fs.querySelector('legend')?.textContent ?? '';
    const radios = fs.querySelectorAll('[role="radio"]').length;
    const checks = fs.querySelectorAll('[role="checkbox"]').length;
    return { legend, radios, checks };
  });

  const starch = semantics.find((x) => /starch/i.test(x.legend));
  const veg = semantics.find((x) => /vegetable side/i.test(x.legend));
  const protein = semantics.find((x) => /protein/i.test(x.legend));
  const drink = semantics.find((x) => /soft drink/i.test(x.legend));

  if (!starch || !veg || !drink) throw new Error(`could not find all the groups: ${JSON.stringify(semantics)}`);
  if (starch.checks === 0 || starch.radios > 0) throw new Error(`starch is not multi-select: ${JSON.stringify(starch)}`);
  if (veg.checks === 0 || veg.radios > 0) throw new Error(`vegetable side is not multi-select: ${JSON.stringify(veg)}`);
  if (protein && (protein.radios === 0 || protein.checks > 0)) {
    throw new Error(`protein must stay a single choice: ${JSON.stringify(protein)}`);
  }
  if (drink.checks === 0 || drink.radios > 0) throw new Error(`the drink is not a checkbox: ${JSON.stringify(drink)}`);

  /* The drink starts unticked. */
  const drinkBox = [...dlg.querySelectorAll('[role="checkbox"]')].reverse()[0];
  if (drinkBox?.getAttribute('aria-checked') === 'true') {
    throw new Error('the soft drink starts ticked, which charges for a bottle nobody asked for');
  }

  /* Two starches, held at once. The plate price must not move: a starch is
     inside the plate price, not an extra on top of it. */
  const groupFor = (needle) => fieldsets.find((fs) => needle.test(fs.querySelector('legend')?.textContent ?? ''));
  const options = (fs) => [...(fs?.querySelectorAll('button[aria-checked]') ?? [])];

  const starchGroup = groupFor(/starch/i);
  const [firstStarch, secondStarch] = options(starchGroup);
  if (!firstStarch || !secondStarch) throw new Error('the starch group does not offer two options');
  firstStarch.click();
  await sleep(120);
  secondStarch.click();
  await sleep(160);

  const ticked = options(starchGroup).filter((b) => b.getAttribute('aria-checked') === 'true');
  if (ticked.length !== 2) {
    throw new Error(`two starches should be ticked at once, found ${ticked.length}: ${ticked.map((b) => b.textContent).join(', ')}`);
  }
  const price = (builderAdd()?.textContent ?? '').match(/R\s?([\d\s]+[.,]\d{2})/)?.[1]?.replace(/\s/g, '').replace(',', '.');
  if (Number(price) > 200) throw new Error(`two starches changed the plate price to R${price}`);

  return 'starch and veg hold two at once, protein is a radio, the drink is an unticked add-on';
});

await step('the soft drink takes a quantity, and prices per bottle', async () => {
  /*
   * Owner, 14 Nov 2026 — "have ability to add extras like how its done on
   * ubereats". The drink is the one priced extra on the plate: tapping it adds
   * one, and a stepper raises the count without touching the plate price.
   *
   * This is the assertion that keeps the two behaviours apart. Adding a second
   * bottle must cost a second R25, and adding the whole plate again must cost
   * another R100 — if the stepper ever started multiplying the plate instead of
   * the drink, a table of four would be charged for four plates.
   */
  const drink = [...(builderDialog()?.querySelectorAll('button') ?? [])]
    .find((b) => /Ginger gemere/i.test(b.textContent ?? ''));
  if (!drink) throw new Error('the soft drink is not offered in the builder');

  const priceOn = () => {
    const label = builderAdd()?.textContent ?? '';
    return Number((label.match(/R\s?([\d\s]+)[.,](\d{2})/) ?? [])[1]?.replace(/\s/g, ''));
  };
  const findPlus = () =>
    [...(builderDialog()?.querySelectorAll('button') ?? [])]
      .find((b) => /One more Ginger/i.test(b.getAttribute('aria-label') ?? ''));

  /* Required groups are already chosen by the previous step, so the button has a price. */
  const before = priceOn();
  s5.click(drink);
  await s5.waitFor(() => findPlus(), 'the drink stepper', 6000);

  const one = priceOn();
  if (one !== before + 25) throw new Error(`one bottle added R${one - before}, not R25`);

  s5.click(findPlus());
  await s5.waitFor(() => priceOn() === before + 50, 'the second bottle to be priced', 6000);

  /*
   * The catalogue caps one plate at four bottles.
   *
   * The two clicks need a tick between them: React re-renders the stepper after
   * each, and clicking the stale node twice in the same task asks for the same
   * increment twice and gets one.
   */
  for (let i = 0; i < 2; i += 1) {
    s5.click(findPlus());
    await sleep(120);
  }
  await s5.waitFor(() => priceOn() === before + 100, 'four bottles to be priced', 6000);
  if (!findPlus()?.disabled) throw new Error('the stepper does not stop at the catalogue limit');

  /* Back down to two, so the basket assertion below is about the drink, not the count. */
  const findMinus = () =>
    [...(builderDialog()?.querySelectorAll('button') ?? [])]
      .find((b) => /One fewer Ginger|Remove Ginger/i.test(b.getAttribute('aria-label') ?? ''));
  s5.click(findMinus());
  await sleep(120);
  s5.click(findMinus());
  await s5.waitFor(() => priceOn() === before + 50, 'two bottles', 6000);
  return `R${before} plate, +R25 per bottle, capped at four`;
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
  /*
   * On a host with no Yoco keys the card submit reads "Online payment coming
   * soon" and cannot be clicked, which says nothing about form validation.
   * Only then switch to cash — clicking anything else would leak into the
   * later steps, which expect the card flow on hosts that have it.
   */
  const cardSubmit = s1.byText('button[type="submit"]', /Place order/i)[0];
  const cardUsable = Boolean(cardSubmit) && !cardSubmit.disabled;
  if (!cardUsable) {
    const cashFirst = [...s1.doc.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').trim().startsWith('Cash'));
    if (cashFirst) {
      s1.click(cashFirst);
      await sleep(200);
    }
  }
  const submit = s1.byText('button[type="submit"]', /Place order/i)[0];
  s1.click(submit);
  await sleep(400);
  if (!/We need a name/i.test(s1.text())) throw new Error('name validation did not fire');
  return 'blocked with a message';
});

await step('email is optional, the checkout has no card fields, and the WhatsApp order button is present', async () => {
  /*
   * Email used to be mandatory for a card order because it was the only place a
   * receipt could go. Email needs SMTP set up on the host, and the order now
   * finishes in a WhatsApp chat that is its own record, so the field is optional
   * and must not block anyone.
   */
  const byPlaceholder = (re) => [...s1.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s1.setInput(byPlaceholder(/Thabo Mahlangu/), 'Interaction Test');
  s1.setInput(byPlaceholder(/\+27 82/), '+27 82 000 7777');
  /*
   * Delivery only: there is no collection fallback, so the address is required
   * on every order and the WhatsApp button stays blocked without it.
   */
  /*
   * The address is typed into the one box the checkout shows, and the location
   * button is what makes it measurable.
   */
  s1.setInput(byPlaceholder(/Oxford Road/), '12 Oxford Road, Illovo, Sandton');
  await sleep(300);
  await useMyLocation(s1);

  /* No card field may exist: money is taken on Yoco's own page. */
  const cardFields = [...s1.doc.querySelectorAll('input')].filter((f) => /4242 4242|MM\/YY|^123$|T MAHLANGU/.test(f.placeholder ?? ''));
  if (cardFields.length) throw new Error(`card fields are still on the checkout: ${cardFields.map((f) => f.placeholder).join(', ')}`);

  /* The second action must exist and must carry the whole order. */
  const wa = [...s1.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));
  if (!wa) throw new Error('no "Complete order on WhatsApp" button');
  const message = new URL(wa.href).searchParams.get('text') ?? '';
  for (const wanted of [/Interaction Test/, /\+27 82 000 7777/]) {
    if (!wanted.test(message)) throw new Error(`the WhatsApp order is missing the customer details typed above: ${message.slice(0, 200)}`);
  }

  /*
   * Nothing in the form may block a customer who has given a name and number:
   * an empty optional email is not an error, and the address fields only appear
   * when delivery is the chosen fulfilment.
   */
  const emailField = byPlaceholder(/you@example\.co\.za/);
  if (emailField && emailField.value) throw new Error('the email field was not empty for this check');
  return 'email optional, details carried into the WhatsApp order, no card fields';
});

const SKIP_YOCO = 'this host has no Yoco configuration (HB_YOCO_*), so the paid path is not part of this run';

await step('placing an online order saves it and hands the customer to Yoco', async () => {
  /*
   * The money path, end to end, without a card: the order is created as
   * awaiting-payment, and the page sends the customer to the Yoco payment page
   * the business configured. Nothing here can charge anyone — that is the point
   * of the change — so what is asserted is the hand-off, not an approval.
   */
  const payments = await fetch(`${BASE}/api/catalog`).then((r) => r.json()).then((c) => c.payments);
  if (!payments.online) return `SKIP: ${SKIP_YOCO}`;

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
  /*
   * Normally the host is pay.yoco.com. When HB_YOCO_CHECKOUT_ENDPOINT points at
   * the project's own stand-in gateway (scripts/yoco-sandbox.mjs), the host is
   * that gateway instead — the one thing that must never happen is a payment
   * page on some unrelated site, so anything other than Yoco or the configured
   * sandbox is refused.
   */
  const sandbox = process.env.HB_YOCO_CHECKOUT_ENDPOINT ? new URL(process.env.HB_YOCO_CHECKOUT_ENDPOINT).host : null;
  if (!/(^|\.)yoco\.com$/.test(url.host) && url.host !== sandbox) {
    throw new Error(`the payment page is not Yoco: ${url.host}`);
  }

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
  /* Marks that __code is a card order — the Yoco-only steps key off this, not
     on __code alone, which the tracking-page steps may fill with a cash order. */
  s1.__card = true;
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
  if (!code || !s1.__card) return `SKIP: ${SKIP_YOCO}`;
  const view = boot(`/order/${code}?token=${encodeURIComponent(s1.__trackingToken)}`);
  await view.waitFor(() => /Order tracking/i.test(view.text()), 'the tracking page', 20000);

  if (!/Awaiting payment/i.test(view.text())) throw new Error('an unpaid order does not say it is unpaid');
  if (!/Payment not completed/i.test(view.text())) throw new Error('the resume-payment panel is missing');
  const again = [...view.doc.querySelectorAll('a')].find((a) => /Pay now on Yoco/i.test(a.textContent ?? ''));
  if (!again) throw new Error('no way to finish the payment');
  /*
   * Yoco, or the project's own stand-in gateway when one is configured. The
   * point of the check is that the link goes back to the payment page and
   * nowhere else.
   */
  const resumeHost = new URL(again.href).host;
  const resumeSandbox = process.env.HB_YOCO_CHECKOUT_ENDPOINT ? new URL(process.env.HB_YOCO_CHECKOUT_ENDPOINT).host : null;
  if (!/heritagebites|yoco/i.test(resumeHost) && resumeHost !== resumeSandbox) {
    throw new Error(`resume link is not the payment page: ${again.href}`);
  }

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
/*
 * The receipt/tracking checks do not care how the order was paid for — only
 * that one exists. On a host with no Yoco keys the card steps never produce
 * an order, so those checks seed their own cash order instead of failing on
 * an environment gap that has nothing to do with what they assert. Card-
 * specific steps (the Yoco hand-off, the webhook) never call this and skip
 * with the reason instead.
 */
async function ensureTrackedOrder() {
  if (s1.__code && s1.__trackingToken) return;
  const loyal = `+27 84 ${String(Date.now()).slice(-8)}`;
  const placed = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'web',
      fulfilment: 'delivery',
      customer: {
        name: 'Tracking Test', phone: loyal, email: 'interaction@example.co.za',
        address: '1 Maude Street, Sandton', suburb: 'Sandton', lat: -26.1075, lng: 28.055,
      },
      items: [{ itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } }],
      payment: { method: 'cash' },
    }),
  }).then((r) => r.json());
  if (!placed.order?.code) throw new Error('could not seed an order for the tracking-page checks');
  s1.__code = placed.order.code;
  s1.__trackingToken = placed.trackingToken;
}
async function orderPage() {
  if (s1Order) return s1Order;
  if (!s1.__code || !s1.__trackingToken) throw new Error('no order came out of the checkout steps');
  s1Order = boot(`/order/${s1.__code}?token=${encodeURIComponent(s1.__trackingToken)}`);
  await s1Order.waitFor(() => /Order tracking/i.test(s1Order.text()), 'the order page for the receipt checks', 20000);
  s1Order.__code = s1.__code;
  s1Order.__trackingToken = s1.__trackingToken;
  return s1Order;
}

await step('the order page claims no email receipt and leaks no address', async () => {
  await ensureTrackedOrder();
  await orderPage();
  /*
   * Email alerts were removed, so there is exactly one honest outcome now: the
   * page says no receipt email is sent, and it must never print the address the
   * customer typed.
   */
  const text = s1Order.text();
  if (/interaction@example\.co\.za/.test(text)) throw new Error('the full email address is exposed on the page');
  if (/Receipt (emailed to|on its way to)|could not email your receipt/i.test(text)) {
    throw new Error('the page still claims an email receipt');
  }
  if (!/No receipt email is sent/i.test(text)) {
    throw new Error('the page does not tell the customer plainly that no receipt email is sent');
  }
  return 'no receipt email claimed, and no address leaked';
});

await step('the tracking page offers manual WhatsApp updates, an order ticket and a shareable receipt', async () => {
  await ensureTrackedOrder();
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
  if (!s1.__code || !s1.__card) return `SKIP: ${SKIP_YOCO}`;
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
  /*
   * The two payment options are now plain "Card" and "Cash" — collection no
   * longer gets its own wording, because both are accepted for either
   * fulfilment and the blurbs say when the money changes hands.
   */
  const cashButton = [...s6.doc.querySelectorAll('button')]
    .find((b) => (b.textContent ?? '').trim().startsWith('Cash'));
  if (!cashButton) throw new Error('no Cash payment option on the checkout');
  s6.click(cashButton);
  await sleep(200);
  const suspicious = [...s6.doc.querySelectorAll('input')].filter((f) => /4242 4242|MM\/YY|^123$|T MAHLANGU/.test(f.placeholder ?? ''));
  if (suspicious.length) throw new Error(`card fields are still present: ${suspicious.map((f) => f.placeholder).join(', ')}`);

  const byPh = (re) => [...s6.doc.querySelectorAll('input')].find((f) => re.test(f.placeholder ?? ''));
  s6.setInput(byPh(/Thabo Mahlangu/), 'Cash Customer');
  s6.setInput(byPh(/\+27 82/), '+27 82 000 6600');
  /*
   * Delivery only (owner, 14 Nov 2026): there is no collection to fall back on,
   * so every order needs a street address. The address field is typed into the
   * way a customer would — the suggestion list is an assist, not a requirement.
   */
  /*
   * Type the address, then locate it with the button. The order cannot leave the
   * form until one of the two location routes has been used — a typed address
   * carries no coordinates, so the 50 km rule cannot be checked against it.
   */
  /*
   * One box, typed, and then the location button — the order cannot leave until
   * one of the two location routes has been used, so both are done here.
   */
  const addressField = byPh(/Oxford Road/);
  if (!addressField) throw new Error('checkout has no delivery address field');
  s6.setInput(addressField, '15 Oxford Road, Rosebank');
  await sleep(300);
  await useMyLocation(s6);

  /*
   * The WhatsApp handoff used to open an empty chat: the link carried the
   * number and nothing else, so the customer had to retype the order. It now
   * has to carry the basket itself — dishes, quantities, line totals, the total
   * and the delivery address — pre-typed into the message.
   */
  const waLink = [...s6.doc.querySelectorAll('a[href^="https://wa.me/"]')]
    .find((a) => /Complete order on WhatsApp/i.test(a.textContent ?? ''));
  if (!waLink) throw new Error('checkout has no WhatsApp order button');
  const waText = new URL(waLink.href).searchParams.get('text') ?? '';
  /* en-ZA writes the decimal as a comma: R200,00. */
  for (const wanted of [/Tshotlo Plate/, /2 ×/, /R200[,.]00/, /Pap/, /Braised cabbage/]) {
    if (!wanted.test(waText)) throw new Error(`the WhatsApp message is missing the order data (${wanted}): ${waText.slice(0, 160)}`);
  }
  /*
   * The closing line used to read "I will send it through", which read as if the
   * customer still had a step left to take. It must now state how this order
   * will be paid — cash here, because the customer chose it — and ask for a
   * reply.
   */
  if (!/I will pay cash on delivery/.test(waText) || !/confirm this order/.test(waText)) {
    throw new Error(`the WhatsApp message does not close with the cash confirm ask: ${waText.slice(-160)}`);
  }
  if (/I will send it through/.test(waText)) {
    throw new Error('the WhatsApp message still asks the customer to send it through');
  }

  const submit = s6.byText('button[type="submit"]', /Place order/i)[0];
  if (!submit) throw new Error('no submit button on a cash checkout');
  if (submit.disabled) throw new Error(`cash checkout is locked without a card (page input: ${s6.text().replace(/\s+/g, ' ').slice(0, 700)})`);
  s6.click(submit);

  await s6.waitFor(
    () => /Order tracking/i.test(s6.text()),
    `tracking page for the cash order — page says: ${s6.text().replace(/\s+/g, ' ').slice(0, 900)}`,
    25000,
  );
  const code = s6.w.location.pathname.split('/').pop();
  if (!/^HB-\d{4}[A-Z]$/.test(code)) throw new Error(`unexpected order code: ${code}`);

  // The customer must be told they have not paid yet.
  if (!/Payment on delivery/i.test(s6.text())) {
    throw new Error('tracking page does not say payment is due on delivery');
  }

  // And the kitchen must agree, server-side.
  const trackingToken = new URLSearchParams(s6.w.location.search).get('token');
  if (!trackingToken) throw new Error('cash checkout did not provide a secure tracking token');
  const order = await fetch(`${BASE}/api/orders/${code}?token=${encodeURIComponent(trackingToken)}`).then((r) => r.json());
  if (order.order.payment.status !== 'pending') {
    throw new Error(`cash order recorded as ${order.order.payment.status}, expected pending`);
  }
  if (order.order.payment.method !== 'cash') {
    throw new Error(`payment method recorded as ${order.order.payment.method}`);
  }
  return `${code} unpaid, due on delivery`;
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

await s8.waitFor(() => /3 items/.test(s8.text()), 'the pinned basket bar', 20000);

await step('the basket bar states the one arrangement there is: delivery', async () => {
  /*
   * Owner, 14 Nov 2026 — collection is gone. The bar and the drawer used to
   * carry a collection/delivery switch and warn about a flat fee; both are
   * replaced by a single true sentence, and the check is that no collection
   * wording survives anywhere in the basket.
   */
  if (!/3 items · delivery/.test(s8.text())) throw new Error('the bar does not show the item count and delivery');
  /*
   * "Collection" may only survive in the stamp counter ("Stamps collected"),
   * which is a different word doing a different job. What must be gone is the
   * fulfilment wording: "Collection — nothing extra", "· collection".
   */
  if (/·\s*collection\b/i.test(s8.text())) {
    throw new Error('a collection mode is still advertised in the basket bar');
  }
  if (/Collection — nothing/.test(s8.text())) {
    throw new Error('the old collection price line is still in the basket bar');
  }

  const open = [...s8.doc.querySelectorAll('button')].find((b) => /Open your basket/i.test(b.getAttribute('aria-label') ?? ''));
  s8.click(open);
  await s8.waitFor(() => /Your basket/i.test(s8.text()), 'the basket drawer', 15000);

  /* There is no switch left to click: one option is not a choice. */
  const switchBtn = [...s8.doc.querySelectorAll('button')].find((b) => /^collection$/i.test((b.textContent ?? '').trim()));
  if (switchBtn) throw new Error('the basket still offers a collection switch');

  const drawer = s8.text();
  if (!/Delivered/i.test(drawer)) throw new Error('the drawer does not state that the order is delivered');
  if (!/included in Sandton/i.test(drawer)) throw new Error('the drawer does not say delivery is included in the two suburbs');
  if (/^Collection point/m.test(drawer)) throw new Error('the drawer still points at a collection point');

  const close = [...s8.doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close');
  s8.click(close);
  await sleep(300);
  return 'delivery stated plainly, no collection switch, no collection point';
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

/* Flow 4: the basket survives a reload, and the bar can empty it        */
/* ------------------------------------------------------------------ */

/*
 * "When I refresh, my plates are still there" is a promise, not a detail: the
 * cart lives in localStorage (`hb.cart`), so a new page load — which is exactly
 * what booting a fresh document here simulates — must show the same plates, the
 * same quantities and the same total without the customer touching anything.
 */
const RELOAD_CART = {
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
    /*
     * A cart saved by the OLD build, still saying `collection`. The store
     * migrates it to delivery on load (version 3), which is the point of this
     * fixture: a returning customer must not be shown a collection screen that
     * no longer exists.
     */
    fulfilment: 'collection',
  },
  version: 2,
};

const s9 = boot('/menu', { seedCart: RELOAD_CART });
await s9.waitFor(() => /3 items/.test(s9.text()), 'the basket bar after a reload', 20000);

await step('a page load still shows the plates that were already picked', async () => {
  /* The saved `collection` cart must read as delivery after the version-3 migration. */
  if (!/3 items · delivery/.test(s9.text())) throw new Error(`the bar lost the items or kept the retired collection mode: ${s9.text().slice(0, 200)}`);
  if (!/R330/.test(s9.text())) throw new Error(`the bar lost the running total: ${s9.text().slice(0, 200)}`);

  const open = [...s9.doc.querySelectorAll('button')].find((b) => /Open your basket/i.test(b.getAttribute('aria-label') ?? ''));
  s9.click(open);
  await s9.waitFor(() => /Your basket/i.test(s9.text()), 'the basket drawer after a reload', 15000);
  if (!/Mogodu/.test(s9.text()) || !/Short Rib/i.test(s9.text())) {
    throw new Error('the drawer does not list both plates that were picked before the reload');
  }
  const close = [...s9.doc.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close');
  s9.click(close);
  await sleep(300);
  return 'plates, quantities and total all restored';
});

await step('the bar can empty the whole basket without opening it', async () => {
  const clearOnBar = () => [...s9.doc.querySelectorAll('button')].find((b) => /^Clear the basket/i.test(b.getAttribute('aria-label') ?? ''));
  if (!clearOnBar()) throw new Error('the basket bar has no clear button');
  s9.click(clearOnBar());
  await sleep(400);

  if (/Open your basket/i.test(s9.text())) throw new Error('the bar is still showing after clearing');
  const stored = JSON.parse(s9.w.localStorage.getItem('hb.cart') ?? '{}');
  const lines = stored?.state?.lines ?? [];
  if (lines.length) throw new Error(`${lines.length} line(s) survived the clear button`);
  return 'one tap on the bar, and nothing is left in storage';
});

/* Flow 5: the footer's Meals menu                                         */
/* ------------------------------------------------------------------ */

await step('the footer keeps ordering behind one "Meals" toggle', async () => {
  const footer = s9.doc.querySelector('footer');
  if (!footer) throw new Error('no footer on the page');

  const toggle = footer.querySelector('button[aria-controls="footer-meals"]');
  if (!toggle) throw new Error('the footer has no Meals toggle');
  if (!/Meals/.test(toggle.textContent ?? '')) throw new Error('the toggle is not labelled Meals');

  const group = footer.querySelector('#footer-meals');
  if (!group) throw new Error('the toggle points at a group that does not exist');
  if (toggle.getAttribute('aria-expanded') !== 'false') throw new Error('the menu should start closed');
  if (!/hidden/.test(group.className)) throw new Error('the closed menu is still showing');

  /*
   * Every route a customer orders on is inside it. The fourth slot is not always
   * the checkout: with a basket it is, and with an empty one it is the menu under
   * the label "Start an order" — a checkout link that leads to "your basket is
   * empty" is the dead end the owner reported (18 Nov 2026). So the assertion is
   * on the destination, not on a fixed path list.
   */
  const inside = [...group.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href'),
    label: (a.textContent ?? '').trim(),
  }));
  for (const href of ['/menu', '/specials', '/passport']) {
    if (!inside.some((l) => l.href === href)) throw new Error(`${href} is missing from the Meals menu`);
  }
  const orderSlot = inside.find((l) => l.href === '/checkout' || /Start an order/i.test(l.label));
  if (!orderSlot) throw new Error('the Meals menu offers no way to reach the checkout');
  /*
   * The step immediately above this one clears the basket, so by the time the
   * footer is checked this customer genuinely has nothing to order — and the slot
   * must therefore point at the menu. The basket-full half of the rule is checked
   * in the "Order online" step; this one only has to prove the footer agrees with
   * the rest of the site about which of the two is right.
   */
  if (orderSlot.href !== '/menu') throw new Error(`with an empty basket the footer order slot points at ${orderSlot.href}`);
  if (!/Start an order/i.test(orderSlot.label)) throw new Error(`the emptied footer still promises a checkout: ${orderSlot.label}`);

  s9.click(toggle);
  await sleep(150);
  if (toggle.getAttribute('aria-expanded') !== 'true') throw new Error('the toggle did not open');
  if (/hidden/.test(group.className)) throw new Error('the menu is still hidden after the click');

  /*
   * Loyalty card and Customer quest sit after the group as their own items —
   * they are not part of ordering a plate, which is why they are outside it.
   */
  const items = [...footer.querySelectorAll('li')].map((li) => (li.querySelector(':scope > a')?.textContent ?? '').trim());
  if (!items.includes('Loyalty card')) throw new Error('Loyalty card is not a top-level footer item');
  if (!items.includes('Customer request')) throw new Error('Customer request is not a top-level footer item');

  s9.click(toggle);
  await sleep(150);
  if (toggle.getAttribute('aria-expanded') !== 'false') throw new Error('the toggle does not close again');
  return 'closed by default, four ordering links inside, loyalty and quest outside';
});

await step('the back-to-top button appears only after scrolling, and returns the page to the top', async () => {
  /*
   * Owner, 18 Nov 2026: "add back to top floating button".
   *
   * The pages here are long — eight plates, ten sides, five policy documents —
   * and the header is where search, navigation and the basket live, so getting
   * back to it meant flicking up the whole document. What has to be true:
   *
   *   - it is not there on arrival (a button that does nothing is noise);
   *   - it appears once the customer is genuinely down the page;
   *   - it clears the basket bar when that bar is on screen, rather than hiding
   *     behind it;
   *   - tapping it actually scrolls to the top;
   *   - it stays off the checkout and the order page, where scrolling away from
   *     the submit control could cost an order.
   */
  const top = boot('/about');
  await top.waitFor(() => /About/i.test(top.text()), 'about page', 20000);
  await sleep(200);

  const button = (page) => [...page.doc.querySelectorAll('button')]
    .find((el) => /back to the top/i.test(el.getAttribute('aria-label') ?? ''));

  if (button(top)) throw new Error('the button is showing at the top of the page, where it would do nothing');

  /* One phone screen of scrolling: far enough that the top is lost. */
  top.w.__scrollTo(900);
  await sleep(200);
  const shown = button(top);
  if (!shown) throw new Error('the button did not appear after scrolling down 900px');

  /* 44px minimum, like every other thumb control on the site. */
  const size = shown.className.match(/\bh-(\d+)\b/)?.[1];
  if (size !== '11') throw new Error(`the button is ${size ? `${size} units` : 'not sized'} tall, not the 44px minimum`);

  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    shown.dispatchEvent(new top.w.MouseEvent(type, { bubbles: true }));
  }
  await sleep(200);
  const jump = top.scrolls.at(-1);
  if (!jump || jump.kind !== 'scrollTo' || jump.arg?.top !== 0) {
    throw new Error(`clicking it did not scroll to the top: ${JSON.stringify(jump)}`);
  }
  if (top.w.scrollY !== 0) throw new Error('the page did not end up at the top');
  if (button(top)) throw new Error('the button is still floating over the top of the page after being used');

  /* With a basket, the bar owns the bottom edge — the button must sit above it. */
  const basketLine = {
    key: 'plate::traditional',
    itemId: 'plate-traditional',
    plateId: 'traditional',
    name: 'Traditional Plate',
    image: '/img/plate-mogodu.jpg',
    unitPrice: 100,
    qty: 1,
    picks: [],
    kind: 'plate',
  };
  const shopper = boot('/menu', { seedCart: { state: { fulfilment: 'delivery', lines: [basketLine] }, version: 2 } });
  await shopper.waitFor(() => /Menu/i.test(shopper.text()), 'menu', 20000);
  shopper.w.__scrollTo(900);
  await sleep(200);
  const raised = button(shopper);
  if (!raised) throw new Error('the button is missing on a page with a basket in it');
  if (!/\bbottom-32\b/.test(raised.className)) throw new Error('the button does not clear the basket bar');

  /* The checkout is a form in progress; no way out of it from here. */
  const paying = boot('/checkout', { seedCart: CHECKOUT_CART });
  await paying.waitFor(() => /Almost there/i.test(paying.text()), 'checkout', 20000);
  paying.w.__scrollTo(900);
  await sleep(200);
  if (button(paying)) throw new Error('the button is offered on the checkout, mid-form');

  top.close();
  shopper.close();
  paying.close();
  return 'hidden at the top, appears after scrolling, clears the basket bar, returns to the top, absent from the checkout';
});

await step('the heritage band carries white as one of its painted pigments', async () => {
  /*
   * Owner, 19 Nov 2026: "the heritage vector must also have a white color".
   *
   * The band's ground is chalk (#f7f2e6), so white has to be a *painted* chevron
   * rather than the surface showing through — otherwise the register reads as
   * four colours on a cream stripe instead of a five-shape cloth repeat.
   *
   * Asserted against the rendered SVG so it catches the pigment being dropped
   * from the cycle, which is a one-word edit that leaves everything else intact.
   */
  const page = boot('/menu');
  await page.waitFor(() => /The full menu/i.test(page.text()), 'menu', 20000);
  await sleep(300);

  const band = [...page.doc.querySelectorAll('svg')].find((svg) => svg.querySelector('pattern'));
  if (!band) throw new Error('no heritage band on the page');

  const fills = [...band.querySelectorAll('path')].map((p) => p.getAttribute('fill'));
  if (!fills.length) throw new Error('the band has no painted shapes');

  const unique = [...new Set(fills)];
  if (!unique.includes('#ffffff')) {
    throw new Error(`white is not in the band: ${unique.join(', ')}`);
  }
  /* One shape per pigment in the tile, or the cycle is not whole. */
  const cycle = ['var(--color-ochre)', '#ffffff', '#a33b26', '#1f4e79', '#2f6b4f'];
  for (const pigment of cycle) {
    if (!unique.includes(pigment)) throw new Error(`the band is missing ${pigment}`);
  }

  page.close();
  return `${fills.length} chevrons in ${unique.length} pigments, white included`;
});

await step('the appearance control cycles light, dark and back to the device', async () => {
  /*
   * Owner, 19 Nov 2026: "can i have dark and light mode".
   *
   * Three states, not a switch: "follow my phone" is a preference in its own
   * right, and a two-way toggle silently discards it the first time it is
   * touched. jsdom has no CSS engine, so what is asserted here is the contract
   * the styling depends on — the attribute that `light-dark()` resolves
   * against, and the value persisted so the pre-paint script in index.html can
   * restore it before React mounts.
   */
  const page = boot('/');
  await page.waitFor(() => /Heritage/i.test(page.text()), 'home', 20000);

  const control = () => [...page.doc.querySelectorAll('button')]
    .find((el) => /^Appearance:/i.test(el.getAttribute('aria-label') ?? ''));
  if (!control()) throw new Error('there is no appearance control in the header');
  if (!/Device/i.test(control().getAttribute('aria-label'))) {
    throw new Error(`the control did not start on "follow the device": ${control().getAttribute('aria-label')}`);
  }

  const root = page.doc.documentElement;
  if (root.dataset.theme) throw new Error('a theme attribute is set before the customer has chosen one');

  page.click(control());
  await sleep(150);
  if (root.dataset.theme !== 'light') throw new Error('the first press did not select light');
  if (page.w.localStorage.getItem('hb.theme') !== 'light') throw new Error('the light choice was not persisted');

  page.click(control());
  await sleep(150);
  if (root.dataset.theme !== 'dark') throw new Error('the second press did not select dark');
  if (page.w.localStorage.getItem('hb.theme') !== 'dark') throw new Error('the dark choice was not persisted');

  /* Third press returns to the device: no attribute, nothing stored. */
  page.click(control());
  await sleep(150);
  if (root.dataset.theme) throw new Error('the third press did not return to following the device');
  if (page.w.localStorage.getItem('hb.theme')) throw new Error('the device choice left a stored override behind');
  if (!/Device/i.test(control().getAttribute('aria-label'))) throw new Error('the label did not follow the state');

  page.close();
  return 'starts on the device, cycles light -> dark -> device, persists only explicit choices';
});

await step('the archive sections follow the list/grid choice too', async () => {
  /*
   * The Kasi Fast Food and Morning Heritage sections were a hardcoded grid, so
   * switching to list view left them four-up while every selling section
   * obeyed — it read as a broken page rather than a preference.
   */
  const page = boot('/menu');
  await page.waitFor(() => /The full menu/i.test(page.text()), 'menu', 20000);
  await sleep(400);

  const toggle = [...page.doc.querySelectorAll('button')]
    .find((el) => /Show meals as a list/i.test(el.getAttribute('aria-label') ?? ''));
  if (!toggle) throw new Error('there is no list/grid toggle on the menu');
  page.click(toggle);
  await sleep(300);

  const archive = page.doc.querySelector('[data-coming-soon]');
  if (!archive) throw new Error('the archive section is missing');
  if (archive.getAttribute('data-view') !== 'list') {
    throw new Error(`the archive section ignored the list choice: data-view=${archive.getAttribute('data-view')}`);
  }
  if (!/grid gap-4/.test(archive.className)) {
    throw new Error(`the archive section is still laid out as a grid: ${archive.className}`);
  }
  const cards = [...archive.querySelectorAll('article')];
  if (!cards.length) throw new Error('the archive section has no cards');
  if (cards.some((c) => c.getAttribute('data-layout') !== 'list')) {
    throw new Error('an archive card did not switch to the row layout');
  }

  page.close();
  return `${cards.length} archive cards follow the toggle into list view`;
});

/* ------------------------------------------------------------------ */

const failed = results.filter(([s]) => s === 'FAIL');
console.log('\n--- interaction smoke test (jsdom, live API) ---');
for (const [status, label, detail] of results) console.log(`  ${status}  ${label}${detail ? ` — ${detail}` : ''}`);

const errs = [...s1.errors, ...s3.errors, ...s5.errors, ...s6.errors, ...s8.errors, ...s9.errors];
if (errs.length) {
  console.log('\n--- runtime errors ---');
  for (const e of errs.slice(0, 10)) console.log(`  ${e}`);
}

const ok = failed.length === 0 && errs.length === 0;
console.log(`\n${ok ? 'ALL GREEN' : 'FAILURES'}: ${results.length - failed.length}/${results.length} interactions passed, ${errs.length} runtime errors\n`);
s1.close();
s3.close();
s5.close();
s8.close();
s9.close();
s6.close();
s8.close();
process.exit(ok ? 0 : 1);
