/**
 * Card + payment helpers.
 *
 * This module implements the payment *adapter* used by the checkout API.
 * Two drivers ship with it:
 *
 *   1. `sandbox` (default) — deterministic, offline, safe for demos and CI.
 *   2. `yoco`             — real Yoco Checkout API calls. Activated by setting
 *                           YOCO_SECRET_KEY in the environment.
 *
 * Nothing here ever stores a PAN. Only the last four digits and the brand are
 * kept on the order, which is what PCI-DSS allows a merchant to retain.
 */

/** Luhn checksum (mod 10). Exported for tests. */
export function luhnValid(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const BRANDS = [
  { brand: 'visa', test: /^4[0-9]{12}(?:[0-9]{3})?$/ },
  { brand: 'mastercard', test: /^(?:5[1-5][0-9]{14}|2(?:2(?:2[1-9]|[3-9][0-9])|[3-6][0-9]{2}|7(?:[01][0-9]|20))[0-9]{12})$/ },
  { brand: 'amex', test: /^3[47][0-9]{13}$/ },
  { brand: 'diners', test: /^3(?:0[0-5]|[68][0-9])[0-9]{11}$/ },
];

/** Returns 'visa' | 'mastercard' | 'amex' | 'diners' | 'unknown'. Exported for tests. */
export function detectBrand(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return BRANDS.find((b) => b.test.test(digits))?.brand ?? 'unknown';
}

/** Validates an expiry written as MM/YY or MM/YYYY against the current date. */
export function expiryValid(expiry, now = new Date()) {
  const m = String(expiry ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return false;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return false;
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  return endOfMonth.getTime() >= now.getTime();
}

/** Test PANs the sandbox driver treats specially. */
export const SANDBOX_CARDS = {
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
  requires3ds: '4000000000003220',
  approvedVisa: '4242424242424242',
  approvedMastercard: '5555555555554444',
};

function authCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function reference(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}_${ts}${rand}`;
}

/**
 * Sandbox driver. Behaviour is driven by the PAN so the demo is deterministic:
 * see SANDBOX_CARDS. Anything else with a valid Luhn checksum is approved.
 */
async function chargeSandbox({ amount, currency, card, description }) {
  const digits = String(card.number).replace(/\D/g, '');
  const brand = detectBrand(digits);
  const last4 = digits.slice(-4);
  const base = {
    id: reference('ch_sbx'),
    brand,
    last4,
    amount,
    currency,
    description,
    driver: 'sandbox',
  };

  await new Promise((r) => setTimeout(r, 650)); // network feel

  if (digits === SANDBOX_CARDS.declined) {
    return { ...base, status: 'declined', code: 'card_declined', message: 'The card was declined by the issuer.' };
  }
  if (digits === SANDBOX_CARDS.insufficientFunds) {
    return { ...base, status: 'declined', code: 'insufficient_funds', message: 'Insufficient funds on this card.' };
  }
  if (digits === SANDBOX_CARDS.requires3ds) {
    return { ...base, status: 'requires_action', code: 'requires_3ds', message: '3-D Secure verification required.' };
  }
  return { ...base, status: 'approved', authCode: authCode(), riskScore: Math.round(Math.random() * 20) / 100 };
}

/**
 * Live Yoco Checkout.
 *
 * The card is entered in Yoco's own hosted popup, in the customer's browser.
 * The browser hands back only a checkout id; this server reads that checkout
 * back from Yoco and confirms the amount before an order is created. The PAN
 * (and the CVC) never touch this process, which is what keeps the merchant in
 * PCI-DSS SAQ A rather than having to secure card data on the server.
 *
 * Set YOCO_SECRET_KEY (secret) and YOCO_PUBLIC_KEY (publishable) on the host to
 * switch card payments from the sandbox to live.
 */
export function yocoConfigured() {
  return Boolean(process.env.YOCO_SECRET_KEY);
}

/** Public (safe to expose) payment settings for the checkout screen. */
export function paymentConfig() {
  const live = yocoConfigured();
  return {
    driver: live ? 'yoco' : 'sandbox',
    // A publishable key is designed to be sent to the browser. The secret key is never exposed.
    publicKey: live ? (process.env.YOCO_PUBLIC_KEY ?? '') : '',
    hostedCheckout: live,
    card: true,
    cashOnCollection: true,
    cashOnDelivery: false,
  };
}

const PAID_CHECKOUT_STATUSES = new Set(['succeeded', 'completed', 'paid', 'captured']);

/**
 * Read a completed Yoco checkout back from the gateway.
 * Returns { status: 'approved' | 'declined' | 'invalid', ... }.
 */
export async function verifyYocoCheckout({ checkoutId, amountCents, currency = 'ZAR' }) {
  if (!checkoutId || typeof checkoutId !== 'string') {
    return { status: 'invalid', code: 'missing_checkout', message: 'No Yoco checkout reference was supplied.' };
  }
  if (!yocoConfigured()) {
    return { status: 'invalid', code: 'live_payments_off', message: 'Live card payments are not enabled on this site yet.' };
  }

  try {
    const res = await fetch(`https://payments.yoco.com/api/checkouts/${encodeURIComponent(checkoutId)}`, {
      headers: { Authorization: `Bearer ${process.env.YOCO_SECRET_KEY}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        status: 'declined',
        code: data.errorCode ?? 'gateway_error',
        message: data.error?.message ?? data.message ?? 'We could not verify that payment with Yoco.',
      };
    }

    const paidAmount = Number(data.amount);
    const paidCurrency = String(data.currency ?? currency).toUpperCase();

    if (!PAID_CHECKOUT_STATUSES.has(String(data.status ?? '').toLowerCase())) {
      return {
        status: 'declined',
        code: data.status ?? 'not_paid',
        message: 'That payment was not completed. Please try again.',
      };
    }
    if (paidCurrency !== String(currency).toUpperCase()) {
      return { status: 'declined', code: 'currency_mismatch', message: 'The payment currency did not match the order.' };
    }
    if (Number.isFinite(paidAmount) && paidAmount !== Number(amountCents)) {
      // Never fulfil on an amount the customer did not agree to.
      return {
        status: 'declined',
        code: 'amount_mismatch',
        message: 'The amount paid did not match this order. Please place the order again.',
      };
    }

    return {
      status: 'approved',
      id: data.id ?? checkoutId,
      brand: String(data.card?.brand ?? data.paymentMethod?.card?.brand ?? '').toLowerCase() || null,
      last4: data.card?.last4 ?? data.paymentMethod?.card?.last4 ?? null,
      amount: Number.isFinite(paidAmount) ? paidAmount / 100 : undefined,
      currency: paidCurrency,
      driver: 'yoco',
      riskScore: data.risk?.score ?? null,
    };
  } catch (error) {
    return {
      status: 'declined',
      code: 'network_error',
      message: `We could not reach Yoco to verify the payment: ${error.message}`,
    };
  }
}

/**
 * Charge a card held by the server. Only the offline sandbox driver accepts a
 * PAN here; once a live key is present the raw-card path is refused outright so
 * card data cannot be posted to this API by mistake.
 */
export async function chargeCard(input) {
  const { amount, currency = 'ZAR', card = {}, description = 'Heritage Bites order' } = input ?? {};

  if (yocoConfigured()) {
    return {
      status: 'invalid',
      code: 'hosted_checkout_required',
      message: 'Card details must be entered in the secure Yoco payment window, not sent to this site.',
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: 'invalid', code: 'invalid_amount', message: 'Amount must be greater than zero.' };
  }
  if (!luhnValid(card.number)) {
    return { status: 'invalid', code: 'invalid_number', message: 'That card number is not valid.' };
  }
  if (!expiryValid(card.expiry)) {
    return { status: 'invalid', code: 'invalid_expiry', message: 'That expiry date has passed.' };
  }
  if (!/^\d{3,4}$/.test(String(card.cvc ?? ''))) {
    return { status: 'invalid', code: 'invalid_cvc', message: 'The CVC must be 3 or 4 digits.' };
  }

  try {
    return await chargeSandbox({ amount, currency, card, description });
  } catch (err) {
    return { status: 'declined', code: 'network_error', message: `Payment gateway unreachable: ${err.message}` };
  }
}

/** Which driver is active — surfaced on the checkout screen and in /api/health. */
export function paymentDriver() {
  return yocoConfigured() ? 'yoco' : 'sandbox';
}
