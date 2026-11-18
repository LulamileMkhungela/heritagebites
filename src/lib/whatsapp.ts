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
import { extraLabel, sastNow } from '../../shared/service.js';
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
  /**
   * How this order will be paid: a Yoco payment link that Heritage Bites sends
   * back in this chat (the default — the arrangement for orders taken on
   * WhatsApp), or cash on collection when the customer chose that explicitly.
   */
  payment?: 'yoco' | 'cash';
  /** Extra line at the top, e.g. "Can I get this for Friday?" */
  intro?: string;
  /**
   * The cooking day the customer booked the order for.
   *
   * The owner asked for this in as many words (16 Nov 2026): the message "must
   * mention it is an order from this day for a specific day". Without it the
   * kitchen reads a Saturday message as a Saturday order, and a booking for two
   * Fridays' time looks like a late lunch. `forDate` is the day they chose; the
   * date it was sent is added by the message itself.
   *
   * `shortLabel` is the human form the catalogue serves ("Friday 4 Dec"), so the
   * wording cannot drift from the day picker on the checkout.
   */
  booking?: { label: string; isToday?: boolean } | null;
  /** The moment the message was written, defaulting to now. */
  placedAt?: Date;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Wednesday 19 Nov", in Johannesburg time.
 *
 * Built from `sastNow` rather than `toLocaleDateString`, because the browser is
 * not necessarily in South Africa: a customer checking out from London must
 * still produce a message that says which South African day the order was
 * placed. The shared helper is the same clock the server uses, so the two
 * cannot disagree about what "today" is.
 */
export function sastLabel(now: Date = new Date()): string {
  const at = sastNow(now);
  const [, month, day] = at.dateKey.split('-').map(Number);
  return `${WEEKDAY_SHORT[at.day]} ${day} ${MONTHS_SHORT[month - 1]}`;
}

/** How many basket lines are listed in full before summarising the rest. */
const MAX_LINES = 12;

export function basketMessage(lines: CartLine[], opts: OrderMessageOptions = {}): string {
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
  const fulfilment = opts.fulfilment ?? 'delivery';

  const rows = lines.slice(0, MAX_LINES).map((l) => {
    /*
     * An extra is written as "2 × Ginger gemere" rather than twice in a row.
     * The kitchen packs from this message, and a repeated label reads as a
     * mistake in the order rather than as a number of bottles.
     */
    const picks = l.picks.length
      ? `\n   ${l.picks.map((p) => extraLabel(p.label, p.qty)).join(', ')}`
      : '';
    return `• ${l.qty} × ${l.name} — ${zar(l.unitPrice * l.qty)}${picks}`;
  });
  if (lines.length > MAX_LINES) {
    rows.push(`• …and ${lines.length - MAX_LINES} more item${lines.length - MAX_LINES === 1 ? '' : 's'}`);
  }

  /*
   * "Today is Wednesday 19 Nov. This order is for Friday 21 Nov."
   *
   * The first line is the one the kitchen triages from, so it carries both
   * facts: when the customer sent it, and which cooking day it is for. A
   * booking made on a Saturday for next Friday used to arrive looking like a
   * Saturday order — this is the fix the owner asked for, in their own words
   * ("mention it is an order from this day for a specific day").
   */
  const placedAt = opts.placedAt ?? new Date();
  const sentLabel = sastLabel(placedAt);
  const bookingLabel = opts.booking?.label?.trim() || '';

  const parts: string[] = [];
  if (bookingLabel) {
    parts.push(
      opts.intro?.trim() ||
        `Hi Heritage Bites! This is an order placed ${sentLabel}, for ${bookingLabel}.`,
    );
    parts.push(`Order placed: ${sentLabel}`);
    parts.push(`Cooking day: ${bookingLabel}`);
  } else {
    parts.push(opts.intro?.trim() || 'Hi Heritage Bites! I would like to order:');
  }
  parts.push('');
  parts.push(rows.join('\n'));
  parts.push('');
  /*
   * Every order is a delivery now (owner, 14 Nov 2026). Inside Sandton and
   * Rosebank the plate price already covers the trip, so the message states the
   * plates and names the address; the kitchen adds any out-of-area fee on the
   * quote it confirms in this same chat.
   */
  /*
   * "Items", not "plates": a basket can hold a bowl of chakalaka on its own now
   * (owner, 17 Nov 2026 — the sides are sold by the portion), and a WhatsApp
   * message that calls one bowl "1 plate" is the order misdescribed to the kitchen
   * that has to pack it.
   */
  parts.push(`Items: ${zar(subtotal)} (${count} item${count === 1 ? '' : 's'})`);
  /*
   * The suburb, when it is a real one.
   *
   * The select's third option is the label "Another area — within 15 km", which
   * is a rule, not a place: "I would like it delivered in Another area — within
   * 15 km" is nonsense in a chat, and the full address is on its own line
   * directly below anyway. So the option is skipped and the sentence stays a
   * sentence.
   */
  const area = String(opts.customer?.suburb ?? '').trim();
  const outsideChoice = /^another area/i.test(area) || /^other\b/i.test(area);
  parts.push(`I would like it delivered${area && !outsideChoice ? ` in ${area}` : ''}.`);

  const name = opts.customer?.name?.trim();
  const phone = opts.customer?.phone?.trim();
  if (name) parts.push(`Name: ${name}`);
  if (phone) parts.push(`Phone: ${phone}`);
  if (fulfilment === 'delivery' && opts.customer?.address?.trim()) parts.push(`Address: ${opts.customer.address.trim()}`);
  if (opts.customer?.notes?.trim()) parts.push(`Notes: ${opts.customer.notes.trim()}`);

  /*
   * The message itself is the order, so it ends with the one thing the customer
   * cannot do inside WhatsApp: pay. The arrangement is Yoco — Heritage Bites
   * replies with a payment link and the customer pays there — unless the
   * customer picked cash on collection on the checkout.
   */
  parts.push('');
  /*
   * The closing line states how the order will be paid.
   *
   * Card always asks for the Yoco link, because that is the channel the kitchen
   * actually uses to collect a card payment regardless of how the food arrives.
   *
   * Cash has to name the right moment. It used to say "cash on collection" for
   * every cash order, so a delivery customer was told they would pay at a
   * collection that was not happening — the one line in the message that
   * contradicted the fulfilment stated three lines above it.
   */
  parts.push(
    opts.payment === 'cash'
      ? 'I will pay cash on delivery — please confirm this order.'
      : 'I will pay by Yoco — please confirm this order and send me the payment link.',
  );

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

/**
 * Asked from an order placed before collection was removed (owner, 14 Nov
 * 2026). No surface offers collection any more, but a stored order's tracking
 * page still needs a way to ask where to meet the kitchen.
 */
export const COLLECTION_POINT_ENQUIRY =
  'Hi Heritage Bites! My order was placed for collection before you moved to delivery only — can you tell me what happens to it?';

/** Asked from the WhatsApp channel card, and from the footer. */
export const CHANNEL_ENQUIRY =
  'Hi Heritage Bites! I would like to order. Please tell me what is available and how to pay.';

/**
 * A basket link, or an order enquiry when the cart is empty: a WhatsApp
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
