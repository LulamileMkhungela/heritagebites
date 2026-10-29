# Online payments with Yoco

*Heritage Bites · how online payment is switched on*

## What changed

The site no longer takes a card number. There is no card field on the checkout,
no "test mode" card form, and no card data on the server at all — a request that
carries a card number is refused outright.

Instead the customer places the order and is sent to **Yoco's own payment page**.
Yoco takes the card (or instant EFT) and tells this site when the money arrived.
That keeps Heritage Bites in the simplest PCI-DSS scope (SAQ A) instead of having
to secure a server full of card numbers.

```
customer fills the checkout
        │
        ├── POST /api/orders ─────────────► order saved, status "awaiting payment"
        │                                   ◄── payment page URL
        │
        ├── browser leaves for Yoco ─────► card / instant EFT paid there
        │
        ├── Yoco → POST /api/payments/yoco/webhook   (signed)
        │                                   order marked "paid"
        │
        └── customer returns to /order/HB-1234A ─── sees "Paid"
```

**The order is only marked paid by that signed webhook.** A return URL is
something a customer can type, so it is never accepted as proof of payment.

## What Heritage Bites needs to provide

There are two ways to connect the account. Either is enough; the second is
better, because it fixes the amount.

### Option A — a Yoco payment link (fastest, no keys)

1. In the Yoco dashboard, create a **payment link** (Yoco calls these “Payment
   Links” / “pay.yoco.com” links) for Heritage Bites.
2. Send the link. It looks like `https://pay.yoco.com/heritagebites` or
   `https://pay.yoco.com/business/<id>`.
3. It is set as one host variable:

   ```
   HB_YOCO_PAYMENT_URL=https://pay.yoco.com/…
   ```

   The site appends three parameters that Yoco's payment page understands:

   ```
   ?amount=130.00&reference=HB-1234A&redirectOnPaymentSuccess=https://<site>/order/HB-1234A?token=…
   ```

   `reference` is the order code, shown on Yoco's page and in the dashboard;
   `amount` pre-fills the total; `redirectOnPaymentSuccess` brings the customer
   back to their own order.

   **Trade-off:** a link cannot *pin* the amount — the customer can still edit it
   on Yoco's page, and Yoco will take whatever figure is there. So someone has to
   check that what was paid matches the order, and the webhook stays the only
   thing that marks it paid. Good for starting today; use Option B when you can.

### Option B — the Checkout API (recommended)

The server creates the payment for the exact order total, so the customer cannot
pay the wrong amount.

| From the Yoco dashboard | Variable | Notes |
| --- | --- | --- |
| Settings → Developers → API keys → **Secret key** (`sk_live_…`, or `sk_test_…` while testing) | `HB_YOCO_SECRET_KEY` | Server-side only. Never put this in a document, chat, screenshot or the front-end. |
| Developers → **Webhooks** → signing secret (starts `whsec_…`) | `HB_YOCO_WEBHOOK_SECRET` | Used to verify that a “payment succeeded” message really came from Yoco. |

Optional overrides:

```
HB_YOCO_CHECKOUT_ENDPOINT=https://payments.yoco.com/api/checkouts   # default; only change for a sandbox
HB_PUBLIC_URL=https://heritagebites.co.za                            # used for the return URLs
```

### What actually happens on the redirect

This is the part worth being precise about, because it is the whole payment
design: **the card is never typed on this site.**

```
browser                       this site (server)                 Yoco
   |  POST /api/orders  ----------> |                               |
   |                                |  POST /api/checkouts ---------> |
   |                                |  { amount, currency, metadata }|
   |                                | <----- { id, redirectUrl } ---- |
   | <-- 201 { payment.redirectUrl }|                               |
   |                                                                |
   |  window.location.assign(redirectUrl) ------------------------> |
   |                     card is typed on Yoco's page               |
   | <----------- 303 successUrl ----------------------------------- |
   |                                   <---- webhook: payment.succeeded
   |                                        (signed) ---- |
   |                                order.payment.status = 'approved'
```

- The server asks Yoco for **`amount` in cents**, the order code in `metadata`,
  and the three return addresses (`successUrl`, `cancelUrl`, `failureUrl`).
- Yoco answers with `redirectUrl`. The checkout screen stores it, shows
  “Order HB-1042 is saved — taking you to Yoco”, and sends the browser there.
- Every request carries `Idempotency-Key: hb-<order code>`, so a double tap or a
  retried request reuses the same checkout instead of opening a second payment.
- The order is saved **before** the customer leaves, as `awaiting_payment`, so a
  closed tab or a flat battery never loses a paid-for order. The order page keeps
  the `redirectUrl` and offers **Pay now on Yoco** to resume.
- The `successUrl` is **not** proof of payment. Only the signed webhook moves an
  order to `approved`; the docs say so and so does the code (`server/index.js`,
  `POST /api/payments/yoco/webhook` is the single writer).

### The webhook (needed for either option)

In the Yoco dashboard, add a webhook endpoint:

```
POST https://heritagebites.co.za/api/payments/yoco/webhook
```

Subscribe it to **payment succeeded** (and, if offered, payment failed — the site
records it and does nothing else). Then copy that endpoint's signing secret into
`HB_YOCO_WEBHOOK_SECRET`. Without this secret the site returns 503 for every
webhook and **no order can ever be marked paid automatically** — the checkout
still works, the money still arrives, but someone has to reconcile it by hand.

The webhook must receive the **raw body** — the site already keeps it for the
signature check. Do not put a proxy in front that rewrites the JSON.

### In one line, to go live

Send the owner of this repo:

1. **either** the payment link (`https://pay.yoco.com/…`) **or** the secret key
   (`sk_live_…`) plus the endpoint above configured in Yoco,
2. the **webhook signing secret** (`whsec_…`) for
   `https://heritagebites.co.za/api/payments/yoco/webhook`,
3. confirmation that the public site URL is `https://heritagebites.co.za`.

Nothing else. The public key is not needed any more: the browser never talks to
Yoco directly in this design.

## Switching it on

1. Set the variables in the host's environment (not in a file committed to git).
2. Restart the app.
3. Open `https://<domain>/api/catalog` and look at `payments`:

   ```json
   { "provider": "yoco", "online": true, "mode": "api", "exactAmount": true, … }
   ```

   `mode: "off"` means the variables were not picked up.
4. Open `/api/health` and check `paymentDriver` is `yoco` (or `link`).
5. On the checkout, the payment step should read **“Pay online — Card or instant
   EFT on Yoco's secure page”**. If it says *“Online payment is not switched on
   yet”*, the variables are missing.

## The first real payment

Do this before announcing the site:

1. Place a real order for the cheapest plate and pay it.
2. Confirm three things:
   - the money appears in the Yoco dashboard with the order code as the reference,
   - the order page changes from **Awaiting payment** to **Paid** (this is the
     webhook working — if it does not change, the webhook is not configured),
   - the kitchen's alert email / push arrives.
3. Refund it in the Yoco dashboard, then place a second order from a phone to
   check the mobile redirect.

## Failure states the site already handles

| Situation | What the customer sees |
| --- | --- |
| No Yoco configuration | “Online payment is not switched on yet”, a WhatsApp basket button, and the place-order button disabled for online orders — the API refuses with 503 rather than creating an unpayable order |
| Yoco refuses to create the payment | The message from Yoco plus “Nothing was charged”, and no order is stored |
| Customer closes the tab on Yoco's page | The order stays **awaiting payment**; its page offers *Pay now on Yoco* to resume |
| The card is declined | Yoco returns the customer to `failureUrl`; the order stays **awaiting payment** and can be retried, or paid by cash on collection |
| The customer abandons and orders again | One checkout per order code (`Idempotency-Key`), so there is one payment to reconcile, not two |
| A webhook with a bad signature, or none | Rejected (401/400), logged, order unchanged |
| A replayed webhook | Rejected if older than five minutes |
| The same webhook delivered twice | Acknowledged and ignored — no double receipt, no double alert |
| A paid order | Cannot be cancelled online; the page explains a refund needs a person |

## Refunds and cancellations

Refunds stay **manual**, on purpose: a paid order cannot be cancelled online, the
receipt tells the customer to contact the business, and someone with Yoco
dashboard access issues the refund there. That matches the approved Refund and
Cancellation policies on `/policies`.

## Test mode: proving the flow before real money

There are two layers, and it is worth using both: **Yoco's own test mode** proves
the live gateway agrees with us, and the **local stand-in** proves the site's side
of the conversation on any machine with no account at all.

### 1. Proven locally already (no Yoco account, no network)

`server/yoco-checkout-flow.test.js` runs the entire redirect against
`scripts/yoco-sandbox.mjs` — a small server that speaks the same three exchanges
as Yoco (`POST /api/checkouts` → `redirectUrl`, a payment page, a signed
`payment.succeeded` webhook). It asserts:

| # | What is proven |
| --- | --- |
| 1 | The site reports `mode: "api"` and `exactAmount: true`, not a payment link. |
| 2 | A card order returns a `redirectUrl` pointing **off this site**, and the order is `awaiting_payment`. |
| 3 | That URL is a payment page showing the order total and code — with **no card fields of ours**. |
| 4 | Pressing Pay sends the browser back to `successUrl`, and the **signed webhook** flips the order to `approved` (brand `visa`, last4 `1111`, `paidAt`, history entry). |
| 5 | A declined payment leaves the order `awaiting_payment`, with the payment URL kept for a retry. |
| 6 | Opening the return URL by hand changes **nothing** — the order stays `awaiting_payment`. |
| 7 | A forged webhook signature is refused with 401 and changes nothing. |

Run it with `npm test`, or on its own:

```
node --test server/yoco-checkout-flow.test.js
```

To watch it in a browser instead, in two terminals:

```
node scripts/yoco-sandbox.mjs                     # fake Yoco on :4555
```

```
HB_YOCO_SECRET_KEY=sk_test_sandbox_only \
HB_YOCO_CHECKOUT_ENDPOINT=http://127.0.0.1:4555/api/checkouts \
HB_YOCO_WEBHOOK_SECRET=whsec_$(printf %s local-webhook-secret | base64) \
HB_PUBLIC_URL=http://localhost:4000 \
npm start
```

Then order a plate in the browser, press **Pay** on the stand-in page, and land
back on the order as **Paid**. What this does *not* prove is that
`payments.yoco.com` behaves as documented — that is what step 2 is for.

### 2. Yoco test mode (the real gateway, no real money)

Yoco has **no public anonymous sandbox**: test mode lives inside your own Yoco
account. You need an account (a test-mode key is available before the business is
fully verified), then:

1. Yoco dashboard → **Selling online → Payment Gateway → API keys** and copy the
   key that starts **`sk_test_`**. (Do not use `sk_live_` yet.)
2. Put it in the host's environment as `HB_YOCO_SECRET_KEY`, keep
   `HB_YOCO_CHECKOUT_ENDPOINT` at its default, restart the app.
3. Check `https://<your domain>/api/payments/config` says
   `{"online":true,"mode":"api","webhook":true}`.
4. Add the webhook endpoint (`https://<your domain>/api/payments/yoco/webhook`) in
   the dashboard's **test** webhooks and copy that signing secret into
   `HB_YOCO_WEBHOOK_SECRET`.
5. Place a real order on the site and pay on Yoco's page with a test card:

   | Card number | Result |
   | --- | --- |
   | `4111 1111 1111 1111` | succeeds |
   | `5105 1051 0510 5100` | declined |
   | `4000 0000 0000 0002` | declined |

   Any future expiry date and any 3-digit CVC work. Nothing is charged.
6. Expect: the order page shows **Paid**, the kitchen alert arrives, and the
   payment appears in the Yoco dashboard in test mode.
7. Repeat with `5105 1051 0510 5100`: the customer is returned to the order,
   which stays **Awaiting payment** and offers **Pay now on Yoco** to retry.
8. Delete any test orders from the shop before launch.

### 3. Going live

Swap `sk_test_…` for `sk_live_…`, re-point the webhook to the live one and copy
its **live** signing secret, restart, and confirm
`/api/payments/config` still reports `mode: "api"` and `webhook: true`. Then make
**one real payment of a small amount** (R100, a single traditional plate) on your
own card, confirm it shows as Paid and the alert arrives, and refund it in the
Yoco dashboard. That one rand is the only way to be sure live keys, the live
webhook and the bank all agree.

### Redeploying after a config change

The values are read from the environment at request time, so a restart is enough;
there is nothing to rebuild in the browser.

## Testing without money (summary)

- `npm test` covers the money path with no network: `server/lib/payments.test.js`
  (configuration, request building, signatures), `server/integration.test.js`
  (order creation, webhook → paid, duplicates, stale and forged signatures,
  refusal when unconfigured) and `server/yoco-checkout-flow.test.js` (the whole
  redirect, above).
- `HB_YOCO_PAYMENT_URL=https://pay.yoco.com/heritagebites npm start` shows the
  link mode in a browser, with no keys at all.
- `npm run test:interaction` exercises the paid path end to end when the server
  is started with the same `HB_YOCO_WEBHOOK_SECRET` that the suite exports.
