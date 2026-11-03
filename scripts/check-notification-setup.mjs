#!/usr/bin/env node
/**
 * Fill-in-the-blanks check for the notification details.
 *
 * `npm run notify:check` asks the *live site* what it thinks. This asks the
 * settings themselves, before the site is ever started, and then proves them by
 * logging in to the mail account and sending a message.
 *
 * That difference matters. A health endpoint can only report what the process
 * read: it will happily say "owner email: configured" while the App Password was
 * revoked last Tuesday, because nothing has tried to log in yet. Here the login
 * is the test.
 *
 *   npm run check:notifications                     # read .env, test the login, send to the kitchen
 *   npm run check:notifications -- --to me@x.com    # also send a test receipt to that address
 *   npm run check:notifications -- --dry-run        # report only, send nothing
 *
 * Exit codes: 0 everything a customer needs is in place, 1 something must be
 * fixed, 2 the mail account would not accept the login.
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import nodemailer from 'nodemailer';
import {
  customerEmailConfig,
  emailConfig,
  formatCustomerReceipt,
  formatOrderAlert,
  transportFor,
} from '../server/lib/order-notifications.js';
import { notificationSetup, PLACEHOLDER_ORIGIN } from '../server/lib/notification-setup.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const dryRun = flag('dry-run');
const receiptTo = value('to');

const say = (line = '') => console.log(line);
const tick = (line) => console.log(`  ✓ ${line}`);
const cross = (line) => console.log(`  ✗ ${line}`);
const dot = (line) => console.log(`  · ${line}`);

const failures = [];
const fail = (line) => {
  failures.push(line);
  cross(line);
};

/* ------------------------------------------------------------------ header */

say('');
say('Heritage Bites — notification setup check');
say('='.repeat(58));

if (!existsSync('.env')) {
  say('');
  cross('There is no .env file in this folder.');
  say('');
  say('  The site reads its settings from .env. Create it from the template:');
  say('');
  say('      cp notifications.env.example .env');
  say('      # then open .env and fill in the details');
  say('');
  say('  If .env already exists somewhere else, run this from that folder.');
  process.exit(1);
}
tick('.env found in the current folder');

const setup = notificationSetup();

/* ------------------------------------------------------- what is switched on */

say('');
say('What the settings add up to');
say('-'.repeat(58));

if (setup.kitchenEmail) {
  tick(`Kitchen ticket:    ${setup.kitchenEmail.to}  (via ${setup.kitchenEmail.host}:${setup.kitchenEmail.port}${setup.kitchenEmail.secure ? ', TLS' : ''})`);
} else {
  cross('Kitchen ticket:    no email account configured — the kitchen would hear nothing');
}
if (setup.customerEmail) {
  tick(`Customer receipt:  on${setup.customerEmail.dedicated ? ' (own verified sender)' : " (from the kitchen's account — expect some spam filtering)"}`);
  if (setup.customerEmail.from) dot(`sent as: ${setup.customerEmail.from}`);
} else {
  cross('Customer receipt:  off — customers get no email');
}
/*
 * The push state in words an owner can act on. A raw reason such as
 * "no-owner-key" with a tick next to it reads like success, which is the exact
 * confusion this script exists to remove.
 */
const PUSH_WORDS = {
  ready: ['tick', 'valid'],
  'missing-keys': ['dot', 'off — no keys yet (run `npm run push:keys` for a phone alert)'],
  'no-owner-key': ['cross', 'keys are set but HB_OWNER_PUSH_KEY is missing, so no phone can enrol'],
  'invalid-keys': ['cross', 'BROKEN — HB_VAPID_* is not a valid key pair'],
  'invalid-subject': ['cross', 'BROKEN — HB_VAPID_SUBJECT must be a mailto: or https: address'],
  disabled: ['dot', 'switched off (HB_PUSH_ENABLED=false)'],
};
const [kind, words] = PUSH_WORDS[setup.push.reason] ?? ['dot', `unknown state (${setup.push.reason})`];
({ tick, cross, dot })[kind](`Push keys:         ${words}`);
if (kind === 'cross') failures.push(`Push: ${words}`);
if (setup.push.configured) dot(`kitchen devices enrolled: ${setup.push.ownerDevices}${setup.push.ownerDevices ? '' : '  (open /alerts on the phone to enrol one)'}`);
if (setup.originIsPlaceholder) {
  cross(`Tracking links:    ${setup.origin}  ← NOT YOUR SITE (see below)`);
} else {
  tick(`Tracking links:    ${setup.origin}`);
}

/* --------------------------------------------------------- the real test */

say('');
say('Testing the mail account for real');
say('-'.repeat(58));

const owner = emailConfig();
const customer = customerEmailConfig();

/** A ticket that looks exactly like a real one, for a code that cannot collide. */
const testOrder = {
  code: 'HB-TEST1',
  createdAt: new Date().toISOString(),
  status: 'pending',
  fulfilment: 'collection',
  payment: { method: 'cash-on-collection', status: 'pending' },
  serviceWindow: { label: 'Thursday 12:00–13:30', isPreOrder: true },
  items: [{ name: 'Mogodu Plate', qty: 1, lineTotal: 100, options: [{ label: 'Pap' }] }],
  totals: { subtotal: 100, total: 100 },
  customer: { name: 'This is a test', phone: '+27 00 000 0000', email: 'test@example.com' },
};

async function testOwner() {
  if (!owner) {
    fail('No SMTP account, so no kitchen ticket can be sent.');
    return;
  }
  if (dryRun) {
    dot('dry run: not connecting');
    return;
  }

  const transport = transportFor(owner);
  try {
    await transport.verify();
    tick(`Logged in to ${owner.host} as ${owner.user}`);
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0];
    fail(`The mail account refused the login: ${message}`);
    say('');
    say('    What this usually means:');
    say('      · Gmail  -> the App Password was revoked, or 2-Step Verification is off,');
    say('                  or a normal account password was pasted instead of an App Password.');
    say('      · Brevo  -> the SMTP login is not the account email; copy it from SMTP settings.');
    say('      · host/port blocked by the host firewall (try port 587 with SECURE=false).');
    process.exit(2);
  }

  const alert = formatOrderAlert(testOrder);
  try {
    const info = await transport.sendMail({
      from: owner.from,
      to: owner.to,
      subject: `[TEST] ${alert.subject}`,
      text: `${alert.text}\n\n— This is a test from npm run check:notifications. No customer is waiting.\n`,
    });
    tick(`Sent a test ticket to ${owner.to}  (${info.messageId ?? 'accepted'})`);
    dot('Open that inbox: if the test is there, every real order will be too.');
  } catch (error) {
    fail(`The login worked but the message was not accepted: ${String(error?.message ?? error).split('\n')[0]}`);
  } finally {
    transport.close();
  }
}

async function testCustomer() {
  if (!receiptTo) {
    if (customer) dot('Customer receipt not tested. Add --to you@example.com to send one.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(receiptTo)) {
    fail(`--to ${receiptTo} is not an email address.`);
    return;
  }
  if (!customer) {
    fail('Customer receipts are switched off, so --to has nothing to send.');
    return;
  }
  if (dryRun) {
    dot('dry run: not sending the receipt');
    return;
  }

  const receipt = formatCustomerReceipt(testOrder, {
    trackingUrl: `${setup.origin}/order/HB-TEST1?token=this-is-a-test-token`,
  });
  const transport = transportFor(customer);
  try {
    const info = await transport.sendMail({
      from: customer.from ?? owner?.from,
      to: receiptTo,
      replyTo: customer.replyTo ?? undefined,
      subject: `[TEST] ${receipt.subject}`,
      text: `${receipt.text}\n\n— This is a test from npm run check:notifications.\n`,
    });
    tick(`Sent a test receipt to ${receiptTo}  (${info.messageId ?? 'accepted'})`);
    dot('Check that the private order link in it opens your own site, not somewhere else.');
  } catch (error) {
    fail(`The test receipt was not accepted: ${String(error?.message ?? error).split('\n')[0]}`);
  } finally {
    transport.close();
  }
}

await testOwner();
await testCustomer();

/* ------------------------------------------------------------- the verdict */

if (setup.issues.length) {
  say('');
  say('Settings that need attention');
  say('-'.repeat(58));
  let n = 0;
  for (const issue of setup.issues) {
    n += 1;
    const label = issue.severity === 'error' ? 'MUST FIX' : 'worth fixing';
    console.log(`\n  ${n}. [${label}] ${issue.message}`);
    if (issue.severity === 'error') failures.push(issue.message);
  }
}

if (setup.push.reason === 'ready' && setup.push.ownerDevices === 0) {
  say('');
  dot('Push keys are valid, but no phone has enrolled yet:');
  dot('open /alerts on the kitchen phone, paste HB_OWNER_PUSH_KEY, and press the button.');
}

say('');
say('='.repeat(58));

if (failures.length) {
  console.log(`✗ ${failures.length} thing(s) must be fixed before the kitchen can be relied on.`);
  if (setup.origin === PLACEHOLDER_ORIGIN) {
    say('');
    say(`  The most urgent one is HB_PUBLIC_URL: right now every receipt links to`);
    say(`  ${PLACEHOLDER_ORIGIN}, which is a different restaurant.`);
  }
  say('');
  process.exit(1);
}

console.log('✓ The details work: the kitchen is emailed, and the login was accepted.');
if (!receiptTo) dot('Run it once more with --to your-own@email to prove customer receipts too.');
say('');
process.exit(0);
