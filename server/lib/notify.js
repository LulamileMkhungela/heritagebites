/**
 * Ordering-channel deep links.
 *
 * WhatsApp is a first-class order channel here: the app builds a pre-filled
 * message containing the whole basket and the customer just presses send. That
 * means the restaurant receives a structured ticket instead of a free-text
 * "hi, what's available?".
 */

const money = (n) => `R${Number(n || 0).toFixed(2)}`;

export function buildWhatsAppMessage({ code, items, totals, fulfilment, customer }) {
  const lines = [];
  lines.push(`*Heritage Bites order${code ? ` ${code}` : ''}*`);
  lines.push('');
  lines.push('*My order:*');
  for (const it of items ?? []) {
    const opts = it.options?.length ? ` (${it.options.map((o) => o.label).join(', ')})` : '';
    lines.push(`• ${it.qty} × ${it.name}${opts} — ${money(it.lineTotal)}`);
  }
  lines.push('');
  if (totals) {
    if (totals.discount > 0) lines.push(`Subtotal: ${money(totals.subtotal)}`);
    if (totals.delivery > 0) lines.push(`Delivery: ${money(totals.delivery)}`);
    if (totals.discount > 0) lines.push(`Discount: -${money(totals.discount)}`);
    lines.push(`*Total: ${money(totals.total)}*`);
  }
  lines.push('');
  lines.push(`Order type: ${fulfilmentLabel(fulfilment)}`);
  if (customer?.name) lines.push(`Name: ${customer.name}`);
  if (customer?.phone) lines.push(`Contact: ${customer.phone}`);
  if (fulfilment === 'delivery' && customer?.address) lines.push(`Deliver to: ${customer.address}`);
  if (customer?.notes) lines.push(`Notes: ${customer.notes}`);
  return lines.join('\n');
}

export function fulfilmentLabel(f) {
  return { delivery: 'Delivery', collection: 'Collection' }[f] ?? 'Collection';
}

export function whatsappLink(msisdn, message) {
  return `https://wa.me/${String(msisdn).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

/** Uber Eats / Mr D links, with a per-item search fallback. */
export function channelLink(channel, settings, itemName) {
  const cfg = settings.channels?.[channel];
  if (!cfg?.url) return null;
  if (!itemName) return cfg.url;
  return `${cfg.url}${cfg.url.includes('?') ? '&' : '?'}q=${encodeURIComponent(itemName)}`;
}
