# Production card payments with Yoco

*Heritage Bites · how live card checkout is switched on*

## How the payment flow works

1. The customer builds a basket and reaches checkout.
2. On the payment step, the site opens **Yoco's own secure payment window** in the browser (loaded from `https://js.yoco.com/sdk/v1/yoco-sdk-web.js`).
3. The customer types their card **into Yoco's window**, not into Heritage Bites. Yoco returns a one-time checkout reference to the page.
4. When the customer presses *Place order*, the browser sends the order plus that reference to our API.
5. The API asks Yoco (`GET https://payments.yoco.com/api/checkouts/{id}`) what that checkout was, and checks:
   - it was paid,
   - in ZAR,
   - **for exactly the basket total**.
6. Only then is the order created. The receipt stores the brand and the last four digits, never the card number.

This means a customer cannot fake a payment, and Heritage Bites never handles card data — which keeps the business in the simplest PCI-DSS scope (SAQ A) instead of having to secure a server full of card numbers.

## What you need from Yoco

From the **live** Yoco merchant account (not the test account):

| Yoco dashboard | What it is | Where it goes |
| --- | --- | --- |
| Settings → Developer / API keys → **Secret key** (`sk_live_…`) | Server-to-server credential. Must stay secret. | Host secret `YOCO_SECRET_KEY` |
| Same page → **Public key** (`pk_live_…`) | Designed to be public; used by the browser window. | Host secret `YOCO_PUBLIC_KEY` |

Do not email, WhatsApp, print or paste these keys into a document. Enter them directly in the hosting provider's environment/secret settings. Anyone holding the secret key can move money on the account.

## Steps to go live

1. **Confirm the merchant account is live** and that payouts are enabled for Heritage Bites.
2. **Copy the two live keys** from the Yoco dashboard.
3. In the host (Afrihost Cloud/VPS, Render, Railway, or whatever is chosen), open the environment/secret settings and add:
   ```
   YOCO_SECRET_KEY=sk_live_…
   YOCO_PUBLIC_KEY=pk_live_…
   ```
4. **Redeploy or restart** the app.
5. Check `https://<the-domain>/api/health` — it should report `"paymentDriver":"yoco"`.
6. Open checkout on the live site. The test-card form is gone; the payment step now shows **"Pay R… by card"**, which opens Yoco's window.
7. **Make one real, small test payment** (R100 traditional plate), confirm:
   - the money appears in the Yoco dashboard,
   - the confirmation page shows the order code and "Paid · VISA ****1234",
   - the order email arrives (once SMTP is configured),
   - the *Refund* button in Yoco can refund that payment.
8. Then refund the test payment and place a second, real order from a phone to be sure the mobile flow works.

## Refunds and cancellations

Refunds are **not automated** in the site, on purpose. A paid order cannot be cancelled online; the receipt tells the customer to contact the business, and someone with Yoco dashboard access issues the refund there. That matches the approved Refund Policy and Cancellation Policy (`/policies`).

If refunds become frequent, the next step is a small staff screen that calls Yoco's refund endpoint with its own permission list. It is not built yet.

## Failure states the site already handles

- **Declined card** — the customer sees Yoco's message, and the order is not created. They can retry or switch to cash on collection.
- **3-D Secure / bank approval** — shown as an amber "your bank needs to approve this payment" step with a way out, never as a hard decline.
- **Total changed after paying** — if the basket changes after the card is authorised, the payment is cleared and the customer is asked to pay again, so the amount charged always equals the amount ordered.
- **Yoco unreachable** — the order is refused with a clear message; nothing is saved as paid.
- **Amount mismatch** — refused outright, even if Yoco reports success.
- **Raw card data posted to the API** — refused with "please enter card details in the secure Yoco window".

## Cash

Cash on collection stays available. Cash on delivery is removed: the business confirmed collection cash only, and a shadow kitchen has no counter for a rider to pay in against. Delivery orders are card only. Re-enabling cash on delivery is a deliberate change — ask before switching it on.

## Local sandbox

With no `YOCO_SECRET_KEY`, the checkout uses its offline test-card form (`4242 4242 4242 4242` approves, `4000 0000 0000 0002` declines, `4000 0000 0000 3220` simulates 3-D Secure). No real money moves, and the server refuses the raw-card path as soon as a live key is present.
