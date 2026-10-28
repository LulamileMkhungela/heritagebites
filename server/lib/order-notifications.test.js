import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatOrderAlert } from './order-notifications.js';

describe('order email alert formatting', () => {
  const baseOrder = {
    code: 'HB-0123C',
    trackingTokenHash: 'must-not-appear-in-email',
    createdAt: '2026-10-19T09:30:00.000Z',
    status: 'pending',
    fulfilment: 'delivery',
    payment: { method: 'card', status: 'approved', last4: '4242', brand: 'visa' },
    serviceWindow: { label: 'Thursday 12:00–13:30', isPreOrder: true },
    items: [{
      qty: 2,
      name: 'Tshotlo',
      options: [{ label: 'Regular' }],
      lineTotal: 190,
    }],
    totals: { subtotal: 190, delivery: 0, discount: 0, total: 190 },
    customer: {
      name: 'Kemorego Test',
      phone: '+27 67 013 7587',
      email: 'customer@example.co.za',
      address: '12 Sample Road',
      suburb: 'Sandton',
      notes: 'Call on arrival',
    },
  };

  test('includes the order summary and delivery details but never a tracking secret', () => {
    const message = formatOrderAlert(baseOrder);
    assert.equal(message.subject, 'New Heritage Bites order HB-0123C');
    assert.match(message.text, /2 × Tshotlo \(Regular\): R190\.00/);
    assert.match(message.text, /Delivery address: 12 Sample Road/);
    assert.match(message.text, /Payment: Card \(Yoco\) \(approved\)/);
    assert.match(message.text, /Service window: Thursday 12:00–13:30 \(pre-order\)/);
    assert.match(message.text, /Delivery area: Sandton|TOTAL: R190\.00/);
    assert.match(message.text, /TOTAL: R190\.00/);
    // The last four digits are the only card detail allowed; the PAN and the
    // tracking secret must never be emailed.
    assert.doesNotMatch(message.text, /must-not-appear-in-email|trackingTokenHash|424242/);
  });

  test('does not include an address for a collection order', () => {
    const message = formatOrderAlert({
      ...baseOrder,
      fulfilment: 'collection',
      customer: { ...baseOrder.customer, address: 'Private address' },
    });
    assert.match(message.text, /Type: Collection/);
    assert.doesNotMatch(message.text, /Private address/);
  });
});
