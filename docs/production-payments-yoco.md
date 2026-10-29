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

   The site appends `?reference=HB-1234A` so the order code is visible on Yoco's
   page and in the Yoco dashboard.

   **Trade-off:** a link cannot fix the amount. The customer types it on Yoco's
   page, so someone has to check that what was paid matches the order. Good for
   starting today; use Option B when you can.

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
| A webhook with a bad signature, or none | Rejected (401/400), logged, order unchanged |
| A replayed webhook | Rejected if older than five minutes |
| The same webhook delivered twice | Acknowledged and ignored — no double receipt, no double alert |
| A paid order | Cannot be cancelled online; the page explains a refund needs a person |

## Refunds and cancellations

Refunds stay **manual**, on purpose: a paid order cannot be cancelled online, the
receipt tells the customer to contact the business, and someone with Yoco
dashboard access issues the refund there. That matches the approved Refund and
Cancellation policies on `/policies`.

## Testing without money

- The whole money path is covered by tests that never touch Yoco:
  `server/lib/payments.test.js` (configuration, request building, signature
  checks) and `server/integration.test.js` (order creation, webhook → paid,
  duplicate and stale webhooks, unconfigured refusal).
- To see the flow in a browser with a fake link:
  `HB_YOCO_PAYMENT_URL=https://pay.yoco.com/heritagebites npm start`.
- To let the interaction suite exercise the paid path, start the server with the
  same `HB_YOCO_WEBHOOK_SECRET` you export when running
  `npm run test:interaction`.
