#!/usr/bin/env node
/**
 * A fake Yoco, for testing the redirect flow without a Yoco account.
 *
 * Why this exists: the real Checkout API cannot be reached from a locked-down
 * build machine, and nobody should be putting live card details into a test run.
 * This implements just enough of Yoco to prove the thing that actually matters —
 * that our server hands the customer over, that the browser really leaves for
 * the payment page, and that the customer comes back and the order becomes paid
 * only through a signed webhook.
 *
 * It speaks the same three exchanges as Yoco:
 *
 *   POST /api/checkouts   { amount, currency, successUrl, cancelUrl, failureUrl,
 *                           metadata }  →  { id, redirectUrl, status }
 *   GET  /pay/:id         a payment page with "Pay" and "Decline" buttons
 *   POST /pay/:id/pay     signs a `payment.succeeded` webhook to the app, then
 *                         redirects to the checkout's successUrl (like Yoco)
 *
 * Run it against the app:
 *
 *   node scripts/yoco-sandbox.mjs                       # listens on :4555
 *   HB_YOCO_SECRET_KEY=sk_test_anything \
 *   HB_YOCO_CHECKOUT_ENDPOINT=http://127.0.0.1:4555/api/checkouts \
 *   HB_YOCO_WEBHOOK_SECRET=whsec_$(printf %s fake-webhook-secret | base64) \
 *   HB_PUBLIC_URL=http://localhost:4000 \
 *   node server/index.js
 *
 * Then place an order in the browser: you will be sent to the fake payment page,
 * press Pay, and land back on the order as "Paid".
 *
 * NEVER point a production deployment at this file.
 */
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';

const PORT = Number(process.env.FAKE_YOCO_PORT ?? 4555);
const APP = process.env.FAKE_YOCO_APP ?? 'http://127.0.0.1:4000';
const WEBHOOK_SECRET = process.env.HB_YOCO_WEBHOOK_SECRET ?? '';

/** checkouts by id, kept in memory: this is a test double, not a database. */
const checkouts = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const html = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

/** Sign a webhook exactly the way Yoco does (Standard Webhooks, HMAC-SHA256). */
function signatureFor(body, id, timestamp) {
  const key = WEBHOOK_SECRET.startsWith('whsec_') ? Buffer.from(WEBHOOK_SECRET.slice(6), 'base64') : Buffer.from(WEBHOOK_SECRET);
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

/**
 * Where Yoco would deliver the event: the shop that created the checkout. It is
 * derived from the checkout's successUrl origin, so the gateway and the site stay
 * in step without extra configuration.
 */
function webhookTarget(checkout) {
  try {
    return new URL('/api/payments/yoco/webhook', checkout.successUrl ?? APP).toString();
  } catch {
    return `${APP}/api/payments/yoco/webhook`;
  }
}

async function sendWebhook(checkout, paid) {
  const body = JSON.stringify({
    type: paid ? 'payment.succeeded' : 'payment.failed',
    payload: {
      id: checkout.id,
      amount: checkout.amount,
      currency: checkout.currency,
      status: paid ? 'succeeded' : 'failed',
      metadata: checkout.metadata,
      card: paid ? { brand: 'visa', last4: '1111' } : null,
    },
  });
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const res = await fetch(webhookTarget(checkout), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${signatureFor(body, id, timestamp)}`,
    },
    body,
  });
  const text = await res.text();
  console.log(`[fake-yoco] webhook ${paid ? 'succeeded' : 'failed'} for ${checkout.metadata?.orderCode ?? checkout.id} → ${res.status} ${text.slice(0, 120)}`);
}

/** The address this gateway is actually bound to (the port may be 0 = "pick one"). */
const selfBase = () => `http://127.0.0.1:${server.address().port}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  /* --- create a checkout, exactly where HB_YOCO_CHECKOUT_ENDPOINT points --- */
  if (req.method === 'POST' && url.pathname === '/api/checkouts') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return json(res, 400, { errorCode: 'invalid_json', message: 'Body was not JSON' });
    }
    if (!body.amount || body.currency !== 'ZAR') {
      return json(res, 400, { errorCode: 'invalid_amount', message: 'amount (cents) and currency ZAR are required' });
    }
    const id = `ch_${randomUUID().slice(0, 8)}`;
    const checkout = {
      id,
      amount: body.amount,
      currency: 'ZAR',
      successUrl: body.successUrl ?? null,
      cancelUrl: body.cancelUrl ?? null,
      failureUrl: body.failureUrl ?? null,
      metadata: body.metadata ?? {},
      status: 'created',
      idempotencyKey: req.headers['idempotency-key'] ?? null,
    };
    checkouts.set(id, checkout);
    console.log(`[fake-yoco] checkout ${id} for ${(body.amount / 100).toFixed(2)} ZAR (${checkout.metadata.orderCode ?? 'no code'})`);
    return json(res, 200, { id, redirectUrl: `${selfBase()}/pay/${id}`, status: 'created' });
  }

  /* --- the hosted payment page --- */
  const payMatch = /^\/pay\/([\w-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && payMatch) {
    const checkout = checkouts.get(payMatch[1]);
    if (!checkout) return html(res, 404, '<p>Unknown checkout</p>');
    return html(
      res,
      200,
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <title>Fake Yoco — pay ${(checkout.amount / 100).toFixed(2)}</title>
       <style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#f6f1e7;color:#001938;display:grid;place-items:center;min-height:100vh;margin:0}
       .card{background:#fff;border:2px solid #00193822;border-radius:24px;padding:32px;max-width:380px;width:90%;text-align:center}
       .brand{font:600 12px/1 ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#8a6a2f}
       h1{font-size:30px;margin:8px 0 4px} p{color:#001938aa;font-size:14px;line-height:1.5}
       button{width:100%;border:0;border-radius:999px;padding:14px;font-weight:700;margin-top:10px;cursor:pointer}
       .pay{background:#e0a52e;color:#001938} .decline{background:#e6ded0;color:#001938}
       code{font-size:12px;color:#00193888}</style></head>
       <body><div class="card">
         <div class="brand">Fake Yoco · test gateway</div>
         <h1>R ${(checkout.amount / 100).toFixed(2)}</h1>
         <p>Order <strong>${checkout.metadata?.orderCode ?? '—'}</strong><br>
         <code>${checkout.id}</code></p>
         <p>This is not Yoco. It stands in for their payment page so the redirect,
         the return trip and the webhook can be tested without real money.</p>
         <form method="POST" action="/pay/${checkout.id}/pay"><button class="pay" type="submit">Pay R ${(checkout.amount / 100).toFixed(2)}</button></form>
         <form method="POST" action="/pay/${checkout.id}/decline"><button class="decline" type="submit">Decline the card</button></form>
       </div></body></html>`,
    );
  }

  /* --- the customer pays (or does not), then returns to the shop --- */
  const doneMatch = /^\/pay\/([\w-]+)\/(pay|decline)$/.exec(url.pathname);
  if (req.method === 'POST' && doneMatch) {
    const checkout = checkouts.get(doneMatch[1]);
    if (!checkout) return html(res, 404, '<p>Unknown checkout</p>');
    const paid = doneMatch[2] === 'pay';
    checkout.status = paid ? 'succeeded' : 'failed';
    await sendWebhook(checkout, paid);
    const target = paid ? checkout.successUrl : checkout.failureUrl ?? checkout.cancelUrl;
    res.writeHead(303, { Location: target ?? `${APP}/` });
    return res.end();
  }

  /* --- a tiny inspector, handy while testing --- */
  if (req.method === 'GET' && url.pathname === '/checkouts') {
    return json(res, 200, { checkouts: [...checkouts.values()] });
  }

  return json(res, 404, { errorCode: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  /* The real port is printed, so a test can start this on 0 and read it back. */
  console.log(`[fake-yoco] listening on http://0.0.0.0:${server.address().port} — app at ${APP}`);
  if (!WEBHOOK_SECRET) {
    console.warn('[fake-yoco] HB_YOCO_WEBHOOK_SECRET is empty: the app will reject every webhook this gateway sends.');
  }
});
