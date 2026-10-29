/**
 * Tests for the Yoco adapter — the part of taking money that can go wrong
 * silently.
 *
 * Two rules matter more than any others here and are covered first:
 *
 *   1. Nothing may mark an order paid except a correctly signed webhook. A
 *      return URL is a string a customer can type; a signature is not.
 *   2. With no Yoco configuration the site must say so, rather than sending a
 *      customer to a dead page.
 *
 * No network: the API path is exercised against a stubbed `fetch`, so this suite
 * runs on a locked-down machine and never touches the business's Yoco account.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  DEFAULT_CHECKOUT_ENDPOINT,
  paymentConfig,
  paymentDriver,
  readYocoEvent,
  startYocoPayment,
  verifyYocoWebhook,
  yocoMode,
} from './payments.js';

const PAYMENT_ENV = ['HB_YOCO_PAYMENT_URL', 'HB_YOCO_SECRET_KEY', 'HB_YOCO_CHECKOUT_ENDPOINT', 'HB_YOCO_WEBHOOK_SECRET'];

/** Put the payment environment back the way it was after each test. */
afterEach(() => {
  for (const key of PAYMENT_ENV) delete process.env[key];
});

const secret = 'unit-test-webhook-secret';
const webhookSecret = `whsec_${Buffer.from(secret).toString('base64')}`;

/** Sign a body the way Yoco does, so verification is tested against the real format. */
function sign(body, { id = 'msg_1', timestamp = Math.floor(Date.now() / 1000), key = secret } = {}) {
  const signature = createHmac('sha256', Buffer.from(key)).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` };
}

describe('configuration', () => {
  test('with nothing set, online payment is off and says so', () => {
    const config = paymentConfig();
    assert.equal(config.provider, 'yoco');
    assert.equal(config.online, false);
    assert.equal(config.mode, 'off');
    assert.equal(paymentDriver(), 'off');
    assert.equal(yocoMode(), null);
    /* Cash on collection is a business fact, not a payment setting. */
    assert.equal(config.cashOnCollection, true);
    assert.equal(config.cashOnDelivery, false);
  });

  test('a payment link is enough to take money', () => {
    process.env.HB_YOCO_PAYMENT_URL = 'https://pay.yoco.com/heritagebites';
    assert.equal(yocoMode(), 'link');
    const config = paymentConfig();
    assert.equal(config.online, true);
    /* A link cannot pin the amount — the customer types it on Yoco's page. */
    assert.equal(config.exactAmount, false);
  });

  test('a secret key is preferred over a link, because it fixes the amount', () => {
    process.env.HB_YOCO_PAYMENT_URL = 'https://pay.yoco.com/heritagebites';
    process.env.HB_YOCO_SECRET_KEY = 'sk_test_123';
    assert.equal(yocoMode(), 'api');
    assert.equal(paymentConfig().exactAmount, true);
  });
});

describe('starting a payment', () => {
  test('nothing configured: refuses with advice instead of a dead link', async () => {
    const started = await startYocoPayment({ amountCents: 13000, orderCode: 'HB-1042A' });
    assert.equal(started.ok, false);
    assert.equal(started.code, 'payment_not_configured');
    assert.match(started.message, /WhatsApp/i);
  });

  test('link mode: the order code travels with the customer', async () => {
    process.env.HB_YOCO_PAYMENT_URL = 'https://pay.yoco.com/heritagebites';
    const started = await startYocoPayment({ amountCents: 13000, orderCode: 'HB-1042A' });
    assert.equal(started.ok, true);
    const url = new URL(started.redirectUrl);
    assert.equal(url.origin + url.pathname, 'https://pay.yoco.com/heritagebites');
    assert.equal(url.searchParams.get('reference'), 'HB-1042A');
    /* Pre-filled, so the customer confirms a figure instead of inventing one. */
    assert.equal(url.searchParams.get('amount'), '130.00');
  });

  test('link mode: the customer is sent back to their own order, without a tracking token', async () => {
    process.env.HB_YOCO_PAYMENT_URL = 'https://pay.yoco.com/heritagebites';
    const started = await startYocoPayment({
      amountCents: 13000,
      orderCode: 'HB-1042A',
      trackingToken: 'tok_abc',
      baseUrl: 'https://heritagebites.co.za/',
    });
    const url = new URL(started.redirectUrl);
    assert.equal(
      url.searchParams.get('redirectOnPaymentSuccess'),
      'https://heritagebites.co.za/order/HB-1042A',
      'the way back is the order page',
    );
    /*
     * No token: a payment link is a static page, the return address is stored by
     * Yoco, and the tracking token is the only thing protecting the order. The
     * browser remembers it instead (see Checkout.tsx).
     */
    assert.doesNotMatch(started.redirectUrl, /tok_abc|token=/);
  });

  test('link mode: a nonsense link is refused rather than followed', async () => {
    process.env.HB_YOCO_PAYMENT_URL = 'not a url';
    const started = await startYocoPayment({ amountCents: 13000, orderCode: 'HB-1042A' });
    assert.equal(started.ok, false);
    assert.equal(started.code, 'invalid_payment_url');
  });

  test('api mode: the amount is created server-side, with the order code in metadata', async (t) => {
    process.env.HB_YOCO_SECRET_KEY = 'sk_test_123';
    let seen = null;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ id: 'ch_1', redirectUrl: 'https://pay.yoco.com/checkout/ch_1' }) };
    });

    const started = await startYocoPayment({
      amountCents: 13000,
      currency: 'ZAR',
      orderCode: 'HB-1042A',
      trackingToken: 'tok_abc',
      baseUrl: 'https://heritagebites.co.za/',
    });

    assert.equal(started.ok, true);
    assert.equal(started.redirectUrl, 'https://pay.yoco.com/checkout/ch_1');
    assert.equal(started.reference, 'ch_1');
    assert.equal(seen.url, DEFAULT_CHECKOUT_ENDPOINT);
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.Authorization, 'Bearer sk_test_123');
    /* One checkout per order: a double tap cannot open a second payment. */
    assert.equal(seen.init.headers['Idempotency-Key'], 'hb-HB-1042A');
    assert.equal(seen.body.amount, 13000, 'Yoco takes cents');
    assert.equal(seen.body.currency, 'ZAR');
    assert.equal(seen.body.metadata.orderCode, 'HB-1042A');
    /* The way back is authenticated, so the customer is not asked for a token. */
    assert.match(seen.body.successUrl, /^https:\/\/heritagebites\.co\.za\/order\/HB-1042A\?token=tok_abc$/);
    assert.match(seen.body.cancelUrl, /token=tok_abc$/);
  });

  test('api mode: a refusal from Yoco is passed on, not swallowed', async (t) => {
    process.env.HB_YOCO_SECRET_KEY = 'sk_test_123';
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 401,
      json: async () => ({ errorCode: 'invalid_api_key', message: 'Invalid API key' }),
    }));
    const started = await startYocoPayment({ amountCents: 13000, orderCode: 'HB-1042A' });
    assert.equal(started.ok, false);
    assert.equal(started.code, 'invalid_api_key');
    assert.match(started.message, /Invalid API key/);
    assert.match(started.message, /Nothing was charged/);
  });

  test('api mode: a network failure still says nothing was charged', async (t) => {
    process.env.HB_YOCO_SECRET_KEY = 'sk_test_123';
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    const started = await startYocoPayment({ amountCents: 13000, orderCode: 'HB-1042A' });
    assert.equal(started.ok, false);
    assert.equal(started.code, 'network_error');
    assert.match(started.message, /Nothing was charged/);
  });

  test('an amount of zero is refused before any request is made', async () => {
    process.env.HB_YOCO_PAYMENT_URL = 'https://pay.yoco.com/heritagebites';
    const started = await startYocoPayment({ amountCents: 0, orderCode: 'HB-1042A' });
    assert.equal(started.ok, false);
    assert.equal(started.code, 'invalid_amount');
  });
});

describe('webhook verification', () => {
  const body = JSON.stringify({ type: 'payment.succeeded', payload: { metadata: { orderCode: 'HB-1042A' } } });

  test('a correctly signed webhook is accepted', () => {
    process.env.HB_YOCO_WEBHOOK_SECRET = webhookSecret;
    const result = verifyYocoWebhook({ rawBody: body, headers: sign(body) });
    assert.equal(result.ok, true);
    assert.equal(result.event.type, 'payment.succeeded');
  });

  test('a tampered body is refused', () => {
    process.env.HB_YOCO_WEBHOOK_SECRET = webhookSecret;
    const headers = sign(body);
    const tampered = body.replace('HB-1042A', 'HB-9999Z');
    const result = verifyYocoWebhook({ rawBody: tampered, headers });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'bad_signature');
    assert.equal(result.status, 401);
  });

  test('a wrong secret is refused', () => {
    process.env.HB_YOCO_WEBHOOK_SECRET = webhookSecret;
    const result = verifyYocoWebhook({ rawBody: body, headers: sign(body, { key: 'some-other-secret' }) });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'bad_signature');
  });

  test('an old signature is refused, so a captured request cannot be replayed', () => {
    process.env.HB_YOCO_WEBHOOK_SECRET = webhookSecret;
    const old = Math.floor(Date.now() / 1000) - 3600;
    const result = verifyYocoWebhook({ rawBody: body, headers: sign(body, { timestamp: old }) });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'stale_webhook');
  });

  test('an unsigned webhook is refused', () => {
    process.env.HB_YOCO_WEBHOOK_SECRET = webhookSecret;
    const result = verifyYocoWebhook({ rawBody: body, headers: {} });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'missing_signature');
  });

  test('with no webhook secret the site says so rather than trusting anything', () => {
    const result = verifyYocoWebhook({ rawBody: body, headers: sign(body) });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'webhook_not_configured');
    assert.equal(result.status, 503);
  });

  test('several signatures in the header are tried, so a secret can be rotated', () => {
    process.env.HB_YOCO_WEBHOOK_SECRET = webhookSecret;
    const headers = sign(body);
    headers['webhook-signature'] = `v1,${Buffer.from('wrong').toString('base64')} ${headers['webhook-signature']}`;
    const result = verifyYocoWebhook({ rawBody: body, headers });
    assert.equal(result.ok, true);
  });
});

describe('reading a webhook payload', () => {
  test('a succeeded payment carries the order code, brand and last four', () => {
    const event = readYocoEvent({
      type: 'payment.succeeded',
      payload: { id: 'pay_1', amount: 13000, metadata: { orderCode: 'HB-1042A' }, card: { brand: 'visa', last4: '4242' } },
    });
    assert.equal(event.paid, true);
    assert.equal(event.orderCode, 'HB-1042A');
    assert.equal(event.amountCents, 13000);
    assert.equal(event.last4, '4242');
    assert.equal(event.brand, 'visa');
  });

  test('anything that is not a success is not treated as paid', () => {
    for (const type of ['payment.failed', 'payment.cancelled', 'refund.succeeded', '']) {
      const event = readYocoEvent({ type, payload: { metadata: { orderCode: 'HB-1042A' } } });
      assert.equal(event.paid, false, `${type || '(empty)'} must not mark an order paid`);
    }
  });

  test('a payload with no order code reports that rather than guessing', () => {
    const event = readYocoEvent({ type: 'payment.succeeded', payload: { id: 'pay_1' } });
    assert.equal(event.orderCode, null);
  });
});
