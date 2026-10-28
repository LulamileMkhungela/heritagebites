/**
 * Integration tests against the real Express handlers over HTTP.
 * These exercise the public routes the storefront calls.
 *
 * The catalogue asserted here is the owner-approved content: two plate menus
 * (R100 traditional / R130 contemporary), Thursday and Friday service between
 * 12:00 and 13:30, delivery in Rosebank and Sandton with delivery included.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.HB_ORDER_EMAIL_ENABLED = 'false';
// Keep the contact endpoint offline: the Formspree call is exercised by its own
// unit test with a stub, never against the real inbox from a test run.
process.env.HB_CONTACT_FORMSPREE_URL = '';
// Tests run against a throwaway data directory so they never touch the demo
// dataset that the storefront shows.
const TMP = mkdtempSync(join(tmpdir(), 'hb-test-'));
process.env.HB_DATA_DIR = TMP;

const { app } = await import('./index.js');
const { processNextOrderAlert } = await import('./lib/order-notifications.js');

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

const GOOD_CARD = { number: '4242424242424242', expiry: '12/32', cvc: '123', holder: 'Test User' };
const BAD_CARD = { number: '4000000000000002', expiry: '12/32', cvc: '123', holder: 'Test User' };

const WINGS = { itemId: 'wings-plate', qty: 1, options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' } };
const MOGODU = { itemId: 'mogodu-plate', qty: 1, options: { starch: 'pap', veg: 'braised-cabbage' } };

async function placeOrder(overrides = {}) {
  const body = {
    channel: 'card',
    fulfilment: 'collection',
    customer: { name: 'Integration Test', phone: '+27 82 000 9999', email: 'i@e.co.za' },
    items: [WINGS],
    payment: { method: 'card', card: GOOD_CARD },
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
    assert.equal(c.settings.deliveryFlat, 0, 'delivery is included in the plate price');
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
    assert.equal(c.payments.driver, 'sandbox');
    assert.equal(c.payments.cashOnCollection, true);
    assert.equal(c.payments.cashOnDelivery, false);
    assert.equal(c.contact.inboxConfigured, false, 'the endpoint is disabled in tests');
  });

  test('the kitchen archive is a look, never stock: no prices and no order path', async () => {
    const c = await fetch(`${base}/api/catalog`).then(json);

    assert.ok(Array.isArray(c.comingSoon), 'the archive categories are published for the view-only section');
    assert.ok(c.comingSoon.length >= 5, 'the categories the site carried before the two-tier menu are back');
    assert.deepEqual(
      c.comingSoon.map((cat) => cat.id),
      ['heritage-pots', 'modern-favourites', 'kasi-fast-food', 'morning-heritage', 'sides-relishes'],
    );

    const archived = c.comingSoon.flatMap((cat) => cat.items);
    assert.ok(archived.length >= 10);

    for (const cat of c.comingSoon) {
      assert.ok(cat.name && cat.tagline && cat.blurb, `archive category is incomplete: ${cat.id}`);
      for (const item of cat.items) {
        assert.equal('price' in item, false, `${item.id} must carry no price — the archive is not for sale`);
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

describe('checkout', () => {
  test('an approved card creates a paid order with a trackable code', async () => {
    const { res, body } = await placeOrder();
    assert.equal(res.status, 201);
    assert.match(body.order.code, /^HB-\d{4}[A-Z]$/);
    assert.equal(body.order.status, 'pending');
    assert.equal(body.order.payment.status, 'approved');
    assert.equal(body.order.payment.last4, '4242');
    assert.equal(body.order.totals.total, 130, 'a contemporary plate is R130, delivery included');
    assert.ok(body.order.whatsapp.includes('wa.me/27670137587'));
    assert.equal(typeof body.order.serviceWindow.isPreOrder, 'boolean', 'every order carries a service window');
    assert.ok(body.order.serviceWindow.label);

    const jobs = JSON.parse(readFileSync(join(TMP, 'orderNotificationJobs.json'), 'utf8'));
    const alert = jobs.find((job) => job.orderCode === body.order.code);
    assert.ok(alert, 'a saved order should enqueue a background owner email alert');
    assert.equal(alert.status, 'waiting_config', 'missing SMTP credentials must not block checkout');
    assert.equal(alert.attempts, 0);

    const sentEmails = [];
    await processNextOrderAlert({
      sendMail: async (email) => {
        sentEmails.push(email);
        return { messageId: 'mock-message-id' };
      },
    }, { from: 'alerts@example.co.za', to: 'heritagebitesfood@gmail.com' });
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'heritagebitesfood@gmail.com');
    assert.match(sentEmails[0].text, new RegExp(body.order.code));
    assert.match(sentEmails[0].text, /Chicken Wings Plate/);
    assert.doesNotMatch(sentEmails[0].text, new RegExp(body.trackingToken));

    const sentJob = JSON.parse(readFileSync(join(TMP, 'orderNotificationJobs.json'), 'utf8'))
      .find((job) => job.orderCode === body.order.code);
    assert.equal(sentJob.status, 'sent');
    assert.equal(sentJob.messageId, 'mock-message-id');
  });

  test('a declined card returns 402 and creates nothing', async () => {
    const before = (await fetch(`${base}/api/health`).then(json)).orders;
    const queuedBefore = JSON.parse(readFileSync(join(TMP, 'orderNotificationJobs.json'), 'utf8')).length;
    const { res, body } = await placeOrder({ payment: { method: 'card', card: BAD_CARD } });
    assert.equal(res.status, 402);
    assert.equal(body.code, 'card_declined');
    const afterCount = (await fetch(`${base}/api/health`).then(json)).orders;
    const queuedAfter = JSON.parse(readFileSync(join(TMP, 'orderNotificationJobs.json'), 'utf8')).length;
    assert.equal(afterCount, before, 'a failed payment must not create an order');
    assert.equal(queuedAfter, queuedBefore, 'a failed payment must not send an order alert');
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
        customer: { name: 'T', phone: '+27820009999' },
        // 'veg' is required on this plate and is deliberately omitted here.
        items: [{ itemId: 'mogodu-plate', qty: 1, options: { starch: 'pap' } }],
        payment: { method: 'card', card: GOOD_CARD },
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

  test('only card and cash on collection are accepted payment methods', async () => {
    const tap = await placeOrder({ payment: { method: 'yoco-tap' } });
    assert.equal(tap.res.status, 422);
    assert.match(tap.body.errors[0], /unknown payment method/i);

    const eft = await placeOrder({ payment: { method: 'eft' } });
    assert.equal(eft.res.status, 422);

    const cashOnDelivery = await placeOrder({
      fulfilment: 'delivery',
      customer: { name: 'T', phone: '+27820009999', address: '1 Sandton Drive', suburb: 'Sandton' },
      payment: { method: 'cash-on-delivery' },
    });
    assert.equal(cashOnDelivery.res.status, 422, 'cash on delivery was not confirmed by the business');
  });

  test('delivery is free in Rosebank and Sandton and enforces the minimum', async () => {
    const sandton = await placeOrder({
      fulfilment: 'delivery',
      customer: { name: 'T', phone: '+27820009999', address: '12 Rivonia Road', suburb: 'Sandton' },
      items: [MOGODU],
    });
    assert.equal(sandton.res.status, 201);
    assert.equal(sandton.body.order.totals.delivery, 0, 'delivery is included in the plate price');
    assert.equal(sandton.body.order.totals.total, 100);
    assert.equal(sandton.body.order.deliveryArea, 'Sandton');

    const rosebank = await placeOrder({
      fulfilment: 'delivery',
      customer: { name: 'T', phone: '+27820009999', address: '15 Oxford Road', suburb: 'Rosebank' },
      items: [MOGODU],
    });
    assert.equal(rosebank.res.status, 201);
    assert.equal(rosebank.body.order.deliveryArea, 'Rosebank');
  });

  test('REGRESSION: an address outside the delivery boundary is refused, not accepted', async () => {
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { name: 'T', phone: '+27820009999', address: '1 Church Street', suburb: 'Pretoria' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /Rosebank and Sandton/i);
    assert.deepEqual(body.deliveryAreas, ['Rosebank', 'Sandton']);
  });

  test('a suburb name alone cannot smuggle an out-of-area delivery through', async () => {
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { name: 'T', phone: '+27820009999', address: '1 Church Street', suburb: 'Sandtonville' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /Rosebank and Sandton/i);
  });

  test('cash on collection cannot be used for a delivery order', async () => {
    const { res, body } = await placeOrder({
      fulfilment: 'delivery',
      customer: { name: 'T', phone: '+27820009999', address: '12 Rivonia Road', suburb: 'Sandton' },
      payment: { method: 'cash-on-collection' },
    });
    assert.equal(res.status, 422);
    assert.match(body.errors[0], /cash is only accepted on collection/i);
  });

  test('cash on collection still works', async () => {
    const { res, body } = await placeOrder({ payment: { method: 'cash-on-collection' } });
    assert.equal(res.status, 201);
    assert.equal(body.order.payment.status, 'pending');
    assert.equal(body.order.payment.reference, 'CASH');
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
      customer: { name: 'T', phone: '+27820009999', address: '12 Rivonia Road', suburb: 'Sandton' },
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

  test('a paid card order cannot be cancelled without a refund workflow', async () => {
    const placed = await placeOrder();
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
    await placeOrder({ customer: { name: 'Passport Test', phone } });
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
      customer: { name: 'Stamp Check', phone },
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
      customer: { name: 'Full Card', phone },
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

  test('a quest needs a name, a reachable number and something to cook', async () => {
    const noName = await post({ phone: '+27820001111', dish: 'Dombolo and tshotlo' });
    assert.equal(noName.status, 422);
    assert.match((await noName.json()).errors[0], /name/i);

    const badPhone = await post({ name: 'Lerato', phone: '082', dish: 'Dombolo and tshotlo' });
    assert.equal(badPhone.status, 422);
    assert.match((await badPhone.json()).errors[0], /cell number/i);

    const emptyDish = await post({ name: 'Lerato', phone: '+27820001111', dish: '  ' });
    assert.equal(emptyDish.status, 422);
    assert.match((await emptyDish.json()).errors[0], /cook/i);
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
