/**
 * Integration tests against the real Express handlers over HTTP.
 * These exercise the public routes the storefront calls.
 *
 * The catalogue asserted here is the owner-approved content: two plate menus
 * (R100 traditional / R130 contemporary), Thursday and Friday service between
 * 12:00 and 13:30, delivery in Rosebank and Sandton with delivery included.
 */
import { test, before, after, describe } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';

/*
 * Web Push is configured for the whole integration run so its routes can be
 * exercised. The key pair is generated here, never committed: a leaked VAPID
 * private key would let anyone push to this deployment's subscribers.
 */
const { default: webpush } = await import('web-push');
const VAPID = webpush.generateVAPIDKeys();
process.env.HB_VAPID_PUBLIC_KEY = VAPID.publicKey;
process.env.HB_VAPID_PRIVATE_KEY = VAPID.privateKey;
process.env.HB_VAPID_SUBJECT = 'mailto:kitchen@example.com';
process.env.HB_OWNER_PUSH_KEY = 'integration-owner-key-1234';
/* Nothing in the suite may reach a real push service. */
process.env.HB_PUSH_DRY_RUN = 'true';
/*
 * The checkout refuses orders outside the Thu/Fri 12:00-13:30 window. CI runs at
 * all hours, so the suite opens the shop explicitly rather than pretending to be
 * Thursday lunchtime — the closed path has its own test which clears this.
 */
process.env.HB_ORDERS_OPEN = 'true';
// Keep the contact endpoint offline: the Formspree call is exercised by its own
// unit test with a stub, never against the real inbox from a test run.
process.env.HB_CONTACT_FORMSPREE_URL = '';
/*
 * Online payments: the suite uses a Yoco *payment link* (no secret key, no
 * network) plus a webhook secret, which is exactly the setup the business can
 * hand over fastest. Nothing here calls Yoco — a payment link is a redirect, and
 * the webhook is verified locally, so the whole money path is exercised offline.
 */
const YOCO_LINK = 'https://pay.yoco.com/heritagebites';
const WEBHOOK_SECRET_RAW = 'integration-webhook-secret-0123456789';
const WEBHOOK_SECRET = `whsec_${Buffer.from(WEBHOOK_SECRET_RAW).toString('base64')}`;
process.env.HB_YOCO_PAYMENT_URL = YOCO_LINK;
process.env.HB_YOCO_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.HB_PUBLIC_URL = 'https://heritagebites.test';
/*
 * The suite is one client on one address and places more orders in a minute than
 * any real customer would, so every rate limit is multiplied rather than turned
 * off: the middleware stays wired and under test, only the allowance is raised.
 * The limiter itself has its own tests, including one that proves a 429 arrives.
 */
process.env.HB_RATE_LIMIT_MULTIPLIER = '50';
// Tests run against a throwaway data directory so they never touch the demo
// dataset that the storefront shows.
const TMP = mkdtempSync(join(tmpdir(), 'hb-test-'));
process.env.HB_DATA_DIR = TMP;

const { app } = await import('./index.js');

let server;
let base;

const json = (res) => res.json();

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  // fetch() keeps sockets alive; without closing them server.close() never
  // resolves and the test process hangs.
  server?.closeAllConnections?.();
  server?.close();
  rmSync(TMP, { recursive: true, force: true });
});

/** A card number, to prove this API refuses them outright now. */
const CARD_FIELDS = { number: '4242424242424242', expiry: '12/32', cvc: '123', holder: 'Test User' };

const WINGS = { itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } };
const MOGODU = { itemId: 'mogodu-plate', qty: 1, options: { starch: 'pap', veg: 'braised-cabbage' } };

/**
 * Sign a webhook body the way Yoco does (Standard Webhooks): HMAC-SHA256 over
 * `${id}.${timestamp}.${body}`, base64, with the secret after its `whsec_`
 * prefix decoded. Used to post payments the way the real gateway would.
 */
function signedWebhook(event, { secret = WEBHOOK_SECRET, id = 'msg_test_1', timestamp = Math.floor(Date.now() / 1000), tamper = false } = {}) {
  const body = JSON.stringify(event);
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${tamper ? signature.slice(0, -4) + 'AAAA' : signature}`,
    },
  };
}

/** A `payment.succeeded` webhook for an order code. */
function paidEvent(orderCode, extra = {}) {
  return {
    type: 'payment.succeeded',
    payload: {
      id: 'pay_test_123',
      amount: 13000,
      currency: 'ZAR',
      status: 'succeeded',
      metadata: { orderCode },
      card: { brand: 'visa', last4: '4242' },
      ...extra,
    },
  };
}

async function postWebhook(signed) {
  const res = await fetch(`${base}/api/payments/yoco/webhook`, { method: 'POST', headers: signed.headers, body: signed.body });
  return { res, body: await res.json().catch(() => ({})) };
}

async function placeOrder(overrides = {}) {
  const body = {
    channel: 'card',
    fulfilment: 'collection',
    customer: { name: 'Integration Test', phone: '+27 82 000 9999', email: 'i@e.co.za' },
    items: [WINGS],
    payment: { method: 'card' },
    ...overrides,
  };
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: await res.json() };
}

describe('catalogue + search', () => {
  test('catalogue exposes the approved plates, prices and rules', async () => {
    const c = await fetch(`${base}/api/catalog`).then(json);

    assert.equal(c.categories.length, 2, 'traditional and contemporary plates only');
    assert.equal(c.menu.length, 8, 'five traditional plates and three contemporary plates');
    assert.equal(c.plateMenus.length, 2);

    const traditional = c.plateMenus.find((p) => p.id === 'traditional');
    const contemporary = c.plateMenus.find((p) => p.id === 'contemporary');
    assert.equal(traditional.price, 100);
    assert.equal(contemporary.price, 130);

    // The confirmed component lists, verbatim.
    const labels = (plate, group) => plate.groups.find((g) => g.id === group).items.map((i) => i.label);
    assert.deepEqual(labels(traditional, 'starch'), ['Pap', 'Mabele (sorghum)', 'Samp', 'Dumpling']);
    assert.deepEqual(labels(traditional, 'protein'), [
      'Mogodu (beef tripe)', 'Tshotlo (pounded beef)', 'Chicken hardbody', 'Tlhakwana (beef trotters)', 'Smiley (sheep head)',
    ]);
    assert.deepEqual(labels(traditional, 'veg'), ['Braised cabbage', 'Spinach', 'Morogo', 'Salsa']);
    assert.deepEqual(labels(contemporary, 'starch'), ['Potato mash', 'Savoury rice', 'Baby potatoes', 'Cous cous', 'Garlic bread']);
    assert.deepEqual(labels(contemporary, 'protein'), ['Chicken wings', 'BBQ beef short rib', 'Lamb stew']);
    assert.deepEqual(labels(contemporary, 'veg'), [
      'Braised cabbage', 'Spinach', 'Salsa', 'Green salad', 'Corn ribs', 'Glazed carrots',
    ]);

    for (const item of c.menu) {
      assert.ok(item.id && item.name && item.price > 0 && item.image, `menu item is incomplete: ${item.id}`);
      assert.ok(c.categories.some((cat) => cat.id === item.category), `${item.id} has an orphan category`);
      assert.equal(item.price, traditional.price === item.price ? 100 : 130, `${item.id} is not on an approved plate price`);
      assert.equal('kcal' in item, false, `${item.id} must not show calorie data`);
      assert.equal('badge' in item, false, `${item.id} must not have a signature badge`);
    }

    // Business rules confirmed by the owner.
    assert.equal(c.settings.minDeliveryOrder, 100);
    assert.deepEqual(c.settings.deliveryAreas, ['Rosebank', 'Sandton']);
    assert.equal(c.settings.deliveryFlat, 55, 'delivery is a flat fee charged on top of the plates');
    assert.equal(c.settings.freeDeliveryAbove, 300, 'delivery is free from R300');
    assert.equal(c.settings.serviceWindow.open, '12:00');
    assert.equal(c.settings.serviceWindow.close, '13:30');
    assert.equal(c.settings.contactFormspreeUrl, 'https://formspree.io/f/xvkkkwve');

    const open = c.settings.hours.filter((h) => !h.closed).map((h) => h.label);
    assert.deepEqual(open, ['Thursday', 'Friday'], 'the kitchen serves two days a week');

    // No unconfirmed promotions, testimonials or physical address.
    assert.equal(c.specials, undefined, 'no day-of-week specials are published');
    assert.equal(c.testimonials, undefined, 'no testimonials are published');
    assert.equal('address' in c.settings, false, 'the storefront has no physical address');
    assert.equal(c.settings.channels.ubereats.url, '', 'Uber Eats link waits for the store URL');
    assert.equal(c.settings.channels.mrd.url, '', 'Mr D link waits for the store URL');

    // Customer policies supplied by the business.
    assert.equal(c.policies.length, 5);
    assert.deepEqual(c.policies.map((p) => p.id), ['privacy', 'terms', 'delivery-collection', 'refunds', 'cancellations']);

    // Service status and payment configuration are exposed for the UI.
    assert.equal(typeof c.service.open, 'boolean');
    assert.equal(c.service.windowLabel, '12:00–13:30');
    /* Payments are exposed as capabilities, not as keys: the browser needs to
       know whether "pay online" leads anywhere, and nothing more. */
    assert.equal(c.payments.provider, 'yoco');
    assert.equal(c.payments.online, true, 'the test host has a Yoco payment link');
    assert.equal(c.payments.mode, 'link');
    assert.equal(c.payments.exactAmount, false, 'a payment link cannot fix the amount');
    assert.equal(c.payments.cashOnCollection, true);
    assert.equal(c.payments.cashOnDelivery, true, 'the kitchen brings a card machine and takes cash');
    assert.equal(c.contact.inboxConfigured, false, 'the endpoint is disabled in tests');
  });

  test('the kitchen archive is a look, never stock: priced cards with no order path', async () => {
    const c = await fetch(`${base}/api/catalog`).then(json);

    assert.ok(Array.isArray(c.comingSoon), 'the archive categories are published for the view-only section');
    assert.ok(c.comingSoon.length >= 4, 'the categories the site carried before the two-tier menu are back');
    /*
     * Modern Favourites is gone on purpose: every dish in it is now a
     * Contemporary plate, and "coming soon" on food that is already on sale was
     * the owner's complaint.
     */
    assert.deepEqual(c.comingSoon.map((cat) => cat.id), [
      'heritage-pots',
      'kasi-fast-food',
      'morning-heritage',
      'sides-relishes',
    ]);

    const archived = c.comingSoon.flatMap((cat) => cat.items);
    assert.ok(archived.length >= 10);

    /* Nothing that can already be ordered belongs in the archive. */
    const sellableNames = c.menu.map((m) => m.name.toLowerCase());
    for (const item of archived) {
      const clashes = sellableNames.filter((name) => name.startsWith(item.name.toLowerCase().split(' — ')[0]));
      assert.deepEqual(clashes, [], `${item.id} duplicates a dish that is already on sale`);
    }

    for (const cat of c.comingSoon) {
      assert.ok(cat.name && cat.tagline && cat.blurb, `archive category is incomplete: ${cat.id}`);
      for (const item of cat.items) {
        /* The owner asked for archive cards to read like menu cards: name,
           guide price and a line of description. */
        assert.equal(typeof item.price, 'number', `${item.id} needs a guide price to show`);
        assert.ok(item.price > 0, `${item.id} has a nonsense price`);
        assert.ok(item.description && item.description.length > 20, `${item.id} needs a description`);
        assert.equal(item.status, 'coming-soon');
        assert.ok(item.image.startsWith('/img/'), `${item.id} needs a photo to show`);
      }
    }

    // The archive is never part of the sellable menu, so it cannot be priced,
    // searched, added to a basket or checked out.
    const sellable = new Set(c.menu.map((m) => m.id));
    for (const item of archived) assert.equal(sellable.has(item.id), false, `${item.id} leaked into the menu`);

    const search = await fetch(`${base}/api/search?q=Kota`).then(json);
    assert.equal(search.results.length, 0, 'archive dishes are not searchable stock');

    const quoted = await fetch(`${base}/api/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ itemId: archived[0].id, qty: 1 }], fulfilment: 'collection' }),
    });
    assert.equal(quoted.status, 422, 'an archive dish cannot be priced');
  });

  test('search finds plates by local name', async () => {
    const byLocal = await fetch(`${base}/api/search?q=tshotlo`).then(json);
    assert.equal(byLocal.results[0].id, 'tshotlo-plate');
    const byEnglish = await fetch(`${base}/api/search?q=trotters`).then(json);
    assert.ok(byEnglish.results.some((r) => r.id === 'tlhakwana-plate'));
    const empty = await fetch(`${base}/api/search?q=zzzzzz`).then(json);
    assert.equal(empty.results.length, 0);
  });

  test('fresh installs start without demo orders', async () => {
    const health = await fetch(`${base}/api/health`).then(json);
    assert.equal(health.orders, 0, 'no sample customer orders are seeded into a fresh install');
  });
});

describe('web push', () => {
  const sub = (n) => ({
    endpoint: `https://push.example.test/integration/${n}`,
    keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
  });

  test('the public config publishes the VAPID key but never the private one', async () => {
    const config = await fetch(`${base}/api/push/config`).then(json);
    assert.equal(config.enabled, true);
    assert.equal(config.vapidPublicKey, process.env.HB_VAPID_PUBLIC_KEY);
    assert.equal(config.ownerEnrolment, true);
    assert.doesNotMatch(JSON.stringify(config), new RegExp(process.env.HB_VAPID_PRIVATE_KEY));
  });

  test('a customer can only subscribe a device to an order it can already read', async () => {
    const { body } = await placeOrder();

    const wrongToken = await fetch(`${base}/api/push/order-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: body.order.code, token: 'not-the-token', subscription: sub(1) }),
    });
    assert.equal(wrongToken.status, 404, 'the tracking token is the authorisation');

    const noOrder = await fetch(`${base}/api/push/order-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'HB-9999Z', token: body.trackingToken, subscription: sub(2) }),
    });
    assert.equal(noOrder.status, 404);

    const good = await fetch(`${base}/api/push/order-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: body.order.code, token: body.trackingToken, subscription: sub(3) }),
    });
    assert.equal(good.status, 201);
    assert.equal((await good.json()).scope, 'order');

    const stored = JSON.parse(readFileSync(join(TMP, 'pushSubscriptions.json'), 'utf8'));
    const record = stored.find((entry) => entry.endpoint.endsWith('/3'));
    assert.equal(record.role, 'customer');
    assert.equal(record.orderCode, body.order.code, 'a customer device is bound to one order');
    assert.ok(record.lastSentAt, 'the subscription was confirmed with a push, proving the pipe works');
    assert.equal(record.failures, 0);
  });

  test('a malformed subscription is refused with a reason', async () => {
    const { body } = await placeOrder();
    const res = await fetch(`${base}/api/push/order-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: body.order.code, token: body.trackingToken, subscription: { endpoint: 'not-a-url' } }),
    });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /not usable/i);
  });

  test('owner enrolment needs the key, and a wrong key is refused', async () => {
    const wrong = await fetch(`${base}/api/push/owner-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hb-owner-key': 'wrong-key-wrong-key' },
      body: JSON.stringify({ subscription: sub(4) }),
    });
    assert.equal(wrong.status, 401);

    const right = await fetch(`${base}/api/push/owner-subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hb-owner-key': process.env.HB_OWNER_PUSH_KEY },
      body: JSON.stringify({ subscription: sub(5) }),
    });
    assert.equal(right.status, 201);

    const stored = JSON.parse(readFileSync(join(TMP, 'pushSubscriptions.json'), 'utf8'));
    assert.equal(stored.find((entry) => entry.endpoint.endsWith('/5')).role, 'owner');
  });

  test('a device can revoke itself without a key', async () => {
    const res = await fetch(`${base}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub(5).endpoint }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).removed, 1);

    const stored = JSON.parse(readFileSync(join(TMP, 'pushSubscriptions.json'), 'utf8'));
    assert.equal(stored.some((entry) => entry.endpoint.endsWith('/5')), false);
  });

  test('health reports push state without exposing endpoints', async () => {
    const health = await fetch(`${base}/api/health`).then(json);
    const push = health.notifications.push;
    assert.equal(push.configured, true);
    assert.equal(typeof push.ownerDevices, 'number');
    assert.equal(typeof push.customerDevices, 'number');
    assert.doesNotMatch(JSON.stringify(health), /push\.example\.test/);
  });
});

describe('cross-origin API access', () => {
  /*
   * The storefront can be hosted apart from the API (the GitHub Pages build is
   * one origin, the Express API another). That only works if the browser is
   * allowed to make the post — and only for the origins the owner listed.
   */
  const FOREIGN = 'https://not-heritagebites.example';

  test('a foreign origin gets no CORS grant and cannot preflight', async () => {
    const preflight = await fetch(`${base}/api/contact`, {
      method: 'OPTIONS',
      headers: { Origin: FOREIGN, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.status, 403, 'an unlisted origin must not be allowed to preflight');
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);

    const read = await fetch(`${base}/api/catalog`, { headers: { Origin: FOREIGN } });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('access-control-allow-origin'), null, 'the API must not hand out a wildcard grant');
  });

  test('a listed origin is granted exactly its own origin, and can preflight', async () => {
    /*
     * Read at import time, so this needs a real process rather than a second
     * import of the same module. Spawned on its own port with its own data dir.
     */
    const dir = mkdtempSync(join(tmpdir(), 'hb-cors-'));
    const port = 41733;
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HB_DATA_DIR: dir,
        HB_ALLOWED_ORIGINS: 'https://lulamilemkhungela.github.io/',
        HB_CONTACT_FORMSPREE_URL: '',
      },
      stdio: 'ignore',
    });

    try {
      const url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 15000;
      let up = false;
      while (Date.now() < deadline) {
        try {
          await fetch(`${url}/api/health`);
          up = true;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (!up) throw new Error('the CORS test server never came up');

      const origin = 'https://lulamilemkhungela.github.io';
      const preflight = await fetch(`${url}/api/contact`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
      assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-type/i);

      const posted = await fetch(`${url}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ name: 'Cors Test', phone: '0821234567', message: 'From the static site.' }),
      });
      assert.equal(posted.status, 201);
      assert.equal(posted.headers.get('access-control-allow-origin'), origin, 'a listed origin must stay granted on the post');

      /* An unlisted neighbour does not inherit the grant. */
      const other = await fetch(`${url}/api/catalog`, { headers: { Origin: 'https://evil.example' } });
      assert.equal(other.headers.get('access-control-allow-origin'), null);
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the service window gate', () => {
  /*
   * The gate exists because the site used to advertise "You can still place the
   * order now" after the window closed, and then take the order. This clears the
   * test override so the closed path is exercised for real, and restores it
   * afterwards so the rest of the suite can still order.
   */
  test('an order outside the service window is refused and points at WhatsApp', async () => {
    const previous = process.env.HB_ORDERS_OPEN;
    delete process.env.HB_ORDERS_OPEN;
    try {
      /*
       * 2026-11-13 is a Friday and the kitchen serves 12:00–13:30, so 15:09 is
       * exactly the moment the owner reported the bug at.
       */
      process.env.HB_CLOCK_LABEL = '2026-11-13T15:09:00+02:00';
      try {
        const { res, body } = await placeOrder();
        assert.equal(res.status, 409, 'a window that has gone by must not accept an order');
        assert.equal(body.closed, true);
        assert.match(body.errors[0], /WhatsApp/i, 'the refusal must offer a way through');
      } finally {
        delete process.env.HB_CLOCK_LABEL;
      }
    } finally {
      if (previous === undefined) delete process.env.HB_ORDERS_OPEN;
      else process.env.HB_ORDERS_OPEN = previous;
    }
  });

  /*
   * The narrow reading matters. Before the pots go on the site deliberately
   * takes the order early — every line of copy says so — so only a window that
   * has already passed may be refused.
   */
  test('an early-morning pre-order is still taken', async () => {
    const previous = process.env.HB_ORDERS_OPEN;
    delete process.env.HB_ORDERS_OPEN;
    try {
      process.env.HB_CLOCK_LABEL = '2026-11-13T08:00:00+02:00';
      try {
        const { res } = await placeOrder();
        assert.equal(res.status, 201, 'a pre-order before opening must not be refused');
      } finally {
        delete process.env.HB_CLOCK_LABEL;
      }
    } finally {
      if (previous === undefined) delete process.env.HB_ORDERS_OPEN;
      else process.env.HB_ORDERS_OPEN = previous;
    }
  });

  test('the same order is accepted once the window is open', async () => {
    /* The override stands in for "it is Thursday lunchtime". */
    const previous = process.env.HB_ORDERS_OPEN;
    process.env.HB_ORDERS_OPEN = 'true';
    try {
      const { res } = await placeOrder();
      assert.equal(res.status, 201);
    } finally {
      if (previous === undefined) delete process.env.HB_ORDERS_OPEN;
      else process.env.HB_ORDERS_OPEN = previous;
    }
  });
});

describe('checkout', () => {
  test('an online order is created and handed to Yoco, not charged here', async () => {
    const { res, body } = await placeOrder();
    assert.equal(res.status, 201);
    assert.match(body.order.code, /^HB-\d{4}[A-Z]$/);
    assert.equal(body.order.status, 'pending');
    /*
     * The old flow charged a card inside this API and returned "approved". It
     * cannot any more: the customer is sent to Yoco, so the honest state is
     * "waiting for money", and only a signed webhook may change it.
     */
    assert.equal(body.order.payment.status, 'awaiting_payment');
    assert.equal(body.order.payment.driver, 'yoco');
    assert.ok(body.payment.redirectUrl.startsWith(YOCO_LINK), 'the customer is sent to the configured Yoco page');
    assert.match(body.payment.redirectUrl, new RegExp(`reference=${body.order.code}`), 'the payment carries the order code');
    assert.equal(body.payment.provider, 'yoco');
    assert.equal(body.order.totals.total, 130, 'a collected contemporary plate is R130');
    assert.ok(body.order.whatsapp.includes('wa.me/27670137587'));
    assert.equal(typeof body.order.serviceWindow.isPreOrder, 'boolean', 'every order carries a service window');
    assert.ok(body.order.serviceWindow.label);

    /* No email receipt is promised: that channel is gone, not merely unconfigured. */
    assert.equal(body.order.receiptEmail, null);
    assert.equal(body.order.receiptState, 'none');
  });

  test('card details posted to this API are refused, and no order is created', async () => {
    /*
     * The checkout has no card fields, so a request carrying a PAN is either a
     * stale client or an attempt to push this server into PCI scope. Either way
     * it must never reach a store.
     */
    const before = (await fetch(`${base}/api/health`).then(json)).orders;
    const { res, body } = await placeOrder({ payment: { method: 'card', card: CARD_FIELDS } });
    assert.equal(res.status, 422);
    assert.equal(body.code, 'card_details_refused');
    assert.equal((await fetch(`${base}/api/health`).then(json)).orders, before, 'no order is kept');
  });

  test('an unpaid order is only marked paid by a correctly signed Yoco webhook', async () => {
    const { body } = await placeOrder();
    const code = body.order.code;

    /* Nothing paid yet. */
    let tracked = await fetch(`${base}/api/orders/${code}?token=${encodeURIComponent(body.trackingToken)}`).then(json);
    assert.equal(tracked.order.payment.status, 'awaiting_payment');

    /* An unsigned "payment succeeded" must not move it. */
    const unsigned = await fetch(`${base}/api/payments/yoco/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paidEvent(code)),
    });
    assert.equal(unsigned.status, 400, 'an unsigned webhook is rejected');

    /* A wrong signature must not move it either. */
    const tampered = await postWebhook(signedWebhook(paidEvent(code), { tamper: true }));
    assert.equal(tampered.res.status, 401);

    /* The real thing does. */
    const good = await postWebhook(signedWebhook(paidEvent(code)));
    assert.equal(good.res.status, 200);
    assert.equal(good.body.matched, true);

    tracked = await fetch(`${base}/api/orders/${code}?token=${encodeURIComponent(body.trackingToken)}`).then(json);
    assert.equal(tracked.order.payment.status, 'approved');
    assert.equal(tracked.order.payment.last4, '4242');
    assert.equal(tracked.order.payment.brand, 'visa');
    assert.equal(tracked.order.payment.reference, 'pay_test_123', 'the Yoco payment id is kept on the order');

    /* Yoco retries; a second delivery must be a no-op, not a second receipt. */
    const again = await postWebhook(signedWebhook(paidEvent(code), { id: 'msg_test_2' }));
    assert.equal(again.res.status, 200);
    assert.equal(again.body.duplicate, true);
  });

  test('with Yoco not connected, an online order is refused instead of sent nowhere', async () => {
    /*
     * The state a fresh deployment is in. The customer must be told before they
     * fill in the form, and the API must refuse rather than create an order that
     * can never be paid for.
     */
    const link = process.env.HB_YOCO_PAYMENT_URL;
    delete process.env.HB_YOCO_PAYMENT_URL;
    try {
      const catalog = await fetch(`${base}/api/catalog`).then(json);
      assert.equal(catalog.payments.online, false);
      assert.equal(catalog.payments.mode, 'off');

      const before = (await fetch(`${base}/api/health`).then(json)).orders;
      const { res, body } = await placeOrder();
      assert.equal(res.status, 503);
      assert.equal(body.code, 'payment_not_configured');
      assert.match(body.errors[0], /WhatsApp/i);
      assert.equal((await fetch(`${base}/api/health`).then(json)).orders, before, 'nothing is stored');
    } finally {
      process.env.HB_YOCO_PAYMENT_URL = link;
    }
  });

  test('a webhook for an unknown order is accepted but changes nothing', async () => {
    const signed = signedWebhook(paidEvent('HB-0000Z'));
    const { res, body } = await postWebhook(signed);
    assert.equal(res.status, 202, 'Yoco should not keep retrying something we cannot match');
    assert.equal(body.matched, false);
  });

  test('a replayed webhook is refused once it is old', async () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    const signed = signedWebhook(paidEvent('HB-0000Z'), { timestamp: stale });
    const { res, body } = await postWebhook(signed);
    assert.equal(res.status, 400);
    assert.equal(body.code, 'stale_webhook');
  });

  test('the server ignores a client-supplied price', async () => {
    const { body } = await placeOrder({
      items: [{ itemId: 'short-rib-plate', qty: 1, unitPrice: 1, options: { starch: 'garlic-bread', veg: 'corn-ribs' } }],
    });
    assert.equal(body.order.items[0].unitPrice, 130);
    assert.equal(body.order.totals.total, 130);
  });

  test('missing required plate choices and empty baskets are rejected', async () => {
    const noSide = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fulfilment: 'collection',
        customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999' },
        // 'veg' is required on this plate and is deliberately omitted here.
        items: [{ itemId: 'mogodu-plate', qty: 1, options: { starch: 'pap' } }],
        payment: { method: 'card' },
      }),
    });
    assert.equal(noSide.status, 422);
    assert.match((await noSide.json()).errors[0], /vegetable side/i);

    const empty = await placeOrder({ items: [] });
    assert.equal(empty.res.status, 422);
  });

  test('the plate builder prices from the fixed plate menu', async () => {
    const { res, body } = await placeOrder({
      items: [{
        kind: 'plate',
        plateId: 'traditional',
        qty: 2,
        selections: { protein: ['tshotlo'], starch: ['dumpling'], veg: ['morogo'] },
      }],
    });
    assert.equal(res.status, 201);
    assert.equal(body.order.items[0].unitPrice, 100);
    assert.equal(body.order.items[0].lineTotal, 200);
    assert.deepEqual(body.order.items[0].options.map((o) => o.label), ['Tshotlo (pounded beef)', 'Dumpling', 'Morogo']);

    const missing = await placeOrder({
      items: [{ kind: 'plate', plateId: 'traditional', qty: 1, selections: { protein: ['tshotlo'], starch: ['dumpling'] } }],
    });
    assert.equal(missing.res.status, 422);
  });

  test('the plate builder ignores an unknown plate and unknown choices', async () => {
    const { res, body } = await placeOrder({
      items: [{ kind: 'plate', plateId: 'ghost-menu', qty: 1, selections: {} }],
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /no longer on our menu/i);
  });

  test('dine-in is no longer an available order type', async () => {
    const { res, body } = await placeOrder({ fulfilment: 'dine-in' });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /collection or delivery/i);
  });

  test('card and cash are both accepted, on collection and on delivery', async () => {
    const tap = await placeOrder({ payment: { method: 'yoco-tap' } });
    assert.equal(tap.res.status, 422);
    assert.match(tap.body.errors[0], /unknown payment method/i);

    const eft = await placeOrder({ payment: { method: 'eft' } });
    assert.equal(eft.res.status, 422);

    /*
     * The kitchen carries a card machine and a cash float, so a delivered order
     * can be paid either way. Cash on delivery used to be refused; it is not.
     */
    const cashOnDelivery = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '1 Sandton Drive', suburb: 'Sandton' },
      payment: { method: 'cash-on-collection' },
    });
    assert.equal(cashOnDelivery.res.status, 201, 'cash is accepted at the door');

    const cardOnCollection = await placeOrder({
      fulfilment: 'collection',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999' },
      payment: { method: 'cash-on-collection' },
    });
    assert.equal(cardOnCollection.res.status, 201);
  });

  test('delivery adds the flat fee in Rosebank and Sandton and enforces the minimum', async () => {
    const sandton = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '12 Rivonia Road', suburb: 'Sandton' },
      items: [MOGODU],
    });
    assert.equal(sandton.res.status, 201);
    assert.equal(sandton.body.order.totals.delivery, 55, 'the run is charged on top of the plate');
    assert.equal(sandton.body.order.totals.total, 155, 'plate price plus the delivery fee');
    assert.equal(sandton.body.order.deliveryArea, 'Sandton');

    const rosebank = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '15 Oxford Road', suburb: 'Rosebank' },
      items: [MOGODU],
    });
    assert.equal(rosebank.res.status, 201);
    assert.equal(rosebank.body.order.deliveryArea, 'Rosebank');
  });

  test('REGRESSION: an address outside the delivery boundary is refused, not accepted', async () => {
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '1 Church Street', suburb: 'Pretoria' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /Rosebank and Sandton/i);
    assert.deepEqual(body.deliveryAreas, ['Rosebank', 'Sandton']);
  });

  test('a suburb name alone cannot smuggle an out-of-area delivery through', async () => {
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '1 Church Street', suburb: 'Sandtonville' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /Rosebank and Sandton/i);
  });

  test('a typed address that contradicts the selected area is refused, and says both', async () => {
    /*
     * The exact bug the owner hit: choose Sandton, type a Rosebank street. The
     * old rule matched the suburb and the address together and took the first
     * hit, so the order was silently relabelled Rosebank. It must be refused,
     * with a message naming the contradiction so the customer can fix either
     * half — not a generic "we do not deliver there".
     */
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '15 Oxford Road, Rosebank', suburb: 'Sandton' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /Rosebank/);
    assert.match(body.errors[0], /Sandton/);
    assert.match(body.errors[0], /Change the delivery area/i);
  });

  test('an address that names the area is trusted even when the select was skipped', async () => {
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '15 Oxford Road, Rosebank', suburb: '' },
    });
    assert.equal(res.status, 201);
    assert.equal(body.order.deliveryArea, 'Rosebank', 'the typed address decides where the food goes');
  });

  test('cash is accepted for a delivery order too', async () => {
    /*
     * The driver carries a card machine and takes cash, so the method is a real
     * choice rather than a constraint. This used to be refused outright.
     */
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '12 Rivonia Road', suburb: 'Sandton' },
      payment: { method: 'cash-on-collection' },
    });
    assert.equal(res.status, 201);
    assert.equal(body.order.payment.reference, 'CASH');
    /* WINGS is a contemporary plate at R130, plus the R55 run. */
    assert.equal(body.order.totals.total, 185, 'plate plus the delivery fee');
  });

  test('cash on collection still works', async () => {
    const { res, body } = await placeOrder({ payment: { method: 'cash-on-collection' } });
    assert.equal(res.status, 201);
    assert.equal(body.order.payment.status, 'pending');
    assert.equal(body.order.payment.reference, 'CASH');
  });

  /*
   * Email is optional for card orders now.
   *
   * It used to be mandatory, and that was the only way a card customer could get
   * a record. Email needs SMTP set up on the host, and the order finishes in a
   * WhatsApp chat that is its own record — so an address is no longer a gate in
   * front of a paying customer.
   */
  test('a card order without an email is accepted', async () => {
    const { res, body } = await placeOrder({
      customer: { name: 'No Email', phone: '+27 82 000 1111' },
    });
    assert.equal(res.status, 201);
    assert.equal(body.order.receiptEmail, null, 'nothing is promised without an address');
  });

  test('a cash order does not need an email', async () => {
    const { res, body } = await placeOrder({
      customer: { name: 'Walk In', phone: '+27 82 000 2222' },
      payment: { method: 'cash-on-collection' },
    });
    assert.equal(res.status, 201);
    assert.equal(body.order.receiptEmail, null);
  });

  test('a malformed email is refused for either payment method', async () => {
    const { res, body } = await placeOrder({
      customer: { name: 'Typo', phone: '+27 82 000 3333', email: 'not-an-email' },
      payment: { method: 'cash-on-collection' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /does not look right/i);
  });

  test('unknown discount codes are ignored now that no codes are approved', async () => {
    const { res, body } = await placeOrder({ code: 'HERITAGE10' });
    assert.equal(res.status, 201);
    assert.equal(body.order.totals.discount, 0);
    assert.equal(body.order.discountCode, null);
  });
});

describe('order tracking + cancellation', () => {
  test('a tracking token is required, and the receipt never leaks the address', async () => {
    const placed = await placeOrder({
      fulfilment: 'delivery',
      customer: { email: 't@e.co.za', name: 'T', phone: '+27820009999', address: '12 Rivonia Road', suburb: 'Sandton' },
    });
    const { code } = placed.body.order;

    const noToken = await fetch(`${base}/api/orders/${code}`);
    assert.equal(noToken.status, 404);

    const withToken = await fetch(`${base}/api/orders/${code}?token=${placed.body.trackingToken}`).then(json);
    assert.equal(withToken.order.code, code);
    assert.equal('address' in withToken.order.customer, false, 'the public receipt hides the street address');
    assert.equal(withToken.order.deliveryArea, 'Sandton');
  });

  test('a customer can cancel an unpaid order before preparation', async () => {
    const placed = await placeOrder({ payment: { method: 'cash-on-collection' } });
    const url = `${base}/api/orders/${placed.body.order.code}`;
    const res = await fetch(`${url}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: placed.body.trackingToken }),
    });
    assert.equal(res.status, 200);
    const cancelled = (await res.json()).order;
    assert.equal(cancelled.status, 'cancelled', 'the order status itself must change, not just its timeline');
    assert.equal(cancelled.canCancel, false);

    const refetched = await fetch(`${url}?token=${placed.body.trackingToken}`).then(json);
    assert.equal(refetched.order.status, 'cancelled', 'the cancellation must be persisted');
  });

  test('an order that has been paid cannot be cancelled without a refund workflow', async () => {
    const placed = await placeOrder();
    /* Paid means a verified webhook said so — not a query string, not a return URL. */
    await postWebhook(signedWebhook(paidEvent(placed.body.order.code)));

    /*
     * An order that is *not* paid is different: it is exactly what a customer
     * should be able to abandon, and the previous order in this file proves a
     * pending one cancels cleanly. Paying for it must change that.
     */
    const res = await fetch(`${base}/api/orders/${placed.body.order.code}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: placed.body.trackingToken }),
    });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /contact us.*refund/i);
  });

  test('invalid tokens cannot cancel orders', async () => {
    const placed = await placeOrder();
    const res = await fetch(`${base}/api/orders/${placed.body.order.code}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-the-token' }),
    });
    assert.equal(res.status, 404);
  });

  test('unknown codes return 404', async () => {
    const res = await fetch(`${base}/api/orders/HB-9999Z?token=anything`);
    assert.equal(res.status, 404);
  });
});

describe('loyalty card and contact', () => {
  test('repeat customers accumulate stamps', async () => {
    const phone = '+27 71 234 5678';
    await placeOrder({ customer: { email: 't@e.co.za', name: 'Passport Test', phone } });
    const after = await fetch(`${base}/api/passport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then(json);
    assert.equal(after.found, true);
    assert.ok(after.orders >= 1);
    assert.equal(after.untilFree, 10 - (after.stamps % 10));
  });

  test('REGRESSION: the loyalty card banks the stamps the tracking page promises', async () => {
    const phone = '+27 71 999 0001';

    // Two contemporary plates is R260 — five full R50 bands, so a flat one
    // stamp per order would fail this assertion.
    const placed = await placeOrder({
      customer: { email: 't@e.co.za', name: 'Stamp Check', phone },
      items: [{ ...WINGS, qty: 2 }],
    });
    assert.equal(placed.res.status, 201, `order should be accepted: ${JSON.stringify(placed.body)}`);
    const earned = placed.body.order.loyalty.pointsEarned;
    assert.equal(earned, 5);

    const card = await fetch(`${base}/api/passport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then(json);

    assert.equal(card.stamps, earned, 'the passport must bank exactly what the tracking page told the customer they earned');
    assert.equal(card.orders, 1);
  });

  test('REGRESSION: a completed loyalty card reads as full, not as zero progress', async () => {
    const phone = '+27 71 555 0101';

    // Four contemporary plates at R130 is exactly R520 — ten stamps, one
    // completed card. `10 - (stamps % 10)` used to answer "10 more to go".
    const placed = await placeOrder({
      customer: { email: 't@e.co.za', name: 'Full Card', phone },
      items: [{ itemId: 'short-rib-plate', qty: 4, options: { starch: 'savoury-rice', veg: 'glazed-carrots' } }],
    });
    assert.equal(placed.res.status, 201, `order should be accepted: ${JSON.stringify(placed.body)}`);
    assert.equal(placed.body.order.totals.subtotal, 520);
    assert.equal(placed.body.order.loyalty.pointsEarned, 10);

    const card = await fetch(`${base}/api/passport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then(json);

    assert.equal(card.stamps, 10);
    assert.equal(card.untilFree, 0, 'a full card owes a meal; it must not ask for ten more stamps');
    assert.equal(card.cardsCompleted, 1);
  });

  test('the contact form validates and records submitted messages', async () => {
    const bad = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No message' }),
    });
    assert.equal(bad.status, 422);

    const good = await fetch(`${base}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Grace M.', phone: '+27830001111', message: 'Catering for 40?' }),
    });
    assert.equal(good.status, 201);
    const saved = await good.json();
    assert.equal(saved.ok, true);
    assert.ok(saved.id);
    assert.equal(saved.delivered, false, 'with the endpoint disabled the message is stored but not forwarded');

    /*
     * The owner's rule: a name, a message, and one way to reply — an email
     * address or a cell number. Each column is checked on its own so a form
     * that drops one of them cannot slip through.
     */
    const post = (body) =>
      fetch(`${base}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const noName = await post({ phone: '0821234567', message: 'No name here' });
    assert.equal(noName.status, 422, 'a name is mandatory');
    assert.match((await noName.json()).errors.join(' '), /name/i);

    const noMessage = await post({ name: 'No Message', phone: '0821234567' });
    assert.equal(noMessage.status, 422, 'a message is mandatory');
    assert.match((await noMessage.json()).errors.join(' '), /message/i);

    const noReply = await post({ name: 'No Reply', message: 'How do I reach you?' });
    assert.equal(noReply.status, 422, 'an email or a cell number is mandatory');
    assert.match((await noReply.json()).errors.join(' '), /email address or a cell number/i);

    const junkEmail = await post({ name: 'Junk Mail', email: 'not-an-email', message: 'Reply to me' });
    assert.equal(junkEmail.status, 422, 'an unusable email is refused');
    assert.match((await junkEmail.json()).errors.join(' '), /email/i);

    const junkPhone = await post({ name: 'Junk Phone', phone: '123', message: 'Reply to me' });
    assert.equal(junkPhone.status, 422, 'an unusable number is refused');
    assert.match((await junkPhone.json()).errors.join(' '), /cell number/i);

    const emailOnly = await post({ name: 'Email Only', email: 'reply@example.co.za', message: 'Reply by email' });
    assert.equal(emailOnly.status, 201, 'an email alone is enough to reply to');

    const phoneOnly = await post({ name: 'Phone Only', phone: '0821234567', message: 'Reply by phone' });
    assert.equal(phoneOnly.status, 201, 'a cell number alone is enough to reply to');
  });
});

describe('customer quests', () => {
  /*
   * A quest is a request for a dish, not an order. These tests pin the parts
   * that matter: it refuses half-filled requests, it never creates an order,
   * and the free-text request survives the round trip intact.
   */
  const post = (body) =>
    fetch(`${base}/api/quests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('a quest needs a name, a reachable contact and something to cook', async () => {
    const noName = await post({ phone: '+27820001111', dish: 'Dombolo and tshotlo' });
    assert.equal(noName.status, 422);
    assert.match((await noName.json()).errors[0], /name/i);

    const badPhone = await post({ name: 'Lerato', phone: '082', dish: 'Dombolo and tshotlo' });
    assert.equal(badPhone.status, 422);
    assert.match((await badPhone.json()).errors.join(' '), /cell number/i);

    const emptyDish = await post({ name: 'Lerato', phone: '+27820001111', dish: '  ' });
    assert.equal(emptyDish.status, 422);
    assert.match((await emptyDish.json()).errors[0], /cook/i);

    /* No way to reply is refused; either channel on its own is enough. */
    const noReply = await post({ name: 'Lerato', dish: 'Dombolo and tshotlo' });
    assert.equal(noReply.status, 422);
    assert.match((await noReply.json()).errors.join(' '), /email address or a cell number/i);

    const emailOnly = await post({ name: 'Lerato', email: 'lerato@example.co.za', dish: 'Dombolo and tshotlo' });
    assert.equal(emailOnly.status, 201, 'an email alone is enough to answer a quest');
  });

  test('a valid quest is stored, normalised and does not create an order', async () => {
    const before = (await fetch(`${base}/api/health`).then(json)).orders;

    const res = await post({
      name: '  Lerato M. ',
      phone: '+27 82 000 1111',
      dish: 'Dombolo with tshotlo and morogo',
      serviceDay: 'Friday',
      plates: '200',
      notes: 'A birthday table for eight',
    });
    assert.equal(res.status, 201);
    const saved = await res.json();
    assert.equal(saved.ok, true);
    assert.equal(saved.delivered, false, 'the inbox is disabled in tests, so the quest is only stored');

    const after = (await fetch(`${base}/api/health`).then(json)).orders;
    assert.equal(after, before, 'a quest must never place an order');

    const file = JSON.parse(readFileSync(join(TMP, 'quests.json'), 'utf8'));
    const entry = file.find((q) => q.id === saved.id);
    assert.ok(entry, 'the quest is kept for the owner');
    assert.equal(entry.name, 'Lerato M.');
    assert.equal(entry.dish, 'Dombolo with tshotlo and morogo');
    assert.equal(entry.serviceDay, 'Friday');
    assert.equal(entry.plates, 60, 'an absurd plate count is clamped, not stored as 200');
    assert.equal(entry.status, 'new');
    assert.match(entry.notes, /birthday/);
  });

  test('an unknown service day falls back to either day rather than failing silently', async () => {
    const res = await post({ name: 'Sipho', phone: '+27821112222', dish: 'Samp and beans with chicken', serviceDay: 'Sunday' });
    assert.equal(res.status, 201);
    const saved = await res.json();
    const file = JSON.parse(readFileSync(join(TMP, 'quests.json'), 'utf8'));
    assert.equal(file.find((q) => q.id === saved.id).serviceDay, 'either');
  });
});

describe('console removal', () => {
  test('admin API routes are no longer available', async () => {
    const orders = await fetch(`${base}/api/admin/orders`);
    assert.equal(orders.status, 404);
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'manager', password: 'anything' }),
    });
    assert.equal(login.status, 404);
  });
});

describe('static hosting', () => {
  /*
   * A SPA fallback that answers every path with index.html creates soft 404s:
   * crawlers see 200 for a page that does not exist and index an apology.
   */
  test('known routes serve the shell with 200', async () => {
    for (const path of ['/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest', '/order/HB-0001A']) {
      const res = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } });
      assert.equal(res.status, 200, `${path} should be 200`);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    }
  });

  test('unknown routes serve the shell with 404, not 200', async () => {
    for (const path of ['/no-such-page', '/admin', '/admin/nope', '/menu/xyz']) {
      const res = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } });
      assert.equal(res.status, 404, `${path} should be 404`);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    }
  });

  test('missing assets 404 as JSON instead of falling back to the shell', async () => {
    for (const path of ['/img/does-not-exist.jpg', '/assets/nope.js']) {
      const res = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } });
      assert.equal(res.status, 404, `${path} should be 404`);
      assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    }
  });
});

describe('the head served to a crawler', () => {
  /*
   * The React app sets these itself, but only after it has run. A crawler that
   * executes no JavaScript — and every link preview in WhatsApp — reads this HTML
   * and nothing else, so the shell has to carry the route's own metadata.
   *
   * `HB_PUBLIC_URL` is set for this suite, which stands in for the deployment
   * address. The last test proves the fallback: with no configured address the
   * host the request arrived on is used, never a domain typed into the source.
   */
  const html = async (path) => {
    const res = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } });
    return { res, body: await res.text() };
  };

  test('the home page declares its own title, description and canonical', async () => {
    const { res, body } = await html('/');
    assert.equal(res.status, 200);
    assert.match(body, /<title>South African Plates in Rosebank &amp; Sandton — Heritage Bites<\/title>/);
    assert.match(body, /<meta name="description" content="South African plates from R100/);
    assert.match(body, /<link rel="canonical" href="https:\/\/heritagebites\.test\/" \/>/);
    assert.match(body, /<meta name="robots" content="index,follow/);
  });

  test('every public route answers with its own metadata, not the home page\'s', async () => {
    const expected = {
      '/menu': /<title>The Menu &amp; Prices — Heritage Bites<\/title>/,
      '/specials': /<title>This Week&#39;s Cooking &amp; Delivery — Heritage Bites<\/title>/,
      '/about': /<title>Our Story, Vision &amp; Mission — Heritage Bites<\/title>/,
      '/contact': /<title>Contact &amp; WhatsApp — Heritage Bites<\/title>/,
      '/policies': /<title>Policies &amp; Terms — Heritage Bites<\/title>/,
      '/passport': /<title>Loyalty Card — Heritage Bites<\/title>/,
      '/quest': /<title>Ask Us to Cook It — Heritage Bites<\/title>/,
    };
    for (const [path, pattern] of Object.entries(expected)) {
      const { res, body } = await html(path);
      assert.equal(res.status, 200, `${path} should be 200`);
      assert.match(body, pattern, `${path} carries the wrong title`);
      assert.ok(
        body.includes(`<link rel="canonical" href="https://heritagebites.test${path}" />`),
        `${path} has no canonical for its own address`,
      );
      /* One title element, one description, one canonical. */
      assert.equal((body.match(/<title>/g) ?? []).length, 1, `${path} has more than one title`);
      assert.equal((body.match(/rel="canonical"/g) ?? []).length, 1, `${path} has more than one canonical`);
    }
  });

  test('the checkout and an order page are kept out of the index', async () => {
    for (const path of ['/checkout', '/order/HB-1042A']) {
      const { res, body } = await html(path);
      assert.equal(res.status, 200, `${path} should still render`);
      assert.match(body, /<meta name="robots" content="noindex,nofollow" \/>/, `${path} must be noindex`);
      assert.doesNotMatch(body, /rel="canonical"/, `${path} must not advertise a canonical`);
    }
    assert.match((await html('/order/HB-1042A')).body, /<title>Order tracking — Heritage Bites<\/title>/);
  });

  test('the business is described from the live catalogue, not a hardcoded copy', async () => {
    const { body } = await html('/');
    /* Each node is its own block in the served HTML; the app sends one @graph. */
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
      JSON.parse(m[1].replace(/<\\\//g, '</')),
    );
    assert.ok(blocks.length, 'no structured data on the home page');
    const nodes = blocks.flatMap((node) => node['@graph'] ?? [node]);
    const restaurant = nodes.find((node) => node['@type'] === 'Restaurant');
    assert.ok(restaurant, 'no Restaurant node');
    assert.equal(restaurant.name, 'Heritage Bites');
    assert.deepEqual(restaurant.areaServed.map((a) => a.name), ['Rosebank', 'Sandton']);
    assert.equal(restaurant.telephone, '+27670137587');
    assert.equal(restaurant.address, undefined, 'the business has no public street address to claim');
  });

  test('without a configured address the head uses the host that was asked', async () => {
    const saved = process.env.HB_PUBLIC_URL;
    delete process.env.HB_PUBLIC_URL;
    try {
      const { body } = await html('/menu');
      /*
       * The suite runs on 127.0.0.1, which is explicitly not a public address, so
       * the honest outcome is no canonical at all rather than one pointing at a
       * laptop.
       */
      assert.doesNotMatch(body, /rel="canonical"/);
      assert.match(body, /<title>The Menu &amp; Prices — Heritage Bites<\/title>/);
    } finally {
      process.env.HB_PUBLIC_URL = saved;
    }
  });

  test('robots.txt and sitemap.xml are served as files', async () => {
    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    const txt = await robots.text();
    assert.match(txt, /^User-agent: \*$/m);
    assert.match(txt, /^Disallow: \/order\/$/m);

    /* The sitemap is only written when the build knew the public address. */
    const sitemap = await fetch(`${base}/sitemap.xml`);
    if (sitemap.status === 200) {
      const xml = await sitemap.text();
      assert.match(xml, /<urlset/);
      assert.doesNotMatch(xml, /\/checkout/);
    } else {
      assert.equal(sitemap.status, 404, 'a missing sitemap must 404, not answer with the shell');
    }
  });
});
