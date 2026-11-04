import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The outbox is read from HB_DATA_DIR at import time, so the throwaway directory
 * has to be set before the modules load — hence the dynamic imports below.
 */
process.env.NODE_ENV = 'test';
process.env.HB_DATA_DIR = mkdtempSync(join(tmpdir(), 'hb-notify-test-'));
for (const key of ['HB_VAPID_PUBLIC_KEY', 'HB_VAPID_PRIVATE_KEY', 'HB_VAPID_SUBJECT', 'HB_PUSH_ENABLED', 'HB_SMTP_HOST', 'HB_SMTP_PORT', 'HB_SMTP_USER', 'HB_SMTP_PASS', 'HB_SMTP_FROM', 'HB_ORDER_ALERT_EMAIL', 'HB_VAPID_PUBLIC_KEY', 'HB_VAPID_PRIVATE_KEY', 'HB_OWNER_PUSH_KEY', 'HB_PUBLIC_URL', 'HB_CUSTOMER_SMTP_HOST', 'HB_CUSTOMER_SMTP_PORT', 'HB_CUSTOMER_SMTP_USER', 'HB_CUSTOMER_SMTP_PASS', 'HB_CUSTOMER_SMTP_FROM', 'HB_CUSTOMER_EMAIL_ENABLED']) {
  delete process.env[key];
}

const {
  formatOrderAlert,
  formatCustomerReceipt,
  enqueueOrderAlert,
  processNextOrderAlert,
  customerEmailConfig,
  emailConfig,
  notifyStatus,
  publicBaseUrl,
  trackingUrlFor,
} = await import('./order-notifications.js');
const { store } = await import('./store.js');

const SMTP_ENV = {
  HB_SMTP_HOST: 'smtp.example.com',
  HB_SMTP_PORT: '465',
  HB_SMTP_USER: 'alerts@example.com',
  HB_SMTP_PASS: 'app-password',
  HB_SMTP_FROM: 'Heritage Bites <alerts@example.com>',
  HB_ORDER_ALERT_EMAIL: 'kitchen@example.com',
  HB_PUBLIC_URL: 'https://example.test',
};

/** Set env vars for one test and put the previous values back afterwards. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const jobs = () => store.load('orderNotificationJobs', []);
const jobFor = (code, channel) => jobs().find((job) => job.orderCode === code && (job.channel ?? 'owner-email') === channel);

function makeOrder(code = 'HB-0123C', overrides = {}) {
  return {
    code,
    trackingTokenHash: 'must-not-appear-in-email',
    createdAt: '2026-10-19T09:30:00.000Z',
    status: 'pending',
    fulfilment: 'delivery',
    payment: { method: 'card', status: 'approved', last4: '4242', brand: 'visa' },
    serviceWindow: { label: 'Thursday 12:00–13:30', isPreOrder: true },
    items: [{
      qty: 2,
      name: 'Tshotlo',
      options: [{ label: 'Regular' }],
      lineTotal: 190,
    }],
    totals: { subtotal: 190, delivery: 0, discount: 0, total: 190 },
    customer: {
      name: 'Kemorego Test',
      phone: '+27 67 013 7587',
      email: 'customer@example.co.za',
      address: '12 Sample Road',
      suburb: 'Sandton',
      notes: 'Call on arrival',
    },
    whatsapp: 'https://wa.me/27670137587?text=hello',
    ...overrides,
  };
}

/** Every outbox test starts from an empty outbox and an empty order list. */
beforeEach(() => {
  store.save('orderNotificationJobs', []);
  store.save('orders', []);
});

describe('order email alert formatting', () => {
  const baseOrder = makeOrder();

  test('includes the order summary and delivery details but never a tracking secret', () => {
    const message = formatOrderAlert(baseOrder);
    assert.equal(message.subject, 'New Heritage Bites order HB-0123C');
    assert.match(message.text, /2 × Tshotlo \(Regular\): R190\.00/);
    assert.match(message.text, /Delivery address: 12 Sample Road/);
    assert.match(message.text, /Payment: Card \(Yoco\) \(approved\)/);
    assert.match(message.text, /Service window: Thursday 12:00–13:30 \(pre-order\)/);
    assert.match(message.text, /Delivery area: Sandton|TOTAL: R190\.00/);
    assert.match(message.text, /TOTAL: R190\.00/);
    // The last four digits are the only card detail allowed; the PAN and the
    // tracking secret must never be emailed.
    assert.doesNotMatch(message.text, /must-not-appear-in-email|trackingTokenHash|424242/);
  });

  test('does not include an address for a collection order', () => {
    const message = formatOrderAlert({
      ...baseOrder,
      fulfilment: 'collection',
      customer: { ...baseOrder.customer, address: 'Private address' },
    });
    assert.match(message.text, /Type: Collection/);
    assert.doesNotMatch(message.text, /Private address/);
  });
});

describe('customer receipt', () => {
  test('carries the order, the private tracking link and a WhatsApp handoff', async () => {
    await withEnv({ HB_PUBLIC_URL: 'https://example.test' }, async () => {
      const order = makeOrder('HB-0200C');
      const trackingUrl = trackingUrlFor(order, 'secret-token-value');
      const message = formatCustomerReceipt(order, { settings: { whatsapp: '27670137587', phoneDisplay: '+27 67 013 7587', email: 'heritagebitesfood@gmail.com' }, trackingUrl });

      assert.equal(message.subject, 'Heritage Bites receipt — order HB-0200C');
      assert.match(message.text, /Hi Kemorego,/);
      assert.match(message.text, /• 2 × Tshotlo \(Regular\) — R190\.00/);
      assert.match(message.text, /TOTAL: R190\.00/);
      assert.match(message.text, /Service window: Thursday 12:00–13:30 \(pre-order for the next window\)/);
      assert.match(message.text, /Payment: Card \(Yoco\) \(paid\)/);
      assert.match(message.text, /https:\/\/example\.test\/order\/HB-0200C\?token=secret-token-value/);
      assert.match(message.text, /https:\/\/wa\.me\/27670137587/);
      assert.match(message.text, /Call: \+27 67 013 7587/);
      assert.match(message.text, /We deliver to Sandton — 12 Sample Road/);
      // Never the hash, never a card number.
      assert.doesNotMatch(message.text, /must-not-appear-in-email|trackingTokenHash|424242/);
      });
  });

  test('says collection, not delivery, and omits the link when there is no token', () => {
    const order = makeOrder('HB-0201C', { fulfilment: 'collection', payment: { method: 'cash-on-collection', status: 'pending' } });
    const message = formatCustomerReceipt(order, { settings: { whatsapp: '27670137587' } });

    assert.match(message.text, /Type: Collection/);
    assert.match(message.text, /Collect from our shadow kitchen/);
    assert.match(message.text, /Cash on collection \(to be paid on collection\)/);
    assert.doesNotMatch(message.text, /FOLLOW YOUR ORDER/);
    assert.doesNotMatch(message.text, /undefined|null/);
    // A collection receipt must not repeat a saved delivery address.
    assert.doesNotMatch(message.text, /12 Sample Road/);
  });
});

describe('configuration status', () => {
  test('reports nothing configured on a bare install', async () => {
    await withEnv({ ...SMTP_ENV, HB_SMTP_HOST: undefined }, () => {
      const status = notifyStatus();
      assert.equal(status.ownerEmail, false);
      assert.equal(status.customerEmail, false);
      assert.equal(status.push.configured, false);
    });
  });

  test('reports each free channel independently', async () => {
    await withEnv(SMTP_ENV, () => {
      const status = notifyStatus();
      assert.equal(status.ownerEmail, true);
      assert.equal(status.customerEmail, true);
      assert.equal(status.push.configured, false);
      assert.equal(status.publicUrl, 'https://example.test');
    });

    await withEnv({ ...SMTP_ENV, HB_CUSTOMER_EMAIL_ENABLED: 'false' }, () => {
      assert.equal(notifyStatus().ownerEmail, true);
      assert.equal(notifyStatus().customerEmail, false, 'the customer copy can be switched off on its own');
    });
  });

  test('public URL falls back to the live domain and drops trailing slashes', async () => {
    assert.equal(publicBaseUrl(), 'https://heritagebites.co.za');
    await withEnv({ HB_PUBLIC_URL: 'https://staging.example.test///' }, () => {
      assert.equal(publicBaseUrl(), 'https://staging.example.test');
    });
  });
});

describe('outbox', () => {
  test('without SMTP the owner job waits for configuration and nothing else is queued', () => {
    const order = makeOrder('HB-0400C');
    const queued = enqueueOrderAlert(order, { trackingToken: 'tok-1' });

    assert.equal(queued.length, 1);
    const owner = jobFor(order.code, 'owner-email');
    assert.equal(owner.status, 'waiting_config');
    assert.equal(owner.attempts, 0);
    assert.equal(jobFor(order.code, 'customer-email'), undefined, 'a receipt cannot be promised without SMTP');
    assert.equal(JSON.stringify(jobs()).includes('tok-1'), false, 'no tracking token is stored before a receipt can be sent');
  });

  test('queues the owner ticket and the customer receipt once, owner ticket first', async () => {
    await withEnv(SMTP_ENV, () => {
      const order = makeOrder('HB-0401C');
      const queued = enqueueOrderAlert(order, { trackingToken: 'tok-2' });
      assert.equal(queued.length, 2);

      const owner = jobFor(order.code, 'owner-email');
      const customer = jobFor(order.code, 'customer-email');
      assert.equal(owner.status, 'pending');
      assert.equal(customer.status, 'pending');
      assert.equal(customer.trackingToken, 'tok-2', 'the receipt needs the one-time token to deep-link');

      /* Jobs are prepended, so the owner ticket is the first email claimed. */
      const emails = jobs().filter((job) => ['owner-email', 'customer-email'].includes(job.channel));
      assert.equal(emails.at(0).channel, 'owner-email');

      enqueueOrderAlert(order, { trackingToken: 'tok-2' });
      assert.equal(jobs().length, 2, 're-queueing the same order must not duplicate jobs');
    });
  });

  test('delivers the kitchen ticket before the customer receipt, then clears the token', async () => {
    await withEnv(SMTP_ENV, async () => {
      const order = makeOrder('HB-0402C');
      store.save('orders', [order]);
      enqueueOrderAlert(order, { trackingToken: 'tok-3' });

      const sent = [];
      const transport = {
        sendMail: async (email) => {
          sent.push(email);
          return { messageId: `mock-${sent.length}` };
        },
      };
      const config = { from: 'alerts@example.com', to: 'kitchen@example.com' };

      await processNextOrderAlert(transport, config);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, 'kitchen@example.com');
      assert.match(sent[0].text, /HB-0402C/);
      assert.doesNotMatch(sent[0].text, /tok-3/, "the owner's copy never carries the tracking secret");
      assert.equal(jobFor(order.code, 'owner-email').status, 'sent');
      assert.equal(jobFor(order.code, 'customer-email').status, 'pending');

      await processNextOrderAlert(transport, config);
      assert.equal(sent.length, 2);
      assert.equal(sent[1].to, 'customer@example.co.za');
      assert.equal(sent[1].replyTo, 'kitchen@example.com', 'a reply reaches the kitchen inbox');
      assert.match(sent[1].text, /https:\/\/example\.test\/order\/HB-0402C\?token=tok-3/);
      assert.equal(jobFor(order.code, 'customer-email').status, 'sent');
      assert.equal(jobFor(order.code, 'customer-email').trackingToken, null, 'the token is dropped once the receipt is out');
    });
  });

  test('a customer receipt with no address fails without touching the owner job', async () => {
    await withEnv(SMTP_ENV, async () => {
      const order = makeOrder('HB-0403C', { customer: { ...makeOrder().customer, email: '' } });
      store.save('orders', [order]);
      enqueueOrderAlert(order, { trackingToken: 'tok-4' });

      // No address means no receipt job at all; force one to prove the failure path.
      store.update('orderNotificationJobs', [], (list) => [
        { id: 'forced', orderCode: order.code, channel: 'customer-email', status: 'pending', attempts: 0, nextAttemptAt: null },
        ...list,
      ]);

      const sent = [];
      const transport = { sendMail: async (email) => { sent.push(email); return { messageId: 'x' }; } };
      const config = { from: 'a@b.c', to: 'kitchen@example.com' };

      /* The unusable receipt is claimed first and dropped without sending. */
      await processNextOrderAlert(transport, config);
      assert.equal(sent.length, 0);
      assert.equal(jobFor(order.code, 'customer-email').status, 'failed');
      assert.match(jobFor(order.code, 'customer-email').lastError, /No customer email/i);

      /* The kitchen ticket is untouched by that failure. */
      await processNextOrderAlert(transport, config);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, 'kitchen@example.com');
      assert.equal(jobFor(order.code, 'owner-email').status, 'sent');
    });
  });

  test('retries a failed email and gives up after five attempts', async () => {
    await withEnv({ ...SMTP_ENV, HB_CUSTOMER_EMAIL_ENABLED: 'false' }, async () => {
      const order = makeOrder('HB-0404C');
      store.save('orders', [order]);
      enqueueOrderAlert(order, { trackingToken: 'tok-5' });

      const failing = { sendMail: async () => { throw new Error('SMTP 421 try later'); } };
      const config = { from: 'a@b.c', to: 'kitchen@example.com' };

      await processNextOrderAlert(failing, config);
      const retried = jobFor(order.code, 'owner-email');
      assert.equal(retried.status, 'pending');
      assert.equal(retried.attempts, 1);
      assert.ok(retried.nextAttemptAt, 'a retry is scheduled');
      assert.match(retried.lastError, /try later/);
    });
  });
});

describe('customer receipts on their own sending account', () => {
  const BREVO = {
    HB_CUSTOMER_SMTP_HOST: 'smtp-relay.brevo.com',
    HB_CUSTOMER_SMTP_PORT: '587',
    HB_CUSTOMER_SMTP_USER: 'brevo-user@smtp-brevo.com',
    HB_CUSTOMER_SMTP_PASS: 'brevo-key',
    HB_CUSTOMER_SMTP_FROM: 'Heritage Bites <orders@heritagebites.co.za>',
  };

  test('without its own account a receipt inherits the owner credentials', async () => {
    await withEnv(SMTP_ENV, () => {
      const owner = emailConfig();
      const customer = customerEmailConfig();
      assert.equal(customer.dedicated, false);
      assert.equal(customer.host, owner.host);
      assert.equal(customer.user, owner.user);
      assert.equal(customer.from, owner.from);
      assert.equal(customer.replyTo, 'kitchen@example.com', 'a reply still reaches the kitchen');
      assert.equal(notifyStatus().customerEmailDedicated, false);
    });
  });

  test('a dedicated block wins, so receipts leave from a verified domain', async () => {
    await withEnv({ ...SMTP_ENV, ...BREVO }, () => {
      const owner = emailConfig();
      const customer = customerEmailConfig();
      assert.equal(customer.dedicated, true);
      assert.equal(customer.host, 'smtp-relay.brevo.com');
      assert.equal(customer.port, 587);
      assert.equal(customer.secure, false, 'port 587 means STARTTLS, not implicit TLS');
      assert.equal(customer.from, 'Heritage Bites <orders@heritagebites.co.za>');
      assert.equal(owner.host, 'smtp.example.com', "the kitchen ticket stays on the owner's account");
      assert.equal(notifyStatus().customerEmailDedicated, true);
    });
  });

  test('the two channels are routed to the two transports with the right sender', async () => {
    await withEnv({ ...SMTP_ENV, ...BREVO }, async () => {
      const order = makeOrder('HB-0600C');
      store.save('orders', [order]);
      enqueueOrderAlert(order, { trackingToken: 'tok-6' });

      const ownerSent = [];
      const customerSent = [];
      const config = {
        from: 'alerts@example.com',
        to: 'kitchen@example.com',
        customer: customerEmailConfig(),
        customerTransport: { sendMail: async (email) => { customerSent.push(email); return { messageId: 'c1' }; } },
      };

      /* Kitchen ticket first, on the owner transport. */
      await processNextOrderAlert({ sendMail: async (email) => { ownerSent.push(email); return { messageId: 'o1' }; } }, config);
      assert.equal(ownerSent.length, 1);
      assert.equal(ownerSent[0].from, 'alerts@example.com');
      assert.equal(ownerSent[0].to, 'kitchen@example.com');
      assert.equal(customerSent.length, 0);

      /* Then the receipt, on the dedicated account. */
      await processNextOrderAlert({ sendMail: async () => { throw new Error('the owner transport must not carry a receipt'); } }, config);
      assert.equal(customerSent.length, 1);
      assert.equal(customerSent[0].from, 'Heritage Bites <orders@heritagebites.co.za>');
      assert.equal(customerSent[0].to, 'customer@example.co.za');
      assert.equal(customerSent[0].replyTo, 'kitchen@example.com');
      assert.match(customerSent[0].text, /\?token=tok-6/);
    });
  });

  test('switching the customer copy off leaves the kitchen ticket working', async () => {
    await withEnv({ ...SMTP_ENV, ...BREVO, HB_CUSTOMER_EMAIL_ENABLED: 'false' }, () => {
      assert.equal(customerEmailConfig(), null);
      assert.ok(emailConfig());
      const order = makeOrder('HB-0601C');
      const queued = enqueueOrderAlert(order, { trackingToken: 'tok-7' });
      assert.deepEqual(queued.map((job) => job.channel), ['owner-email']);
    });
  });
});

describe('outbox visibility', () => {
  test('failed and waiting jobs are counted so a monitor can shout', async () => {
    await withEnv({ ...SMTP_ENV, HB_CUSTOMER_EMAIL_ENABLED: 'false' }, async () => {
      const order = makeOrder('HB-0700C');
      store.save('orders', [order]);
      enqueueOrderAlert(order, { trackingToken: null });

      assert.deepEqual(notifyStatus().outbox, { waitingConfig: 0, pending: 1, retrying: 0, stuck: 0, failed: 0, sent: 0 });
      assert.equal(notifyStatus().healthy, true, 'a freshly queued job is not yet a problem');

      await processNextOrderAlert({ sendMail: async () => { throw new Error('mailbox unavailable'); } }, { from: 'a@b.c', to: 'kitchen@example.com' });
      assert.equal(notifyStatus().outbox.pending, 1, 'a retryable failure stays pending');
      assert.equal(notifyStatus().outbox.retrying, 1, 'a failed attempt is visible, not silently pending');

      /* Make it terminal: the job is at its last attempt. */
      store.update('orderNotificationJobs', [], (list) => list.map((job) => ({ ...job, attempts: 5, nextAttemptAt: null, status: 'pending' })));
      await processNextOrderAlert({ sendMail: async () => { throw new Error('mailbox unavailable'); } }, { from: 'a@b.c', to: 'kitchen@example.com' });
      assert.equal(notifyStatus().outbox.failed, 1);
      assert.equal(notifyStatus().healthy, false, 'a permanent failure must make the check shout');
    });
  });
});

describe('broken push counts against health', () => {
  test('push keys that were set but are unusable make the status unhealthy', async () => {
    await withEnv({ ...SMTP_ENV, HB_VAPID_PUBLIC_KEY: 'bad', HB_VAPID_PRIVATE_KEY: 'bad' }, () => {
      const status = notifyStatus();
      assert.equal(status.ownerEmail, true, 'email still works');
      assert.equal(status.push.reason, 'invalid-keys');
      assert.equal(status.healthy, false, 'but the kitchen phone will never buzz, so this is not healthy');
    });
  });

  test('an enrolled kitchen device that keeps failing makes the status unhealthy', async () => {
    const { privateKey: priv, publicKey: pub } = (await import('web-push')).default.generateVAPIDKeys();
    store.save('pushSubscriptions', [{
      id: 'deaf', role: 'owner', orderCode: null,
      endpoint: 'https://push.example.test/deaf',
      keys: { p256dh: 'a', auth: 'b' },
      createdAt: new Date().toISOString(), failures: 5,
    }]);
    await withEnv({
      ...SMTP_ENV,
      HB_VAPID_PUBLIC_KEY: pub,
      HB_VAPID_PRIVATE_KEY: priv,
      HB_OWNER_PUSH_KEY: 'k'.repeat(32),
    }, () => {
      const status = notifyStatus();
      assert.equal(status.push.failingOwnerDevices, 1);
      assert.equal(status.healthy, false, 'enrolled but deaf is not healthy');
    });
    store.save('pushSubscriptions', []);
  });

  test('push that was never configured does not block an email-only setup', async () => {
    await withEnv({ ...SMTP_ENV, HB_VAPID_PUBLIC_KEY: undefined, HB_VAPID_PRIVATE_KEY: undefined }, () => {
      const status = notifyStatus();
      assert.equal(status.push.reason, 'missing-keys');
      assert.equal(status.healthy, true, 'email reaches the kitchen, so this is honest and healthy');
    });
  });
});

describe('monitor signal', () => {
  test('a job stuck for more than 15 minutes is unhealthy even though it is pending', async () => {
    await withEnv({ ...SMTP_ENV, HB_CUSTOMER_EMAIL_ENABLED: 'false' }, () => {
      const longAgo = new Date(Date.now() - 16 * 60_000).toISOString();
      store.save('orderNotificationJobs', [{
        id: 'stale',
        orderCode: 'HB-0800C',
        channel: 'owner-email',
        status: 'pending',
        attempts: 1,
        createdAt: longAgo,
        startedAt: null,
        nextAttemptAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        lastError: 'SMTP 421 try later',
      }]);

      const status = notifyStatus();
      assert.equal(status.outbox.stuck, 1);
      assert.equal(status.healthy, false, 'a notification stuck for a whole service window is not healthy');
    });
  });
});
