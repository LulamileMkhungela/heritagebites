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
| Customer email | Optional — used only if the customer wants a written reply; no receipt is emailed |
| Contact | 067 013 7587 · heritagebitesfood@gmail.com · Formspree inbox |

Outside the window the site still takes orders, but labels them **pre-orders** for the next window on the order page and on the customer's screen.

### One-off service days (special openings)

Thursday and Friday stay the signed-off rhythm. For a single extra trading day — a Saturday market, a holiday — the server can open once on a calendar date without a code change:

```
HB_SPECIAL_SERVICE_DAYS=2026-11-21,2026-12-05   # host environment; each date trades once
```

Every listed date opens with the normal 12:00–13:30 window and the usual delivery rules (Rosebank and Sandton, included in the plate price), the site says **"Special opening"** instead of a rest day, and orders placed that day are filed against that day rather than the next Thursday. Invalid dates are ignored and logged, never opened. The same list can be reviewed into the catalogue as `specialServiceDays` in `server/seed.js` — an ISO string for the standard window, or `{ date: '2026-11-21', open: '10:00', close: '14:00', label: 'Saturday market' }` for a custom one. Setting either is a promise to cook and deliver that day, so it is the owner's call, not a default — and a reviewed date should be removed once it has passed.

## Current product status

The kitchen/manager console, staff roles, seeded staff logins and admin API have been removed. No staff-facing order workflow remains in this application. Successful orders are saved and alerted on: a Web Push notification to every enrolled kitchen device, and a Web Push confirmation to a customer who enabled alerts. Nothing is delivered until the VAPID keys exist on the host, but the order is still saved and still tracked. The alerts do not provide a staff queue or advance order statuses. Order receipts are secure contact points, not live kitchen tracking.

The Contact form forwards each enquiry to the business Formspree endpoint **and** keeps a local copy, so a delivery failure never loses a message. WhatsApp remains a tap-to-send channel in both directions: see [Free order notifications](#free-order-notifications-push--whatsapp) for why that is deliberate.

**Card numbers never reach this server, and there is no card field on the checkout.** The customer places the order, is sent to Yoco's own payment page (card or instant EFT), and returns; a signed webhook from Yoco is the only thing that can mark the order paid. Configure it with `HB_YOCO_PAYMENT_URL` (a Yoco payment link, quickest) or `HB_YOCO_SECRET_KEY` (Checkout API, fixes the amount), plus `HB_YOCO_WEBHOOK_SECRET`. Without any of these the checkout says online payment is not switched on yet and offers WhatsApp or cash on collection instead. The redirect and the paid-by-webhook step are tested end to end against a stand-in gateway (`npm run sandbox:yoco`, see `server/yoco-checkout-flow.test.js`), and test mode with Yoco's own `sk_test_` key is written up in [`docs/production-payments-yoco.md`](docs/production-payments-yoco.md). Run `npm run check:payments` on the server before launch: it fetches the configured payment link and refuses to call a dead one ready.

The combined handoff PDF, [`docs/heritage-bites-complete.pdf`](docs/heritage-bites-complete.pdf), contains all current public screens followed by the owner checklist. Related documents:

- [`docs/regomoditswe-answers-2026-10.md`](docs/regomoditswe-answers-2026-10.md) — how the owner's answers were applied.
- [`docs/production-payments-yoco.md`](docs/production-payments-yoco.md) — switching card payments live.
- [`docs/seo.md`](docs/seo.md) — search foundations: titles, canonicals, sitemap, structured data, and the domain decision.
- [`docs/what-i-need-from-kemorego.md`](docs/what-i-need-from-kemorego.md) / `.pdf` — what is still outstanding from the business.
- [`docs/what-is-needed.md`](docs/what-is-needed.md) / `.pdf` — technical launch checklist.
- [`docs/screens/heritage-bites-screens.pdf`](docs/screens/heritage-bites-screens.pdf) — screens only.

## Content policy

The **kitchen archive** (`comingSoon` in `server/seed.js`) brings back the pre-signoff categories on `/menu` as category buttons beside Traditional and Contemporary Plates, each with its own section. Its cards read like the rest of the menu — photo, name, a guide price and one line of description — with a "Coming soon" tag on the photo and no basket control, which is the only thing that marks them as unavailable. Nothing here is sellable, so the archive stays out of `menu` entirely and can never be priced, searched or checked out; dishes without an honest photo are commented out rather than padded with one, and **a dish that is already on sale is never listed here** (the old "Modern Favourites" category was dropped for exactly that reason — short ribs and wings are Contemporary plates today).

Every WhatsApp link on the site is built in `src/lib/whatsapp.ts`, and every one of them opens with the message already written — a customer should never land in an empty chat box and have to retype what the site already knows:

- **Order links** (checkout, the basket drawer, the hero's WhatsApp row, the preview strip) send the basket: each dish, its chosen options, the quantity, the line total, the order total and whether it is collect or delivery — plus name, phone, address and kitchen notes when the checkout form has them.
- **Enquiry links** (footer, service strip, contact card, the WhatsApp channel card, the loyalty page, the customer quest) carry a sentence that names the reason for the message, so the kitchen can answer without a round trip. The quest link also carries anything the customer has typed into the form so far.
- The order-tracking page's "Message us about HB-XXXX" link is built server-side in `server/lib/notify.js` and includes the order lines too.

**Enquiry validation, both ends.** The contact form and the customer quest require a name, a message, and **one way to reply** — a valid email address or a South African cell number (`082 123 4567`, `+27 82 123 4567`, `27821234567`). `isValidEmail` / `isValidCellNumber` in `src/lib/format.ts` do the check for instant feedback in the browser; `server/index.js` enforces the same rule in `replyChannelErrors()` so a direct `POST /api/contact` or `/api/quests` cannot bypass it. A junk address or number is refused rather than stored, because an enquiry the kitchen cannot answer is worse than no enquiry.

**Enquiries submit from the static build too.** An enquiry does not need the Heritage Bites server — only an inbox — so `web/` (the Pages build) posts the contact form and the customer quest straight to the business's Formspree endpoint (`settings.contactFormspreeUrl`) from the browser, with the same payload shape the server sends via `/api/contact` and `/api/quests`. Orders, payments, loyalty lookups and tracking still need the server and are refused on that build with an explanation.

If the storefront is ever served from a different origin than the API, set `HB_ALLOWED_ORIGINS` on the server (comma-separated, exact origins). Without it the browser blocks those requests — the API sends no wildcard CORS grant by default.

WhatsApp silently drops over-long `text` parameters, so the basket message lists up to 12 lines and summarises the rest. `scripts/interaction-smoke.mjs` walks six pages and fails if any `wa.me` link opens without a message.

Nothing is published that the business has not signed off. Specifically: no drinks, add-ons, discount codes, testimonials or day-of-week promotions are live, because none were approved. Two dishes (Tlhakwana and Smiley) have no photograph yet, so they render a "photo coming soon" panel instead of a picture of a different dish. `SEED_VERSION` in `server/seed.js` re-seeds catalogue content on boot when it changes; orders, messages and loyalty stamps are never touched.

## Free order notifications (push + WhatsApp)

Every channel below costs nothing per message and needs no card on file. There is
no SMS provider, no WhatsApp Cloud API account, no messaging app to install and no
message bundle to buy.

| Who | Channel | Automatic? | Reaches them when the site is closed? | Cost |
| --- | --- | --- | --- | --- |
| Owner | **Web Push** to enrolled kitchen devices | Yes, within seconds | Yes | R0 |
| Customer | **Web Push** confirmation + cancellation for their order | Yes, once they tap "Alert me" | Yes | R0 |
| Customer / owner | WhatsApp | No — one tap, sent from their own app | — | R0, unlimited |

### Which alert does who get?

- **Owner, the moment an order lands:** a Web Push notification on every enrolled
  kitchen device (phone and/or counter tablet). The push says the code, plate
  count, total and collection/delivery; `requireInteraction` keeps it on screen
  until acknowledged. The order itself is the permanent record — this page and
  the WhatsApp chat.
- **Customer, when they opt in:** a Web Push confirmation the instant they tap
  "alert me" on their receipt — which is also their proof that alerts reach that
  phone. The push deliberately carries no tracking token: a lock-screen message
  must not hand someone the order page.

  (An earlier design pushed "order placed" at checkout. That could never work: the
  customer opts in *after* checkout returns, so no device was subscribed yet. The
  confirmation is sent at opt-in time instead, which is both reachable and useful.)
- **Customer, when the order changes:** a Web Push for the one status change this
  build can produce — cancellation. There is no staff console and no status
  workflow, so nothing else advances an order; the tracking page is the live state.

### Web Push: free, because the browser does the delivering

A browser subscribes once and the server can then wake that device even with the
site closed. It rides the browser vendor's own push service, so there is no
provider account and no per-message charge. Set it up once:

```bash
npm run push:keys     # prints HB_VAPID_* and a suggested HB_OWNER_PUSH_KEY
```

Put the values in the host's secrets, restart the API, then open **`/alerts`** on
each device that should buzz and paste the owner key. That page is protected by the
key rather than a login, and holds no order data — it only enrols a browser.

Two honest limits:

- **iPhone:** Safari only delivers push after the site is added to the Home Screen
  (iOS 16.4+). Android and desktop work straight away. The pages say this instead
  of failing silently.
- **It is opt-in.** Nobody is pushed to without tapping. A customer who ignores the
  offer still has the tracking page and the WhatsApp chat, which is why neither is
  redundant.

A customer subscription is bound to one order code and capped at five devices, so
nobody can point a device at someone else's orders; a device's own
`/api/push/unsubscribe` needs no key, because revoking oneself must always work.
Dead subscriptions (a browser reporting 404/410) are deleted rather than retried.

### Why there is no email alert

Email was removed on purpose. A working alert email means an SMTP host, a port, a
sender address and a 16-character app password held on the server, plus DNS work
if receipts are to avoid spam folders. That is infrastructure, not "type your
address and get alerts", and it failed the test of what the restaurant should have
to configure.

Web Push replaces it with no provider at all. The one-time setup is running
`npm run push:keys` and pasting the result into the host's secrets; the daily use
is opening `/alerts` on the kitchen phone and pressing enrol. Nothing else on the
server holds a credential for sending mail.

The record of an order is the saved order (a private tracking link, from
`/api/orders/<code>`), this order page, and the WhatsApp chat the customer used.

### Checking it without a phone

`HB_PUSH_DRY_RUN=true` makes the server log each push instead of sending it, so a
local run or a test can exercise the whole path without touching a push service.
The test suite sets it.

### Free tiers fail silently — so make them shout

The real risk with a free stack is not the price, it is the silence: keys are
rotated, a phone is wiped, a browser subscription dies. Orders keep arriving and
nobody is told.

Two things guard against that:

1. **The channel is visible.** `GET /api/health` reports `notifications.push`:
   whether it is ready, why not if not, and how many kitchen and customer devices
   are enrolled.
2. **A scheduled check exits non-zero.** `scripts/notification-check.mjs` reads
   the live API and fails loudly when push is not configured, when keys are
   present but unusable, when `HB_OWNER_PUSH_KEY` is missing, when push is
   configured but **no device has enrolled**, or when a kitchen device has failed
   three sends in a row.

   ```bash
   HB_BASE=https://heritagebites.co.za npm run notify:check
   ```

   Run it from cron, a GitHub Action or an uptime monitor pointed at
   `/api/health` — failure is only survivable if something notices.
3. **The site is the source of truth.** The order is saved before any notification
   is attempted, so a dead channel never loses a sale; `GET /api/orders/<code>`
   with its tracking token always shows the current state.

### WhatsApp: free because a person presses send

Automated WhatsApp push is not free, and it is worth being precise about why.

- **What changed.** From 1 October 2026 Meta charges per message for service
  messages beyond 1,000 per business number per month, and for utility templates
  sent inside the open 24-hour customer service window (utility templates get no
  free allowance at all). Both were free before that date.
- **The South African rate is not one number.** Meta's rate card effective
  1 July 2026 lists South Africa at **US$0.0076** for utility and authentication
  and **US$0.0379** for marketing. The card effective **1 October 2026** is
  reported to raise the utility/authentication list rate by 25% to **US$0.0095**.
  At roughly R16/US$ that is about **R0.12–R0.15 per delivered message**, and a
  provider may add 15% VAT on top.
- **Where to get the real figure.** Meta's own pricing dashboard for this account,
  not an article and not this README. Meta's documentation has been inconsistent
  about in-window pricing, so treat any quoted number — including these — as
  provisional until the dashboard agrees.

The conclusion does not depend on which of those figures is right: automated
WhatsApp needs a verified Meta business account with a card on file, so it is not
free, and this build does **not** claim to send WhatsApp notifications. The receipt
page says so plainly.

What it does instead is hand the message to the customer's own WhatsApp, pre-filled:
the receipt page has *Message us about HB-xxxx* (a structured ticket to the kitchen),
*Keep this receipt on WhatsApp* (sends the receipt and tracking link into any chat
they choose) and *Request WhatsApp updates*. Checkout carries the same basket-to-
WhatsApp link. Replies come from a person on the kitchen phone, inside a normal
WhatsApp chat, which is unlimited and free.

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
npm run test:mobile      # phone layout: 12 routes × 4 widths, real Chromium
npm run backup           # gzipped copy of the runtime JSON store (orders, stamps)
npm run verify           # all of the above
npm run build            # TypeScript and production build
```

`npm run test:mobile` is the one that answers "does this work on a phone?". It
drives a real browser at 320, 360, 390 and 414 CSS px wide, with a two-item
basket seeded so the header is at its widest, and fails the run if any page is
wider than the screen. It also reports tap targets under 44px (the iOS/Android
minimum) and text under 12px. A page that scrolls sideways on a phone is a bug,
not a preference — that is why this exits non-zero.

```bash
HB_BASE=http://127.0.0.1:4000 npm run test:mobile   # sits on a dev/preview server
HB_MOBILE_SHOTS=1 npm run test:mobile               # also writes docs/screens/mobile-*.png
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

## Search foundations

Every public page states its own title, description, canonical address and
structured data, and the private screens (checkout, an order behind a token, the
owner's alerts) are `noindex`. The route table and the builders live once in
`shared/seo.js`, and the app, the Express host, the static build, `robots.txt`
and `sitemap.xml` all derive from it — four copies of the same facts would drift.

Nothing in the source names a domain. Set the address the site is actually served
from and everything follows:

```bash
HB_SITE_URL=https://<the real address> npm run build          # dist/ + robots + sitemap
HB_SITE_URL=https://<the real address> npm run build:pages    # web/ + one file per route
```

Without it, titles and descriptions are still correct, but no canonical and no
sitemap are written rather than inventing a domain. `npm run test:render` checks
each route's head, its single `<h1>`, that no two routes share a title, and — at a
public origin — the canonical and the Restaurant/Menu structured data.
[`docs/seo.md`](docs/seo.md) has the full picture, including the one decision that
is still the owner's: `heritagebites.co.za` currently serves a different website.

## The logo, the icons and the share card

The shop's badge is the brand everywhere it can be a file: the header and footer
of the site, the browser tab, the iOS home screen, the Android launcher, a browser
notification, and the picture that appears when the link is pasted into WhatsApp,
Facebook, LinkedIn or Slack.

Every one of those files is generated from the artwork by
`scripts/build-brand-assets.py`; none was drawn separately.

| File | Where it shows | Size |
| --- | --- | --- |
| `public/img/logo-badge.png` | header, footer, share card | 512px, white on transparent |
| `public/img/logo-badge-ink.png` | the 404 page, the empty basket | 512px, ink on transparent |
| `public/img/social-card.jpg` | a pasted link | 1200×630 |
| `public/favicon.ico` · `favicon-16.png` · `favicon-32.png` | the browser tab | 16/32/48 |
| `public/apple-touch-icon.png` | iOS home screen | 180, opaque |
| `public/icon-192.png` · `icon-512.png` · `icon-maskable-512.png` | Android, the manifest | 192/512 |
| `public/manifest.webmanifest` | install prompt, Android | — |

### Why the tab icon is the pot, not the whole badge

The badge is an engraving: arched "HERITAGE", "BITES", "EST. 2025" and crossed
cutlery, all inside a ring. At 16px that ring is a grey smudge — checked by
rendering it at true size next to the alternatives rather than assuming. The pot
is the one part of the mark that survives the size, so it is cut out of the
artwork by connected-component analysis, set on an ink tile (white art vanishes in
a light tab, dark art in a dark one), and used for the tab, the home screen and
the notification icon. The full badge is used wherever there is room for it.

### Regenerating

The builder needs Pillow, numpy, scipy and fontTools, and the site's own typefaces
as TTF (they ship as woff2, which Pillow cannot read):

```bash
pip install --break-system-packages pillow numpy scipy fonttools brotli
python3 scripts/woff2-to-ttf.py            # public/fonts/*.woff2 → /tmp/*.ttf
python3 scripts/build-brand-assets.py <the supplied logo.png>
npm run build && npm run build:pages
```

`server/lib/brand.test.js` reads the dimensions out of the files themselves, so a
missing, empty or wrongly sized icon fails `npm test` rather than shipping.

### The share card

`shared/seo.js` names `DEFAULT_SHARE_IMAGE`, its size and its alt text, and both
the app and the server emit `og:image`, `og:image:width/height/type/alt` and the
`twitter:image` pair. Everything on the card is a fact the shop already states on
the site: South African plates, R100–R130, delivery in Rosebank and Sandton,
Thursdays and Fridays 12:00–13:30. No address, rating or review is invented to
fill space.

Social networks cache a preview the first time they see a URL and can hold it for
weeks. After a deploy, paste the link into the
[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) and the
[LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) and ask them to
re-scrape; WhatsApp caches too, so an unchanged preview after a deploy is usually
the cache, not the code.

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
- `/order/:code?token=…` — private order receipt and details, with per-device alert opt-in
- `/alerts` — owner device enrolment for kitchen alerts (not in the public navigation)

There are no admin/staff routes. Unknown paths show the public not-found screen.

## Order privacy

A successful checkout returns a random, high-entropy tracking token. The token is included in the private order URL; the server stores only its SHA-256 digest. Reading an order or requesting cancellation requires the token as well as the order code. Order responses are not cacheable. Delivery addresses remain in the stored order for fulfilment but are excluded from the public order response; only the confirmed delivery area is shown back.

## API overview

- `GET /api/health` — service health, payment-driver label and which notification channels are configured (booleans)
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
- `GET /api/push/config` — whether Web Push is on, and the public VAPID key
- `POST /api/push/order-subscribe` — enrol a device for one order; needs the order code **and** its tracking token
- `POST /api/push/owner-subscribe` — enrol a kitchen device; needs the `x-hb-owner-key` header
- `POST /api/push/unsubscribe` — a device revoking itself; deliberately unauthenticated

There are no `/api/admin/*` endpoints.

## Launch dependencies

Before relying on this as a live restaurant ordering system, complete the items in `docs/what-is-needed.md`. The most important are:

1. Run `npm run push:keys`, set `HB_VAPID_*` and `HB_OWNER_PUSH_KEY`, enrol the kitchen devices at `/alerts`. Then schedule `npm run notify:check`.
2. Set the live Yoco keys so card payments are real.
3. Decide who watches the order inbox during the service window, or commission a protected order queue.
4. Confirm the exact collection point and the Formspree inbox owner.
5. Production data storage and monitoring: point `HB_DATA_DIR` at a persistent disk, schedule `npm run backup` off the machine, watch `/api/health`, and set `HB_TRUST_PROXY=1` if the host puts a proxy in front. Rate limiting, gzip and the security headers are already wired; a Content-Security-Policy is the one hardening item still open (it needs nonces threaded through the build, and a bad policy fails silently).
6. Deployment and security review of the live configuration.
7. Supply the real Uber Eats and Mr D store URLs when available; the current settings are blank and disabled.

The Figma file itself was not accessible in this workspace. The colour pass used palette values sampled from the uploaded reference screenshots; it does not claim a layout or pixel-for-pixel match to the inaccessible source file.
