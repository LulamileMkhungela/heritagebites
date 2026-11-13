/**
 * Heritage Bites API.
 *
 * Serves the catalogue, checkout, public order tracking and contact endpoints.
 * The browser reaches it through relative /api URLs, proxied by Vite in development
 * and served from the same origin in production.
 */
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, has } from './lib/store.js';
import { paymentConfig, paymentDriver, paymentWarnings, readYocoEvent, startYocoPayment, verifyYocoWebhook, yocoMode } from './lib/payments.js';
import { computeTotals, applyDiscountCode, deliveryFeeCents, fromCents, toCents, orderCode, loyaltyPointsFor } from './lib/pricing.js';
import { customerCanCancel, STATUS_META, buildTimeline } from './lib/orders.js';
import { buildWhatsAppMessage, whatsappLink, fulfilmentLabel } from './lib/notify.js';
/*
 * Order alerts are Web Push only.
 *
 * Email alerts needed an SMTP host, port and app password configured on the
 * server before a single kitchen ticket could be sent — that is infrastructure
 * work, not "put your address in". Anything the owner cannot switch on by
 * entering their own email address has been removed, so what remains is the
 * push channel: generated keys and a device enrolled once at /alerts.
 */
import {
  confirmOrderSubscription,
  notifyOrderDevices,
  notifyOwnerDevices,
  ownerKey,
  pushConfig,
  pushStatus,
  removeSubscription,
  saveSubscription,
} from './lib/web-push.js';
import { areasNamedIn, deliveryAreaFor, deliveryAreasLabel, serviceStatus, serviceWindowFor } from './lib/service.js';
import { rateLimit, scaledMax } from './lib/rate-limit.js';
import * as seed from './seed.js';
import { HEAD_END, HEAD_START, headHtml, normaliseSiteUrl } from '../shared/seo.js';

/*
 * The clock the shop runs on.
 *
 * `serviceStatus` accepts a moment so it can be asked "what happens at 15:09 on
 * a Friday?". Production never sets HB_CLOCK_LABEL, so this is simply now; the
 * test suites pin it so they can run the shop both open and shut without
 * depending on when CI happens to start.
 */
const clockNow = () => (process.env.HB_CLOCK_LABEL ? new Date(process.env.HB_CLOCK_LABEL) : new Date());

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

/*
 * Behind a host's reverse proxy every connection appears to come from 127.0.0.1,
 * which would make every visitor share one rate-limit bucket. Asking Express to
 * read X-Forwarded-For is only safe when the deployment says there really is a
 * proxy in front of it, so it is opt-in rather than assumed.
 */
if (process.env.HB_TRUST_PROXY === '1') app.set('trust proxy', 1);

/*
 * gzip. The JavaScript bundle is ~325kB uncompressed and ~94kB gzipped, and this
 * audience is on mobile data in South Africa, where that difference is the
 * customer's airtime. The dev server compresses already; the production process
 * did not, which meant the live site shipped the bigger number.
 */
app.use(compression({ threshold: 1024 }));

/*
 * Security headers.
 *
 * Deliberately conservative and hand-written rather than a helmet default: a
 * mis-set Content-Security-Policy does not throw, it silently breaks the site in
 * whichever browser is strictest. The two that matter here are HSTS (this site
 * takes card orders, so plain HTTP must never be offered after the first visit)
 * and frame-ancestors/X-Frame-Options (a login-free order page inside someone
 * else's frame is a clickjacking surface).
 *
 * There is no CSP yet. The built index.html carries an inline JSON-LD block and
 * the app uses inline styles, so a real policy needs nonces threaded through the
 * build. Doing that badly is worse than not doing it; it is listed as follow-up.
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  /*
   * Only over HTTPS, and only for a year at a time: HSTS on a domain that is
   * later served over plain HTTP locks customers out with no way to click past it.
   */
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/*
 * CORS for the split deployment described in .env.example: the storefront on
 * one origin (the GitHub Pages build, say) and this API on another. Without it
 * the browser blocks the enquiry and order posts and the customer sees a
 * network error, so the documented arrangement could never have worked.
 *
 * It is off unless an origin is listed in HB_ALLOWED_ORIGINS — no wildcard, so
 * an unrelated site cannot post here and have its enquiries look like ours.
 * Same-origin deployments (Express serving the built site itself) need nothing.
 */
const ALLOWED_ORIGINS = String(process.env.HB_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = String(req.get('origin') ?? '').replace(/\/$/, '');
  const allowed = Boolean(origin) && ALLOWED_ORIGINS.includes(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  /* Preflight only exists for /api; every other path is served as-is. */
  if (req.method === 'OPTIONS' && req.path.startsWith('/api')) {
    return res.status(allowed ? 204 : 403).end();
  }
  return next();
});

/*
 * The raw body is kept for webhook signature checks. Yoco signs the exact bytes
 * it sent, so re-serialising the parsed JSON would never match.
 */
app.use(
  express.json({
    limit: '256kb',
    verify: (req, _res, buf) => {
      if (req.path.startsWith('/api/payments/')) req.rawBody = buf.toString('utf8');
    },
  }),
);

/* ---------------------------- Rate limits ------------------------------ */
/*
 * Limits on the endpoints that cost something: money (orders), disk (the JSON
 * store grows with every order, quest and enquiry), or trust (the loyalty lookup
 * takes a phone number and returns someone's stamp count, so it is also an
 * enumeration surface).
 *
 * The numbers are deliberately loose, for a reason worth writing down: South
 * African mobile networks put many customers behind one carrier-grade NAT
 * address, so a limit tuned to "one person" would lock out a whole shopping
 * centre. These are tuned to "one busy shopfront", which a script still cannot
 * reach. Anything that trips a limit gets a 429 and a Retry-After, never a silent
 * drop, and the client already degrades gracefully (the search palette falls back
 * to filtering the catalogue it has).
 *
 * Read-only endpoints are capped mostly to stop a scraper copying the catalogue
 * or hammering search, and /api/health is left uncapped because an uptime monitor
 * polling it every minute is exactly the traffic that should always succeed.
 */
const LIMITS = {
  catalogue: rateLimit({ windowMs: 60_000, max: scaledMax(180), name: 'catalogue' }),
  search: rateLimit({ windowMs: 60_000, max: scaledMax(180), name: 'search' }),
  quote: rateLimit({ windowMs: 60_000, max: scaledMax(120), name: 'quote' }),
  order: rateLimit({ windowMs: 10 * 60_000, max: scaledMax(20), name: 'order' }),
  orderRead: rateLimit({ windowMs: 60_000, max: scaledMax(120), name: 'order-read' }),
  cancel: rateLimit({ windowMs: 10 * 60_000, max: scaledMax(10), name: 'cancel' }),
  loyalty: rateLimit({ windowMs: 10 * 60_000, max: scaledMax(30), name: 'loyalty' }),
  contact: rateLimit({ windowMs: 10 * 60_000, max: scaledMax(8), name: 'contact' }),
  quest: rateLimit({ windowMs: 10 * 60_000, max: scaledMax(8), name: 'quest' }),
  push: rateLimit({ windowMs: 60_000, max: scaledMax(30), name: 'push' }),
};

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
   * Collection is the plate price exactly; delivery adds the one flat fee for
   * the Rosebank/Sandton run. It is charged on top of the plates rather than
   * folded into them, so a customer who collects is never paying for a
   * delivery they did not ask for. The R100 minimum and the two approved
   * delivery areas still apply.
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

function publicOrder(order) {
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
     * No receipt email is sent or promised: email alerts are gone, and the
     * WhatsApp chat is the customer's record. The fields stay in the payload as
     * explicit nulls so an older cached client cannot claim a receipt that was
     * never queued.
     */
    receiptEmail: null,
    receiptState: 'none',
    items: order.items,
    totals: order.totals,
    payment: {
      method: order.payment.method,
      status: order.payment.status,
      reference: order.payment.reference,
      last4: order.payment.last4,
      brand: order.payment.brand,
      /** 'yoco' for online orders; null when nothing was processed online. */
      driver: order.payment.driver ?? null,
      /* Kept so an order left mid-payment can be resumed from its own page. */
      redirectUrl: order.payment.redirectUrl ?? null,
    },
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

/* --------------------------- Enquiry validation ------------------------ */

/*
 * The rules a public enquiry has to pass, enforced here as well as in the
 * browser. The browser copy is for instant feedback; this one is the guard,
 * because the static build posts straight to Formspree and anyone can call
 * /api/contact directly.
 *
 * The owner's rule (October 2026): a name, a message, and one way to reply —
 * an email address or a cell number.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normaliseCell(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('27')) return digits;
  if (digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

const isCell = (raw) => /^27[6-8]\d{8}$/.test(normaliseCell(raw));
const isEmail = (raw) => EMAIL_RE.test(String(raw ?? '').trim());

/**
 * The reply-channel rule, shared by /api/contact and /api/quests: at least one
 * of email/phone, and whatever is given has to be usable.
 */
function replyChannelErrors(email, phone) {
  const mail = String(email ?? '').trim();
  const cell = String(phone ?? '').trim();
  const errors = [];
  if (!mail && !cell) {
    errors.push('Please give us an email address or a cell number so we can reply.');
    return errors;
  }
  if (mail && !isEmail(mail)) errors.push('That email address does not look right.');
  if (cell && !isCell(cell)) errors.push('Please use a South African cell number, e.g. 082 123 4567.');
  return errors;
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
    notifications: { push: pushStatus() },
    time: new Date().toISOString(),
  });
});

app.get('/api/catalog', LIMITS.catalogue, (_req, res) => {
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
    /*
     * HB_CLOCK_LABEL lets the interaction suite ask "what would this page look
     * like at Thursday lunchtime?". Without it the suite runs whenever CI
     * happens to run — usually outside the Thu/Fri window — and the checkout
     * correctly refuses every order it tries to place, so fifty behavioural
     * tests report a failure that is really the calendar.
     *
     * Read here as well as at the order gate so the banner and the button can
     * never disagree with the server about whether the shop is open.
     */
    service: serviceStatus(settings, clockNow()),
    payments: paymentConfig(),
    contact: { inboxConfigured: contactEndpoint() !== null },
    /*
     * Which automatic channels are actually live. Push is the only one: email
     * alerts needed SMTP configured on the host, so they are gone rather than
     * left looking like a feature the owner could switch on with an address.
     */
    notifications: { push: Boolean(pushStatus()?.configured) },
    today: todayDay(),
  });
});

/** Search backs the command-palette: name, local name, language, tags, story. */
app.get('/api/search', LIMITS.search, (req, res) => {
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

app.post('/api/quote', LIMITS.quote, (req, res) => {
  const { items, fulfilment, code } = req.body ?? {};
  const { lines, errors, totals, discount } = quote(items, { fulfilment, code });
  if (errors.length) return res.status(422).json({ errors });
  res.json({ lines, totals, discount: discount.ok ? discount.applied : null, discountError: discount.ok ? null : discount.message ?? discount.reason });
});

/* ------------------------------ Checkout ------------------------------ */

/*
 * Cash on collection is the only cash option the business confirmed: it is a
 * shadow kitchen, so there is no counter to pay at and no cash-on-delivery
 * arrangement. Everything else is paid online through Yoco.
 *
 * `card` is kept as the stored method name so existing orders still read
 * correctly, but nothing about a card is collected here any more — the customer
 * is sent to Yoco's hosted page, and a verified webhook is what marks the order
 * paid.
 */
const PAYMENT_METHODS = ['card', 'cash-on-collection'];

/**
 * Card details must never arrive on this API.
 *
 * The checkout has no card fields any more, so anything carrying a number, an
 * expiry or a `token` is either a stale client or an attempt to move this site
 * into PCI scope. Refused loudly rather than silently ignored.
 */
function cardFieldsSent(payment) {
  return Boolean(payment?.card?.number || payment?.card?.cvc || payment?.token);
}

app.post('/api/orders', LIMITS.order, async (req, res) => {
  const { items, fulfilment = 'collection', customer = {}, code = '', payment = {}, channel = 'card' } = req.body ?? {};

  const { lines, errors, totals, discount } = quote(items, { fulfilment, code });
  /*
   * Pricing errors come first: a basket whose only line is invalid has no
   * lines, and "your basket is empty" would hide the actual reason (an unknown
   * plate, a missing starch) from the customer.
   */
  if (errors.length) return res.status(422).json({ errors });
  if (!lines.length) return res.status(422).json({ errors: ['Your basket is empty.'] });

  /*
   * The service window is enforced here, not only described in the UI.
   *
   * Until now `serviceStatus().open` drove a banner and nothing else: the site
   * told the customer the window had closed and then happily took the order.
   * Anyone who reloaded at 15:00 could still check out, which is exactly the
   * thing the owner reported. The check lives on the server so a stale tab, a
   * cached bundle or a hand-made request cannot get past it.
   *
   * The refusal is worded as a redirect to WhatsApp rather than a dead end: the
   * kitchen may well still cook for you, but that is a conversation, not an
   * automated order.
   */
  /*
   * HB_ORDERS_OPEN is a test-only override. The suite places orders at whatever
   * time CI happens to run, which is outside the Thu/Fri window most of the day;
   * without a switch every order test would fail for a reason that has nothing
   * to do with what it is testing. It is never set by the app itself, and the
   * gate below stays wired so its own test can exercise the closed path.
   */
  const ordersForcedOpen = process.env.HB_ORDERS_OPEN === 'true';
  if (!ordersForcedOpen && serviceStatus(get('settings'), clockNow()).orderingClosed) {
    return res.status(409).json({
      errors: ["Today's window has closed, so we are not taking orders. Message us on WhatsApp and we will tell you if the kitchen can still prepare it."],
      closed: true,
    });
  }

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
     *
     * The typed address is checked against the area the customer *selected*,
     * not merged with it. Matching the whole string used to answer "which area
     * is this" by first match, so an address that said Rosebank was silently
     * relabelled to Rosebank while the customer believed they had chosen
     * Sandton — a delivery outside the boundary they thought they were inside.
     */
    const chosen = String(customer.suburb ?? '').trim();
    const named = areasNamedIn(customer.address, get('settings'));
    if (chosen && named.length && !named.some((area) => area.toLowerCase() === chosen.toLowerCase())) {
      return res.status(422).json({
        errors: [
          `That address is in ${named.join(' and ')}, but you chose ${chosen}. Change the delivery area, or give us a ${chosen} address.`,
        ],
        deliveryAreas: get('settings')?.deliveryAreas ?? [],
      });
    }
    /* The address itself decides where the food goes; the select only breaks a tie
       when the address carries no suburb at all (plenty of real ones do not). */
    const area = deliveryAreaFor(customer.address, get('settings')) ?? deliveryAreaFor(chosen, get('settings'));
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
  /*
   * Cash is accepted on delivery too. The kitchen carries a Yoco card machine
   * and a cash float, so a delivery customer can choose either — the old rule
   * that refused cash on delivery only pushed people into a card payment they
   * may not have wanted to make.
   */

  /*
   * Email is optional for every payment method, including card.
   *
   * It used to be mandatory for card orders because email was the only place a
   * receipt could go. Email receipts need SMTP configured on the host before a
   * single message can be sent, and the order now completes in a WhatsApp chat
   * that is itself the record — so demanding an address only added a step that
   * blocked a paying customer. An address that is given is still validated.
   */
  const customerEmail = String(customer.email ?? '').trim();
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail);
  if (customerEmail && !emailLooksValid) {
    return res.status(422).json({ errors: ['That email address does not look right.'] });
  }

  /*
   * Online payment: nothing is charged here.
   *
   * The customer leaves for Yoco's hosted page, so the only thing this route can
   * do is refuse when no payment destination is configured (better than sending
   * someone to a dead link) and refuse card details posted to the API.
   */
  if (payment.method === 'card') {
    if (cardFieldsSent(payment)) {
      return res.status(422).json({
        errors: ['Please pay on Yoco\'s secure page. This site never receives card numbers.'],
        code: 'card_details_refused',
      });
    }
    if (!yocoMode()) {
      return res.status(503).json({
        errors: [
          'Online payment is not switched on for this site yet. Please order on WhatsApp, or choose collection and pay cash.',
        ],
        code: 'payment_not_configured',
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
      /*
       * `awaiting_payment` is the honest state for an online order: the customer
       * is on Yoco's page and the money has not arrived yet. Only a verified
       * webhook moves this to `approved` — a return URL is something a customer
       * can type, so it cannot be evidence of payment.
       */
      status: payment.method === 'card' ? 'awaiting_payment' : 'pending',
      reference: payment.method === 'card' ? null : 'CASH',
      last4: null,
      brand: null,
      riskScore: null,
      driver: payment.method === 'card' ? 'yoco' : null,
      /** Where to send the customer to pay. Also kept so the order page can retry. */
      redirectUrl: null,
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

  /*
   * Hand the customer to Yoco before the order is saved.
   *
   * If Yoco will not start a payment there is no point keeping a half-order the
   * kitchen would cook and the customer could not pay for, so the request fails
   * and nothing is stored. The sequence number is consumed, which costs nothing.
   */
  if (payment.method === 'card') {
    const started = await startYocoPayment({
      amountCents: totals.totalCents,
      currency: totals.currency,
      orderCode: order.code,
      trackingToken,
      baseUrl: (process.env.HB_PUBLIC_URL?.trim() || 'https://heritagebites.co.za').replace(/\/+$/, ''),
      description: `Heritage Bites order ${order.code}`,
    });
    if (!started.ok) {
      return res.status(502).json({
        errors: [started.message],
        code: started.code,
        /* The customer can still be paid-up another way; say so. */
        fallback: { whatsapp: true, cashOnCollection: fulfilment === 'collection' },
      });
    }
    order.payment.redirectUrl = started.redirectUrl;
    order.payment.reference = started.reference;
    order.payment.mode = started.mode;
    appendTimeline(order, 'pending', `Payment started on Yoco (${order.code})`);
  } else {
    appendTimeline(order, 'pending', 'Payment method: cash on collection');
  }

  const settings = get('settings');
  order.whatsapp = whatsappLink(
    settings.whatsapp,
    buildWhatsAppMessage({ code: order.code, items: lines, totals, fulfilment, customer: order.customer }),
  );

  set('orders', [order, ...get('orders')]);

  /*
   * Web Push is sent straight from the request rather than through the outbox: a
   * phone alert is worth seconds, not retries. It is fire-and-forget — a failed
   * push must never delay or fail an order that has already been paid for.
   */
  void notifyOwnerDevices(order).catch((error) => {
    console.error(`[push] owner alert failed for ${order.code}: ${String(error?.message ?? error).slice(0, 200)}`);
  });

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
  res.status(201).json({
    order: publicOrder(order),
    loyalty: next,
    trackingToken,
    /* Present for online orders: the browser sends the customer here. */
    ...(order.payment.redirectUrl ? { payment: { provider: 'yoco', redirectUrl: order.payment.redirectUrl } } : {}),
  });
});

/* --------------------------- Payment webhooks -------------------------- */

/*
 * Yoco tells this site when money arrived. This endpoint is the only path that
 * can mark an order paid, and only for a request Yoco signed.
 *
 * Why not the browser: a return URL is just a URL. Anyone can open
 * /order/HB-1042?paid=1, and a site that believed it would hand out free food.
 */
app.post('/api/payments/yoco/webhook', (req, res) => {
  const verified = verifyYocoWebhook({ rawBody: req.rawBody, headers: req.headers });
  if (!verified.ok) {
    /* Logged loudly: a 401 here means someone is posting fake payments, and a
       503 means the business forgot the webhook secret and no order can ever be
       marked paid automatically. */
    console.error(`[payments] rejected Yoco webhook (${verified.code}): ${verified.message}`);
    return res.status(verified.status).json({ ok: false, code: verified.code, error: verified.message });
  }

  const event = readYocoEvent(verified.event);
  if (!event.paid) return res.json({ ok: true, ignored: event.type || 'not-a-payment' });

  if (!event.orderCode) {
    console.error('[payments] Yoco payment succeeded with no orderCode in metadata — nothing to match it to.');
    return res.status(202).json({ ok: true, matched: false });
  }

  const orders = get('orders');
  const index = orders.findIndex((o) => o.code.toLowerCase() === event.orderCode.toLowerCase());
  if (index === -1) {
    /* Not an error as far as Yoco is concerned: retrying will not create it. */
    console.error(`[payments] Yoco paid for ${event.orderCode}, which is not an order on this site.`);
    return res.status(202).json({ ok: true, matched: false });
  }

  const order = orders[index];
  /* Webhooks are delivered at least once; a second one must not double-notify. */
  if (order.payment?.status === 'approved') return res.json({ ok: true, matched: true, duplicate: true });

  order.payment = {
    ...order.payment,
    status: 'approved',
    reference: event.reference ?? order.payment?.reference ?? null,
    last4: event.last4 ?? null,
    brand: event.brand ?? null,
    paidAt: new Date().toISOString(),
  };
  order.updatedAt = new Date().toISOString();
  appendTimeline(order, order.status, `Payment received (Yoco${event.last4 ? ` **** ${event.last4}` : ''})`);

  const next = [...orders];
  next[index] = order;
  set('orders', next);

  /* The kitchen already has the ticket; this is the “and it is paid” follow-up. */
  void notifyOwnerDevices(order).catch(() => {});

  res.json({ ok: true, matched: true });
});

/* What the checkout and /api/health need to know about payments. */
app.get('/api/payments/config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...paymentConfig(), webhook: Boolean(process.env.HB_YOCO_WEBHOOK_SECRET) });
});

app.get('/api/orders/:code', LIMITS.orderRead, (req, res) => {
  const order = get('orders').find((o) => o.code.toLowerCase() === String(req.params.code).toLowerCase());
  if (!order || !hasValidTrackingToken(order, String(req.query.token ?? ''))) {
    return res.status(404).json({ error: 'That secure tracking link is invalid or has expired.' });
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ order: publicOrder(order) });
});

app.post('/api/orders/:code/cancel', LIMITS.cancel, (req, res) => {
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

  /* The one status change a customer can trigger, so it is the one push they get. */
  void notifyOrderDevices(order, 'customer-order-cancelled').catch((error) => {
    console.error(`[push] cancellation alert failed for ${order.code}: ${String(error?.message ?? error).slice(0, 200)}`);
  });

  res.set('Cache-Control', 'private, no-store');
  res.json({ order: publicOrder(order) });
});

/* ----------------------------- Loyalty card -------------------------- */

app.post('/api/passport', LIMITS.loyalty, (req, res) => {
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

app.post('/api/contact', LIMITS.contact, async (req, res) => {
  const { name, phone, email, subject, message } = req.body ?? {};
  const problems = [];
  if (!name?.trim()) problems.push('Please add your name.');
  if (!message?.trim()) problems.push('Please add a message.');
  problems.push(...replyChannelErrors(email, phone));
  if (problems.length) return res.status(422).json({ errors: problems });

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

app.post('/api/quests', LIMITS.quest, async (req, res) => {
  const { name, phone, email, dish, serviceDay = 'either', plates, notes } = req.body ?? {};
  const errors = [];

  if (typeof name !== 'string' || name.trim().length < 2) errors.push('Please add your name so we know who asked.');
  if (typeof dish !== 'string' || dish.trim().length < 5) errors.push('Tell us what you would like us to cook.');
  errors.push(...replyChannelErrors(email, phone));
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

/* ----------------------------- Web Push -------------------------------- */

/*
 * Push routes.
 *
 * All three are rate-limited (see LIMITS above) and they are small, typed, and
 * reject anything unexpected. The important boundary is authorisation, not rate:
 *
 *   /api/push/order-subscribe  needs the order code AND its tracking token, so a
 *                              device can only ever subscribe to one order it can
 *                              already read.
 *   /api/push/owner-subscribe  needs the owner key. Without one set on the host,
 *                              owner enrolment is refused entirely rather than left
 *                              open to whoever finds the URL.
 */

app.get('/api/push/config', (_req, res) => {
  const config = pushConfig();
  res.json({
    enabled: Boolean(config),
    vapidPublicKey: config?.publicKey ?? null,
    ownerEnrolment: Boolean(config && ownerKey()),
  });
});

app.post('/api/push/order-subscribe', LIMITS.push, (req, res) => {
  const config = pushConfig();
  if (!config) return res.status(503).json({ error: 'Order alerts are not switched on for this site.' });

  const { code, token, subscription } = req.body ?? {};
  const orders = get('orders');
  const order = orders.find((entry) => entry.code.toLowerCase() === String(code ?? '').toLowerCase());
  if (!order || !hasValidTrackingToken(order, String(token ?? ''))) {
    return res.status(404).json({ error: 'That secure tracking link is invalid or has expired.' });
  }
  if (order.status === 'cancelled') {
    return res.status(409).json({ error: 'This order is cancelled, so there is nothing left to alert you about.' });
  }

  const saved = saveSubscription(subscription, {
    role: 'customer',
    orderCode: order.code,
    userAgent: req.get('user-agent'),
  });
  if (!saved.ok) return res.status(422).json({ error: saved.error });

  /*
   * Confirm straight away, fire-and-forget. The customer has just tapped "alert
   * me"; silence until a cancellation that may never happen would look broken.
   */
  void confirmOrderSubscription(saved.record, order).catch((error) => {
    console.error(`[push] confirmation failed for ${order.code}: ${String(error?.message ?? error).slice(0, 200)}`);
  });

  res.status(201).json({ ok: true, scope: 'order', code: order.code });
});

app.post('/api/push/owner-subscribe', LIMITS.push, (req, res) => {
  const config = pushConfig();
  if (!config) return res.status(503).json({ error: 'Order alerts are not switched on for this site.' });

  const expected = ownerKey();
  if (!expected) {
    return res.status(503).json({ error: 'Owner alerts are not configured on this host yet.' });
  }

  const given = String(req.get('x-hb-owner-key') ?? req.body?.key ?? '');
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'That owner key is not correct.' });
  }

  const saved = saveSubscription(req.body?.subscription, {
    role: 'owner',
    userAgent: req.get('user-agent'),
  });
  if (!saved.ok) return res.status(422).json({ error: saved.error });

  res.status(201).json({ ok: true, scope: 'owner' });
});

app.post('/api/push/unsubscribe', LIMITS.push, (req, res) => {
  const endpoint = String(req.body?.endpoint ?? '');
  /*
   * Deliberately unauthenticated: a device may revoke itself at any time, which is
   * the whole point of "stop alerts". Nothing is disclosed by doing so, and an
   * endpoint is an opaque capability URL that only its own browser knows.
   */
  const removed = removeSubscription(endpoint);
  res.json({ ok: true, removed });
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

/**
 * The built shell, with a route's own `<head>` in place of the marked block.
 *
 * A crawler that does not run JavaScript — and every link unfurler in WhatsApp,
 * Facebook and Slack — reads this HTML and nothing else. Serving one title and
 * one description for the whole site is how an SPA ends up with eight pages
 * competing under the home page's summary, so the shell is rewritten per route
 * from the same table the app uses (`shared/seo.js`).
 *
 * The shell is read once and the results cached by path: a few strings per route,
 * built lazily, so the first request for /menu pays for it and the rest do not.
 */
function shellRenderer(shell) {
  const start = shell.indexOf(HEAD_START);
  const end = shell.indexOf(HEAD_END);
  if (start === -1 || end === -1) return null;
  const cache = new Map();

  return function render(path, siteUrl) {
    /* Cached per address as well as per route: two hosts must not share a
       canonical tag. */
    const key = `${siteUrl ?? ''}|${path}`;
    if (cache.has(key)) return cache.get(key);
    const html =
      shell.slice(0, start) +
      HEAD_START +
      '\n    ' +
      headHtml(path, { siteUrl, settings: get('settings') }) +
      '\n    ' +
      HEAD_END +
      shell.slice(end + HEAD_END.length);
    cache.set(key, html);
    return html;
  };
}

/**
 * The address this page is publicly served from.
 *
 * `HB_SITE_URL` (or `HB_PUBLIC_URL`) when the deployment states it, otherwise the
 * host the request arrived on. Deliberately *not* the built-in default used for
 * receipt links: that is a different website, and a canonical pointing at it
 * would tell Google this shop's pages are duplicates of somebody else's.
 */
function seoSiteUrl(req) {
  const configured = normaliseSiteUrl(process.env.HB_SITE_URL) ?? normaliseSiteUrl(process.env.HB_PUBLIC_URL);
  if (configured) return configured;
  const host = req.get?.('host');
  if (!host) return null;
  return normaliseSiteUrl(`${req.protocol}://${host}`);
}

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
  const shellPath = join(DIST, 'index.html');
  const renderShell = shellRenderer(readFileSync(shellPath, 'utf8'));

  const KNOWN_ROUTES = new Set([
    '/', '/menu', '/specials', '/about', '/contact', '/policies', '/checkout', '/passport', '/quest', '/alerts',
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
    /* No caching of the shell: the head differs per route, and a shared cache
       would hand /menu's title to the next visitor of /. */
    res.set('Cache-Control', 'no-cache');
    try {
      const rendered = renderShell(path, seoSiteUrl(req));
      if (rendered) return res.status(status).type('html').send(rendered);
    } catch (error) {
      console.error(`[seo] could not write the head for ${path}: ${String(error?.message ?? error).slice(0, 160)}`);
    }
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
  // Bound to 0.0.0.0 so the sandbox preview host can reach this process.
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[heritagebites api] listening on http://0.0.0.0:${PORT} (payments: ${paymentDriver()})`);
    /*
     * Say the payment problems out loud at boot. A missing webhook secret or a
     * payment link that does not exist is invisible until the first customer
     * meets it, and by then the order has already been handed over.
     */
    for (const warning of paymentWarnings()) console.warn(`[payments] ${warning}`);
  });
}
