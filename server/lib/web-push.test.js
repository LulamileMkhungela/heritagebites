import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.HB_DATA_DIR = mkdtempSync(join(tmpdir(), 'hb-push-test-'));

/* Keys are generated per test run, never committed: a leaked pair lets anyone
   push to this deployment's subscribers. */
const webpush = (await import('web-push')).default;
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

const {
  deliver,
  ownerKey,
  pruneSubscriptions,
  pushConfig,
  pushPayload,
  pushStatus,
  removeSubscription,
  saveSubscription,
} = await import('./web-push.js');
const { store } = await import('./store.js');

const OWNER_KEY = 'a'.repeat(32);

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

const CONFIGURED = {
  HB_VAPID_PUBLIC_KEY: publicKey,
  HB_VAPID_PRIVATE_KEY: privateKey,
  HB_VAPID_SUBJECT: 'mailto:kitchen@example.com',
  HB_OWNER_PUSH_KEY: OWNER_KEY,
};

/** A structurally valid subscription; it is never sent to a real push service. */
const makeSub = (n = 1) => ({
  endpoint: `https://push.example.test/subscription/${n}`,
  keys: { p256dh: `p256dh-key-${n}`, auth: `auth-secret-${n}` },
});

const order = {
  code: 'HB-0900C',
  fulfilment: 'collection',
  totals: { total: 200 },
  serviceWindow: { label: 'Thursday 12:00–13:30', isPreOrder: false },
  items: [{ qty: 2, name: 'Mogodu Plate', lineTotal: 200 }],
  customer: { name: 'Test', phone: '0820000000', email: 't@example.co.za' },
};

beforeEach(() => {
  store.save('pushSubscriptions', []);
});

describe('configuration', () => {
  test('stays switched off until both VAPID halves exist', async () => {
    await withEnv({ HB_VAPID_PUBLIC_KEY: publicKey, HB_VAPID_PRIVATE_KEY: undefined }, () => {
      assert.equal(pushConfig(), null);
    });
    await withEnv({ HB_VAPID_PUBLIC_KEY: publicKey, HB_VAPID_PRIVATE_KEY: privateKey }, () => {
      const config = pushConfig();
      assert.equal(config.publicKey, publicKey);
      assert.equal(config.subject, 'mailto:heritagebitesfood@gmail.com', 'a sensible default subject');
    });
  });

  test('rejects a subject a push service would refuse', async () => {
    await withEnv({ ...CONFIGURED, HB_VAPID_SUBJECT: 'kitchen@example.com' }, () => {
      assert.equal(pushConfig(), null, 'the subject must be a mailto: or https: URL');
    });
  });

  test('HB_PUSH_ENABLED=false switches the whole channel off', async () => {
    await withEnv({ ...CONFIGURED, HB_PUSH_ENABLED: 'false' }, () => {
      assert.equal(pushConfig(), null);
    });
  });

  test('owner enrolment needs a key of real length', async () => {
    await withEnv({ HB_OWNER_PUSH_KEY: 'short' }, () => {
      assert.equal(ownerKey(), null, 'a guessable key is no key at all');
    });
    await withEnv({ HB_OWNER_PUSH_KEY: OWNER_KEY }, () => {
      assert.equal(ownerKey(), OWNER_KEY);
    });
  });

  test('status separates "keys set" from "owner devices can enrol"', async () => {
    await withEnv({ HB_VAPID_PUBLIC_KEY: publicKey, HB_VAPID_PRIVATE_KEY: privateKey, HB_OWNER_PUSH_KEY: undefined }, () => {
      const status = pushStatus();
      assert.equal(status.vapid, true);
      assert.equal(status.ownerKeySet, false);
      assert.equal(status.configured, false, 'without an owner key the kitchen cannot be enrolled');
    });
  });
});

describe('subscriptions', () => {
  test('a malformed subscription is refused rather than stored', () => {
    assert.equal(saveSubscription({ endpoint: 'http://insecure.example', keys: makeSub().keys }, { role: 'owner' }).ok, false);
    assert.equal(saveSubscription({ endpoint: makeSub().endpoint, keys: {} }, { role: 'owner' }).ok, false);
    assert.equal(saveSubscription(null, { role: 'owner' }).ok, false);
    assert.equal(store.load('pushSubscriptions', []).length, 0);
  });

  test('re-subscribing the same endpoint replaces the record instead of duplicating', () => {
    saveSubscription(makeSub(1), { role: 'owner' });
    saveSubscription(makeSub(1), { role: 'owner' });
    const stored = store.load('pushSubscriptions', []);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].role, 'owner');
  });

  test('a customer subscription is bound to its order and capped', () => {
    for (let i = 1; i <= 7; i += 1) {
      saveSubscription(makeSub(i), { role: 'customer', orderCode: 'HB-1000C' });
    }
    const stored = store.load('pushSubscriptions', []);
    assert.equal(stored.length, 5, 'a shared link cannot accumulate unlimited devices');
    assert.ok(stored.every((entry) => entry.orderCode === 'HB-1000C'));
  });

  test('one device switching from order A to order B does not keep both', () => {
    saveSubscription(makeSub(1), { role: 'customer', orderCode: 'HB-A' });
    saveSubscription(makeSub(1), { role: 'customer', orderCode: 'HB-B' });
    const stored = store.load('pushSubscriptions', []);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].orderCode, 'HB-B');
  });

  test('unsubscribe removes exactly that endpoint', () => {
    saveSubscription(makeSub(1), { role: 'owner' });
    saveSubscription(makeSub(2), { role: 'owner' });
    assert.equal(removeSubscription(makeSub(1).endpoint), 1);
    const stored = store.load('pushSubscriptions', []);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].endpoint, makeSub(2).endpoint);
  });

  test('old subscriptions are pruned so the store cannot grow forever', () => {
    store.save('pushSubscriptions', [
      { id: 'old', role: 'customer', orderCode: 'HB-OLD', endpoint: 'https://push.example.test/old', keys: makeSub().keys, createdAt: new Date(Date.now() - 30 * 864e5).toISOString() },
      { id: 'new', role: 'customer', orderCode: 'HB-NEW', endpoint: 'https://push.example.test/new', keys: makeSub().keys, createdAt: new Date().toISOString() },
    ]);
    assert.equal(pruneSubscriptions(14), 1);
    assert.deepEqual(store.load('pushSubscriptions', []).map((entry) => entry.id), ['new']);
  });
});

describe('payloads', () => {
  test('the owner alert says what landed, how much and how it is fulfilled', () => {
    const payload = pushPayload('owner-new-order', order);
    assert.equal(payload.title, 'New order HB-0900C');
    assert.match(payload.body, /2 plates/);
    assert.match(payload.body, /R200\.00/);
    assert.match(payload.body, /collection/);
    assert.equal(payload.requireInteraction, true, 'a kitchen alert should not fade away');
  });

  test('the customer alert never carries the tracking token or the address', () => {
    const payload = pushPayload('customer-order-placed', order);
    assert.match(payload.body, /R200\.00/);
    assert.doesNotMatch(JSON.stringify(payload), /token/i);
    assert.doesNotMatch(JSON.stringify(payload), /0820000000|t@example\.co\.za/);
  });

  test('an unknown kind produces nothing rather than a broken notification', () => {
    assert.equal(pushPayload('nonsense', order), null);
  });
});

describe('delivery', () => {
  test('a successful send marks the subscription as used', async () => {
    await withEnv(CONFIGURED, async () => {
      saveSubscription(makeSub(1), { role: 'owner' });
      const [target] = store.load('pushSubscriptions', []);
      const results = await deliver([target], pushPayload('owner-new-order', order), async () => ({ ok: true }));
      assert.deepEqual(results.map((r) => r.ok), [true]);
      assert.ok(store.load('pushSubscriptions', [])[0].lastSentAt);
    });
  });

  test('a 410 means the browser dropped the subscription, so it is deleted', async () => {
    await withEnv(CONFIGURED, async () => {
      saveSubscription(makeSub(1), { role: 'owner' });
      const [target] = store.load('pushSubscriptions', []);
      const error = Object.assign(new Error('Subscription no longer valid'), { statusCode: 410 });
      const results = await deliver([target], pushPayload('owner-new-order', order), async () => { throw error; });
      assert.equal(results[0].gone, true);
      assert.equal(store.load('pushSubscriptions', []).length, 0, 'a dead endpoint must not be retried forever');
    });
  });

  test('a transient failure keeps the record and counts the failure', async () => {
    await withEnv(CONFIGURED, async () => {
      saveSubscription(makeSub(1), { role: 'owner' });
      const [target] = store.load('pushSubscriptions', []);
      const error = Object.assign(new Error('push service unavailable'), { statusCode: 503 });
      await deliver([target], pushPayload('owner-new-order', order), async () => { throw error; });
      const [kept] = store.load('pushSubscriptions', []);
      assert.ok(kept, 'a 503 is not permanent; the device stays enrolled');
      assert.equal(kept.failures, 1);
    });
  });

  test('one failing device does not stop the others being notified', async () => {
    await withEnv(CONFIGURED, async () => {
      saveSubscription(makeSub(1), { role: 'owner' });
      saveSubscription(makeSub(2), { role: 'owner' });
      const targets = store.load('pushSubscriptions', []);
      const seen = [];
      const results = await deliver(targets, pushPayload('owner-new-order', order), async (sub) => {
        if (sub.endpoint.endsWith('/2')) throw Object.assign(new Error('boom'), { statusCode: 500 });
        seen.push(sub.endpoint);
      });
      assert.equal(seen.length, 1);
      assert.equal(results.filter((r) => r.ok).length, 1);
    });
  });
});
