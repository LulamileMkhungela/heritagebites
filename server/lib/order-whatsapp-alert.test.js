/**
 * The WhatsApp order alert (Formspree → WhatsApp plugin).
 *
 * These are deliberately offline: the one thing a notification test must never do
 * is buzz a real phone or spend a real submission, so every send here goes to a
 * stubbed `fetch`.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* The settings fallback is read from HB_DATA_DIR, fixed at import time. */
process.env.NODE_ENV = 'test';
process.env.HB_DATA_DIR = mkdtempSync(join(tmpdir(), 'hb-wa-alert-test-'));
delete process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL;

const {
  buildOrderWhatsAppAlert,
  itemsLine,
  orderWhatsAppEndpoint,
  sendOrderWhatsAppAlert,
  whereLine,
} = await import('./order-whatsapp-alert.js');
const { store } = await import('./store.js');

const ORDER = {
  code: 'HB-2041',
  createdAt: '2026-11-06T11:12:00.000Z',
  fulfilment: 'delivery',
  serviceWindow: { label: 'Friday 6 November, 12:00–13:30', isPreOrder: false },
  payment: { method: 'card', status: 'approved' },
  items: [
    { qty: 2, name: 'Beef Stew', options: [{ label: 'Pap' }, { label: 'Chakalaka' }], lineTotal: 200 },
    { qty: 1, name: 'Grilled Chicken', options: [{ label: 'Savoury Rice' }], lineTotal: 130 },
  ],
  totals: { subtotal: 330, delivery: 0, discount: 0, total: 330 },
  customer: {
    name: 'Thandi Mokoena',
    phone: '082 123 4567',
    email: 'thandi@example.com',
    address: '24 Bath Avenue, Rosebank',
    suburb: 'Rosebank',
    notes: 'Extra chilli on the side',
  },
};

/** Replace `fetch` for one test, recording calls; returns the recorded array. */
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Silence and count console.error for one test. */
function stubConsoleError() {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.error = original; } };
}

describe('endpoint configuration', () => {
  beforeEach(() => {
    store.save('settings', { orderWhatsappFormspreeUrl: 'https://formspree.io/f/seeded' });
    delete process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL;
  });

  afterEach(() => {
    delete process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL;
  });

  test('falls back to the seeded setting when no environment override exists', () => {
    assert.equal(orderWhatsAppEndpoint(), 'https://formspree.io/f/seeded');
  });

  test('the environment override wins', () => {
    process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL = 'https://formspree.io/f/from-env';
    assert.equal(orderWhatsAppEndpoint(), 'https://formspree.io/f/from-env');
  });

  test('an empty override switches the channel off, even with a setting present', () => {
    process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL = '';
    assert.equal(orderWhatsAppEndpoint(), null, 'tests must never post to the real form');
  });

  test('whitespace is not a configured endpoint', () => {
    store.save('settings', { orderWhatsappFormspreeUrl: '   ' });
    assert.equal(orderWhatsAppEndpoint(), null);
  });
});

describe('the message', () => {
  const payload = buildOrderWhatsAppAlert(ORDER);

  test('carries every placeholder the template inserts', () => {
    for (const field of ['code', 'when', 'type', 'items', 'pay', 'total', 'name', 'phone', 'where']) {
      assert.equal(typeof payload[field], 'string', `${field} must always be present`);
      assert.ok(payload[field].length > 0, `${field} must never be blank — Formspree prints the line anyway`);
    }
  });

  test('reads the way the kitchen needs it to read', () => {
    assert.equal(payload.code, 'HB-2041');
    assert.equal(payload.total, 'R330.00');
    assert.equal(payload.type, 'Delivery · Rosebank');
    assert.equal(payload.pay, 'Card (Yoco) · paid');
    assert.equal(payload.name, 'Thandi Mokoena');
    assert.equal(payload.phone, '082 123 4567');
    assert.equal(payload.items, '3 plates: 2× Beef Stew (Pap, Chakalaka) · 1× Grilled Chicken (Savoury Rice)');
    assert.equal(payload.where, 'Deliver: 24 Bath Avenue, Rosebank · Notes: Extra chilli on the side');
  });

  test('shows the local time, not the server time', () => {
    /* 11:12 UTC is 13:12 in Johannesburg. */
    assert.match(payload.when, /13:12/);
  });

  test('says pre-order when the window has passed', () => {
    const pre = buildOrderWhatsAppAlert({ ...ORDER, serviceWindow: { isPreOrder: true } });
    assert.match(pre.type, /pre-order/);
  });

  test('a card order waiting on Yoco reads as "to be paid", not gateway jargon', () => {
    const pending = buildOrderWhatsAppAlert({ ...ORDER, payment: { method: 'card', status: 'awaiting_payment' } });
    assert.equal(pending.pay, 'Card (Yoco) · to be paid');
  });

  test('a collection order names the collection point and invents no address', () => {
    const collect = buildOrderWhatsAppAlert({
      ...ORDER,
      fulfilment: 'collection',
      customer: { ...ORDER.customer, address: undefined, suburb: undefined, notes: '' },
    });
    assert.equal(collect.type, 'Collection');
    assert.match(collect.where, /Collect: Standard Bank, Rosebank\/Sandton/);
    assert.doesNotMatch(collect.where, /Deliver/);
  });

  test('missing customer details are words, not blank lines', () => {
    const bare = buildOrderWhatsAppAlert({
      ...ORDER,
      payment: {},
      customer: { name: '', phone: '', notes: '' },
    });
    assert.equal(bare.name, 'Name not supplied');
    assert.equal(bare.phone, 'Phone not supplied');
    assert.equal(bare.pay, 'Payment · pending');
    assert.equal(bare._replyto, undefined, 'no address means no reply-to');
    assert.doesNotMatch(bare.where, /Notes:/);
  });

  test('an order with no items says so instead of printing an empty line', () => {
    assert.match(itemsLine({ items: [] }), /Basket unavailable/);
  });

  test('a long basket is clipped, not dropped or refused by WhatsApp', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      qty: 1,
      name: `Dish number ${i} with a fairly long name`,
      options: [{ label: 'Pap' }, { label: 'Chakalaka' }],
      lineTotal: 100,
    }));
    const line = itemsLine({ items: many });
    assert.ok(line.length <= 401, `line was ${line.length} characters`);
    assert.match(line, /…$/);
    assert.match(line, /^40 plates:/);
  });

  test('carries no tracking token and no card data', () => {
    const json = JSON.stringify(buildOrderWhatsAppAlert({
      ...ORDER,
      trackingTokenHash: 'abc123',
      payment: { method: 'card', status: 'approved', card: { number: '4242424242424242', cvc: '123' } },
    }));
    assert.doesNotMatch(json, /4242/, 'a card number must never reach a third party');
    assert.doesNotMatch(json, /trackingToken/);
    assert.doesNotMatch(json, /abc123/);
  });

  test('the Formspree special fields make the emailed copy reply to the customer', () => {
    assert.equal(payload._replyto, 'thandi@example.com');
    assert.match(payload._subject, /HB-2041/);
  });
});

describe('sending', () => {
  let stub;
  let logs;

  beforeEach(() => {
    process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL = 'https://formspree.io/f/test-form';
    logs = stubConsoleError();
  });

  afterEach(() => {
    stub?.restore();
    stub = null;
    logs.restore();
    delete process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL;
  });

  test('posts the payload as JSON and reports delivery', async () => {
    stub = stubFetch(async () => new Response('{"ok":true}', { status: 200 }));

    const result = await sendOrderWhatsAppAlert(ORDER);

    assert.deepEqual(result, { delivered: true });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, 'https://formspree.io/f/test-form');
    assert.equal(stub.calls[0].options.method, 'POST');
    assert.match(stub.calls[0].options.headers['Content-Type'], /application\/json/);
    const sent = JSON.parse(stub.calls[0].options.body);
    assert.equal(sent.code, 'HB-2041');
    assert.equal(sent.items, '3 plates: 2× Beef Stew (Pap, Chakalaka) · 1× Grilled Chicken (Savoury Rice)');
  });

  test('a rejected submission is reported, not thrown', async () => {
    stub = stubFetch(async () => new Response('quota exceeded', { status: 402 }));

    const result = await sendOrderWhatsAppAlert(ORDER);

    assert.deepEqual(result, { delivered: false, reason: 'http_402' });
    assert.match(logs.lines.join('\n'), /HB-2041/);
  });

  test('an unreachable form service is reported, not thrown', async () => {
    stub = stubFetch(async () => { throw new Error('connect ECONNREFUSED'); });

    const result = await sendOrderWhatsAppAlert(ORDER);

    assert.deepEqual(result, { delivered: false, reason: 'network_error' });
    assert.match(logs.lines.join('\n'), /ECONNREFUSED/);
  });

  test('nothing is sent when no endpoint is configured', async () => {
    process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL = '';
    stub = stubFetch(async () => { throw new Error('must not be called'); });

    const result = await sendOrderWhatsAppAlert(ORDER);

    assert.deepEqual(result, { delivered: false, reason: 'not_configured' });
    assert.equal(stub.calls.length, 0);
  });

  test('an order without a code is not sent, so the log can never lie about which order', async () => {
    stub = stubFetch(async () => { throw new Error('must not be called'); });

    assert.deepEqual(await sendOrderWhatsAppAlert({}), { delivered: false, reason: 'no_order' });
    assert.equal(stub.calls.length, 0);
  });
});

describe('where the food goes', () => {
  test('a delivery with no suburb still names the address', () => {
    assert.equal(
      whereLine({ fulfilment: 'delivery', customer: { address: '9 Oxford Road' } }),
      'Deliver: 9 Oxford Road',
    );
  });

  test('a delivery with no address asks for one instead of printing "undefined"', () => {
    assert.match(whereLine({ fulfilment: 'delivery', customer: {} }), /address to confirm/);
  });
});
