/**
 * Online payments — Yoco, and only Yoco.
 *
 * What changed and why: the checkout used to collect a card number, expiry and
 * CVC in the page itself (with a "test mode" card form when no live keys were
 * present). That is exactly the arrangement that puts a merchant in the hardest
 * part of PCI-DSS, and it meant the site was either storing card data or
 * pretending to charge cards. Both are gone. There is now no card field
 * anywhere: the customer is sent to Yoco's own hosted payment page, and Yoco
 * tells us when the money arrived.
 *
 * Two ways to point this at Heritage Bites' Yoco account, because the business
 * supplies the destination rather than this codebase inventing one:
 *
 *   1. `HB_YOCO_PAYMENT_URL` — a Yoco payment link, e.g.
 *      https://pay.yoco.com/heritagebites. No secret on this server. The order
 *      code is appended as `?reference=`, so the payment can be matched to the
 *      order by a person, and by the webhook if the link carries metadata.
 *
 *   2. `HB_YOCO_SECRET_KEY` (+ optional `HB_YOCO_CHECKOUT_ENDPOINT`, default
 *      https://payments.yoco.com/api/checkouts) — the server creates a checkout
 *      for the exact amount and redirects to the URL Yoco returns. This is the
 *      mode that guarantees the amount: the customer cannot underpay by editing
 *      a link, and the order code travels in `metadata`.
 *
 * Either way the order is only marked paid by a **verified webhook**
 * (`HB_YOCO_WEBHOOK_SECRET`), never by a query string that says so — a return
 * URL is something the customer can type.
 *
 * Nothing here stores a card number. Yoco's hosted page holds the card; we keep
 * at most the brand and last four digits that a webhook reports.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Where Yoco's Checkout API lives. Overridable so a sandbox can be pointed at. */
export const DEFAULT_CHECKOUT_ENDPOINT = 'https://payments.yoco.com/api/checkouts';

/** Reject webhooks older than this, so a captured request cannot be replayed. */
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const read = (name) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/** A Yoco payment link the business supplied, if any. */
export function yocoPaymentUrl() {
  return read('HB_YOCO_PAYMENT_URL');
}

/** The secret key for creating checkouts server-side, if the business supplied one. */
export function yocoSecretKey() {
  return read('HB_YOCO_SECRET_KEY');
}

/** The endpoint a checkout is created against. */
export function yocoCheckoutEndpoint() {
  return read('HB_YOCO_CHECKOUT_ENDPOINT') ?? DEFAULT_CHECKOUT_ENDPOINT;
}

/** The signing secret Yoco uses for this endpoint's webhooks. */
export function yocoWebhookSecret() {
  return read('HB_YOCO_WEBHOOK_SECRET');
}

/**
 * How online payment is wired up right now.
 *
 * `api`  — a secret key is present: exact-amount checkouts, best option.
 * `link` — only a payment link: still real money, but the amount is whatever the
 *          customer enters on Yoco's page, so it relies on a human checking it.
 * null   — not configured: online payment is not offered at all, rather than
 *          offered and then failing at the last step.
 */
export function yocoMode() {
  if (yocoSecretKey()) return 'api';
  if (yocoPaymentUrl()) return 'link';
  return null;
}

/** Which checkout the site is running — surfaced on the checkout and in /api/health. */
export function paymentDriver() {
  return yocoMode() ?? 'off';
}

/**
 * Public (safe to expose) payment settings for the checkout screen.
 *
 * Deliberately no keys: the browser never talks to Yoco directly in this design,
 * so there is nothing secret or public for it to hold.
 */
export function paymentConfig() {
  const mode = yocoMode();
  return {
    provider: 'yoco',
    /** True only when a customer can actually reach a payment page. */
    online: Boolean(mode),
    mode: mode ?? 'off',
    /** Whether the order code is attached automatically (api mode) or by hand. */
    exactAmount: mode === 'api',
    cashOnCollection: true,
    /* The business confirmed cash on collection only. */
    cashOnDelivery: false,
  };
}

/**
 * Send the customer to Yoco for this order.
 *
 * Never throws: a missing configuration, a refused request or an outage comes
 * back as `{ ok: false }` with a message a customer can act on, and the caller
 * decides what to do with the order.
 *
 * @param {{
 *   amountCents: number,
 *   currency?: string,
 *   orderCode: string,
 *   trackingToken?: string,
 *   baseUrl?: string,
 *   description?: string,
 * }} input
 * @returns {Promise<{ ok: true, mode: string, redirectUrl: string, reference: string | null }
 *                 | { ok: false, code: string, message: string }>}
 */
export async function startYocoPayment(input) {
  const mode = yocoMode();
  if (!mode) {
    return {
      ok: false,
      code: 'payment_not_configured',
      message: 'Online payment is not switched on for this site yet. Please order on WhatsApp, or choose cash on collection.',
    };
  }

  const amountCents = Math.round(Number(input?.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, code: 'invalid_amount', message: 'That order total cannot be paid online.' };
  }

  const orderCode = String(input?.orderCode ?? '').trim();
  if (!orderCode) {
    return { ok: false, code: 'invalid_order', message: 'That order could not be matched to a payment.' };
  }

  if (mode === 'link') {
    try {
      const url = new URL(String(yocoPaymentUrl()));
      /*
       * A Yoco payment page (pay.yoco.com/…) accepts these query parameters and
       * pre-fills the page with them, which closes most of the gap between a link
       * and a real checkout:
       *
       *   amount                   the total, in RANDS with cents ("130.00")
       *   reference                shown on Yoco's page and in the dashboard
       *   redirectOnPaymentSuccess where to send the customer afterwards
       *
       * The amount is still editable on Yoco's page in link mode — only the API
       * mode can pin it — so the webhook and the order code stay the source of
       * truth for what was actually paid.
       */
      url.searchParams.set('amount', (amountCents / 100).toFixed(2));
      url.searchParams.set('reference', orderCode);
      const base = input?.baseUrl ? String(input.baseUrl).replace(/\/+$/, '') : '';
      if (base) {
        /*
         * Deliberately no tracking token on this one. A payment link is a static
         * page: the return address is stored by Yoco and echoed in the browser's
         * history, and the token is the only thing protecting the order page. The
         * checkout already parks the token in the customer's browser before it
         * redirects, so the page opens without it.
         */
        url.searchParams.set('redirectOnPaymentSuccess', `${base}/order/${encodeURIComponent(orderCode)}`);
      }
      return { ok: true, mode, redirectUrl: url.toString(), reference: null };
    } catch {
      return {
        ok: false,
        code: 'invalid_payment_url',
        message: 'The payment link on this site is not a valid address. Please order on WhatsApp.',
      };
    }
  }

  /*
   * API mode. The return URLs carry the tracking token so the customer lands
   * back on their own order page authenticated, without being asked to paste a
   * token Yoco never saw.
   */
  const body = {
    amount: amountCents,
    currency: String(input?.currency ?? 'ZAR').toUpperCase(),
    metadata: { orderCode },
  };
  /*
   * One checkout per order. If a request is retried after a timeout — or a
   * customer double-taps — Yoco returns the same checkout instead of opening a
   * second one, so there is exactly one payment attempt to reconcile.
   */
  const idempotencyKey = `hb-${orderCode}`;
  const base = input?.baseUrl ? String(input.baseUrl).replace(/\/+$/, '') : '';
  if (base) {
    const back = `${base}/order/${encodeURIComponent(orderCode)}`;
    const token = input?.trackingToken ? `?token=${encodeURIComponent(input.trackingToken)}` : '';
    body.successUrl = `${back}${token}`;
    body.cancelUrl = `${back}${token}`;
    body.failureUrl = `${back}${token}`;
  }

  try {
    const res = await fetch(yocoCheckoutEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${yocoSecretKey()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const redirectUrl = data?.redirectUrl ?? data?.redirect_url ?? null;

    if (!res.ok || !redirectUrl) {
      /*
       * Always end with the reassurance: a customer who has just typed their
       * details into a payment page needs to know nothing was taken, whatever
       * Yoco's own wording says.
       */
      const reason = data?.error?.message ?? data?.message ?? 'Yoco did not accept that payment request.';
      return {
        ok: false,
        code: data?.errorCode ?? `yoco_${res.status}`,
        message: `${reason} Nothing was charged — please try again, or order on WhatsApp.`,
      };
    }

    return { ok: true, mode, redirectUrl: String(redirectUrl), reference: data?.id ? String(data.id) : null };
  } catch (error) {
    return {
      ok: false,
      code: 'network_error',
      message: `We could not reach Yoco to start the payment (${error.message}). Nothing was charged — please try again, or order on WhatsApp.`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Webhooks — the only thing that can mark an order paid                      */
/* -------------------------------------------------------------------------- */

/** @param {string} value */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Check a Yoco webhook signature.
 *
 * Yoco signs webhooks in the Standard Webhooks format: HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${raw body}`, base64-encoded, in a
 * `webhook-signature` header that may hold several space-separated `v1,<sig>`
 * entries (so a secret can be rotated without dropping deliveries).
 *
 * Why this matters: without the check, anyone who can guess an order code could
 * POST "payment succeeded" and be handed free food.
 *
 * @param {{ rawBody?: string, headers?: Record<string, unknown>, secret?: string | null, now?: number }} input
 * @returns {{ ok: true, event: any } | { ok: false, status: number, code: string, message: string }}
 */
export function verifyYocoWebhook({ rawBody, headers = {}, secret = yocoWebhookSecret(), now = Date.now() }) {
  if (!secret) {
    return {
      ok: false,
      status: 503,
      code: 'webhook_not_configured',
      message: 'This site has no Yoco webhook secret, so payments cannot be confirmed automatically.',
    };
  }
  if (typeof rawBody !== 'string' || !rawBody) {
    return { ok: false, status: 400, code: 'empty_body', message: 'No webhook body was received.' };
  }

  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatureHeader = header(headers, 'webhook-signature');

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, status: 400, code: 'missing_signature', message: 'That webhook was not signed.' };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, status: 400, code: 'bad_timestamp', message: 'That webhook timestamp is not a number.' };
  }
  /* Seconds in the spec; milliseconds are tolerated so a test can post either. */
  const sentAtSeconds = sentAt > 1e12 ? Math.floor(sentAt / 1000) : sentAt;
  if (Math.abs(Math.floor(now / 1000) - sentAtSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, status: 400, code: 'stale_webhook', message: 'That webhook is too old to trust.' };
  }

  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice('whsec_'.length), 'base64') : Buffer.from(secret);
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();

  const candidates = String(signatureHeader)
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes(',') ? part.slice(part.indexOf(',') + 1) : part));

  const matched = candidates.some((candidate) => {
    const asBuffer = Buffer.from(candidate, 'base64');
    return asBuffer.length === expected.length && timingSafeEqual(asBuffer, expected);
  });

  if (!matched) {
    return { ok: false, status: 401, code: 'bad_signature', message: 'That webhook signature does not match.' };
  }

  try {
    return { ok: true, event: JSON.parse(rawBody) };
  } catch {
    return { ok: false, status: 400, code: 'bad_json', message: 'That webhook body is not JSON.' };
  }
}

/** Case-insensitive header read that works with Node's request headers. */
function header(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Pull what this site needs out of a Yoco webhook.
 *
 * Yoco's payloads have moved around between versions, so this reads the shapes
 * that are documented and reports "nothing useful" rather than guessing.
 *
 * @param {any} event
 * @returns {{ type: string, orderCode: string | null, paid: boolean, reference: string | null, last4: string | null, brand: string | null, amountCents: number | null }}
 */
export function readYocoEvent(event) {
  const payload = event?.payload ?? event?.data?.object ?? event?.data ?? {};
  const type = String(event?.type ?? event?.eventType ?? '');
  const orderCode =
    payload?.metadata?.orderCode ?? payload?.metadata?.order_code ?? event?.metadata?.orderCode ?? null;

  const status = String(payload?.status ?? '').toLowerCase();
  const paid = type === 'payment.succeeded' || status === 'succeeded' || status === 'successful';

  const amount = Number(payload?.amount);
  return {
    type,
    orderCode: orderCode ? String(orderCode) : null,
    paid,
    reference: payload?.id ? String(payload.id) : null,
    last4: payload?.card?.last4 ?? payload?.paymentMethod?.card?.last4 ?? null,
    brand: payload?.card?.brand ?? payload?.paymentMethod?.card?.brand ?? null,
    amountCents: Number.isFinite(amount) ? amount : null,
  };
}
