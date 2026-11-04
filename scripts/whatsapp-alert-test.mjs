#!/usr/bin/env node
/**
 * Send one sample order to the WhatsApp order-alert endpoint.
 *
 * The point is to answer two questions without placing a real order and paying for
 * it: does the endpoint answer, and what does the message look like on the phone?
 * The payload printed here is the source of the Formspree "Insert field" buttons,
 * so run this once before editing the message template — a field only appears in
 * that list after a submission has carried it.
 *
 *   node scripts/whatsapp-alert-test.mjs            # send it
 *   node scripts/whatsapp-alert-test.mjs --print    # show the payload, send nothing
 *   HB_ORDER_WHATSAPP_FORMSPREE_URL=https://formspree.io/f/xxxx node scripts/whatsapp-alert-test.mjs
 *
 * Each run is one submission, and the Free plan allows 50 a month, so this is a
 * setup tool, not a health check.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const printOnly = process.argv.includes('--print');

const { buildOrderWhatsAppAlert, orderWhatsAppEndpoint, sendOrderWhatsAppAlert } = await import(
  join(here, '..', 'server', 'lib', 'order-whatsapp-alert.js')
);

/** The same shape `/api/orders` saves, so the template is rehearsed on real fields. */
const sampleOrder = {
  code: 'HB-TEST',
  createdAt: new Date().toISOString(),
  fulfilment: 'delivery',
  serviceWindow: { label: 'Friday 6 November, 12:00–13:30', isPreOrder: false },
  payment: { method: 'card', status: 'approved' },
  items: [
    { qty: 2, name: 'Beef Stew', options: [{ label: 'Pap' }, { label: 'Chakalaka' }], lineTotal: 200 },
    { qty: 1, name: 'Grilled Chicken', options: [{ label: 'Savoury Rice' }, { label: 'Green Salad' }], lineTotal: 130 },
  ],
  totals: { subtotal: 330, delivery: 0, discount: 0, total: 330 },
  customer: {
    name: 'Thandi Mokoena',
    phone: '082 123 4567',
    email: 'thandi@example.com',
    address: '24 Bath Avenue, Rosebank',
    suburb: 'Rosebank',
    notes: 'Extra chilli on the side, please.',
  },
};

const endpoint = orderWhatsAppEndpoint();
console.log('Heritage Bites — WhatsApp order alert test');
console.log(`  endpoint: ${endpoint ?? 'NOT CONFIGURED (settings.orderWhatsappFormspreeUrl / HB_ORDER_WHATSAPP_FORMSPREE_URL)'}`);
console.log('');
console.log('Payload (these field names are what the WhatsApp template can insert):');
console.log(JSON.stringify(buildOrderWhatsAppAlert(sampleOrder), null, 2));
console.log('');

if (printOnly) {
  console.log('--print given: nothing was sent.');
  process.exit(endpoint ? 0 : 2);
}

if (!endpoint) {
  console.error('✗ No endpoint configured, so there is nothing to send to.');
  process.exit(2);
}

const result = await sendOrderWhatsAppAlert(sampleOrder);
if (!result.delivered) {
  console.error(`✗ Not delivered (${result.reason}).`);
  console.error('  402/403 usually means the Formspree monthly submission quota is spent;');
  console.error('  404 means the form ID is wrong; network_error means formspree.io was unreachable.');
  process.exit(1);
}

console.log('✓ Formspree accepted the submission.');
console.log('  If the WhatsApp plugin is connected on that form, the message is on the phone.');
console.log('  Check it against the template in docs/whatsapp-order-alerts.md.');
