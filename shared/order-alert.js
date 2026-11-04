/**
 * The shape of an order alert, shared by the server and the Pages preview.
 *
 * `server/lib/order-whatsapp-alert.js` posts this to Formspree after a real order
 * is saved; the static checkout posts the same fields for a **test** alert, so one
 * six-line WhatsApp template works for both and a rehearsal cannot drift from the
 * real thing. Nothing here touches the filesystem, the network or `process`, which
 * is what lets the browser import it directly.
 *
 * Field names are the template's contract — `docs/whatsapp-order-alerts.md`:
 *
 *   Heritage Bites — new order {{code}}
 *   {{when}} · {{type}}
 *   {{items}}
 *   {{pay}} · Total {{total}}
 *   {{name}} · {{phone}}
 *   {{where}}
 */

/** Longest single line the plugin accepts is 1,024 characters; keep well under. */
const MAX_LINE = 400;

export const money = (value) => `R${Number(value || 0).toFixed(2)}`;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Cut on a word boundary rather than mid-word, and say something was cut. */
export function clip(text, limit = MAX_LINE) {
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
 * When the order was placed, in the kitchen's own time zone.
 *
 * The browser and the server may both be anywhere; a UTC timestamp would tell the
 * kitchen an order arrived at 11:12 when the customer pressed pay at 13:12.
 */
export function placedLine(order) {
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

export function typeLine(order) {
  const parts = [order?.fulfilment === 'delivery' ? 'Delivery' : 'Collection'];
  if (order?.fulfilment === 'delivery' && clean(order?.customer?.suburb)) {
    parts.push(clean(order.customer.suburb));
  }
  /* Outside the window the site still takes orders, so say which window it is for. */
  if (order?.serviceWindow?.isPreOrder) parts.push('pre-order');
  return parts.join(' · ');
}

export function paymentLine(order) {
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
    /* The preview overrides this so a test submission says it is a test. */
    source: clip(order?.source ?? 'heritagebites.co.za/checkout'),
  };
}
