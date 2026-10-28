/**
 * Web Push — the phone alert that needs no app, no account and no card.
 *
 * A browser subscribes to push once; after that the server can wake that device
 * even when the site is closed. It rides the browser vendor's own push service
 * (FCM/Mozilla/Apple), which is free, so there is no provider, no per-message fee
 * and nothing to bill. Two devices matter here:
 *
 *   owner     the kitchen phone or counter tablet. Any device the owner enrols
 *             with the owner key receives every new order.
 *   customer  the phone that placed an order. A customer subscription is bound to
 *             that one order code and dies with it — nobody can subscribe a
 *             device to a stream of other people's orders.
 *
 * The subscription store is the JSON outbox's sibling: durable across restarts,
 * pruned as browsers report subscriptions gone (404/410).
 */
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { store } from './store.js';

const SUB_STORE = 'pushSubscriptions';
/** A subscription nobody has used in this long is dropped, not kept forever. */
const MAX_SUBSCRIPTIONS_PER_ORDER = 5;

let configuredFor = null;

const money = (value) => `R${Number(value || 0).toFixed(2)}`;

/* -------------------------------- Config ------------------------------- */

/**
 * VAPID keys identify this server to the browser's push service.
 *
 * Generate once per deployment with `npm run push:keys` and set both values as
 * secrets. They are not secrets in the password sense — the public half is sent
 * to every browser — but the private half signs each push, so a leaked pair lets
 * anyone send notifications to your subscribers.
 */
export function pushConfig() {
  if (process.env.HB_PUSH_ENABLED === 'false') return null;

  const publicKey = process.env.HB_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.HB_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.HB_VAPID_SUBJECT?.trim() || 'mailto:heritagebitesfood@gmail.com';

  if (!publicKey || !privateKey) return null;
  /* `mailto:` or an https: URL; the push service rejects anything else. */
  if (!/^(mailto:|https:)/.test(subject)) return null;

  return { publicKey, privateKey, subject };
}

/** Who may enrol a device as an owner device. Without it, nobody can. */
export function ownerKey() {
  const key = process.env.HB_OWNER_PUSH_KEY?.trim();
  return key && key.length >= 16 ? key : null;
}

/** Configure the signing library once; keys are process-wide, not per-request. */
function ensureVapid(config) {
  if (!config) return false;
  const stamp = `${config.publicKey}:${config.privateKey}:${config.subject}`;
  if (configuredFor === stamp) return true;
  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configuredFor = stamp;
    return true;
  } catch (error) {
    console.error(`[push] VAPID configuration is invalid: ${String(error?.message ?? error).slice(0, 200)}`);
    return false;
  }
}

/* ----------------------------- Subscriptions --------------------------- */

const subscriptions = () => store.load(SUB_STORE, []) ?? [];

/** A subscription's endpoint is its identity; the same device re-subscribing must not duplicate. */
function normaliseSubscription(raw) {
  const endpoint = typeof raw?.endpoint === 'string' ? raw.endpoint.trim() : '';
  const p256dh = typeof raw?.keys?.p256dh === 'string' ? raw.keys.p256dh : '';
  const auth = typeof raw?.keys?.auth === 'string' ? raw.keys.auth : '';
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return null;
  if (!p256dh || !auth || p256dh.length > 500 || auth.length > 200) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Save one subscription.
 *
 * `scope` is deliberately narrow: `{ role: 'owner' }` for kitchen devices, or
 * `{ role: 'customer', orderCode }` for a customer's own order. A device that
 * re-subscribes replaces its previous record, so a phone that clears storage and
 * subscribes again does not end up with duplicate pushes.
 */
export function saveSubscription(raw, scope) {
  const subscription = normaliseSubscription(raw);
  if (!subscription) return { ok: false, error: 'That push subscription is not usable.' };

  const userAgent = String(scope.userAgent ?? '').slice(0, 160);
  const record = {
    id: randomUUID(),
    role: scope.role,
    orderCode: scope.role === 'customer' ? String(scope.orderCode ?? '') : null,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    userAgent,
    createdAt: new Date().toISOString(),
    lastSentAt: null,
    failures: 0,
  };

  store.update(SUB_STORE, [], (list) => {
    const without = list.filter((entry) => entry.endpoint !== subscription.endpoint);
    if (scope.role === 'customer') {
      /*
       * One order should not accumulate devices without limit: a shared phone, a
       * tablet and a laptop is plausible, fifty is abuse. Oldest go first.
       */
      const forOrder = without.filter((entry) => entry.role === 'customer' && entry.orderCode === record.orderCode);
      if (forOrder.length >= MAX_SUBSCRIPTIONS_PER_ORDER) {
        const oldest = forOrder
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
          .slice(0, forOrder.length - MAX_SUBSCRIPTIONS_PER_ORDER + 1);
        const drop = new Set(oldest.map((entry) => entry.id));
        return [record, ...without.filter((entry) => !drop.has(entry.id))];
      }
    }
    return [record, ...without];
  });

  return { ok: true, role: record.role, orderCode: record.orderCode, record };
}

export function removeSubscription(endpoint) {
  if (!endpoint) return 0;
  let removed = 0;
  store.update(SUB_STORE, [], (list) => {
    const next = list.filter((entry) => entry.endpoint !== endpoint);
    removed = list.length - next.length;
    return next;
  });
  return removed;
}

/** Drop subscriptions for orders older than `days`, so the store cannot grow forever. */
export function pruneSubscriptions(days = 14) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;

  store.update(SUB_STORE, [], (list) => {
    const next = list.filter((entry) => {
      const created = Date.parse(entry.createdAt ?? '');
      const stale = Number.isFinite(created) && created < cutoff;
      if (stale) removed += 1;
      return !stale;
    });
    return next;
  });

  return removed;
}

/* -------------------------------- Payload ------------------------------ */

/**
 * What a notification says.
 *
 * The customer's notification never carries the tracking URL: a push payload is
 * stored by the browser's push service and can be displayed on a lock screen. It
 * says enough to act ("your order is ready") and nothing that would let a person
 * who picks up the phone open the order. They tap through to the page they
 * already have open instead.
 */
export function pushPayload(kind, order) {
  if (kind === 'owner-new-order') {
    const itemCount = (order.items ?? []).reduce((n, item) => n + item.qty, 0);
    return {
      title: `New order ${order.code}`,
      body: `${itemCount} plate${itemCount === 1 ? '' : 's'} · ${money(order.totals?.total)} · ${order.fulfilment === 'delivery' ? 'delivery' : 'collection'}`,
      tag: `order-${order.code}`,
      requireInteraction: true,
      data: { kind, code: order.code },
    };
  }

  /*
   * Sent the moment a device opts in, not when the order was placed.
   *
   * The original design pushed "order placed" at checkout, which could never work:
   * the customer taps "alert me" on the receipt page *after* checkout returns, so
   * there was nobody subscribed yet. This confirmation is also the only proof the
   * customer gets that the pipe actually reaches their phone.
   */
  if (kind === 'customer-alerts-on') {
    return {
      title: `Alerts on for ${order.code}`,
      body: `We will tell you here if ${order.code} changes. Total ${money(order.totals?.total)}.`,
      tag: `order-${order.code}-alerts`,
      data: { kind, code: order.code },
    };
  }

  if (kind === 'customer-order-cancelled') {
    return {
      title: `Order ${order.code} cancelled`,
      body: 'Your order has been cancelled. Call or WhatsApp us if this was not you.',
      tag: `order-${order.code}`,
      requireInteraction: true,
      data: { kind, code: order.code },
    };
  }

  return null;
}

/* -------------------------------- Sending ------------------------------ */

/**
 * Send one payload to a set of subscriptions.
 *
 * Returns what happened per subscription so the caller can prune dead endpoints.
 * A 404/410 means the browser threw the subscription away (uninstalled, permission
 * revoked, storage cleared) — that is permanent and the record is removed. Anything
 * else is transient and only counts a failure against the record.
 */
export async function deliver(subscriptionsToSend, payload, send = defaultSend) {
  const results = [];
  for (const subscription of subscriptionsToSend) {
    try {
      await send(subscription, payload);
      results.push({ id: subscription.id, ok: true });
      markSent(subscription.id);
    } catch (error) {
      const status = error?.statusCode ?? error?.status;
      const gone = status === 404 || status === 410;
      results.push({ id: subscription.id, ok: false, status, gone, message: String(error?.message ?? error).slice(0, 200) });
      if (gone) removeSubscription(subscription.endpoint);
      else markFailed(subscription.id);
    }
  }
  return results;
}

function defaultSend(subscription, payload) {
  /*
   * HB_PUSH_DRY_RUN=true logs instead of sending. Local runs and the test suite
   * use it so nothing reaches a real push service (and no test depends on DNS).
   */
  if (process.env.HB_PUSH_DRY_RUN === 'true') {
    console.info(`[push] dry run (${process.env.NODE_ENV ?? 'dev'}): would send "${payload.title}"`);
    return Promise.resolve({ statusCode: 201 });
  }
  return webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: subscription.keys },
    JSON.stringify(payload),
    { TTL: 60 * 60 * 6, urgency: payload.requireInteraction ? 'high' : 'normal' },
  );
}

function markSent(id) {
  store.update(SUB_STORE, [], (list) => list.map((entry) => (
    entry.id === id
      ? { ...entry, lastSentAt: new Date().toISOString(), failures: 0 }
      : entry
  )));
}

function markFailed(id) {
  store.update(SUB_STORE, [], (list) => list.map((entry) => (
    entry.id === id ? { ...entry, failures: (entry.failures ?? 0) + 1 } : entry
  )));
}

/** Notify every enrolled owner device about a new order. */
export async function notifyOwnerDevices(order, send) {
  const config = pushConfig();
  if (!config || !ensureVapid(config)) return { sent: 0, results: [] };

  const devices = subscriptions().filter((entry) => entry.role === 'owner');
  if (!devices.length) return { sent: 0, results: [] };

  const payload = pushPayload('owner-new-order', order);
  const results = await deliver(devices, payload, send);
  const sent = results.filter((result) => result.ok).length;
  console.info(`[push] order ${order.code}: owner devices notified ${sent}/${devices.length}`);
  return { sent, results };
}

/** Notify the devices subscribed to one order — never anyone else's. */
export async function notifyOrderDevices(order, kind, send) {
  const config = pushConfig();
  if (!config || !ensureVapid(config)) return { sent: 0, results: [] };

  const payload = pushPayload(kind, order);
  if (!payload) return { sent: 0, results: [] };

  const devices = subscriptions().filter(
    (entry) => entry.role === 'customer' && entry.orderCode === order.code,
  );
  if (!devices.length) return { sent: 0, results: [] };

  const results = await deliver(devices, payload, send);
  const sent = results.filter((result) => result.ok).length;
  console.info(`[push] order ${order.code}: customer devices notified ${sent}/${devices.length} (${kind})`);

  /*
   * A placed-order notification is the single one most orders need; the
   * subscriptions stay so a later cancellation can still reach them. They are
   * pruned by age rather than deleted here, because the receipt page is where a
   * customer revokes a device and it should keep working until they do.
   */
  return { sent, results };
}

/**
 * Confirm a single freshly-saved subscription, so the person who just tapped
 * "alert me" gets immediate proof instead of silence until a cancellation that
 * may never happen.
 */
export async function confirmOrderSubscription(record, order, send) {
  const config = pushConfig();
  if (!config || !ensureVapid(config)) return { sent: 0, results: [] };
  const payload = pushPayload('customer-alerts-on', order);
  if (!payload) return { sent: 0, results: [] };
  const results = await deliver([record], payload, send);
  const sent = results.filter((result) => result.ok).length;
  console.info(`[push] order ${order.code}: subscription confirmation ${sent ? 'delivered' : 'not delivered yet'}`);
  return { sent, results };
}

/** Counts for `/api/health`, without leaking endpoints. */
export function pushStatus() {
  const config = pushConfig();
  const all = subscriptions();
  return {
    configured: Boolean(config && ownerKey()),
    /* Keys present but no owner key means nobody can enrol an owner device. */
    vapid: Boolean(config),
    ownerKeySet: Boolean(ownerKey()),
    ownerDevices: all.filter((entry) => entry.role === 'owner').length,
    customerDevices: all.filter((entry) => entry.role === 'customer').length,
  };
}
