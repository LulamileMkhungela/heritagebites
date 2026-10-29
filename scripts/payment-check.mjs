#!/usr/bin/env node
/**
 * Is the payment configuration actually usable?
 *
 * Written after a real report: the site was pointed at
 * `https://pay.yoco.com/heritagebites` — an example from the documentation, not a
 * link that exists — and the first customer to order was sent to Yoco's own "the
 * page you are looking for could not be found" page. Nothing on this side could
 * tell, because a payment link is just a URL: the shop only finds out when a
 * customer does.
 *
 * This script answers the question before that happens. It reads the same
 * environment the server reads and checks:
 *
 *   - which mode the site is in, and whether the webhook can ever mark an order
 *     paid;
 *   - in link mode, that the link really resolves to a payment page (a 404, or a
 *     page that says "not found", is the exact failure that prompted this);
 *   - in API mode, that the key looks like a Yoco key and says whether it is a
 *     test key (no money) or a live one;
 *   - that the public URL the customer is returned to is a real https address.
 *
 * Usage:
 *
 *   npm run check:payments                 # checks what this shell can see
 *   HB_PAYMENT_CHECK_SKIP_NETWORK=1 …      # configuration only, no requests
 *
 * Exit code is 0 when everything checks out and 1 when something would bite a
 * customer. It never creates a payment and never sends money.
 */
import {
  EXAMPLE_PAYMENT_LINK,
  isExamplePaymentLink,
  paymentConfig,
  yocoCheckoutEndpoint,
  yocoMode,
  yocoPaymentUrl,
  yocoSecretKey,
  yocoWebhookSecret,
} from '../server/lib/payments.js';

const results = [];
const record = (level, label, detail = '') => results.push({ level, label, detail });

/** Values nobody could have meant to deploy. */
const isPlaceholder = (value) =>
  isExamplePaymentLink(value) || /example\.com|your-domain|localhost|127\.0\.0\.1|<|>|…/i.test(value);

/* ---------------------------------------------------------------- config */

const mode = yocoMode();
const config = paymentConfig();

if (!mode) {
  record('fail', 'no online payment configured', 'the checkout will say online payment is not switched on yet — that is honest, but no card can be taken');
} else {
  record('pass', `mode: ${mode}`, mode === 'api' ? 'amount is fixed server-side' : 'the customer types the amount on Yoco’s page');
}

if (!yocoWebhookSecret()) {
  record('fail', 'no webhook secret', 'HB_YOCO_WEBHOOK_SECRET is empty, so no order can ever be marked paid automatically — every payment would need reconciling by hand');
} else if (!/^whsec_/.test(yocoWebhookSecret())) {
  record('warn', 'webhook secret does not start with whsec_', 'check you copied the signing secret, not the endpoint URL');
} else {
  record('pass', 'webhook secret is set');
}

const publicUrl = String(process.env.HB_PUBLIC_URL ?? '').trim();
if (!publicUrl) {
  record('warn', 'HB_PUBLIC_URL is not set', 'customers are returned to the built-in default, which is only right for the production domain');
} else if (!/^https:\/\//.test(publicUrl)) {
  record('warn', `HB_PUBLIC_URL is not https (${publicUrl})`, 'Yoco will return customers over https; a http return address looks broken to browsers');
} else {
  record('pass', `public URL: ${publicUrl}`);
}

/* -------------------------------------------------------------- link mode */

if (mode === 'link') {
  const link = String(yocoPaymentUrl() ?? '').trim();
  let url;
  try {
    url = new URL(link);
  } catch {
    record('fail', 'the payment link is not a URL', `HB_YOCO_PAYMENT_URL is "${link}"`);
  }

  if (url) {
    record('pass', `payment link host: ${url.host}`);
    /*
     * A payment link is the shop's own Yoco "Payment Links" URL. It is not a
     * generic Yoco page, and it is not guessable: an invented one returns Yoco's
     * 404, which is what a customer saw.
     */
    if (!/(^|\.)yoco\.com$/i.test(url.hostname)) {
      record('warn', `that is not a yoco.com address (${url.hostname})`, 'a Yoco payment link lives on pay.yoco.com — check you pasted the right thing');
    }
    if (isPlaceholder(link)) {
      record('fail', 'the link is the example from the documentation, which does not exist', `copy the Payment Link from the Yoco dashboard; ${EXAMPLE_PAYMENT_LINK} returns Yoco's "page could not be found"`);
    }
  }

  if (url && process.env.HB_PAYMENT_CHECK_SKIP_NETWORK !== '1') {
    try {
      /* GET, because a payment page is what the customer's browser does. */
      const res = await fetch(url.toString(), {
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      const body = res.ok ? await res.text() : '';
      const looksMissing = /could not be found|page you are looking for|page not found/i.test(body);
      if (res.status === 404 || res.status === 410) {
        record('fail', `the payment link returns ${res.status}`, 'that link does not exist — customers would land on Yoco’s "page could not be found"');
      } else if (!res.ok) {
        record('fail', `the payment link returns ${res.status}`, 'customers would not reach a payment page');
      } else if (looksMissing) {
        record('fail', 'the link answers 200 but shows a "not found" page', 'Yoco renders its 404 in the browser, so the status alone cannot be trusted');
      } else {
        record('pass', 'the payment link resolves to a page');
      }
    } catch (error) {
      record('warn', 'could not reach the payment link from here', `${String(error?.message ?? error).slice(0, 120)} — run this on the server, or with HB_PAYMENT_CHECK_SKIP_NETWORK=1`);
    }
  }
}

/* --------------------------------------------------------------- api mode */

if (mode === 'api') {
  const key = String(yocoSecretKey() ?? '');
  if (/^sk_test_/.test(key)) {
    record('warn', 'this is a TEST key (sk_test_)', 'payments will not move real money — swap to sk_live_ when the business is ready');
  } else if (/^sk_live_/.test(key)) {
    record('pass', 'this is a LIVE key (sk_live_)');
  } else {
    record('fail', 'the secret key does not look like a Yoco key', 'expected sk_live_… or sk_test_…; the public key will not work here');
  }
  record('pass', `checkout endpoint: ${yocoCheckoutEndpoint()}`);
  if (isPlaceholder(String(yocoCheckoutEndpoint()))) {
    record('warn', 'the checkout endpoint looks like a placeholder', 'only override HB_YOCO_CHECKOUT_ENDPOINT for a stand-in gateway');
  }
}

/* ---------------------------------------------------------------- summary */

const icon = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL' };
for (const r of results) {
  console.log(`${icon[r.level]}  ${r.label}${r.detail ? `\n      ${r.detail}` : ''}`);
}

const failures = results.filter((r) => r.level === 'fail').length;
const warnings = results.filter((r) => r.level === 'warn').length;
console.log(
  `\n${failures ? `NOT READY — ${failures} problem(s)` : 'Ready'}, ${warnings} warning(s). ` +
    `Payments: ${config.online ? 'online' : 'off'}, mode ${config.mode ?? 'off'}, exact amount ${config.exactAmount ? 'yes' : 'no'}.`,
);

/* Configuration problems are worth a non-zero exit so a deploy script can stop. */
process.exitCode = failures ? 1 : 0;
