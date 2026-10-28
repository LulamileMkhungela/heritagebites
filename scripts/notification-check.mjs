#!/usr/bin/env node
/**
 * Notification health check — the loud one.
 *
 * Free notification tiers fail quietly. A Gmail App Password gets revoked when
 * someone changes the account password; Brevo suspends an account for a bounce
 * rate; a Telegram bot token is rotated. In every case the site keeps taking
 * orders and nothing tells the kitchen. This script is meant to run on a schedule
 * (cron, a GitHub Action, an uptime monitor) and exit non-zero so somebody is
 * told, rather than trusting a "no news is good news" dashboard.
 *
 * It reads the live API rather than the store, so it also proves the process is
 * up and the worker is answering.
 *
 *   node scripts/notification-check.mjs            # human output, exit 1 on trouble
 *   HB_BASE=https://heritagebites.co.za node scripts/notification-check.mjs
 *
 * Exit codes: 0 healthy, 1 a channel is down or jobs failed, 2 the API is unreachable.
 */

const BASE = (process.env.HB_BASE || process.env.SMOKE_BASE || 'http://127.0.0.1:4000').replace(/\/+$/, '');

const say = (line = '') => console.log(line);
const problems = [];
const notes = [];

let health;
try {
  const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  health = await res.json();
} catch (error) {
  console.error(`✗ Cannot reach the Heritage Bites API at ${BASE}: ${error?.message ?? error}`);
  console.error('  Nothing in this check can be trusted until the API is up.');
  process.exit(2);
}

const n = health.notifications ?? {};
const outbox = n.outbox ?? {};

say(`Heritage Bites notifications — ${BASE}`);
say(`  orders stored:        ${health.orders}`);
say('');
say(`  owner email:          ${n.ownerEmail ? 'configured' : 'NOT CONFIGURED'}`);
say(`  customer email:       ${n.customerEmail
  ? `configured (${n.customerEmailDedicated ? 'own verified domain' : "shared with the owner's account"})`
  : 'NOT CONFIGURED'}`);
say(`  telegram push:        ${n.telegram ? 'configured' : 'NOT CONFIGURED'}`);
say(`  tracking link origin: ${n.publicUrl ?? 'unknown'}`);
say('');
say(`  outbox:               ${outbox.pending ?? 0} pending · ${outbox.retrying ?? 0} retrying · `
  + `${outbox.waitingConfig ?? 0} waiting for config · ${outbox.failed ?? 0} failed · ${outbox.sent ?? 0} sent`);

if (!n.ownerEmail && !n.telegram) {
  problems.push('No channel can reach the kitchen: set HB_SMTP_* (owner email) and/or HB_TELEGRAM_* .');
}
if (!n.customerEmail) {
  notes.push('Customers get no receipt email. Set HB_SMTP_* or HB_CUSTOMER_SMTP_* to turn it on.');
}
if (n.customerEmail && !n.customerEmailDedicated) {
  notes.push("Customer receipts are sent from the owner's Gmail account, which lands in spam more often. "
    + 'For a verified sending domain, add HB_CUSTOMER_SMTP_* (Brevo free plan, 300/day, no card).');
}
if ((outbox.waitingConfig ?? 0) > 0) {
  problems.push(`${outbox.waitingConfig} order(s) were taken before notifications were configured and are still waiting to be sent.`);
}
if ((outbox.retrying ?? 0) > 0) {
  notes.push(`${outbox.retrying} job(s) failed once and are being retried — check the provider is reachable.`);
}
if ((outbox.stuck ?? 0) > 0) {
  problems.push(`${outbox.stuck} notification(s) have been stuck for more than 15 minutes.`);
}
if ((outbox.failed ?? 0) > 0) {
  problems.push(`${outbox.failed} notification job(s) gave up after five attempts. Read data/runtime/orderNotificationJobs.json and resend by hand.`);
}
if (!n.telegram && n.ownerEmail) {
  notes.push('Email alone is not a push notification. A free Telegram bot puts each order on the owner\'s phone.');
}

if (notes.length) {
  say('');
  for (const note of notes) say(`  note: ${note}`);
}

if (problems.length || n.healthy === false) {
  say('');
  for (const problem of problems.length ? problems : ['notifications.healthy is false.']) {
    console.error(`✗ ${problem}`);
  }
  console.error('');
  console.error('A paying customer can place an order that nobody hears about. Fix this before the next service window.');
  process.exit(1);
}

say('');
say('✓ Kitchen alerts and customer receipts are configured, and no job is stuck or failed.');
process.exit(0);
