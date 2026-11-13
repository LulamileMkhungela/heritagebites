import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { orderCode, loyaltyPointsFor, applyDiscountCode, deliveryFeeCents, computeTotals, toCents, fromCents } from './pricing.js';
import { canTransition, customerCanCancel, nextStatuses, buildTimeline, ORDER_FLOW } from './orders.js';
import { buildWhatsAppMessage, whatsappLink } from './notify.js';

/*
 * Payments are no longer tested here: the card form, its Luhn validation and the
 * offline sandbox charge are gone, replaced by the Yoco hand-off. Everything
 * about taking money now lives in server/lib/payments.test.js and the webhook
 * flow in server/integration.test.js.
 */

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

  test('delivery is charged on top of the plates and enforces the R100 minimum', () => {
    // Collection pays the plate price; delivery adds the flat Rosebank/Sandton fee.
    const s = { deliveryFlat: 55, freeDeliveryAbove: 300, minDeliveryOrder: 100 };
    assert.equal(deliveryFeeCents(9900, s), -1, 'below the R100 minimum');
    assert.equal(deliveryFeeCents(10000, s), 5500, 'one plate delivered still pays the run');
    assert.equal(deliveryFeeCents(13000, s), 5500);
    assert.equal(deliveryFeeCents(29000, s), 5500);
    assert.equal(deliveryFeeCents(30000, s), 0, 'free from R300');
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
