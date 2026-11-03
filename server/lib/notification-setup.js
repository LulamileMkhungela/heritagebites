/**
 * The owner's notification details, read back to her as a verdict.
 *
 * Filling in `.env` is where this goes wrong quietly. A space inside a Gmail App
 * Password, a tracking link pointing at somebody else's website, an alert address
 * with a typo in it, push keys without the owner key — in every one of those
 * cases the site keeps taking orders and the kitchen hears nothing. So the same
 * reading of the environment is used by three callers:
 *
 *   - the boot log, which must shout about a broken setup instead of a note that
 *     scrolls past;
 *   - `GET /api/health`, so an uptime monitor sees it without reading logs;
 *   - `npm run check:notifications`, which tests the credentials for real and
 *     prints a numbered list of what to fix.
 *
 * This module deliberately imports the *live* config readers
 * (`emailConfig`, `customerEmailConfig`, `pushConfig`, `ownerKey`) rather than
 * re-parsing `process.env` itself: a checker that disagrees with the thing it is
 * checking is worse than no checker.
 */
import { customerEmailConfig, emailConfig, publicBaseUrl } from './order-notifications.js';
import { ownerKey, pushStatus } from './web-push.js';

/**
 * What a receipt links to when `HB_PUBLIC_URL` is not set.
 *
 * It is a real, live website — and it is **not this shop**. `heritagebites.co.za`
 * serves a different Pretoria restaurant. So this value is never "a harmless
 * default": with it in place, every customer receipt sends somebody to another
 * business's order page, where their tracking token means nothing.
 */
export const PLACEHOLDER_ORIGIN = 'https://heritagebites.co.za';

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());

/**
 * Is this value still the template's instruction, not a real value?
 *
 * `notifications.env.example` ships sentences where secrets go — "paste the
 * 16-character Google App Password here". Copied into `.env` unchanged and sent to
 * Google, that fails authentication, and the person is told their App Password
 * was revoked. They then spend an afternoon creating App Passwords that were
 * never the problem. This is the difference between "wrong password" and
 * "you have not filled this in yet", and it is worth its own message.
 */
function looksUnfilled(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  return /^(paste|enter|your|insert|replace|todo|tbc)\b|paste the|your-shop|your-domain|address-here|change-?me|example\.(com|org|co\.za)/i.test(text);
}

/** Is this origin one we can put in an email to a paying customer? */
function originProblem(origin) {
  if (!origin) return 'HB_PUBLIC_URL is empty, so receipts cannot contain a working tracking link.';
  if (origin === PLACEHOLDER_ORIGIN) {
    return (
      `HB_PUBLIC_URL is not set, so tracking links in customer receipts fall back to ${PLACEHOLDER_ORIGIN} — ` +
      'that address serves a DIFFERENT restaurant, so the customer\'s private link opens somebody else\'s site. ' +
      'Set HB_PUBLIC_URL to the address this site is actually served from.'
    );
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    return `HB_PUBLIC_URL (${origin}) is not a full web address. Use the form https://your-shop.example.`;
  }
  if (!/^https?:$/.test(url.protocol)) return `HB_PUBLIC_URL (${origin}) must start with https:// (or http:// on a local machine).`;
  if (url.pathname !== '/' && url.pathname !== '') {
    return `HB_PUBLIC_URL (${origin}) should be the site root only — no path, no trailing slash.`;
  }
  const local = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !local) {
    return (
      `HB_PUBLIC_URL (${origin}) is plain http. Gmail and Brevo both downgrade mail whose links are not https, ` +
      'and the order page carries a private token, so serve the site over https before taking real orders.'
    );
  }
  /*
   * Still the template's own example. Caught explicitly because this shipped
   * once without the check: `https://your-shop-address-here.co.za` passed every
   * other test, so an unfilled file looked ready while every receipt linked to a
   * domain that does not exist.
   */
  if (/your-shop|address-here|your-domain|change-?me|example\.(com|org|co\.za)|<.+>/.test(origin)) {
    return `HB_PUBLIC_URL (${origin}) is still the placeholder from the template. Put in the real address of this site.`;
  }
  return null;
}

/**
 * Read the environment and say what is wrong with it.
 *
 * Severity is the difference between "customers are fine but the kitchen is
 * deaf" (`error`) and "this works, but it will land in spam" (`warn`). The boot
 * log prints errors as warnings; the checker exits non-zero only on `error`, so
 * it can be wired to a monitor without crying wolf.
 */
export function notificationSetup() {
  const owner = emailConfig();
  const customer = customerEmailConfig();
  const push = pushStatus();
  const origin = publicBaseUrl();
  const hasOwnerKey = Boolean(ownerKey());

  const issues = [];
  const error = (code, message) => issues.push({ severity: 'error', code, message });
  const warn = (code, message) => issues.push({ severity: 'warn', code, message });

  /* 1. Can the kitchen be reached at all? Email and/or a push to an enrolled device. */
  if (!owner && !push.configured) {
    error(
      'kitchen-unreachable',
      'The kitchen cannot be told about an order: no SMTP account (HB_SMTP_*) and no working push keys. ' +
        'Every order will be saved and never announced. Fill in notifications.env.example and restart.',
    );
  } else if (push.configured && !push.ownerDevices && !owner) {
    error(
      'kitchen-unreachable',
      'Push is configured but no kitchen device has enrolled, and there is no SMTP fallback. ' +
        'Open /alerts on the kitchen phone with HB_OWNER_PUSH_KEY and enrol it.',
    );
  }

  /* 2. The password is the one value people forget to replace. */
  const smtpPassword = String(process.env.HB_SMTP_PASS ?? '');
  const customerPassword = String(process.env.HB_CUSTOMER_SMTP_PASS ?? '');
  const unfilled = [smtpPassword, customerPassword].filter((value) => value && looksUnfilled(value));
  if (unfilled.length) {
    error(
      'password-not-set',
      'The mail password is still the text from the template. Replace HB_SMTP_PASS with the ' +
        '16-character App Password (Google Account -> Security -> App passwords), or the login will be refused ' +
        'for a reason that has nothing to do with the real password.',
    );
  }

  /* 3. The alert address is where the ticket goes; a typo sends it nowhere. */
  if (owner && !looksLikeEmail(owner.to)) {
    error('alert-address-invalid', `HB_ORDER_ALERT_EMAIL (${owner.to}) is not an email address, so kitchen tickets will bounce.`);
  }

  /* 4. The tracking link the customer clicks. */
  const problem = originProblem(origin);
  if (problem && (customer || owner)) {
    /* Only fatal when a customer will actually receive a link. */
    (customer ? error : warn)('public-url', problem);
  }

  /* 5. Push keys are useless without the password that lets a device enrol. */
  if (push.reason === 'no-owner-key') {
    error(
      'no-owner-key',
      'HB_VAPID_* are set but HB_OWNER_PUSH_KEY is missing (or shorter than 16 characters), ' +
        'so no kitchen phone can ever enrol and no push is sent. Generate one with `npm run push:keys`.',
    );
  }
  if (push.reason === 'invalid-keys' || push.reason === 'invalid-subject') {
    error('push-keys', `Push is switched on but unusable (${push.reason}). Run \`npm run push:keys\` and replace HB_VAPID_*.`);
  }

  /* 6. Silent modes that look configured. */
  if (process.env.HB_PUSH_DRY_RUN === 'true') {
    warn('push-dry-run', 'HB_PUSH_DRY_RUN=true: pushes are logged, not delivered. Fine on a laptop, fatal on the live site.');
  }
  if (owner && !customer) {
    warn(
      'customer-email-off',
      'Kitchen tickets are on but customers get no receipt: set HB_SMTP_* (already set) and check ' +
        'HB_CUSTOMER_EMAIL_ENABLED is not "false". Customers only get mail if they typed an address.',
    );
  }
  if (customer && !customer.dedicated) {
    warn(
      'shared-sender',
      "Customer receipts are sent from the kitchen's own account, so a share will land in spam. " +
        'Adding HB_CUSTOMER_SMTP_* (a verified sending domain) fixes that without changing anything else.',
    );
  }

  return {
    /* What the live process would actually do, not what the file says. */
    kitchenEmail: owner ? { to: owner.to, host: owner.host, port: owner.port, secure: owner.secure } : null,
    customerEmail: customer ? { dedicated: Boolean(customer.dedicated), from: customer.from ?? null } : null,
    push,
    ownerKeySet: hasOwnerKey,
    origin,
    originIsPlaceholder: origin === PLACEHOLDER_ORIGIN,
    issues,
    /** True only when nothing at `error` severity is outstanding. */
    ready: !issues.some((issue) => issue.severity === 'error'),
  };
}
