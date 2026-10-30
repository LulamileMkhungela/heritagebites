# Search foundations

How this site tells search engines and link previews what it is, what is
automatic, what is not — and the two decisions only the owner can make.

## The short version

| Foundation | Where it comes from | Status |
| --- | --- | --- |
| One descriptive title per page | `shared/seo.js` → `PAGES` | Built |
| One description per page (~160 chars) | same table | Built |
| One `<h1>` per page, descriptive | each page | Built |
| Canonical address per page | derived from the address the page is served from | Built — needs `HB_SITE_URL` |
| `robots.txt`, `sitemap.xml` | `scripts/build-seo.mjs` | Built — needs `HB_SITE_URL` |
| Structured data (Restaurant, WebSite, BreadcrumbList, Menu) | `shared/seo.js` | Built |
| Open Graph + Twitter cards (link previews) | the same head | Built |
| One static document per route (for crawlers and Pages) | `scripts/build-seo.mjs --routes` | Built |
| Private screens kept out of the index | route table (`/checkout`, `/order/…`, `/alerts`) | Built |
| Internal links between related pages | each page | Built (menu → service details, contact) |
| The real domain, Search Console, Google Business Profile | **the owner** | **Outstanding** |

## Why one table

Four things need to agree about a page: the React app (which rewrites the head as
the customer navigates), the Express server (which answers a route with the shell
HTML), the static build (one file per route) and the two files on disk. Written
four times, they drift. So `shared/seo.js` holds the route table and the builders,
and everything else derives from it.

```
shared/seo.js ──┬─→ src/lib/seo.ts            (usePageSeo: title, description, canonical, JSON-LD)
                ├─→ server/index.js           (rewrites the shell's head per request)
                ├─→ scripts/build-seo.mjs     (robots.txt, sitemap.xml, one document per route)
                └─→ server/lib/seo.test.js    (the rules, enforced)
```

## The site address: set `HB_SITE_URL`

Nothing in the source names a domain, on purpose. A canonical tag pointing at a
site this shop is not served from is worse than no tag: it tells Google these
pages are duplicates of somebody else's.

Set the address once, on the server and in the build:

```
HB_SITE_URL=https://<the real address>      # server + dashboard checks
VITE_SITE_URL=https://<the real address>    # baked into the static build
```

What happens without it:

- the app serves correct titles and descriptions, but **no canonical** and no
  structured data (it has no idea where it lives);
- `robots.txt` is written without a `Sitemap:` line;
- `sitemap.xml` is **not** written, rather than filled with invented URLs.

`npm run build` prints exactly which of these it did.

## What each page tells a search engine

| Route | Indexed | Notes |
| --- | --- | --- |
| `/` | yes | Restaurant + WebSite structured data, `hasMenu`, hours, areas |
| `/menu` | yes | + a Menu node with every sellable plate and its price |
| `/specials` | yes | the week's cooking, delivery and collection |
| `/about` | yes | story, vision, mission |
| `/contact` | yes | phone, email, WhatsApp |
| `/policies` | yes | delivery, refunds, cancellations, privacy, terms |
| `/passport` | yes | loyalty card lookup |
| `/quest` | yes | ask the kitchen to cook a dish |
| `/checkout` | **no** | a form with nothing in it until somebody has a basket |
| `/order/<code>` | **no** | one customer's page, behind a one-time token |
| `/alerts` | **no** | the owner enrolling a phone |
| anything else | **no** | a 404, served with a 404 status |

Coming-soon dishes are deliberately left out of the menu structured data: they
have no price and cannot be ordered, so advertising one as an offer would be a
promise the kitchen has not made.

## Checking it

```
npm run test            # includes server/lib/seo.test.js — the rules
npm run test:render     # every route's title, description, robots, one h1, unique titles
                        # plus canonical + JSON-LD as they appear at a public address
```

After a deploy, with `HB_SITE_URL` set:

```
curl -s https://<domain>/robots.txt
curl -s https://<domain>/sitemap.xml | head -20
curl -s https://<domain>/menu | grep -E '<title>|canonical|og:'
```

## What the owner still has to do

1. **Decide which address is the shop.**
   `https://heritagebites.co.za` currently serves a **different website** — a
   Pretoria restaurant with a WordPress site, dine-in, Mr D and Uber Eats. It is
   the same brand and the same phone number, but a different shop from the one
   this repository serves (a Rosebank/Sandton delivery kitchen, Thursdays and
   Fridays). Until that is resolved, this app must **not** claim that domain:
   two live sites for one brand pay for the confusion, because search engines
   cannot tell which name, address and phone number to trust.
   The realistic options are: (a) this app takes over
   `heritagebites.co.za` and the WordPress site moves or redirects, (b) this app
   lives on its own address (e.g. `order.heritagebites.co.za`) and the two are
   clearly different shops, or (c) the two are merged — content here, content
   there, moving to one host. Only the owner can choose.
2. **Set `HB_SITE_URL`** to whichever address is chosen, on the host and in the
   build, then rebuild (`npm run build`, or `npm run build:pages`).
3. **Google Search Console** — add the property, verify it (DNS or the HTML tag),
   submit `https://<domain>/sitemap.xml`, and check "Pages" after a week. This is
   also where a coverage problem shows up before a customer notices it.
4. **Google Business Profile** — the strongest lever for "food delivery
   Rosebank" and "traditional food Sandton". Only the owner can create it; it
   must use the same name, phone and areas as this site, because mismatched NAP
   (name, address, phone) is the usual reason a local listing and a website
   disagree in search.
5. **Keep the content honest.** The site deliberately has no street address in
   its structured data, because the kitchen cooks in a hired kitchen and hands
   orders over at a collection point. If a permanent address ever exists, it
   belongs in `restaurantJsonLd` — and nowhere before then.

## Rebuilding the static preview

`web/` is committed, not built by GitHub Actions:

```
HB_SITE_URL=https://<address> npm run build:pages
```

This writes, into `web/`: `robots.txt`, `sitemap.xml`, `index.html` with the home
page's head, and one `<route>/index.html` per public page — each with its own
title, description, canonical and structured data, so `/menu` is a real document
rather than a 404 fallback that happens to render.
