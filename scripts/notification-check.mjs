#!/usr/bin/env node
/**
 * Notification health check — the loud one.
 *
 * Free notification tiers fail quietly. A Gmail App Password gets revoked when
 * someone changes the account password; Brevo suspends an account for a bounce
 * rate; the push key pair is rotated. In every case the site keeps taking
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

say(`Heritage Bites notifications — ${BASE}`);
say(`  orders stored:        ${health.orders}`);
say('');
/*
 * Email alerts are gone. They needed an SMTP host, port and app password
 * configured on the server — infrastructure work rather than "enter your
 * address" — so the kitchen is alerted by Web Push only.
 */
const PUSH_REASON = {
  ready: () => 'ready',
  'missing-keys': () => 'NOT CONFIGURED (run `npm run push:keys`)',
  'invalid-keys': () => 'BROKEN — HB_VAPID_* is not a valid key pair, so every push would fail',
  'invalid-subject': () => 'BROKEN — HB_VAPID_SUBJECT must be a mailto: or https: URL',
  'no-owner-key': () => 'keys set but NO HB_OWNER_PUSH_KEY, so no kitchen device can enrol',
  disabled: () => 'switched OFF (HB_PUSH_ENABLED=false)',
};
const pushLine = (n.push?.reason && PUSH_REASON[n.push.reason]?.()) ?? 'unknown state';
say(`  web push:             ${pushLine}${n.push?.configured
  ? ` — ${n.push.ownerDevices} kitchen device(s), ${n.push.customerDevices} customer device(s)`
  : ''}`);
say('');

/*
 * Push is the only channel. The one thing the owner has to do is generate the
 * VAPID pair, set HB_OWNER_PUSH_KEY, and enrol the kitchen device at /alerts —
 * no email account, no SMTP host, no password on the server.
 */
if (!n.push?.configured) {
  problems.push('No channel can reach the kitchen: run `npm run push:keys`, set HB_VAPID_* and HB_OWNER_PUSH_KEY, then open /alerts on the kitchen device.');
}
if (n.push?.reason === 'invalid-keys' || n.push?.reason === 'invalid-subject') {
  problems.push(`Push keys are present but unusable (${n.push.reason}). Run \`npm run push:keys\` and replace both halves.`);
}
if (n.push?.reason === 'no-owner-key') {
  problems.push('Push keys are fine but HB_OWNER_PUSH_KEY is missing, so the kitchen phone can never enrol.');
}
if ((n.push?.failingOwnerDevices ?? 0) > 0) {
  problems.push(`${n.push.failingOwnerDevices} kitchen device(s) have failed three or more sends in a row — `
    + 'the browser subscription is probably dead. Open /alerts on that device and enrol it again.');
}
if (n.push?.configured && (n.push.ownerDevices ?? 0) === 0) {
  problems.push('Push is configured but no kitchen device has enrolled: open /alerts on the kitchen phone or tablet and enrol it.');
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
