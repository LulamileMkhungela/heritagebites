/**
 * WhatsApp order alerts, delivered through Formspree.
 *
 * Why this exists
 * ---------------
 * Web Push is the instant owner channel and email is the permanent record, but
 * both need something the kitchen may not have: push needs the site installed on
 * the phone and a permission granted, and email needs an app that actually
 * interrupts. WhatsApp is where a small food business already is, and Formspree's
 * WhatsApp plugin turns one form submission into one WhatsApp message on a number
 * the business verified.
 *
 * What this is not
 * ----------------
 * It is not an automated WhatsApp message to the *customer*. Formspree sends each
 * form to one number — the number the owner verified — and it cannot message a
 * customer's number, look up whether that number is on WhatsApp, or carry a
 * business-initiated template. Customer WhatsApp stays what it is on the receipt
 * page: a `wa.me` link the customer presses themselves (see `notify.js`), because
 * messaging customers at scale needs Meta's Cloud API, business verification,
 * approved templates, opt-in and a card on file.
 *
 * The quota is real
 * -----------------
 * Every alert is one Formspree submission. The free plan is 50 a month across the
 * whole account, which one busy service weekend can pass, and once it is spent the
 * alert simply stops. That is acceptable here only because this channel is a
 * *spare*: an order is saved and the push/email path runs whether or not Formspree
 * answers. So the send is fire-and-forget, never awaited by checkout, and never
 * allowed to fail an order.
 *
 * Config
 * ------
 *   HB_ORDER_WHATSAPP_FORMSPREE_URL   wins when set; an empty string switches the
 *                                     channel off (tests do exactly that, so a test
 *                                     run can never buzz a real phone)
 *   settings.orderWhatsappFormspreeUrl  seeded fallback, for hosts with no env
 *
 * The field names below are the ones the WhatsApp message template references. They
 * are chosen to read well in the template, because Formspree labels nothing on its
 * own — see docs/whatsapp-order-alerts.md for the six-line template to paste.
 */
import { store } from './store.js';

/** One message, one attempt. A slow form service must not hold a socket open. */
const TIMEOUT_MS = 8000;

/**
 * The message itself lives in `shared/order-alert.js`, because the GitHub Pages
 * preview builds the same payload for a test alert. One builder means a rehearsal
 * cannot drift from the real message.
 */
export { buildOrderWhatsAppAlert, itemsLine, whereLine } from '../../shared/order-alert.js';
import { buildOrderWhatsAppAlert } from '../../shared/order-alert.js';

/**
 * Where the endpoint is configured.
 *
 * Read at call time, not at import time: the test suite switches this off with an
 * empty `HB_ORDER_WHATSAPP_FORMSPREE_URL` after the modules are already loaded.
 */
export function orderWhatsAppEndpoint() {
  if (process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL !== undefined) {
    const override = String(process.env.HB_ORDER_WHATSAPP_FORMSPREE_URL).trim();
    return override || null;
  }
  const configured = String(store.load('settings', {})?.orderWhatsappFormspreeUrl ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return configured || null;
}

/* ------------------------------- Sending ------------------------------- */

/**
 * Send one order to Formspree, where the WhatsApp plugin turns it into a message.
 *
 * Never throws and never rejects: the caller is a checkout that has already taken
 * the order. A returned `delivered: false` is for logging and the health page, not
 * for the customer.
 */
export async function sendOrderWhatsAppAlert(order) {
  const endpoint = orderWhatsAppEndpoint();
  if (!endpoint) return { delivered: false, reason: 'not_configured' };
  if (!order?.code) return { delivered: false, reason: 'no_order' };

  const payload = buildOrderWhatsAppAlert(order);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      /*
       * 402/403 here usually means the Free plan's 50 submissions are spent, and
       * 429 means Formspree is rate-limiting. Both are quota problems, not bugs,
       * so the log says so instead of implying the code is broken.
       */
      console.error(
        `[whatsapp-order] Formspree rejected order ${payload.code} (${res.status}): ${detail.slice(0, 160)}`,
      );
      return { delivered: false, reason: `http_${res.status}` };
    }
    return { delivered: true };
  } catch (error) {
    console.error(
      `[whatsapp-order] could not alert order ${payload.code}: ${String(error?.message ?? error).slice(0, 200)}`,
    );
    return { delivered: false, reason: 'network_error' };
  }
}
