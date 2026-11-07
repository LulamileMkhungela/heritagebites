# Deploying on Render — free plan, step by step

*Heritage Bites · the full site (ordering, `/alerts`, email receipts) on its own
`onrender.com` address. Nothing on `heritagebites.co.za` changes — that domain
currently serves a different website, and this deployment does not touch it.*

The repository carries a **Render blueprint** (`render.yaml` at the root). It
already knows the plan, the region, the build and start commands and every
non-secret setting, so the only things typed by hand are the three values a
public repository must never contain.

## One-time setup (~15 minutes, no card)

1. **Sign up**: go to [render.com](https://render.com) → **Get Started** →
   sign in **with GitHub** (the account that owns
   `LulamileMkhungela/heritagebites`).
2. **Create from the blueprint**: Dashboard → **New +** → **Blueprint** →
   select the `heritagebites` repository. Render reads `render.yaml` and shows
   the service it will create (name `heritagebites`, free plan, Frankfurt).
3. **Enter the three secrets** it prompts for — copy them from the server's
   `.env` file (or regenerate the push pair with `npm run push:keys`):

   | Value | What it is |
   | --- | --- |
   | `HB_SMTP_PASS` | the 16-character Gmail App Password for `mkhungela.l@gmail.com` |
   | `HB_VAPID_PRIVATE_KEY` | signs the Web Push notifications |
   | `HB_OWNER_PUSH_KEY` | the enrolment password for the `/alerts` page |

4. **Apply** → the first build takes about five minutes.
5. When it is live, the address is shown at the top of the service page, e.g.
   `https://heritagebites.onrender.com`.

## If the address is different from `heritagebites.onrender.com`

Service names are first-come-first-served. If you had to pick another name,
open the service → **Environment** → update **`HB_PUBLIC_URL`** and
**`HB_SITE_URL`** to the address Render actually assigned (receipt links and
canonical URLs come from these) → save; it redeploys on its own.

## Test it, in this order

1. **The site**: open the address — the full storefront loads, menu and all.
2. **The order path**: place a small order, *cash on collection*, with your own
   email address. Within seconds (the outbox is checked every 5 s):
   - the **kitchen ticket** arrives at `mkhungela.l@gmail.com`;
   - the **customer receipt** with the private tracking link arrives at the
     email you typed.
3. **The instant buzz**: on the kitchen phone or tablet, open
   `<the address>/alerts`, paste `HB_OWNER_PUSH_KEY`, enrol, and allow
   notifications. Place another order — the device buzzes. (iPhones need the
   site added to the Home Screen first: Share → Add to Home Screen, iOS 16.4+.)
4. **The health check**: `<the address>/api/health` should report
   `ownerEmail: true`, `customerEmail: true` and `push.reason: "ready"`.

If the ticket email never arrives, first check
[Google's sign-in activity](https://myaccount.google.com/connections) for a
blocked sign-in, then try switching `HB_SMTP_PORT` to `587` with
`HB_SMTP_SECURE=false` in the Environment tab — some networks route 465
poorly.

## What the free plan means

- **It sleeps.** After ~15 minutes without a visitor the service stops, and
  the next visit takes about a minute to wake it. Fine for testing.
- **Data does not survive deploys.** Orders, the outbox and loyalty stamps
  live on the container's own filesystem, which is wiped on every deploy and
  on every rebuild after sleeping. Acceptable while testing; before a real
  service window, add a persistent disk (paid) and point `HB_DATA_DIR` at it.
- **Every push to `main` deploys automatically.** The blueprint tracks the
  `main` branch. Merge a pull request and the site updates itself a few
  minutes later.
- **Emails share the Gmail account's daily sending limit** (Gmail's own cap,
  roughly 500 recipients/day) — plenty for a service window, and the outbox
  retries with backoff if Gmail ever refuses.

## Later: a real domain

When the `heritagebites.co.za` question is decided (the options are listed in
[`seo.md`](seo.md) — take the domain over, use a subdomain like
`order.heritagebites.co.za`, or merge the two shops), the change is a setting,
not a rebuild: service → **Settings** → **Custom Domains** → add it, then
update `HB_PUBLIC_URL` and `HB_SITE_URL` to match.
