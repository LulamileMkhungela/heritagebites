/**
 * Background order notifications — free-tier email.
 *
 * Two email channels, neither of which needs a paid message provider or a card:
 *
 *   owner-email     the kitchen ticket, to HB_ORDER_ALERT_EMAIL (or settings.email)
 *   customer-email  the customer's receipt + private tracking link, when they left
 *                   an address and HB_CUSTOMER_EMAIL_ENABLED is not "false"
 *
 * Web Push (server/lib/web-push.js) is the instant channel and is sent straight
 * from the request, not through this outbox: a push is either delivered in
 * seconds or not worth delivering, whereas email wants retries.
 *
 * WhatsApp is deliberately a *tap-to-send* channel, not an automated one: the
 * receipt page builds a pre-filled wa.me link the customer (or owner) presses, so
 * the message is sent by a person from their own WhatsApp. That is free and
 * unlimited. Automated WhatsApp push would need Meta's Cloud API, business
 * verification and per-template charges, which this build does not use.
 *
 * The durable JSON outbox keeps checkout independent from SMTP availability: the order is saved first, then one small job per channel is
 * added. A single worker reads the saved order and retries delivery. For live,
 * multi-instance service, move this outbox into the same transactional database
 * as orders.
 */
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { store } from './store.js';
import { whatsappLink } from './notify.js';
import { pushStatus } from './web-push.js';

const JOB_STORE = 'orderNotificationJobs';
const MAX_ATTEMPTS = 5;
const POLL_MS = Math.max(1000, Number(process.env.HB_ORDER_EMAIL_POLL_MS) || 5000);
const STALE_SENDING_MS = 2 * 60 * 1000;
const RETRY_DELAYS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const DEFAULT_PUBLIC_URL = 'https://heritagebites.co.za';

/** Channels that are delivered by the SMTP transport. */
export const EMAIL_CHANNELS = ['owner-email', 'customer-email'];

const CUSTOMER_EMAIL = 'customer-email';
const OWNER_EMAIL = 'owner-email';

let workerStarted = false;
let workerBusy = false;
let workerTimer;

const money = (value) => `R${Number(value || 0).toFixed(2)}`;

function fulfilmentName(value) {
  return value === 'delivery' ? 'Delivery' : 'Collection';
}

function paymentName(value) {
  return ({
    card: 'Card (Yoco)',
    'cash-on-collection': 'Cash on collection',
  })[value] ?? 'Manual';
}

/** Payment status in words a customer understands, not gateway jargon. */
function paymentStatusName(value) {
  return ({
    approved: 'paid',
    pending: 'to be paid on collection',
    declined: 'not paid',
    refunded: 'refunded',
  })[value] ?? 'pending';
}

/** Jobs written before channels existed have no `channel` field. */
function jobChannel(job) {
  return job?.channel ?? OWNER_EMAIL;
}

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());

/* ------------------------------ Formatting ----------------------------- */

function optionSuffix(item) {
  return item.options?.length ? ` (${item.options.map((option) => option.label).join(', ')})` : '';
}

/** Build a plain-text email without including a tracking token or card data. */
export function formatOrderAlert(order) {
  const lines = [
    `New Heritage Bites order ${order.code}`,
    '',
    `Placed: ${order.createdAt ?? 'time unavailable'}`,
    `Type: ${fulfilmentName(order.fulfilment)}`,
    `Payment: ${paymentName(order.payment?.method)} (${order.payment?.status ?? 'pending'})`,
    ...(order.serviceWindow?.label
      ? [`Service window: ${order.serviceWindow.label}${order.serviceWindow.isPreOrder ? ' (pre-order)' : ''}`]
      : []),
    '',
    'ORDER',
  ];

  for (const item of order.items ?? []) {
    lines.push(`- ${item.qty} × ${item.name}${optionSuffix(item)}: ${money(item.lineTotal)}`);
  }

  lines.push('');
  lines.push(`Subtotal: ${money(order.totals?.subtotal)}`);
  if (Number(order.totals?.delivery) > 0) lines.push(`Delivery: ${money(order.totals.delivery)}`);
  if (Number(order.totals?.discount) > 0) lines.push(`Discount: -${money(order.totals.discount)}`);
  lines.push(`TOTAL: ${money(order.totals?.total)}`);
  lines.push('');
  lines.push('CUSTOMER');
  lines.push(`Name: ${order.customer?.name || 'Not supplied'}`);
  lines.push(`Phone: ${order.customer?.phone || 'Not supplied'}`);
  if (order.customer?.email) lines.push(`Email: ${order.customer.email}`);
  if (order.fulfilment === 'delivery' && order.customer?.address) {
    if (order.customer.suburb) lines.push(`Delivery area: ${order.customer.suburb}`);
    lines.push(`Delivery address: ${order.customer.address}`);
  }
  if (order.fulfilment === 'collection') lines.push('Collection point: confirm the Standard Bank Rosebank/Sandton point with the customer.');
  if (order.customer?.notes) lines.push(`Notes: ${order.customer.notes}`);

  return {
    subject: `New Heritage Bites order ${order.code}`,
    text: lines.join('\n'),
  };
}

/**
 * The customer's own copy.
 *
 * Plain text on purpose: it renders everywhere, cannot be mangled into a
 * phishing-looking HTML shell, and carries no remote images to trip spam filters.
 * The only link that is not published on the website is the private tracking URL,
 * which is why it is built from the one-time token handed out at checkout.
 */
export function formatCustomerReceipt(order, options = {}) {
  const settings = options.settings ?? {};
  const trackingUrl = options.trackingUrl ?? '';
  const phoneDisplay = options.phoneDisplay || settings.phoneDisplay || settings.phone || '';
  const supportEmail = options.supportEmail || settings.email || '';
  const whatsappUrl = options.whatsappUrl
    || (settings.whatsapp
      ? whatsappLink(settings.whatsapp, `Hi Heritage Bites, about order ${order.code}`)
      : '');
  const firstName = String(order.customer?.name ?? '').trim().split(/\s+/)[0];

  const lines = [
    `Hi ${firstName || 'there'},`,
    '',
    'Thank you — your Heritage Bites order is with the kitchen.',
    '',
    `ORDER ${order.code}`,
    `Placed: ${order.createdAt ?? 'time unavailable'}`,
    `Type: ${fulfilmentName(order.fulfilment)}`,
    `Payment: ${paymentName(order.payment?.method)} (${paymentStatusName(order.payment?.status)})`,
  ];

  if (order.serviceWindow?.label) {
    const preOrder = order.serviceWindow.isPreOrder ? ' (pre-order for the next window)' : '';
    lines.push(`Service window: ${order.serviceWindow.label}${preOrder}`);
  }

  lines.push('');
  for (const item of order.items ?? []) {
    lines.push(`• ${item.qty} × ${item.name}${optionSuffix(item)} — ${money(item.lineTotal)}`);
  }

  lines.push('');
  if (Number(order.totals?.discount) > 0) {
    lines.push(`Subtotal: ${money(order.totals?.subtotal)}`);
    if (Number(order.totals?.delivery) > 0) lines.push(`Delivery: ${money(order.totals.delivery)}`);
    lines.push(`Discount: -${money(order.totals.discount)}`);
  }
  lines.push(`TOTAL: ${money(order.totals?.total)}`);

  lines.push('');
  if (order.fulfilment === 'delivery') {
    lines.push('DELIVERY');
    const where = [order.customer?.suburb, order.customer?.address].filter(Boolean).join(' — ');
    lines.push(
      `We deliver to ${where || 'the address you gave us'}. Delivery is included in the plate price and takes about 30 minutes inside the service window.`,
    );
  } else {
    lines.push('COLLECTION');
    lines.push(
      'Collect from our shadow kitchen at Standard Bank, Rosebank and Sandton. We confirm the exact collection point on WhatsApp before your window.',
    );
  }

  if (trackingUrl) {
    lines.push('');
    lines.push('FOLLOW YOUR ORDER');
    lines.push('This private link opens your receipt and its progress. Keep it to yourself — anyone who has it can read the order:');
    lines.push(trackingUrl);
  }

  lines.push('');
  lines.push('NEED SOMETHING?');
  if (whatsappUrl) lines.push(`WhatsApp us: ${whatsappUrl}`);
  if (phoneDisplay) lines.push(`Call: ${phoneDisplay}`);
  if (supportEmail) lines.push(`Email: ${supportEmail}`);
  lines.push('');
  lines.push(
    'WhatsApp replies are written by a person during kitchen hours, so they are not instant. Replying to this email reaches the same inbox the kitchen watches.',
  );
  lines.push('');
  lines.push(`If you did not place order ${order.code}, please ignore this email.`);
  lines.push('— Heritage Bites');

  return {
    subject: `Heritage Bites receipt — order ${order.code}`,
    text: lines.join('\n'),
  };
}

/* -------------------------------- Config ------------------------------- */

/** Public origin used to build tracking links. Never guessed from a request. */
export function publicBaseUrl() {
  const configured = String(process.env.HB_PUBLIC_URL ?? '').trim();
  return (configured || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
}

export function trackingUrlFor(order, token) {
  if (!token) return '';
  return `${publicBaseUrl()}/order/${encodeURIComponent(order.code)}?token=${encodeURIComponent(token)}`;
}

/**
 * Read one SMTP block, e.g. HB_SMTP_* or HB_CUSTOMER_SMTP_*.
 * Returns null unless every value needed to send is present.
 */
function readSmtp(prefix) {
  const host = process.env[`${prefix}HOST`]?.trim();
  const port = Number(process.env[`${prefix}PORT`] || 465);
  const user = process.env[`${prefix}USER`]?.trim();
  const pass = process.env[`${prefix}PASS`];
  const from = process.env[`${prefix}FROM`]?.trim() || user;
  const secureRaw = process.env[`${prefix}SECURE`];

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) return null;

  return {
    host,
    port,
    secure: secureRaw === undefined ? port === 465 : secureRaw === 'true',
    user,
    pass,
    from,
  };
}

/** The kitchen ticket: the owner's own inbox, on the owner's SMTP account. */
export function emailConfig() {
  if (process.env.HB_ORDER_EMAIL_ENABLED === 'false') return null;

  const smtp = readSmtp('HB_SMTP_');
  if (!smtp) return null;

  const settings = store.load('settings', {}) ?? {};
  const settingsEmail = typeof settings.email === 'string' ? settings.email.trim() : '';
  const to = process.env.HB_ORDER_ALERT_EMAIL?.trim() || settingsEmail;
  if (!to) return null;

  return { ...smtp, to };
}

/**
 * Customer receipts, which may use a different account from the kitchen ticket.
 *
 * Deliverability is the reason this is separate. The owner's inbox is a Gmail
 * address, and mail sent from gmail.com while its links point at
 * heritagebites.co.za is the classic shape of spoofed mail: a fair share of
 * receipts end up in spam. A transactional provider with a verified sending
 * domain (Brevo's free plan is 300 emails/day, no card) lands far more reliably.
 *
 * So: HB_SMTP_* carries the kitchen ticket on Gmail, and if HB_CUSTOMER_SMTP_* is
 * set, receipts go out through the verified provider instead. Without it, both
 * channels share the owner's account — still free, just more likely to be
 * filtered.
 */
export function customerEmailConfig() {
  if (process.env.HB_ORDER_EMAIL_ENABLED === 'false') return null;
  if (process.env.HB_CUSTOMER_EMAIL_ENABLED === 'false') return null;

  /* A dedicated block wins; otherwise inherit the owner's credentials. */
  const dedicated = readSmtp('HB_CUSTOMER_SMTP_');
  const smtp = dedicated ?? readSmtp('HB_SMTP_');
  if (!smtp) return null;

  const owner = emailConfig();
  return {
    ...smtp,
    /** Where a reply to a receipt should land. */
    replyTo: owner?.to ?? null,
    dedicated: Boolean(dedicated),
  };
}

/**
 * What is actually wired up — booleans only, no addresses or secrets.
 *
 * `outbox` is the loud part: free tiers fail silently (an expired app password,
 * a suspended provider, a revoked bot), so pending/failed counts are exposed for
 * an uptime monitor to alert on. See `scripts/notification-check.mjs`.
 */
export function notifyStatus() {
  const owner = emailConfig();
  const customer = customerEmailConfig();
  const push = pushStatus();
  const jobs = store.load(JOB_STORE, []) ?? [];

  const waitingConfig = jobs.filter((job) => job.status === 'waiting_config').length;
  const failed = jobs.filter((job) => job.status === 'failed').length;
  /*
   * A job that has already errored and is waiting to retry. Zero of these is the
   * only genuinely quiet state: it means every notification so far went out on
   * its first attempt.
   */
  const retrying = jobs.filter((job) => job.status === 'pending' && (job.attempts ?? 0) >= 1 && job.lastError).length;
  /*
   * Anything that has been stuck for more than 15 minutes is no longer a blip.
   * Two service windows' worth of orders going unheard is a business problem, not
   * a network hiccup, so it counts as unhealthy.
   */
  const staleMs = 15 * 60 * 1000;
  const stuck = jobs.filter((job) => {
    if (!['pending', 'sending', 'waiting_config'].includes(job.status)) return false;
    const since = Date.parse(job.startedAt ?? job.createdAt ?? '');
    return Number.isFinite(since) && Date.now() - since > staleMs;
  }).length;

  /*
   * Push that was attempted and is broken counts against health even when email
   * works. Someone set the keys and believes the kitchen phone buzzes; a green
   * dashboard would keep that belief alive until an order goes unheard.
   * Missing keys are different — push may simply not be in use yet.
   */
  const pushBroken = ['invalid-keys', 'invalid-subject', 'no-owner-key'].includes(push.reason)
    /* An enrolled kitchen device that keeps failing is enrolled but deaf. */
    || (push.failingOwnerDevices ?? 0) > 0;

  return {
    ownerEmail: Boolean(owner),
    customerEmail: Boolean(customer),
    /* True when receipts go through their own verified-domain account. */
    customerEmailDedicated: Boolean(customer?.dedicated),
    push,
    publicUrl: publicBaseUrl(),
    /**
     * One boolean for a monitor to alert on.
     *
     * Free tiers fail silently: an app password is revoked, a provider suspends
     * the account, a bot token is rotated — and nothing sounds. `healthy` is false
     * while no channel can reach the kitchen, while orders sit un-sendable for
     * want of configuration, or after any job has given up. It is deliberately
     * strict, because a quiet kitchen is worse than a noisy monitor.
     */
    healthy: (Boolean(owner || push.configured) && !pushBroken)
      && waitingConfig === 0 && failed === 0 && stuck === 0,
    outbox: {
      waitingConfig,
      pending: jobs.filter((job) => job.status === 'pending' || job.status === 'sending').length,
      retrying,
      stuck,
      failed,
      sent: jobs.filter((job) => job.status === 'sent').length,
    },
  };
}

/* -------------------------------- Outbox ------------------------------- */

function updateJob(id, patch) {
  store.update(JOB_STORE, [], (jobs) => jobs.map((job) => (
    job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job
  )));
}

/**
 * Queue one job per channel that applies to this order.
 *
 * Queue order matters: jobs are prepended, so the owner's ticket is queued after
 * the customer's receipt and is therefore claimed first. The kitchen never waits
 * behind a customer email, and a broken customer address cannot delay the ticket.
 *
 * A job also carries the one-time tracking token *until it is sent*, so the
 * receipt can deep-link into the private order page. The saved order still keeps
 * only the token digest; the token is cleared from the job the moment delivery
 * succeeds or fails permanently.
 */
export function enqueueOrderAlert(order, context = {}) {
  if (!order?.code) throw new Error('Cannot queue an order alert without an order code.');

  const email = emailConfig();
  const customer = customerEmailConfig();
  const createdAt = new Date().toISOString();
  const plans = [];

  if (customer && validEmail(order.customer?.email)) {
    plans.push({ channel: CUSTOMER_EMAIL, status: 'pending', trackingToken: context.trackingToken ?? null });
  }
  /* Always queued, even without SMTP: it waits as `waiting_config` so an order
     taken before the App Password exists is still emailed once the worker starts. */
  plans.push({ channel: OWNER_EMAIL, status: email ? 'pending' : 'waiting_config' });

  const queued = [];

  store.update(JOB_STORE, [], (jobs) => {
    let next = jobs;
    for (const plan of plans) {
      if (next.some((job) => job.orderCode === order.code && jobChannel(job) === plan.channel)) continue;
      const job = {
        id: randomUUID(),
        orderCode: order.code,
        channel: plan.channel,
        status: plan.status,
        attempts: 0,
        createdAt,
        startedAt: null,
        nextAttemptAt: plan.status === 'pending' ? createdAt : null,
        sentAt: null,
        messageId: null,
        lastError: null,
        ...(plan.trackingToken ? { trackingToken: plan.trackingToken } : {}),
      };
      next = [job, ...next];
      queued.push(job);
    }
    return next;
  });

  return queued;
}

function claimNextJob(accept) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let claimed = null;

  store.update(JOB_STORE, [], (jobs) => {
    const index = jobs.findIndex((job) => {
      if (!accept(job)) return false;
      if (job.status === 'waiting_config') return true;
      if (job.status === 'pending') return !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now;
      return job.status === 'sending' && job.startedAt && now - Date.parse(job.startedAt) > STALE_SENDING_MS;
    });
    if (index < 0) return jobs;

    const old = jobs[index];
    claimed = {
      ...old,
      status: 'sending',
      attempts: (old.attempts ?? 0) + 1,
      startedAt: nowIso,
      nextAttemptAt: null,
    };
    const next = [...jobs];
    next[index] = claimed;
    return next;
  });

  return claimed;
}

function savedOrder(orderCode) {
  return store.load('orders', []).find((order) => order.code === orderCode);
}

function failJob(job, error, terminal = true) {
  updateJob(job.id, {
    status: terminal ? 'failed' : 'pending',
    lastError: String(error).slice(0, 400),
    nextAttemptAt: terminal ? null : new Date(Date.now() + RETRY_DELAYS[Math.min((job.attempts ?? 1) - 1, RETRY_DELAYS.length - 1)]).toISOString(),
    /* The receipt has either gone out or never will; stop holding the secret. */
    ...(job.trackingToken ? { trackingToken: null } : {}),
  });
}

/** One email job — the owner ticket or the customer receipt. */
export async function processNextOrderAlert(transport, config) {
  if (workerBusy) return;
  workerBusy = true;

  try {
    const job = claimNextJob((candidate) => EMAIL_CHANNELS.includes(jobChannel(candidate)));
    if (!job) return;

    const channel = jobChannel(job);
    const order = savedOrder(job.orderCode);
    if (!order) {
      failJob(job, 'The saved order could not be found.');
      return;
    }

    const settings = store.load('settings', {}) ?? {};
    const isReceipt = channel === CUSTOMER_EMAIL;
    const message = isReceipt
      ? formatCustomerReceipt(order, {
        settings,
        trackingUrl: trackingUrlFor(order, job.trackingToken),
      })
      : formatOrderAlert(order);
    const to = isReceipt ? String(order.customer?.email ?? '').trim() : config.to;

    if (!to) {
      failJob(job, 'No customer email address was saved with this order.');
      console.error(`[order-notifications] order ${order.code} ${channel} skipped: no recipient`);
      return;
    }

    /* A receipt goes out through the verified-domain account when one exists, so
       it is not filtered for coming from gmail.com. Older callers pass only one
       transport; the receipt then uses it and the shared sender. */
    const receiptConfig = isReceipt ? config.customer : null;
    const sendWith = isReceipt && config.customerTransport ? config.customerTransport : transport;
    const from = isReceipt && receiptConfig ? receiptConfig.from : config.from;
    const replyTo = isReceipt ? (receiptConfig?.replyTo ?? config.to) : undefined;

    try {
      const result = await sendWith.sendMail({
        from,
        to,
        subject: message.subject,
        text: message.text,
        /* A customer replying to their receipt reaches the kitchen inbox. */
        ...(replyTo ? { replyTo } : {}),
      });
      updateJob(job.id, {
        status: 'sent',
        sentAt: new Date().toISOString(),
        messageId: result.messageId ?? null,
        lastError: null,
        nextAttemptAt: null,
        ...(job.trackingToken ? { trackingToken: null } : {}),
      });
      console.info(`[order-notifications] emailed ${channel} for order ${order.code}`);
    } catch (error) {
      const terminal = (job.attempts ?? 1) >= MAX_ATTEMPTS;
      failJob(job, error?.message ?? error, terminal);
      console.error(`[order-notifications] order ${order.code} ${channel} ${terminal ? 'failed permanently' : 'will retry'}: ${String(error?.message ?? error).slice(0, 200)}`);
    }
  } finally {
    workerBusy = false;
  }
}

/* -------------------------------- Worker ------------------------------- */

function transportFor(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * Start one non-blocking worker. It runs whichever channels are configured and
 * stays quiet when none are, so checkout never depends on notification setup.
 */
export function startOrderNotificationWorker() {
  if (workerStarted) return true;

  const email = emailConfig();
  const customer = customerEmailConfig();
  if (!email && !customer) {
    console.info('[order-notifications] no SMTP configuration yet; orders are still saved');
    return false;
  }

  /* One connection per account: reusing the owner's transport when the receipt
     inherits its credentials keeps the pool and the login count honest. */
  const ownerTransport = email ? transportFor(email) : null;
  const sameAccount = customer && email
    && customer.host === email.host && customer.port === email.port && customer.user === email.user;
  const customerTransport = customer
    ? (sameAccount ? ownerTransport : transportFor(customer))
    : null;
  const emailTransport = ownerTransport ?? customerTransport;
  const emailConfigForWorker = {
    ...(email ?? {}),
    ...(customer ? { customer, customerTransport } : {}),
  };

  workerStarted = true;
  const run = async () => {
    if (emailTransport) {
      await processNextOrderAlert(emailTransport, emailConfigForWorker).catch((error) => {
        console.error(`[order-notifications] email worker error: ${String(error?.message ?? error).slice(0, 200)}`);
      });
    }
    if (!workerStarted) return;
    workerTimer = setTimeout(run, POLL_MS);
    workerTimer.unref?.();
  };

  workerTimer = setTimeout(run, 0);
  workerTimer.unref?.();

  const parts = [
    email ? `owner email → ${email.to}` : null,
    customer
      ? `customer receipts → ${customer.dedicated ? 'own verified account' : "owner's account (check spam)"}`
      : null,
  ].filter(Boolean);
  console.info(`[order-notifications] worker enabled (${parts.join(', ')})`);
  return true;
}
