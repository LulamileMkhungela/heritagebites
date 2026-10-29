/**
 * One place that turns a basket into a WhatsApp message.
 *
 * Why this exists: the checkout shipped a "Send the basket on WhatsApp" button
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

  parts.push('');
  parts.push('Please confirm this order and I will send it through.');

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

/** The basket link used by checkout, the cart drawer and the preview checkout. */
export function basketHref(number: string | undefined, lines: CartLine[], opts: OrderMessageOptions = {}): string {
  if (!lines.length) return waChatHref(number);
  return waHref(number, basketMessage(lines, opts));
}
