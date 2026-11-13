/**
 * The whole Yoco redirect, end to end, against a stand-in gateway.
 *
 * This is the test that answers "does the Checkout API really send the customer
 * to Yoco's page, and do they come back paid?" — without a Yoco account and
 * without a real card, because `scripts/yoco-sandbox.mjs` speaks the same three
 * exchanges as Yoco's API:
 *
 *   1. our server POSTs a checkout and gets a `redirectUrl` back (API mode);
 *   2. the browser leaves for that URL and the card is typed *there*, not here;
 *   3. the gateway signs a `payment.succeeded` webhook and then redirects to the
 *      `successUrl` our server chose;
 *   4. the order is `approved` — but only because of the signed webhook, never
 *      because the customer came back.
 *
 * The last point has its own assertion: a customer who returns without a webhook
 * must still see `awaiting_payment`. That is the difference between taking money
 * and giving away food.
 *
 * What this cannot prove is that payments.yoco.com behaves as documented; that
 * needs one real test-mode payment with an `sk_test_` key. See
 * docs/production-payments-yoco.md.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.HB_PUSH_DRY_RUN = 'true';
process.env.HB_RATE_LIMIT_MULTIPLIER = '50';
process.env.HB_CONTACT_FORMSPREE_URL = '';

const WEBHOOK_SECRET_RAW = 'yoco-sandbox-webhook-secret-0123456789';
const WEBHOOK_SECRET = `whsec_${Buffer.from(WEBHOOK_SECRET_RAW).toString('base64')}`;
process.env.HB_YOCO_WEBHOOK_SECRET = WEBHOOK_SECRET;

const TMP = mkdtempSync(join(tmpdir(), 'hb-yoco-sandbox-'));
process.env.HB_DATA_DIR = TMP;

let store;
let gateway;
let gatewayBase;
let server;
let base;

/** Start the stand-in Yoco and resolve once it prints the port it bound. */
function startGateway() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/yoco-sandbox.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, FAKE_YOCO_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('the stand-in gateway did not start in 10s')), 10_000);
    let buffered = '';
    const onData = (chunk) => {
      buffered += String(chunk);
      const match = /listening on (http:\/\/[^ ]+)/.exec(buffered);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[1].replace('0.0.0.0', '127.0.0.1') });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      buffered += String(chunk);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the stand-in gateway exited early (code ${code}): ${buffered.slice(0, 400)}`));
    });
  });
}

before(async () => {
  const started = await startGateway();
  gateway = started.child;
  gatewayBase = started.url;

  /*
   * API mode: a secret key plus the checkout endpoint pointed at the stand-in.
   * The app reads these per request, so setting them here is enough — and it
   * proves the code path that only ever runs with a real `sk_live_`/`sk_test_`
   * key in production.
   */
  process.env.HB_YOCO_SECRET_KEY = 'sk_test_sandbox_only';
  process.env.HB_YOCO_CHECKOUT_ENDPOINT = `${gatewayBase}/api/checkouts`;

  const { app } = await import('./index.js');
  /* The same store the server writes to, so what was saved can be inspected. */
  store = (await import('./lib/store.js')).store;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  /* The return trip has to point at the shop that is actually running. */
  process.env.HB_PUBLIC_URL = base;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
  gateway?.kill('SIGTERM');
  rmSync(TMP, { recursive: true, force: true });
});

const WINGS = {
  itemId: 'wings-plate',
  qty: 1,
  options: { baste: 'honey-soy', starch: 'potato-mash', veg: 'green-salad' },
};

/** Place a real order through the public API, the way the checkout does. */
async function placeCardOrder() {
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'card',
      fulfilment: 'collection',
      customer: { name: 'Sandbox Customer', phone: '+27 82 000 1234', email: 'sandbox@example.co.za' },
      items: [WINGS],
      payment: { method: 'card' },
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `order should be accepted, got ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** Read the order back the way the tracking page does. */
async function readOrder(code, token) {
  const res = await fetch(`${base}/api/orders/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  return body.order;
}

describe('Yoco Checkout API redirect (against a stand-in gateway)', () => {
  test('the site reports API mode, not a payment link', async () => {
    const res = await fetch(`${base}/api/payments/config`);
    const config = await res.json();
    assert.equal(res.status, 200);
    assert.equal(config.provider, 'yoco');
    assert.equal(config.online, true);
    assert.equal(config.mode, 'api');
    assert.equal(config.webhook, true);
    /* API mode pins the amount server-side; a link cannot. */
    assert.equal(config.exactAmount, true);
  });

  test('placing a card order hands the customer a Yoco redirectUrl', async () => {
    const body = await placeCardOrder();
    const { order } = body;

    assert.equal(order.payment.method, 'card');
    assert.equal(order.payment.status, 'awaiting_payment', 'nothing is paid until the webhook says so');
    assert.equal(order.payment.driver, 'yoco');

    /* The browser is sent away from this site, to the gateway's own page. */
    assert.ok(body.payment?.redirectUrl, 'the response must carry a redirectUrl for the browser');
    assert.ok(
      body.payment.redirectUrl.startsWith(gatewayBase),
      `expected a redirect to the gateway, got ${body.payment.redirectUrl}`,
    );
    assert.match(body.payment.redirectUrl, /\/pay\/ch_[a-f0-9]+$/);

    /* And the order carries the same URL, so the customer can resume later. */
    const reread = await readOrder(order.code, body.trackingToken);
    assert.equal(reread.payment.redirectUrl, body.payment.redirectUrl);
  });

  test('the redirect target is a payment page showing the order total, not our form', async () => {
    const body = await placeCardOrder();
    const page = await fetch(body.payment.redirectUrl);
    assert.equal(page.status, 200);
    const html = await page.text();

    const rands = (body.order.totals.totalCents / 100).toFixed(2);
    assert.ok(html.includes(`R ${rands}`), `the payment page should show R ${rands}`);
    assert.ok(html.includes(body.order.code), 'the payment page should show the order code as its reference');

    /* No card fields of ours live here — the card is typed on the payment page. */
    assert.ok(!/name="card|cvc|cardnumber/i.test(html), 'the site must not render card fields of its own');
  });

  test('paying on the payment page returns the customer and the signed webhook marks it paid', async () => {
    const body = await placeCardOrder();
    const { order, trackingToken } = body;

    /* What the customer's browser does after pressing Pay. `manual` keeps the
       303 visible instead of following it, so the return URL can be asserted. */
    const paid = await fetch(`${body.payment.redirectUrl}/pay`, { method: 'POST', redirect: 'manual' });
    assert.equal(paid.status, 303);
    const back = paid.headers.get('location');
    assert.ok(back?.startsWith(`${base}/order/${order.code}`), `should return to the order page, got ${back}`);
    assert.ok(back.includes(`token=${trackingToken}`), 'the return trip must carry the tracking token');

    /* The webhook is what actually marks it paid — and it was signed. */
    const after = await readOrder(order.code, trackingToken);
    assert.equal(after.payment.status, 'approved');
    assert.equal(after.payment.brand, 'visa');
    assert.equal(after.payment.last4, '1111');
    /* `paidAt` is kept on the order but not exposed publicly; read it back from
       the store to prove a paid order carries the moment it was paid. */
    const saved = store.load('orders', []).find((entry) => entry.code === order.code);
    assert.ok(saved?.payment?.paidAt, 'a paid order records when it was paid');
    /* The order's own history records the payment, which is what the kitchen and
       any later dispute read. */
    assert.ok(
      (saved?.timeline ?? []).some((entry) => /payment received/i.test(entry.note ?? '')),
      'the order history should record the payment',
    );
  });

  test('a declined card leaves the order awaiting payment', async () => {
    const body = await placeCardOrder();
    const { order, trackingToken } = body;

    const declined = await fetch(`${body.payment.redirectUrl}/decline`, { method: 'POST', redirect: 'manual' });
    assert.equal(declined.status, 303);

    const after = await readOrder(order.code, trackingToken);
    assert.equal(after.payment.status, 'awaiting_payment', 'a failed payment must not be treated as paid');

    /* And the customer can try again from the order page. */
    assert.ok(after.payment.redirectUrl, 'the payment link must survive a decline so the customer can retry');
  });

  test('coming back from the payment page without a webhook does not mark the order paid', async () => {
    const body = await placeCardOrder();
    const { order, trackingToken } = body;

    /* Exactly what an attacker would try: open the return URL directly. */
    const res = await fetch(`${base}/order/${encodeURIComponent(order.code)}?token=${encodeURIComponent(trackingToken)}`);
    assert.equal(res.status, 200);

    const after = await readOrder(order.code, trackingToken);
    assert.equal(after.payment.status, 'awaiting_payment');
  });

  test('a forged webhook signature is refused and changes nothing', async () => {
    const body = await placeCardOrder();
    const { order, trackingToken } = body;

    const res = await fetch(`${base}/api/payments/yoco/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': 'msg_forged',
        'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'webhook-signature': 'v1,not-a-real-signature',
      },
      body: JSON.stringify({
        type: 'payment.succeeded',
        payload: { id: 'pay_forged', amount: order.totals.totalCents, currency: 'ZAR', metadata: { orderCode: order.code } },
      }),
    });
    assert.equal(res.status, 401);

    const after = await readOrder(order.code, trackingToken);
    assert.equal(after.payment.status, 'awaiting_payment');
  });
});
