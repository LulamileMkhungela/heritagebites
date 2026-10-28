/**
 * Heritage Bites API.
 *
 * Serves the catalogue, checkout, public order tracking and contact endpoints.
 * The browser reaches it through relative /api URLs, proxied by Vite in development
 * and served from the same origin in production.
 */
import 'dotenv/config';
import express from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, has } from './lib/store.js';
import { chargeCard, paymentDriver, paymentConfig, verifyYocoCheckout } from './lib/payments.js';
import { computeTotals, applyDiscountCode, deliveryFeeCents, fromCents, toCents, orderCode, loyaltyPointsFor } from './lib/pricing.js';
import { customerCanCancel, STATUS_META, buildTimeline } from './lib/orders.js';
import { buildWhatsAppMessage, whatsappLink, fulfilmentLabel } from './lib/notify.js';
import { enqueueOrderAlert, notifyStatus, startOrderNotificationWorker } from './lib/order-notifications.js';
import { deliveryAreaFor, deliveryAreasLabel, serviceStatus, serviceWindowFor } from './lib/service.js';
import * as seed from './seed.js';

const PORT = Number(process.env.PORT || 4000);
const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------ Bootstrap ----------------------------- */

/*
 * Catalogue re-seeding.
 *
 * The storefront catalog (menu, plate menus, categories, settings, policies) is
 * owned by `seed.js` — it is content the business signs off, not customer data.
 * When SEED_VERSION changes we replace those files wholesale so a host that
 * already ran an older build cannot keep serving retired dishes, prices or
 * opening hours. Orders, messages, loyalty stamps and the order outbox are
 * customer data and are never touched.
 */
const CATALOG_STORES = ['menu', 'plateMenus', 'categories', 'comingSoon', 'settings', 'discountCodes', 'specials', 'policies'];

const storedSeedVersion = store.load('seedVersion', 0);
if (storedSeedVersion !== seed.SEED_VERSION || !has('menu') || !has('plateMenus')) {
  for (const name of CATALOG_STORES) store.save(name, seed[name]);
  store.save('seedVersion', seed.SEED_VERSION);
  console.info(`[heritagebites] catalogue seeded at version ${seed.SEED_VERSION}`);
}

/* Retired stores from earlier builds; harmless to leave, but kept tidy. */
if (has('plateBuilder')) {
  // The single build-your-own builder was replaced by the two fixed-price plate menus.
  const legacy = store.load('plateBuilder', null);
  if (legacy) store.save('plateBuilderLegacy', legacy);
}

if (!has('orders')) store.save('orders', []);
if (!has('messages')) store.save('messages', []);
if (!has('quests')) store.save('quests', []);
if (!has('stamps')) store.save('stamps', {});
if (!has('seq')) store.save('seq', { n: 1 });

const get = (name) => store.load(name, null);
const set = (name, value) => store.save(name, value);
const tokenDigest = (token) => createHash('sha256').update(String(token)).digest('hex');
const hasValidTrackingToken = (order, token) => {
  if (!order?.trackingTokenHash || typeof token !== 'string' || !token) return false;
  const actual = Buffer.from(tokenDigest(token), 'hex');
  const expected = Buffer.from(order.trackingTokenHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const app = express();
app.use(express.json({ limit: '256kb' }));

/* ------------------------------ Helpers ------------------------------- */

const todayDay = () => new Date().getDay();

function findMenu(id) {
  return get('menu')?.find((m) => m.id === id);
}

/**
 * Resolve a client basket into server-priced line items.
 * Option price deltas are taken from the server catalogue, never the client.
 */
function priceLines(clientLines) {
  const errors = [];
  const lines = [];

  for (const raw of clientLines ?? []) {
    /*
     * Plate-builder lines: the customer picks a protein, a starch and a side
     * inside a fixed-price plate menu. The components carry no price of their
     * own, so the only amount that matters is the plate price — read from the
     * server, never from the browser.
     */
    if (raw.kind === 'plate') {
      const plateMenus = get('plateMenus') ?? seed.plateMenus;
      const plate = plateMenus.find((p) => p.id === raw.plateId);
      if (!plate) {
        errors.push('That plate is no longer on our menu.');
        continue;
      }
      const chosen = [];
      let invalid = false;
      for (const group of plate.groups) {
        const picked = (raw.selections?.[group.id] ?? []).filter((id) => group.items.some((i) => i.id === id));
        if (group.required && picked.length === 0) {
          errors.push(`${plate.name}: please choose ${group.label.toLowerCase()}.`);
          invalid = true;
          continue;
        }
        if (group.max && picked.length > group.max) {
          errors.push(`${plate.name}: you can choose at most ${group.max} for ${group.label.toLowerCase()}.`);
          invalid = true;
          continue;
        }
        for (const id of picked) chosen.push({ label: group.items.find((i) => i.id === id).label });
      }
      if (invalid) continue;

      const qty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
      lines.push({
        itemId: `plate-${plate.id}`,
        name: plate.name,
        unitPrice: plate.price,
        qty,
        options: chosen,
        lineTotal: Math.round(plate.price * qty * 100) / 100,
      });
      continue;
    }

    const item = findMenu(raw.itemId);
    if (!item) {
      errors.push(`"${raw.itemId}" is not on our menu.`);
      continue;
    }
    if (item.available === false) {
      errors.push(`${item.name} is sold out today.`);
      continue;
    }
    const qty = Math.max(1, Math.min(50, Number(raw.qty) || 1));

    const optionLabels = [];
    let unitPrice = Number(item.price);
    for (const opt of item.options ?? []) {
      const clientPicked = raw.options?.[opt.id] ?? null;
      if (!clientPicked) {
        if (opt.required) errors.push(`${item.name}: please choose ${opt.label.toLowerCase()}.`);
        continue;
      }
      const picked = Array.isArray(clientPicked) ? clientPicked : [clientPicked];
      for (const p of picked) {
        const choice = opt.choices.find((c) => c.id === p);
        if (!choice) continue;
        unitPrice += Number(choice.priceDelta) || 0;
        optionLabels.push({ id: choice.id, label: choice.label, priceDelta: Number(choice.priceDelta) || 0 });
      }
    }

    /*
     * A menu card is always one complete plate. If it is linked to a plate
     * menu, the fixed plate price wins over the item price so a stale or edited
     * catalogue record cannot quietly under- or over-charge.
     */
    const plate = item.plateId ? (get('plateMenus') ?? seed.plateMenus).find((p) => p.id === item.plateId) : null;
    if (plate) unitPrice = plate.price;

    lines.push({
      itemId: item.id,
      name: item.name,
      unitPrice: Math.round(unitPrice * 100) / 100,
      qty,
      options: optionLabels,
      lineTotal: Math.round(unitPrice * qty * 100) / 100,
    });
  }

  return { lines, errors };
}

/** One place where totals are decided. Every money path goes through this. */
function quote(clientLines, { fulfilment = 'collection', code = '' } = {}) {
  const { lines, errors } = priceLines(clientLines);
  if (!['collection', 'delivery'].includes(fulfilment)) errors.push('Please choose collection or delivery.');
  const settings = get('settings');
  const subtotalCents = lines.reduce((s, l) => s + toCents(l.unitPrice) * l.qty, 0);

  const disc = applyDiscountCode(code, subtotalCents, get('discountCodes'));

  /*
   * Delivery is included in the plate price (R100 / R130), so there is no
   * separate delivery fee. The rules that still apply are the R100 minimum and
   * the two approved delivery areas, both confirmed by the business.
   */
  let deliveryCents = 0;
  if (fulfilment === 'delivery') {
    const fee = deliveryFeeCents(subtotalCents, settings);
    if (fee < 0) {
      errors.push(`Delivery orders start at R${Number(settings.minDeliveryOrder ?? 100).toFixed(2)}.`);
    } else {
      deliveryCents = fee;
    }
  }

  const totals = computeTotals({ items: lines, settings, discountCents: disc.ok ? disc.discountCents : 0 });
  totals.deliveryCents = deliveryCents;
  totals.delivery = fromCents(deliveryCents);
  totals.totalCents = Math.max(0, totals.subtotalCents - totals.discountCents + deliveryCents);
  totals.total = fromCents(totals.totalCents);

  return { lines, errors, totals, discount: disc };
}

/**
 * `t***@example.co.za` — enough to recognise your own inbox, not enough to leak
 * it to anyone who happens to hold a tracking link.
 */
function maskEmail(value) {
  const email = String(value ?? '').trim();
  const at = email.indexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  return `${local[0]}${'*'.repeat(Math.max(1, Math.min(3, local.length - 1)))}${email.slice(at)}`;
}

/**
 * What actually happened to the customer's receipt.
 *
 * The page must not promise an email that was never queued: with no SMTP
 * configured no customer-email job exists at all, so the state is `none` and the
 * order page stays quiet instead of claiming a receipt was sent.
 */
function receiptStatusFor(order) {
  const jobs = store.load('orderNotificationJobs', []) ?? [];
  const job = jobs.find((entry) => entry.orderCode === order.code
    && (entry.channel ?? 'owner-email') === 'customer-email');
  const state = !job
    ? 'none'
    : job.status === 'sent'
      ? 'sent'
      : job.status === 'failed' ? 'failed' : 'queued';
  return { email: maskEmail(order.customer?.email), state };
}

function publicOrder(order) {
  const receipt = receiptStatusFor(order);
  const settings = get('settings');
  return {
    id: order.id,
    code: order.code,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    status: order.status,
    statusMeta: STATUS_META[order.status],
    channel: order.channel,
    fulfilment: order.fulfilment,
    fulfilmentLabel: fulfilmentLabel(order.fulfilment),
    customer: { name: order.customer.name, phone: order.customer.phone },
    /*
     * Confirmation of where the receipt was emailed, masked. The full address is
     * never returned: this payload is also served from the tracking link, and a
     * masked address is enough for the customer to recognise their own inbox.
     */
    receiptEmail: receipt.state === 'none' ? null : receipt.email,
    receiptState: receipt.state,
    items: order.items,
    totals: order.totals,
    payment: { method: order.payment.method, status: order.payment.status, reference: order.payment.reference, last4: order.payment.last4, brand: order.payment.brand },
    discountCode: order.discountCode ?? null,
    timeline: buildTimeline(order),
    whatsapp: order.whatsapp,
    phone: settings.phoneDisplay,
    serviceWindow: order.serviceWindow ?? null,
    deliveryArea: order.customer?.suburb ?? null,
    loyalty: order.loyalty,
    canCancel: customerCanCancel(order.status) && order.payment.status !== 'approved',
  };
}

function appendTimeline(order, status, note) {
  order.timeline = [...(order.timeline ?? []), { status, at: new Date().toISOString(), note }];
  order.updatedAt = new Date().toISOString();
  return order;
}

/* --------------------------- Contact inbox ---------------------------- */

/*
 * Contact-form delivery.
 *
 * The business supplied a Formspree endpoint (formspree.io/f/xvkkkwve), so an
 * enquiry is posted there — straight to the monitored inbox — and also kept in
 * the local message store as a fallback record. Set
 * HB_CONTACT_FORMSPREE_URL to override it, or to an empty string to keep
 * messages local only (tests do this so they never call the network).
 */
function contactEndpoint() {
  if (process.env.HB_CONTACT_FORMSPREE_URL !== undefined) {
    const override = process.env.HB_CONTACT_FORMSPREE_URL.trim();
    return override ? override : null;
  }
  const configured = String(get('settings')?.contactFormspreeUrl ?? '').trim();
  return configured || null;
}

/**
 * Send one message to the monitored Formspree inbox.
 *
 * Contact enquiries and customer quests share the endpoint because they share
 * the people reading it; only the subject line and the summary differ, so a
 * quest never arrives looking like an order or a complaint.
 */
async function forwardToInbox(payload, label) {
  const endpoint = contactEndpoint();
  if (!endpoint) return { delivered: false, reason: 'not_configured' };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[${label}] Formspree rejected the message (${res.status}): ${detail.slice(0, 160)}`);
      return { delivered: false, reason: `http_${res.status}` };
    }
    return { delivered: true };
  } catch (error) {
    console.error(`[${label}] could not forward the message: ${String(error?.message ?? error).slice(0, 200)}`);
    return { delivered: false, reason: 'network_error' };
  }
}

async function forwardContact(entry) {
  return forwardToInbox(
    {
      name: entry.name,
      phone: entry.phone,
      email: entry.email,
      subject: entry.subject,
      message: entry.message,
      _subject: `Heritage Bites website enquiry — ${entry.subject}`,
      source: 'heritagebites.co.za/contact',
    },
    'contact',
  );
}

async function forwardQuest(entry) {
  const day = entry.serviceDay === 'either' ? 'Thursday or Friday' : entry.serviceDay;
  const summary = [
    `Meal requested: ${entry.dish}`,
    `Service day asked for: ${day}`,
    `Plates: ${entry.plates}`,
    entry.notes ? `Notes: ${entry.notes}` : '',
    `Reply to: ${entry.name} · ${entry.phone}${entry.email ? ` · ${entry.email}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');

  return forwardToInbox(
    {
      name: entry.name,
      phone: entry.phone,
      email: entry.email,
      subject: `Meal quest — ${entry.dish}`.slice(0, 120),
      message: summary,
      _subject: `Heritage Bites meal quest — ${entry.name}`.slice(0, 120),
      source: 'heritagebites.co.za/quest',
    },
    'quest',
  );
}

/* ------------------------------ Public API ---------------------------- */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    paymentDriver: paymentDriver(),
    orders: get('orders').length,
    /* Which free notification channels are configured — booleans, no secrets. */
    notifications: notifyStatus(),
    time: new Date().toISOString(),
  });
});

app.get('/api/catalog', (_req, res) => {
  const settings = get('settings');
  res.json({
    categories: get('categories'),
    /**
     * The kitchen archive: categories the site carried before the two-tier menu.
     * View only — no prices, no stock, never part of `menu`, so it cannot be
     * ordered, priced or searched into a basket.
     */
    comingSoon: get('comingSoon') ?? seed.comingSoon,
    menu: get('menu'),
    plateMenus: get('plateMenus') ?? seed.plateMenus,
    policies: get('policies') ?? seed.policies,
    settings,
    service: serviceStatus(settings),
    payments: paymentConfig(),
    contact: { inboxConfigured: contactEndpoint() !== null },
    today: todayDay(),
  });
});

/** Search backs the command-palette: name, local name, language, tags, story. */
app.get('/api/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const menu = get('menu');
  if (!q) return res.json({ results: [], q });

  const score = (m) => {
    const hay = [m.name, m.localName, m.language, m.category, (m.tags ?? []).join(' '), m.description, m.story].join(' ').toLowerCase();
    if (m.name.toLowerCase().startsWith(q)) return 100;
    if (m.localName?.toLowerCase().startsWith(q)) return 90;
    if (hay.includes(q)) return 60;
    const words = hay.split(/\s+/).filter((w) => w.startsWith(q));
    return words.length ? 40 : 0;
  };

  const results = menu
    .map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map(({ m }) => ({ id: m.id, name: m.name, localName: m.localName, price: m.price, image: m.image, category: m.category, available: m.available }));

  res.json({ results, q });
});

app.post('/api/quote', (req, res) => {
  const { items, fulfilment, code } = req.body ?? {};
  const { lines, errors, totals, discount } = quote(items, { fulfilment, code });
  if (errors.length) return res.status(422).json({ errors });
  res.json({ lines, totals, discount: discount.ok ? discount.applied : null, discountError: discount.ok ? null : discount.message ?? discount.reason });
});

/* ------------------------------ Checkout ------------------------------ */

/*
 * Cash on collection is the only cash option the business confirmed: it is a
 * shadow kitchen, so there is no counter to pay at and no cash-on-delivery
 * arrangement. Card is the only online method.
 */
const PAYMENT_METHODS = ['card', 'cash-on-collection'];

/** Card details are only ever posted to this API by the offline sandbox form. */
function cardFieldsSent(payment) {
  return Boolean(payment?.card || payment?.token);
}

app.post('/api/orders', async (req, res) => {
  const { items, fulfilment = 'collection', customer = {}, code = '', payment = {}, channel = 'card' } = req.body ?? {};

  const { lines, errors, totals, discount } = quote(items, { fulfilment, code });
  /*
   * Pricing errors come first: a basket whose only line is invalid has no
   * lines, and "your basket is empty" would hide the actual reason (an unknown
   * plate, a missing starch) from the customer.
   */
  if (errors.length) return res.status(422).json({ errors });
  if (!lines.length) return res.status(422).json({ errors: ['Your basket is empty.'] });

  if (!customer.name?.trim() || !customer.phone?.trim()) {
    return res.status(422).json({ errors: ['Please add your name and a contact number.'] });
  }
  if (fulfilment === 'delivery') {
    if (!customer.address?.trim()) {
      return res.status(422).json({ errors: ['Please add a delivery address.'] });
    }
    /*
     * The delivery boundary is enforced, not just described. A Rosebank/Sandton
     * kitchen cannot promise a delivery to Pretoria, so the order is refused
     * with a route to collection rather than accepted and cancelled later.
     */
    const area = deliveryAreaFor(`${customer.suburb ?? ''} ${customer.address}`, get('settings'));
    if (!area) {
      return res.status(422).json({
        errors: [`We deliver in ${deliveryAreasLabel(get('settings'))} only. Choose collection, or contact us on WhatsApp to arrange something else.`],
        deliveryAreas: get('settings')?.deliveryAreas ?? [],
      });
    }
    customer.suburb = area;
  }
  if (!PAYMENT_METHODS.includes(payment.method)) {
    return res.status(422).json({ errors: ['Unknown payment method.'] });
  }
  if (payment.method === 'cash-on-collection' && fulfilment === 'delivery') {
    return res.status(422).json({ errors: ['Cash is only accepted on collection. Please pay by card, or choose collection.'] });
  }

  /*
   * A card order needs an email address.
   *
   * That address is the only place a receipt can go: card orders are the ones
   * where the customer has no other record of what they paid for. Cash on
   * collection stays optional — the customer is standing in front of us, and
   * forcing an address there would only add friction to a completed sale.
   *
   * Checked before the card is charged, so a refusal never costs the customer a
   * payment and never creates an order that cannot be receipted.
   */
  const customerEmail = String(customer.email ?? '').trim();
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail);
  if (customerEmail && !emailLooksValid) {
    return res.status(422).json({ errors: ['That email address does not look right.'] });
  }
  if (payment.method === 'card' && !customerEmail) {
    return res.status(422).json({
      errors: ['Please add an email address — it is where your receipt for a card order goes.'],
      code: 'email_required',
    });
  }

  let chargeResult = null;

  if (payment.method === 'card') {
    /*
     * Live Yoco: the card is entered in Yoco's hosted window and the browser
     * posts back a checkout id. We verify that checkout with Yoco, including
     * the amount, before the order is created — a client-supplied "paid" flag
     * is never trusted.
     *
     * Sandbox: no YOCO_SECRET_KEY means no real money is involved, so the
     * offline test-card form is used instead.
     */
    if (paymentConfig().hostedCheckout) {
      if (cardFieldsSent(payment)) {
        return res.status(422).json({
          errors: ['Please enter card details in the secure Yoco payment window. This site never receives card numbers.'],
          code: 'hosted_checkout_required',
        });
      }
      chargeResult = await verifyYocoCheckout({
        checkoutId: payment.checkoutId,
        amountCents: totals.totalCents,
        currency: totals.currency,
      });
    } else {
      chargeResult = await chargeCard({
        amount: totals.total,
        currency: totals.currency,
        description: `Heritage Bites order (${lines.length} items)`,
        card: payment.card,
      });
    }

    if (chargeResult.status !== 'approved') {
      const status = chargeResult.status === 'invalid' ? 422 : chargeResult.status === 'requires_action' ? 409 : 402;
      const requiresAction = chargeResult.status === 'requires_action';
      return res.status(status).json({
        errors: [chargeResult.message || 'Payment could not be completed.'],
        code: chargeResult.code,
        requiresAction,
        // A card needing 3-D Secure is not a decline — the customer can still
        // finish. Yoco hands back the issuer's challenge URL; without it the
        // customer hits a dead end and the order can never be paid for.
        ...(requiresAction && chargeResult.redirectUrl ? { redirectUrl: chargeResult.redirectUrl } : {}),
      });
    }
  }

  const seq = store.update('seq', { n: 1 }, (s) => ({ n: (s.n || 1) + 1 }));
  const now = new Date().toISOString();
  const trackingToken = randomBytes(32).toString('base64url');
  const order = {
    id: `ord_${seq.n.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    trackingTokenHash: tokenDigest(trackingToken),
    code: orderCode(seq.n),
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    channel,
    fulfilment,
    customer: {
      name: customer.name.trim(),
      phone: customer.phone.trim(),
      email: (customer.email ?? '').trim(),
      address: (customer.address ?? '').trim(),
      suburb: (customer.suburb ?? '').trim(),
      notes: (customer.notes ?? '').trim(),
    },
    items: lines,
    totals,
    payment: {
      method: payment.method,
      status: chargeResult ? 'approved' : 'pending',
      reference: chargeResult?.id ?? 'CASH',
      last4: chargeResult?.last4 ?? null,
      brand: chargeResult?.brand ?? null,
      riskScore: chargeResult?.riskScore ?? null,
      driver: chargeResult?.driver ?? null,
    },
    discountCode: discount.ok ? discount.applied.code : null,
    /*
     * Which service window this order belongs to. Inside 12:00–13:30 on a
     * Thursday or Friday it is for today; outside it is a pre-order and the
     * receipt, email alert and customer all say which window it is cooked in.
     */
    serviceWindow: serviceWindowFor(get('settings')),
    loyalty: { pointsEarned: loyaltyPointsFor(totals.total, get('settings').loyaltyRateCents), pointsRedeemed: 0 },
    timeline: [],
  };

  appendTimeline(order, 'pending', chargeResult ? `Card approved (**** ${chargeResult.last4})` : `Payment method: ${payment.method}`);

  const settings = get('settings');
  order.whatsapp = whatsappLink(
    settings.whatsapp,
    buildWhatsAppMessage({ code: order.code, items: lines, totals, fulfilment, customer: order.customer }),
  );

  set('orders', [order, ...get('orders')]);
  try {
    /* The one-time tracking token lets the customer receipt deep-link into the
       private order page; the saved order still keeps only its digest. */
    enqueueOrderAlert(order, { trackingToken });
  } catch (error) {
    // The order remains valid even if its email-alert job cannot be recorded.
    console.error(`[order-notifications] could not queue order ${order.code}: ${String(error?.message ?? error).slice(0, 200)}`);
  }

  // Loyalty-card stamps are tracked per phone number.
  const stamps = get('stamps');
  const key = order.customer.phone.replace(/\D/g, '');
    const prev = stamps[key] ?? { phone: order.customer.phone, name: order.customer.name, stamps: 0, orders: 0, lifetimeCents: 0 };
    const next = {
      ...prev,
      name: order.customer.name,
      /*
       * Credit the stamps the order actually earned, not a flat one.
       *
       * This used to be `prev.stamps + 1`, while the order itself recorded
       * loyalty.pointsEarned from loyaltyPointsFor(total, loyaltyRateCents) —
       * one stamp per R50. The two disagreed, so the tracking page told a
       * customer "This order earned 3 stamps" and the Passport then showed
       * only one. The rate is configurable, so the earned figure is the only
       * correct thing to bank.
       */
      stamps: prev.stamps + order.loyalty.pointsEarned,
      orders: prev.orders + 1,
    lifetimeCents: prev.lifetimeCents + totals.totalCents,
    lastOrderAt: now,
  };
  stamps[key] = next;
  set('stamps', stamps);

  res.set('Cache-Control', 'private, no-store');
  res.status(201).json({ order: publicOrder(order), loyalty: next, trackingToken });
});

app.get('/api/orders/:code', (req, res) => {
  const order = get('orders').find((o) => o.code.toLowerCase() === String(req.params.code).toLowerCase());
  if (!order || !hasValidTrackingToken(order, String(req.query.token ?? ''))) {
    return res.status(404).json({ error: 'That secure tracking link is invalid or has expired.' });
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ order: publicOrder(order) });
});

app.post('/api/orders/:code/cancel', (req, res) => {
  const orders = get('orders');
  const idx = orders.findIndex((o) => o.code.toLowerCase() === String(req.params.code).toLowerCase());
  if (idx < 0 || !hasValidTrackingToken(orders[idx], String(req.body?.token ?? ''))) {
    return res.status(404).json({ error: 'That secure tracking link is invalid or has expired.' });
  }
  const order = orders[idx];
  if (order.payment.status === 'approved') {
    return res.status(409).json({ error: 'This order has been paid. Contact us by phone or WhatsApp to discuss a cancellation or refund.' });
  }
  if (!customerCanCancel(order.status)) {
    return res.status(409).json({ error: 'This order cannot be cancelled online. Please contact us directly.' });
  }
  const previous = order.status;
  order.status = 'cancelled';
  appendTimeline(order, 'cancelled', `Cancelled by customer (was ${previous})`);
  orders[idx] = order;
  set('orders', orders);
  res.set('Cache-Control', 'private, no-store');
  res.json({ order: publicOrder(order) });
});

/* ----------------------------- Loyalty card -------------------------- */

app.post('/api/passport', (req, res) => {
  const key = String(req.body?.phone ?? '').replace(/\D/g, '');
  if (key.length < 9) return res.status(422).json({ error: 'Please enter a valid South African cell number.' });
  const record = get('stamps')[key];
  if (!record) return res.json({ found: false, phone: key, stamps: 0, orders: 0, lifetime: 0 });
  /*
   * A completed card is due, not empty.
   *
   * `10 - (stamps % 10)` reported "10 more to go" at exactly ten stamps, so the
   * cell that filled the card was the one that hid the reward — the customer's
   * tenth stamp looked like zero progress. A multiple of ten that is not zero
   * means a full card, which is what the counter honours.
   */
  const full = record.stamps > 0 && record.stamps % 10 === 0;
  res.json({
    found: true,
    phone: key,
    name: record.name,
    stamps: record.stamps,
    orders: record.orders,
    lifetime: fromCents(record.lifetimeCents),
    untilFree: full ? 0 : 10 - (record.stamps % 10),
    cardsCompleted: Math.floor(record.stamps / 10),
  });
});

/* -------------------------------- Contact ----------------------------- */

app.post('/api/contact', async (req, res) => {
  const { name, phone, email, subject, message } = req.body ?? {};
  if (!name?.trim() || !message?.trim()) return res.status(422).json({ errors: ['Please add your name and a message.'] });

  const entry = {
    id: `msg_${Date.now().toString(36)}`,
    name: name.trim(),
    phone: (phone ?? '').trim(),
    email: (email ?? '').trim(),
    subject: (subject ?? 'General enquiry').trim(),
    message: message.trim(),
    createdAt: new Date().toISOString(),
    read: false,
  };
  set('messages', [entry, ...get('messages')]);

  // The message is saved first, so a delivery failure never loses an enquiry.
  const delivery = await forwardContact(entry);
  res.status(201).json({ ok: true, id: entry.id, delivered: delivery.delivered });
});

/* ---------------------------- Customer quests -------------------------- */

/*
 * A customer quest is a request for a dish the customer wants us to cook — not
 * an order and not a booking. It is stored so nothing is lost, then forwarded
 * to the same monitored inbox as a separate, clearly-labelled message. Nothing
 * is promised: the reply comes from a person, and quests do not create orders,
 * prices or stock.
 */
const QUEST_DAYS = ['either', 'Thursday', 'Friday'];

app.post('/api/quests', async (req, res) => {
  const { name, phone, email, dish, serviceDay = 'either', plates, notes } = req.body ?? {};
  const errors = [];

  if (typeof name !== 'string' || name.trim().length < 2) errors.push('Please add your name so we know who asked.');
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) errors.push('Please add a cell number we can reply to.');
  if (typeof dish !== 'string' || dish.trim().length < 5) errors.push('Tell us what you would like us to cook.');
  if (errors.length) return res.status(422).json({ errors });

  const entry = {
    id: `quest_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 80),
    phone: String(phone).trim().slice(0, 30),
    email: typeof email === 'string' ? email.trim().slice(0, 120) : '',
    dish: dish.trim().slice(0, 600),
    serviceDay: QUEST_DAYS.includes(serviceDay) ? serviceDay : 'either',
    plates: Math.max(1, Math.min(60, Number(plates) || 1)),
    notes: typeof notes === 'string' ? notes.trim().slice(0, 600) : '',
    createdAt: new Date().toISOString(),
    status: 'new',
  };
  set('quests', [entry, ...(get('quests') ?? [])]);

  const delivery = await forwardQuest(entry);
  res.status(201).json({ ok: true, id: entry.id, delivered: delivery.delivered });
});

/* ------------------------------- 404 ---------------------------------- */

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

/* --------------------------- Static frontend --------------------------- */
/*
 * In production this single process serves both the API and the built
 * storefront from one origin, so relative /api calls just work and there is
 * exactly one port to expose. In dev, run `npm run dev` and let Vite serve the
 * app on 5173 while proxying /api here.
 */
const DIST = join(here, '..', 'dist');
if (existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }));

  /*
   * SPA fallback — but only for *routes*. A request for something with a file
   * extension (/img/x.jpg, /assets/x.js) is an asset request: if static serving
   * didn't answer it, it is genuinely missing and must 404. Catching those with
   * index.html hides broken images and missing bundles behind a 200.
   *
   * Unknown *routes* still get the shell, so the client router can paint its own
   * "not found" screen — but with a 404 status. Serving them 200 is a soft 404:
   * crawlers index a page whose entire content is an apology.
   */
  const KNOWN_ROUTES = new Set([
    '/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest',
  ]);
  const isKnownRoute = (path) => KNOWN_ROUTES.has(path) || /^\/order\/[^/]+$/.test(path);

  app.get('*', (req, res, next) => {
    const path = req.path;
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    const looksLikeAsset = lastSegment.includes('.') && !path.startsWith('/api');
    if (looksLikeAsset) {
      return res.status(404).json({ error: `No such file: ${path}` });
    }
    if (!req.accepts('html')) return next();
    const status = isKnownRoute(path) ? 200 : 404;
    return res.status(status).sendFile(join(DIST, 'index.html'));
  });

  console.log(`[heritagebites web] serving ${DIST}`);
} else {
  app.get('/', (_req, res) =>
    res
      .status(503)
      .type('html')
      .send('<h1>Frontend not built yet</h1><p>Run <code>npm run build</code> then restart, or use <code>npm run dev</code>.</p>'),
  );
}

export { app };

if (process.env.NODE_ENV !== 'test') {
  startOrderNotificationWorker();
  // Bound to 0.0.0.0 so the sandbox preview host can reach this process.
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[heritagebites api] listening on http://0.0.0.0:${PORT} (payments: ${paymentDriver()})`);
  });
}
