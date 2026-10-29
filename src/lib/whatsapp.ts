/**
 * One place that turns a basket into a WhatsApp message.
 *
 * Why this exists: the checkout shipped a "Send this basket on WhatsApp" button
 * whose link was just `https://wa.me/<number>` with no `text` parameter. WhatsApp
 * opened with an empty message box, so the customer had to retype the whole order
 * — and on the static preview build there is no checkout at all, which is exactly
 * where that button lives. Every WhatsApp order link in the app now goes through
 * here, so the message arrives pre-filled and the customer only has to press
 * send.
 *
 * Two rules the message has to keep:
 *   - It is assembled from the *cart lines* (name, choices, qty, line total), not
 *     from anything the kitchen would have to look up.
 *   - It stays short enough for a wa.me URL. WhatsApp clients silently drop very
 *     long `text` values, and a truncated order is worse than no order, so the
 *     line list is capped and the count says so.
 */
import { zar } from './format';
import type { CartLine, Fulfilment } from './types';

/** Used when the catalogue has not loaded yet or has no number configured. */
export const FALLBACK_WHATSAPP = '27670137587';

/** wa.me wants international digits only: no +, no spaces, no leading zero. */
export function waNumber(raw?: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return FALLBACK_WHATSAPP;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

export interface OrderMessageOptions {
  fulfilment?: Fulfilment;
  customer?: { name?: string; phone?: string; suburb?: string; address?: string; notes?: string } | null;
  /** Extra line at the top, e.g. "Can I get this for Friday?" */
  intro?: string;
}

/** How many basket lines are listed in full before summarising the rest. */
const MAX_LINES = 12;

export function basketMessage(lines: CartLine[], opts: OrderMessageOptions = {}): string {
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
  const fulfilment = opts.fulfilment ?? 'collection';

  const rows = lines.slice(0, MAX_LINES).map((l) => {
    const picks = l.picks.length ? `\n   ${l.picks.map((p) => p.label).join(', ')}` : '';
    return `• ${l.qty} × ${l.name} — ${zar(l.unitPrice * l.qty)}${picks}`;
  });
  if (lines.length > MAX_LINES) {
    rows.push(`• …and ${lines.length - MAX_LINES} more item${lines.length - MAX_LINES === 1 ? '' : 's'}`);
  }

  const parts: string[] = [];
  parts.push(opts.intro?.trim() || 'Hi Heritage Bites! I would like to order:');
  parts.push('');
  parts.push(rows.join('\n'));
  parts.push('');
  parts.push(`Total: ${zar(subtotal)} (${count} plate${count === 1 ? '' : 's'}, delivery included)`);
  parts.push(
    fulfilment === 'delivery'
      ? `I would like it delivered${opts.customer?.suburb ? ` in ${opts.customer.suburb}` : ''}.`
      : 'I would like to collect it.',
  );

  const name = opts.customer?.name?.trim();
  const phone = opts.customer?.phone?.trim();
  if (name) parts.push(`Name: ${name}`);
  if (phone) parts.push(`Phone: ${phone}`);
  if (fulfilment === 'delivery' && opts.customer?.address?.trim()) parts.push(`Address: ${opts.customer.address.trim()}`);
  if (opts.customer?.notes?.trim()) parts.push(`Notes: ${opts.customer.notes.trim()}`);

  /*
   * The message itself is the order, so it ends by asking for the two things
   * the customer cannot do inside WhatsApp: have it confirmed, and know where
   * to pay. It used to read "I will send it through", which sounded like the
   * customer still owed the kitchen another form or a payment link — the one
   * sentence in the message that raised a question instead of answering one.
   */
  parts.push('');
  parts.push('Please reply here to confirm this order and let me know how to pay.');

  return parts.join('\n');
}

/**
 * A wa.me link with the message already in it. Encoding happens once, here:
 * `%0A` newlines are what WhatsApp expects, and the bullet characters survive
 * because the whole string goes through encodeURIComponent.
 */
export function waHref(number: string | undefined, text: string): string {
  return `https://wa.me/${waNumber(number)}?text=${encodeURIComponent(text)}`;
}

/** Straight-to-chat link with no message, for "ask us something" buttons. */
export function waChatHref(number?: string): string {
  return `https://wa.me/${waNumber(number)}`;
}

/* --------------------------- Canned enquiries -------------------------- */

/*
 * Every WhatsApp button on the site opens a message that is already written.
 * An empty chat box is where a customer gives up — they either retype what the
 * site already knows or they close the tab — so even the buttons with no basket
 * behind them (the footer, the service strip, the contact card, the loyalty
 * page) open with a sentence that makes the reason for the message obvious.
 */

/** Nothing in the basket: a plain "I would like to order" opener. */
export const ORDER_ENQUIRY =
  'Hi Heritage Bites! I would like to place an order. What is on the menu today?';

/** A general question — the catch-all for contact-style buttons. */
export const GENERAL_ENQUIRY = 'Hi Heritage Bites! I have a question.';

/** Asked from the service strip, which explains the Thursday/Friday window. */
export function serviceEnquiry(headline?: string): string {
  const lead = headline ? `I see "${headline}" — ` : '';
  return `Hi Heritage Bites! ${lead}can I still place an order today?`;
}

/** Asked from the loyalty page, carrying whatever number the customer typed. */
export function loyaltyEnquiry(phone?: string): string {
  const digits = String(phone ?? '').trim();
  return digits
    ? `Hi Heritage Bites! Please can you check my loyalty stamps? My number is ${digits}.`
    : 'Hi Heritage Bites! Please can you check my loyalty stamps?';
}

/** Asked from the WhatsApp channel card, and from the footer. */
export const CHANNEL_ENQUIRY =
  'Hi Heritage Bites! I would like to order. Please tell me what is available and how to pay.';

/**
 * A basket link, or an order enquiry when the basket is empty: a WhatsApp
 * button must never open a blank message box.
 */
export function basketHref(number: string | undefined, lines: CartLine[], opts: OrderMessageOptions = {}): string {
  if (!lines.length) return waHref(number, ORDER_ENQUIRY);
  return waHref(number, basketMessage(lines, opts));
}

/**
 * Put a message into an already-configured WhatsApp URL.
 *
 * `settings.channels.whatsapp.url` is owner-editable and ships as a bare
 * `https://wa.me/27670137587`, which opens an empty chat. Where the configured
 * URL is a WhatsApp link this returns it with the message attached (using the
 * configured number if it has one); anything else — a link to another app — is
 * returned untouched rather than rewritten into a WhatsApp link by mistake.
 */
export function waUrlWithText(url: string | undefined, number: string | undefined, text: string): string {
  if (!url) return waHref(number, text);
  if (!/^(https?:\/\/)?(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)/i.test(url)) return url;
  const configured = String(url).replace(/\D/g, '');
  return waHref(configured || number, text);
}
