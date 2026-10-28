# Heritage Bites — public storefront

A React/Vite storefront with an Express API for Heritage Bites. The public site includes the current menu, this week's service, About Us, contact details, a loyalty card lookup, checkout and secure order receipts, and the approved customer policies. It collects delivery addresses for delivery orders but does not publish the business address and does not offer dine-in.

## Confirmed business rules (owner sign-off, 27 October 2026)

These are implemented, not just described. `server/seed.js` is the source of truth and `server/lib/service.js` enforces the time and area rules.

| Rule | Value |
| --- | --- |
| Service days | Thursday and Friday only |
| Service window | 12:00–13:30 (SAST) for delivery and collection |
| Traditional plates | R100 — one protein, one starch, one vegetable side |
| Contemporary plates | R130 — one protein, one starch, one vegetable side |
| Delivery areas | Rosebank and Sandton only; refused elsewhere in the API |
| Delivery fee | None — included in the plate price |
| Minimum order | R100 for plated meals |
| Preparation / delivery | ~20 minutes / ~30 minutes inside the window |
| Collection | Standard Bank, Rosebank and Sandton (exact point still to be confirmed) |
| Payments | Card (Yoco) and cash on collection. No cash on delivery. |
| Contact | 067 013 7587 · heritagebitesfood@gmail.com · Formspree inbox |

Outside the window the site still takes orders, but labels them **pre-orders** for the next window on the receipt, in the order email and on the customer's screen.

## Current product status

The kitchen/manager console, staff roles, seeded staff logins and admin API have been removed. No staff-facing order workflow remains in this application. Successful orders are saved and queued for a background email alert to `heritagebitesfood@gmail.com`; delivery is not active until Gmail SMTP secrets are configured on the host. The email alert does not provide a staff queue or advance order statuses. Order receipts are secure contact points, not live kitchen tracking.

The Contact form forwards each enquiry to the business Formspree endpoint **and** keeps a local copy, so a delivery failure never loses a message. WhatsApp customer updates remain manual.

Card payment has two modes. Without `YOCO_SECRET_KEY` checkout uses an offline sandbox test-card form. With a live Yoco key the sandbox form is replaced by Yoco's hosted payment window: the card is entered in Yoco's iframe, the browser returns only a checkout id, and the server verifies that checkout — including the amount — before the order exists. Card numbers never reach this server. See [`docs/production-payments-yoco.md`](docs/production-payments-yoco.md).

The combined handoff PDF, [`docs/heritage-bites-complete.pdf`](docs/heritage-bites-complete.pdf), contains all current public screens followed by the owner checklist. Related documents:

- [`docs/regomoditswe-answers-2026-10.md`](docs/regomoditswe-answers-2026-10.md) — how the owner's answers were applied.
- [`docs/production-payments-yoco.md`](docs/production-payments-yoco.md) — switching card payments live.
- [`docs/what-i-need-from-kemorego.md`](docs/what-i-need-from-kemorego.md) / `.pdf` — what is still outstanding from the business.
- [`docs/what-is-needed.md`](docs/what-is-needed.md) / `.pdf` — technical launch checklist.
- [`docs/screens/heritage-bites-screens.pdf`](docs/screens/heritage-bites-screens.pdf) — screens only.

## Content policy

The **kitchen archive** (`comingSoon` in `server/seed.js`) brings back the pre-signoff categories on `/menu` as category buttons beside Traditional and Contemporary Plates, each with its own section. The chips navigate and scroll like any other category; the cards inside are view only — name, photo and a "Coming soon" tag, with no price, no dish detail and no way to order. It is kept out of `menu` entirely, so it can never be priced, searched or checked out; dishes without an honest photo are commented out rather than padded with one.

Nothing is published that the business has not signed off. Specifically: no drinks, add-ons, discount codes, testimonials or day-of-week promotions are live, because none were approved. Two dishes (Tlhakwana and Smiley) have no photograph yet, so they render a "photo coming soon" panel instead of a picture of a different dish. `SEED_VERSION` in `server/seed.js` re-seeds catalogue content on boot when it changes; orders, messages and loyalty stamps are never touched.

## Free order email alerts

The chosen no-per-message-provider-fee route is email to the existing `heritagebitesfood@gmail.com` inbox. After an order is saved, the API adds an outbox job; a background worker sends it by SMTP and retries failures. This can notify the owner's phone through the Gmail app, but it is not an SMS or WhatsApp message. Gmail's normal account limits and policies apply.

To enable it, turn on 2-step verification for the business Google account and create an App Password. Copy `.env.example` to `.env` locally, or set the same values in the production host's secret settings. Set `HB_SMTP_PASS` to that App Password without spaces, keep it private, and restart the API. Until SMTP is configured, jobs remain queued as `waiting_config`; checkout still saves the order.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm ci
npm run dev
```

Vite serves the storefront at `http://localhost:5173` and proxies relative `/api` requests to Express on port 4000. For a production-style local run:

```bash
npm run build
npm start
```

The Express process serves the built `dist/` site and API from one origin. Runtime JSON data is written to `data/runtime/` (gitignored). Set `HB_DATA_DIR` to use a different data directory; tests use a temporary directory.

## Public preview on GitHub Pages

The storefront can be published as a static preview so the business can review it in
a browser — no host, no secrets, no server. The API cannot run on Pages, so that
build ships a read-only catalogue snapshot and switches every write off (checkout
becomes a preview, lookups and messages point to WhatsApp) with a clear notice on
every page.

```bash
npm run build:pages                              # builds the preview into web/
npm run preview:pages                            # serve it as Pages would, on :5055
npm run test:pages                               # 8 checks against that server
```

GitHub Pages publishes **committed files** on `main`, because this account cannot run
Actions while its billing limit is unresolved. Best is folder `/web`; the repository
root also works — the source shell redirects to `./web/` and a root `404.html` catches
deep links. Rebuild and commit whenever site content changes. One-time setup,
what works on the preview and how to move to a real host are in
[`docs/github-pages-preview.md`](docs/github-pages-preview.md).

## Verification

With the API and Vite server running on their default ports, run:

```bash
npm test                 # API/core unit and integration tests (includes service-window and delivery-boundary rules)
npm run test:render      # render each public route against the live API
npm run test:interaction # exercise storefront, contact, checkout and order flows
npm run test:a11y        # route-level accessibility audit
npm run test:pages       # the GitHub Pages preview (needs `npm run build:pages` + `preview:pages`)
npm run verify           # all of the above
npm run build            # TypeScript and production build
```

Refresh screenshots after product or UI changes with a built site and API available at port 4000:

```bash
HB_BASE=http://127.0.0.1:4000 node scripts/capture-screens.mjs
node scripts/build-pdf.mjs
node scripts/build-statement.mjs
HB_STATEMENT_SRC=docs/what-i-need-from-kemorego.md HB_STATEMENT_OUT=docs/what-i-need-from-kemorego.pdf node scripts/build-statement.mjs
node scripts/build-combined-pdf.mjs
```

`HB_ONLY=01-home,02-home-mobile` limits a screenshot run to named screens without clearing the rest.

## Public routes

- `/` — home
- `/menu` — the two plate menus, dish details and both plate builders (`?builder=traditional` / `?builder=contemporary`)
- `/specials` — this week: service days, both plate menus and the delivery rules
- `/about` — story, Vision and Mission
- `/contact` — contact details, hours, delivery rules and the enquiry form
- `/policies` — privacy, terms, delivery & collection, refunds and cancellations
- `/passport` — loyalty card
- `/quest` — customer quest: a view-only reference of what the kitchen cooks, then a request form
- `/checkout` — order checkout
- `/order/:code?token=…` — private order receipt and details

There are no admin/staff routes. Unknown paths show the public not-found screen.

## Order privacy

A successful checkout returns a random, high-entropy tracking token. The token is included in the private order URL; the server stores only its SHA-256 digest. Reading an order or requesting cancellation requires the token as well as the order code. Order responses are not cacheable. Delivery addresses remain in the stored order for fulfilment but are excluded from the public order response; only the confirmed delivery area is shown back.

## API overview

- `GET /api/health` — service health and payment-driver label
- `GET /api/catalog` — catalogue, plate menus, policies, settings, live service status and payment configuration
- `GET /api/search` — public catalogue search
- `POST /api/quote` — server-priced basket quote
- `POST /api/orders` — place an order and receive a private tracking token
- `GET /api/orders/:code?token=…` — read an order using its tracking secret
- `POST /api/orders/:code/cancel` — request cancellation using the tracking secret; paid orders require direct contact
- `POST /api/passport` — loyalty-card lookup
- `POST /api/contact` — record an enquiry and forward it to the business inbox
- `POST /api/quests` — record a customer quest (a request for a dish, not an order) and forward it to the same
  monitored inbox; nothing is charged, priced or reserved

There are no `/api/admin/*` endpoints.

## Launch dependencies

Before relying on this as a live restaurant ordering system, complete the items in `docs/what-is-needed.md`. The most important are:

1. Set the Gmail App Password so order emails actually send.
2. Set the live Yoco keys so card payments are real.
3. Decide who watches the order inbox during the service window, or commission a protected order queue.
4. Confirm the exact collection point and the Formspree inbox owner.
5. Production data storage, backups, monitoring, rate limiting and deployment/security review.
6. Supply the real Uber Eats and Mr D store URLs when available; the current settings are blank and disabled.

The Figma file itself was not accessible in this workspace. The colour pass used palette values sampled from the uploaded reference screenshots; it does not claim a layout or pixel-for-pixel match to the inaccessible source file.
