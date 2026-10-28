/**
 * Pricing + order-number logic, kept free of Express so it can be unit tested.
 * All money is handled in cents internally to avoid float drift.
 */

export const rand = (n) => Math.round(n);

export function toCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}

export function fromCents(cents) {
  return Number(cents) / 100;
}

const CHECK_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Order code, e.g. HB-0147D — a readable running number (easy to say over the
 * phone and to print on a docket) plus a check letter so codes are not
 * trivially guessable by walking the sequence.
 */
export function orderCode(seq) {
  const n = Math.max(1, Number(seq) || 1);
  return `HB-${String(n).padStart(4, '0')}${CHECK_LETTERS[n % CHECK_LETTERS.length]}`;
}

/** Loyalty: 1 stamp per R50 spent, rounded down. Exported for tests. */
export function loyaltyPointsFor(totalAmount, ratePerCents = 5000) {
  return Math.floor(toCents(totalAmount) / ratePerCents);
}

/**
 * Resolve a discount code against the settings table.
 * Returns { ok, discountCents, applied } — never throws.
 */
export function applyDiscountCode(code, subtotalCents, codes = []) {
  const needle = String(code ?? '').trim().toUpperCase();
  if (!needle) return { ok: false, discountCents: 0, applied: null, reason: 'no_code' };

  const found = (codes || []).find((c) => c.code === needle);
  if (!found) return { ok: false, discountCents: 0, applied: null, reason: 'unknown_code' };
  if (!found.active) return { ok: false, discountCents: 0, applied: null, reason: 'inactive' };

  if (found.minSubtotalCents && subtotalCents < found.minSubtotalCents) {
    return {
      ok: false,
      discountCents: 0,
      applied: null,
      reason: 'min_not_met',
      message: `Spend R${fromCents(found.minSubtotalCents).toFixed(2)} or more to use ${found.code}.`,
    };
  }

  const discountCents =
    found.type === 'percent'
      ? Math.round((subtotalCents * found.value) / 100)
      : Math.min(toCents(found.value), subtotalCents);

  const capped = found.maxDiscountCents ? Math.min(discountCents, found.maxDiscountCents) : discountCents;
  return { ok: true, discountCents: capped, applied: { code: found.code, type: found.type, value: found.value } };
}

/**
 * Authoritative totals calculation. The client mirrors this for live display,
 * but the server recalculates from its own menu so a tampered client cannot
 * change what is charged.
 */
export function computeTotals({ items, settings, discountCents = 0, deliveryCents = 0 }) {
  const subtotalCents = items.reduce((sum, it) => sum + toCents(it.unitPrice) * it.qty, 0);
  const totalCents = Math.max(0, subtotalCents - discountCents + deliveryCents);

  return {
    subtotalCents,
    subtotal: fromCents(subtotalCents),
    deliveryCents,
    delivery: fromCents(deliveryCents),
    discountCents,
    discount: fromCents(discountCents),
    totalCents,
    total: fromCents(totalCents),
    currency: settings?.currency ?? 'ZAR',
  };
}

/**
 * Delivery fee tiers. Free above `freeAboveCents`, flat rate below.
 * Exported for tests.
 */
export function deliveryFeeCents(subtotalCents, settings = {}) {
  const flat = toCents(settings.deliveryFlat ?? 35);
  const freeAbove = toCents(settings.freeDeliveryAbove ?? 250);
  /*
   * The minimum is checked before the free-delivery threshold. When delivery is
   * included in the price the threshold is zero, and testing it first would
   * make every basket — including one below the minimum — read as "free".
   */
  if (subtotalCents < toCents(settings.minDeliveryOrder ?? 120)) return -1; // -1 signals "below minimum"
  if (subtotalCents >= freeAbove) return 0;
  return flat;
}
