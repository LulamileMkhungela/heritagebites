/**
 * Background email alerts for newly placed orders.
 *
 * The durable JSON outbox keeps checkout independent from SMTP availability:
 * the order is saved first, then a small job containing only its code is added.
 * A single worker reads the saved order and retries email delivery. For live,
 * multi-instance service, move this outbox into the same transactional database
 * as orders.
 */
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { store } from './store.js';

const JOB_STORE = 'orderNotificationJobs';
const MAX_ATTEMPTS = 5;
const POLL_MS = Math.max(1000, Number(process.env.HB_ORDER_EMAIL_POLL_MS) || 5000);
const STALE_SENDING_MS = 2 * 60 * 1000;
const RETRY_DELAYS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

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
    const options = item.options?.length ? ` (${item.options.map((option) => option.label).join(', ')})` : '';
    lines.push(`- ${item.qty} × ${item.name}${options}: ${money(item.lineTotal)}`);
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

function emailConfig() {
  if (process.env.HB_ORDER_EMAIL_ENABLED === 'false') return null;

  const host = process.env.HB_SMTP_HOST?.trim();
  const port = Number(process.env.HB_SMTP_PORT || 465);
  const user = process.env.HB_SMTP_USER?.trim();
  const pass = process.env.HB_SMTP_PASS;
  const from = process.env.HB_SMTP_FROM?.trim() || user;
  const settings = store.load('settings', {}) ?? {};
  const settingsEmail = typeof settings.email === 'string' ? settings.email.trim() : '';
  const to = process.env.HB_ORDER_ALERT_EMAIL?.trim() || settingsEmail;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from || !to) return null;

  return {
    host,
    port,
    secure: process.env.HB_SMTP_SECURE === undefined
      ? port === 465
      : process.env.HB_SMTP_SECURE === 'true',
    user,
    pass,
    from,
    to,
  };
}

/** Add exactly one outbox job per order. Missing SMTP config never blocks checkout. */
export function enqueueOrderAlert(order) {
  if (!order?.code) throw new Error('Cannot queue an order alert without an order code.');
  const configured = Boolean(emailConfig());
  const createdAt = new Date().toISOString();
  let queued;

  store.update(JOB_STORE, [], (jobs) => {
    const existing = jobs.find((job) => job.orderCode === order.code);
    if (existing) {
      queued = existing;
      return jobs;
    }

    queued = {
      id: randomUUID(),
      orderCode: order.code,
      status: configured ? 'pending' : 'waiting_config',
      attempts: 0,
      createdAt,
      nextAttemptAt: configured ? createdAt : null,
      lastError: null,
    };
    return [queued, ...jobs];
  });

  return queued;
}

function updateJob(id, patch) {
  store.update(JOB_STORE, [], (jobs) => jobs.map((job) => (
    job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job
  )));
}

function claimNextJob() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let claimed = null;

  store.update(JOB_STORE, [], (jobs) => {
    const index = jobs.findIndex((job) => {
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

export async function processNextOrderAlert(transport, config) {
  if (workerBusy) return;
  workerBusy = true;

  try {
    const job = claimNextJob();
    if (!job) return;

    const order = savedOrder(job.orderCode);
    if (!order) {
      updateJob(job.id, {
        status: 'failed',
        lastError: 'The saved order could not be found.',
        nextAttemptAt: null,
      });
      return;
    }

    try {
      const message = formatOrderAlert(order);
      const result = await transport.sendMail({
        from: config.from,
        to: config.to,
        subject: message.subject,
        text: message.text,
      });
      updateJob(job.id, {
        status: 'sent',
        sentAt: new Date().toISOString(),
        messageId: result.messageId ?? null,
        lastError: null,
        nextAttemptAt: null,
      });
      console.info(`[order-notifications] emailed order ${order.code}`);
    } catch (error) {
      const terminal = job.attempts >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS[Math.min(job.attempts - 1, RETRY_DELAYS.length - 1)];
      updateJob(job.id, {
        status: terminal ? 'failed' : 'pending',
        lastError: String(error?.message ?? error).slice(0, 400),
        nextAttemptAt: terminal ? null : new Date(Date.now() + delay).toISOString(),
      });
      console.error(`[order-notifications] order ${order.code} email ${terminal ? 'failed permanently' : 'will retry'}: ${String(error?.message ?? error).slice(0, 200)}`);
    }
  } finally {
    workerBusy = false;
  }
}

/** Start one non-blocking worker. Call after SMTP secrets are configured. */
export function startOrderNotificationWorker() {
  if (workerStarted) return true;
  const config = emailConfig();
  if (!config) {
    console.info('[order-notifications] waiting for SMTP configuration; orders will still be saved');
    return false;
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  workerStarted = true;
  const run = async () => {
    await processNextOrderAlert(transport, config).catch((error) => {
      console.error(`[order-notifications] worker error: ${String(error?.message ?? error).slice(0, 200)}`);
    });
    if (!workerStarted) return;
    workerTimer = setTimeout(run, POLL_MS);
    workerTimer.unref?.();
  };

  workerTimer = setTimeout(run, 0);
  workerTimer.unref?.();
  console.info(`[order-notifications] email worker enabled for ${config.to}`);
  return true;
}
