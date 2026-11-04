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

/** Longest single line the plugin accepts is 1,024 characters; keep well under. */
const MAX_LINE = 400;

const money = (value) => `R${Number(value || 0).toFixed(2)}`;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Cut on a word boundary rather than mid-word, and say something was cut. */
function clip(text, limit = MAX_LINE) {
  const value = clean(text);
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const PAYMENT_NAME = {
  card: 'Card (Yoco)',
  'cash-on-collection': 'Cash on collection',
};

const PAYMENT_STATUS = {
  approved: 'paid',
  /* What a card order reads from the moment it is placed until Yoco's signed
     webhook says otherwise. "awaiting_payment" on a lock screen is jargon. */
  awaiting_payment: 'to be paid',
  pending: 'to be paid',
  declined: 'not paid',
  refunded: 'refunded',
  cancelled: 'cancelled',
};

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
  const configured = clean(store.load('settings', {})?.orderWhatsappFormspreeUrl);
  return configured || null;
}

/* ------------------------------ Formatting ----------------------------- */

/**
 * When the order was placed, in the kitchen's own time zone.
 *
 * The server may run anywhere; a UTC timestamp would tell the kitchen an order
 * arrived at 11:12 when the customer pressed pay at 13:12.
 */
function placedLine(order) {
  const at = order?.createdAt ? new Date(order.createdAt) : null;
  if (!at || Number.isNaN(at.getTime())) return 'time unavailable';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function typeLine(order) {
  const parts = [order?.fulfilment === 'delivery' ? 'Delivery' : 'Collection'];
  if (order?.fulfilment === 'delivery' && clean(order?.customer?.suburb)) {
    parts.push(clean(order.customer.suburb));
  }
  /* Outside the window the site still takes orders, so say which window it is for. */
  if (order?.serviceWindow?.isPreOrder) parts.push('pre-order');
  return parts.join(' · ');
}

function paymentLine(order) {
  const method = PAYMENT_NAME[order?.payment?.method] ?? 'Payment';
  const status = PAYMENT_STATUS[order?.payment?.status]
    || clean(order?.payment?.status).replace(/_/g, ' ')
    || 'pending';
  return `${method} · ${status}`;
}

/**
 * The basket on one line.
 *
 * WhatsApp is a glance, not a receipt: every line item would push past the six
 * lines the template has, so lines are joined with middots and the detail stays in
 * the email ticket. Options are kept — a plate with the wrong starch is a remake.
 */
export function itemsLine(order) {
  const items = order?.items ?? [];
  if (!items.length) return 'Basket unavailable — open the Formspree submission';
  const plates = items.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
  const lines = items.map((item) => {
    const options = item?.options?.length ? ` (${item.options.map((option) => clean(option?.label)).join(', ')})` : '';
    return `${Number(item?.qty || 0)}× ${clean(item?.name)}${options}`;
  });
  const head = plates === 1 ? '1 plate' : `${plates} plates`;
  return clip(`${head}: ${lines.join(' · ')}`);
}

/**
 * Where the food goes, plus the customer's note.
 *
 * The collection point is still being confirmed by the business, so the alert does
 * not invent a street address — it says what the site says, and the kitchen
 * confirms by WhatsApp as usual.
 */
export function whereLine(order) {
  const parts = [];
  if (order?.fulfilment === 'delivery') {
    /*
     * Most addresses the customer types already end in the suburb they then pick
     * from the list. Printing it twice reads like a stutter on a phone screen.
     */
    const address = clean(order?.customer?.address);
    const suburb = clean(order?.customer?.suburb);
    const where = address && suburb && !new RegExp(`\\b${suburb}\\b`, 'i').test(address)
      ? `${address}, ${suburb}`
      : address;
    parts.push(`Deliver: ${where || 'address to confirm with the customer'}`);
  } else {
    parts.push('Collect: Standard Bank, Rosebank/Sandton');
  }
  const notes = clean(order?.customer?.notes);
  if (notes) parts.push(`Notes: ${notes}`);
  return clip(parts.join(' · '));
}

/**
 * The payload Formspree receives.
 *
 * Every key is always present with a readable fallback. Formspree leaves a line
 * blank when a submission has no such field, and a blank line in the middle of a
 * six-line template is worse than the word "none".
 */
export function buildOrderWhatsAppAlert(order) {
  const code = clean(order?.code) || 'HB-????';
  const email = clean(order?.customer?.email);
  const totals = order?.totals ?? {};

  return {
    /* Formspree special fields: the email notification's subject and reply-to. */
    _subject: `Heritage Bites order ${code} — ${typeLine(order)}`,
    ...(email ? { _replyto: email } : {}),

    /* The fields the WhatsApp template inserts, one placeholder each. */
    code,
    when: placedLine(order),
    type: clip(typeLine(order)),
    items: itemsLine(order),
    pay: clip(paymentLine(order)),
    total: money(totals.total),
    name: clip(clean(order?.customer?.name) || 'Name not supplied'),
    phone: clip(clean(order?.customer?.phone) || 'Phone not supplied'),
    where: whereLine(order),

    /* Not in the message; they make the Formspree submission readable on its own. */
    service: clip(order?.serviceWindow?.label ?? ''),
    source: 'heritagebites.co.za/checkout',
  };
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
