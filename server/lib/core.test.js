import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { luhnValid, detectBrand, expiryValid, chargeCard, SANDBOX_CARDS, paymentDriver, paymentConfig } from './payments.js';
import { orderCode, loyaltyPointsFor, applyDiscountCode, deliveryFeeCents, computeTotals, toCents, fromCents } from './pricing.js';
import { canTransition, customerCanCancel, nextStatuses, buildTimeline, ORDER_FLOW } from './orders.js';
import { buildWhatsAppMessage, whatsappLink } from './notify.js';

/* ----------------------------- Payments ------------------------------- */

describe('card validation', () => {
  test('accepts valid Luhn numbers', () => {
    assert.equal(luhnValid('4242 4242 4242 4242'), true);
    assert.equal(luhnValid('5555555555554444'), true);
    assert.equal(luhnValid('378282246310005'), true);
  });

  test('rejects numbers that fail the checksum or are too short', () => {
    assert.equal(luhnValid('4242424242424241'), false);
    assert.equal(luhnValid('1234567812345678'), false);
    assert.equal(luhnValid('424242'), false);
    assert.equal(luhnValid(''), false);
    assert.equal(luhnValid(null), false);
  });

  test('detects brands', () => {
    assert.equal(detectBrand('4242424242424242'), 'visa');
    assert.equal(detectBrand('5555555555554444'), 'mastercard');
    assert.equal(detectBrand('2223000010181375'), 'mastercard');
    assert.equal(detectBrand('378282246310005'), 'amex');
    assert.equal(detectBrand('9999999999999999'), 'unknown');
  });

  test('expiry must be a real month in the future', () => {
    const now = new Date('2026-10-16T00:00:00Z');
    assert.equal(expiryValid('12/30', now), true);
    assert.equal(expiryValid('10/26', now), true); // current month is still valid
    assert.equal(expiryValid('09/26', now), false);
    assert.equal(expiryValid('13/30', now), false);
    assert.equal(expiryValid('1230', now), false);
  });
});

describe('chargeCard', () => {
  const card = (number) => ({ number, expiry: '12/32', cvc: '123', holder: 'Test User' });

  test('approves a valid sandbox card and returns masked details only', async () => {
    const r = await chargeCard({ amount: 140, card: card(SANDBOX_CARDS.approvedVisa) });
    assert.equal(r.status, 'approved');
    assert.equal(r.last4, '4242');
    assert.equal(r.brand, 'visa');
    assert.ok(r.authCode);
    assert.equal(r.amount, 140);
    assert.equal(r.number, undefined, 'full PAN must never be echoed back');
  });

  test('declines the declined test card', async () => {
    const r = await chargeCard({ amount: 140, card: card(SANDBOX_CARDS.declined) });
    assert.equal(r.status, 'declined');
    assert.equal(r.code, 'card_declined');
  });

  test('flags 3-D Secure', async () => {
    const r = await chargeCard({ amount: 140, card: card(SANDBOX_CARDS.requires3ds) });
    assert.equal(r.status, 'requires_action');
  });

  test('rejects bad input before talking to a gateway', async () => {
    assert.equal((await chargeCard({ amount: 0, card: card(SANDBOX_CARDS.approvedVisa) })).status, 'invalid');
    assert.equal((await chargeCard({ amount: 10, card: card('4242424242424241') })).code, 'invalid_number');
    assert.equal((await chargeCard({ amount: 10, card: { number: SANDBOX_CARDS.approvedVisa, expiry: '01/20', cvc: '123' } })).code, 'invalid_expiry');
    assert.equal((await chargeCard({ amount: 10, card: { number: SANDBOX_CARDS.approvedVisa, expiry: '12/32', cvc: '1' } })).code, 'invalid_cvc');
  });

  test('defaults to the sandbox driver without YOCO_SECRET_KEY', () => {
    assert.equal(paymentDriver(), 'sandbox');
    assert.equal(paymentConfig().hostedCheckout, false);
    assert.equal(paymentConfig().cashOnCollection, true);
    assert.equal(paymentConfig().cashOnDelivery, false);
  });

  test('with live keys the server refuses raw card data and reports hosted checkout', async () => {
    const before = process.env.YOCO_SECRET_KEY;
    process.env.YOCO_SECRET_KEY = 'sk_test_dummy';
    process.env.YOCO_PUBLIC_KEY = 'pk_test_dummy';
    try {
      assert.equal(paymentDriver(), 'yoco');
      assert.equal(paymentConfig().hostedCheckout, true);
      assert.equal(paymentConfig().publicKey, 'pk_test_dummy', 'the publishable key may reach the browser');
      assert.equal(JSON.stringify(paymentConfig()).includes('sk_test_dummy'), false, 'the secret key must never be exposed');

      const result = await chargeCard({ amount: 130, card: card(SANDBOX_CARDS.approvedVisa) });
      assert.equal(result.status, 'invalid');
      assert.equal(result.code, 'hosted_checkout_required');
    } finally {
      if (before === undefined) delete process.env.YOCO_SECRET_KEY;
      else process.env.YOCO_SECRET_KEY = before;
      delete process.env.YOCO_PUBLIC_KEY;
    }
  });
});

/* ------------------------------ Pricing ------------------------------- */

describe('pricing', () => {
  test('order codes are sequential, readable and carry a check letter', () => {
    assert.equal(orderCode(1), 'HB-0001B');
    assert.equal(orderCode(147), 'HB-0147D');
    assert.notEqual(orderCode(1), orderCode(2));
    assert.match(orderCode(987), /^HB-\d{4}[A-Z]$/);
    assert.equal(orderCode(0), 'HB-0001B', 'bad input falls back to 1');
  });

  test('cents conversion never drifts', () => {
    assert.equal(toCents(0.1) + toCents(0.2), 30);
    assert.equal(fromCents(1999), 19.99);
  });

  test('loyalty awards one stamp per R50', () => {
    assert.equal(loyaltyPointsFor(49.99), 0);
    assert.equal(loyaltyPointsFor(50), 1);
    assert.equal(loyaltyPointsFor(140), 2);
  });

  test('discount codes respect minimums, caps and inactive flags', () => {
    const codes = [
      { code: 'HERITAGE10', type: 'percent', value: 10, active: true, minSubtotalCents: 15000, maxDiscountCents: 5000 },
      { code: 'KOTA20', type: 'flat', value: 20, active: true, minSubtotalCents: 6000 },
      { code: 'STAFF', type: 'percent', value: 25, active: false },
    ];
    assert.equal(applyDiscountCode('HERITAGE10', 10000, codes).ok, false);
    assert.equal(applyDiscountCode('HERITAGE10', 20000, codes).discountCents, 2000);
    assert.equal(applyDiscountCode('heritage10', 90000, codes).discountCents, 5000, 'cap must apply');
    assert.equal(applyDiscountCode('KOTA20', 6000, codes).discountCents, 2000);
    assert.equal(applyDiscountCode('KOTA20', 4000, codes).ok, false);
    assert.equal(applyDiscountCode('STAFF', 90000, codes).reason, 'inactive');
    assert.equal(applyDiscountCode('NOPE', 90000, codes).reason, 'unknown_code');
    assert.equal(applyDiscountCode('', 90000, codes).reason, 'no_code');
  });

  test('delivery fee is free above the threshold and blocks tiny orders', () => {
    const s = { deliveryFlat: 35, freeDeliveryAbove: 250, minDeliveryOrder: 120 };
    assert.equal(deliveryFeeCents(11900, s), -1);
    assert.equal(deliveryFeeCents(15000, s), 3500);
    assert.equal(deliveryFeeCents(25000, s), 0);
  });

  test('the confirmed delivery rules charge no fee and enforce the R100 minimum', () => {
    // Owner-approved: delivery is included in the plate price, minimum R100.
    const s = { deliveryFlat: 0, freeDeliveryAbove: 0, minDeliveryOrder: 100 };
    assert.equal(deliveryFeeCents(9900, s), -1, 'below the R100 minimum');
    assert.equal(deliveryFeeCents(10000, s), 0);
    assert.equal(deliveryFeeCents(13000, s), 0);
  });

  test('totals are additive and discount cannot go negative', () => {
    const t = computeTotals({
      items: [{ unitPrice: 85, qty: 2 }, { unitPrice: 30, qty: 1 }],
      settings: { currency: 'ZAR' },
      discountCents: 2000,
      deliveryCents: 3500,
    });
    assert.equal(t.subtotal, 200);
    assert.equal(t.total, 215);
    const over = computeTotals({ items: [{ unitPrice: 10, qty: 1 }], settings: {}, discountCents: 5000, deliveryCents: 0 });
    assert.equal(over.total, 0);
  });
});

/* ---------------------------- Order lifecycle ------------------------- */

describe('order lifecycle', () => {
  test('only legal transitions are allowed', () => {
    assert.equal(canTransition('pending', 'accepted'), true);
    assert.equal(canTransition('pending', 'ready'), false);
    assert.equal(canTransition('pending', 'cancelled'), true);
    assert.equal(canTransition('completed', 'cancelled'), false, 'completed orders are final');
    assert.equal(canTransition('out-for-delivery', 'cancelled'), false, 'a dispatched rider cannot be cancelled');
  });

  test('every status has an exit path except the terminal ones', () => {
    for (const s of ORDER_FLOW) {
      if (s === 'completed') continue;
      assert.ok(nextStatuses(s).length > 0, `${s} must have a next status`);
    }
    assert.deepEqual(nextStatuses('completed'), []);
  });

  test('customers may only cancel before the pot goes on the fire', () => {
    assert.equal(customerCanCancel('pending'), true);
    assert.equal(customerCanCancel('accepted'), true);
    assert.equal(customerCanCancel('preparing'), false, 'customers cannot self-cancel after preparation begins');
    assert.equal(customerCanCancel('out-for-delivery'), false);
    assert.equal(customerCanCancel('completed'), false);
    // A future protected order workflow may cancel mid-cook (e.g. an ingredient ran out).
    assert.equal(canTransition('preparing', 'cancelled'), true);
  });

  test('timeline marks progress and honours fulfilment', () => {
    const order = {
      status: 'preparing',
      fulfilment: 'collection',
      timeline: [{ status: 'pending', at: 'x' }, { status: 'accepted', at: 'y' }, { status: 'preparing', at: 'z' }],
    };
    const tl = buildTimeline(order);
    assert.equal(tl.filter((s) => s.done).length, 3);
    assert.equal(tl.find((s) => s.current).status, 'preparing');
    assert.equal(tl.some((s) => s.status === 'out-for-delivery'), false, 'collection timelines omit delivery stages');
    assert.deepEqual(tl.map((s) => s.status), ['pending', 'accepted', 'preparing'], 'only reached statuses are shown');
  });

});

/* ------------------------- WhatsApp & order messages ----------------- */

describe('ordering channels', () => {
  const basket = {
    code: 'HB-0145B',
    items: [{ name: 'Mogodu & Samp', qty: 1, lineTotal: 85, options: [{ label: 'Large' }] }],
    totals: { subtotal: 85, delivery: 35, discount: 0, total: 120 },
    fulfilment: 'delivery',
    customer: { name: 'Nomsa M.', phone: '+27 82 555 0142', address: '41 Florence Ribeiro Ave' },
  };

  test('WhatsApp ticket contains the basket, total and address', () => {
    const msg = buildWhatsAppMessage(basket);
    assert.match(msg, /HB-0145B/);
    assert.match(msg, /1 × Mogodu & Samp \(Large\) — R85\.00/);
    assert.match(msg, /Total: R120\.00/);
    assert.match(msg, /Deliver to: 41 Florence Ribeiro Ave/);
  });

  test('WhatsApp link targets the restaurant number and URL-encodes the body', () => {
    const url = whatsappLink('27670137587', buildWhatsAppMessage(basket));
    assert.ok(url.startsWith('https://wa.me/27670137587?text='));
    assert.ok(!url.includes(' '));
    assert.ok(decodeURIComponent(url).includes('Heritage Bites order'));
  });
});
