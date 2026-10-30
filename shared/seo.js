/**
 * Search foundations: one description of the site, used everywhere.
 *
 * The same facts have to appear in four places that cannot see each other — the
 * React app (which sets the head as the customer navigates), the server (which
 * answers a route with the shell HTML), the static GitHub Pages build (one file
 * per route), and `sitemap.xml` / `robots.txt` (plain files on disk). Written
 * four times, they drift: a page gets a new title in one place and an old one in
 * another, and search engines are told two different things about one URL.
 *
 * So the route table lives here, once, and every consumer derives from it. This
 * module is deliberately free of DOM and Node APIs so it can be imported by all
 * of them and tested with `node --test`.
 *
 * ## The site URL
 *
 * Nothing here invents a domain. `normaliseSiteUrl` accepts only a real http(s)
 * address, and the callers decide where it comes from (`HB_SITE_URL` at build
 * time, `HB_PUBLIC_URL` on the server, the browser's own origin as a last
 * resort). That matters more than it sounds: this repository once hardcoded
 * `https://heritagebites.co.za` into every canonical tag, and that domain serves
 * a different website — a canonical pointing there tells Google this shop is a
 * duplicate of somebody else's pages.
 */

/** The brand, as it is written everywhere. */
export const BRAND = 'Heritage Bites';
export const LOCALE = 'en_ZA';
export const TAGLINE = 'Every Bite Tells a Story';

/**
 * The picture a pasted link shows.
 *
 * Built by `scripts/build-brand-assets.py`: the badge, the tagline, the price
 * band, the delivery areas and the service days on one 1200×630 card. A logo on
 * its own would tell a stranger nothing about whether they want to tap it, and
 * a photograph alone would not say what the shop is or where it delivers.
 */
export const DEFAULT_SHARE_IMAGE = '/img/social-card.jpg';

/**
 * Its size and type.
 *
 * `og:image:width` and `og:image:height` are what stop WhatsApp and Facebook
 * guessing at a crop: without them the first scrape often renders a sliver or a
 * square before it learns better.
 */
export const SHARE_IMAGE_META = { width: 1200, height: 630, type: 'image/jpeg' };

/** Read by screen readers, and used when the image itself cannot load. */
export const SHARE_IMAGE_ALT =
  'The Heritage Bites logo: a cooking pot on an engraved badge, with the words Heritage Bites and Every Bite Tells a Story.';

/**
 * Pages a search engine may index.
 *
 * `title` is the page's own title — the brand is appended by `documentTitle()`,
 * so it is written once. `description` is the search-result summary: one honest
 * sentence about what is on the page, under ~160 characters so Google does not
 * truncate it.
 *
 * `priority` and `changefreq` are hints for `sitemap.xml` only.
 */
export const PAGES = {
  '/': {
    title: 'South African Plates in Rosebank & Sandton',
    description:
      'South African plates from R100 — mogodu, tshotlo, tlhakwana, smiley, wings and short rib. Cooked Thursdays and Fridays, delivered in Rosebank and Sandton.',
    priority: 1,
    changefreq: 'daily',
  },
  '/menu': {
    title: 'The Menu & Prices',
    description:
      'Every plate on the Heritage Bites menu: traditional at R100, contemporary at R130, each with one starch and one side. Cooked twice a week, delivery included.',
    priority: 0.9,
    changefreq: 'weekly',
  },
  '/specials': {
    title: "This Week's Cooking & Delivery",
    description:
      'What is cooking this week and how service works: Thursdays and Fridays, 12:00 to 13:30, with delivery in Rosebank and Sandton and collection in Rosebank.',
    priority: 0.8,
    changefreq: 'daily',
  },
  '/about': {
    title: 'Our Story, Vision & Mission',
    description:
      'Heritage Bites began in a family kitchen: mogodu, tshotlo and tlhakwana cooked in small batches, and South African food taken seriously.',
    priority: 0.7,
    changefreq: 'monthly',
  },
  '/contact': {
    title: 'Contact & WhatsApp',
    description:
      'Call or WhatsApp +27 67 013 7587, email heritagebitesfood@gmail.com, or send a message about an order, delivery in Rosebank and Sandton, or the weekly menu.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  '/policies': {
    title: 'Policies & Terms',
    description:
      'Delivery and collection, refunds, cancellations, website terms and privacy — the Heritage Bites policies in plain language, including failed payments.',
    priority: 0.5,
    changefreq: 'yearly',
  },
  '/passport': {
    title: 'Loyalty Card',
    description:
      'Look up your Heritage Bites loyalty card with your cell number: one stamp for every R50 spent, and ten stamps earns a plate on us. No app or account needed.',
    priority: 0.5,
    changefreq: 'monthly',
  },
  '/quest': {
    title: 'Ask Us to Cook It',
    description:
      'Ask the Heritage Bites kitchen to cook a dish you miss, or tell us how the food was. Every quest is read by a person and answered by a person.',
    priority: 0.5,
    changefreq: 'monthly',
  },
};

/**
 * Routes that must never appear in a search result.
 *
 * `/checkout` is an empty form until there is a basket, `/order/:code` is one
 * customer's private tracking page behind a token, and `/alerts` is the owner
 * enrolling a phone. Indexing any of them puts a blank or private screen in
 * front of a searcher.
 */
export const PRIVATE_PREFIXES = ['/checkout', '/order', '/alerts'];

/**
 * What to call a private screen in the browser tab.
 *
 * These pages are `noindex`, but a customer still sees the title in their history
 * and on a receipt screenshot, and "Heritage Bites" alone says nothing about
 * which screen it was.
 */
export const PRIVATE_TITLES = {
  '/checkout': 'Checkout',
  '/order': 'Order tracking',
  '/alerts': 'Order alerts',
};

/** The tab title for a private path, or '' when it is not one. */
export function privateTitle(path) {
  const clean = normalisePath(path);
  const match = Object.keys(PRIVATE_TITLES).find(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`),
  );
  return match ? PRIVATE_TITLES[match] : '';
}

/** Is this path one that may be indexed? */
export function isPrivatePath(path) {
  const clean = normalisePath(path);
  return PRIVATE_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
}

/** `/menu/` and `/menu` are the same page; `/` stays `/`. */
export function normalisePath(path) {
  const raw = String(path ?? '/').trim();
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withSlash === '/') return '/';
  return withSlash.replace(/\/+$/, '') || '/';
}

/**
 * Read the metadata for a path.
 *
 * Unknown and private paths come back as `{ index: false }` with no description,
 * which is the honest answer: a page that is not in the table has nothing
 * truthful to say about itself in a search result.
 */
export function pageMeta(path) {
  const clean = normalisePath(path);
  const known = PAGES[clean];
  if (known) return { path: clean, index: true, ...known };
  return { path: clean, index: false, title: '', description: '', priority: 0, changefreq: 'monthly' };
}

/** The full `<title>` for a page, brand included. */
export function documentTitle(title) {
  const own = String(title ?? '').trim();
  return own ? `${own} — ${BRAND}` : BRAND;
}

/**
 * Turn a configured address into an origin we can build canonical URLs from.
 *
 * Returns `null` for anything that is not a usable public address — an empty
 * value, a relative path, a placeholder from a template, or `localhost`. A
 * canonical tag on `http://localhost:4000/menu` is worse than no tag at all: it
 * tells Google the page lives on a machine in somebody's kitchen.
 */
export function normaliseSiteUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) return null;
  /* Built-in template values, and the classic "your-domain" placeholder. */
  if (/example\.(com|org|co\.za)$/i.test(url.hostname) || /your-?domain|<|>|\.\.\./i.test(url.hostname)) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** The one canonical address of a page. */
export function canonicalUrl(siteUrl, path) {
  const base = normaliseSiteUrl(siteUrl);
  const clean = normalisePath(path);
  if (!base) return null;
  return clean === '/' ? `${base}/` : `${base}${clean}`;
}

/* ------------------------------------------------------------- text safety */

/** Attribute-and-text escaping. One apostrophe in a description must not break the head. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON for a `<script type="application/ld+json">` block.
 *
 * `</script>` inside a string would end the block early, so the slash is escaped.
 * `</` cannot appear in valid JSON other than inside a string, so this is safe
 * and keeps the document well-formed.
 */
export function jsonLdScript(data) {
  return JSON.stringify(data).replace(/<\//g, '<\\/');
}

/* ----------------------------------------------------------- structured data */

/**
 * The business itself, as a schema.org `Restaurant`.
 *
 * Deliberately without `address`: Heritage Bites cooks in a hired kitchen and
 * hands the food over at a collection point, so a street address would be an
 * invented fact — and a wrong one is worse than a missing one for local search.
 * What is true is here: the phone, the email, the cuisine, the price band, the
 * two delivery areas, and the two service days.
 *
 * @param {string | null} siteUrl
 * @param {{ phoneDisplay?: string, phone?: string, email?: string, established?: number, deliveryAreas?: string[], serviceWindow?: { open?: string, close?: string } }} [settings]
 */
export function restaurantJsonLd(siteUrl, settings = {}) {
  const base = normaliseSiteUrl(siteUrl);
  const phone = String(settings.phoneDisplay ?? settings.phone ?? '+27 67 013 7587').replace(/[^\d+]/g, '');
  const areas = settings.deliveryAreas?.length ? settings.deliveryAreas : ['Rosebank', 'Sandton'];
  const open = settings.serviceWindow?.open ?? '12:00';
  const close = settings.serviceWindow?.close ?? '13:30';

  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': base ? `${base}/#restaurant` : undefined,
    name: BRAND,
    slogan: TAGLINE,
    description:
      'Traditional and contemporary South African plates, cooked in small batches on Thursdays and Fridays and delivered in Rosebank and Sandton.',
    ...(base ? { url: `${base}/`, hasMenu: `${base}/menu`, image: `${base}${DEFAULT_SHARE_IMAGE}` } : {}),
    telephone: phone,
    ...(settings.email ? { email: settings.email } : {}),
    servesCuisine: 'South African',
    priceRange: 'R100–R130',
    currenciesAccepted: 'ZAR',
    paymentAccepted: 'Cash, Credit Card',
    foundingDate: String(settings.established ?? 2025),
    /* Delivery-only in two suburbs, and it is not a booking restaurant. */
    areaServed: areas.map((name) => ({ '@type': 'City', name })),
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Thursday', 'Friday'],
        opens: open,
        closes: close,
      },
    ],
  };
}

/** The site as a `WebSite`, so search engines can group the pages under one name. */
export function websiteJsonLd(siteUrl) {
  const base = normaliseSiteUrl(siteUrl);
  if (!base) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${base}/#website`,
    url: `${base}/`,
    name: BRAND,
    inLanguage: 'en-ZA',
    publisher: { '@id': `${base}/#restaurant` },
  };
}

/**
 * One crumb per level, from the home page down to this one.
 *
 * Breadcrumbs are how a search engine learns that /menu belongs to the same shop
 * as /, rather than being an unrelated page that happens to link to it.
 */
export function breadcrumbJsonLd(siteUrl, path, label) {
  const base = normaliseSiteUrl(siteUrl);
  const clean = normalisePath(path);
  if (!base || clean === '/') return null;
  const meta = pageMeta(clean);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: label ?? meta.title ?? clean, item: `${base}${clean}` },
    ],
  };
}

/**
 * The menu as schema.org data, built from the catalogue the site already serves.
 *
 * This is what lets a plate show up as a dish with a price rather than as a line
 * of text. Only sellable plates with a real price are included: a "coming soon"
 * dish has no price and no page, and claiming one would be an offer the kitchen
 * cannot honour.
 *
 * @param {string | null} siteUrl
 * @param {{ menu?: any[], categories?: any[] }} catalog
 */
export function menuJsonLd(siteUrl, catalog) {
  const base = normaliseSiteUrl(siteUrl);
  const dishes = Array.isArray(catalog?.menu) ? catalog.menu : [];
  if (!base || !dishes.length) return null;

  const currency = catalog?.settings?.currency ?? 'ZAR';
  const sectionName = (id) => catalog?.categories?.find((c) => c.id === id)?.name ?? 'Plates';

  const sections = new Map();
  for (const dish of dishes) {
    const price = Number(dish?.price);
    /* Skip anything that cannot be ordered: no price, or flagged as an archive. */
    if (!dish?.name || !Number.isFinite(price) || price <= 0 || dish.comingSoon || dish.archived) continue;
    const key = dish.category ?? dish.plateId ?? 'plates';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push({
      '@type': 'MenuItem',
      name: dish.localName && dish.localName !== dish.name ? `${dish.name} (${dish.localName})` : dish.name,
      description: String(dish.description ?? '').slice(0, 300),
      url: `${base}/menu`,
      offers: { '@type': 'Offer', price: price.toFixed(2), priceCurrency: currency },
      /* In the customer's words, so the schema matches the page. */
      ...(dish.image ? { image: dish.image.startsWith('http') ? dish.image : `${base}${dish.image}` } : {}),
    });
  }

  if (!sections.size) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    '@id': `${base}/menu#menu`,
    name: `${BRAND} menu`,
    inLanguage: 'en-ZA',
    url: `${base}/menu`,
    hasMenuSection: [...sections.entries()].map(([id, items]) => ({
      '@type': 'MenuSection',
      name: sectionName(id),
      hasMenuItem: items,
    })),
  };
}

/* ------------------------------------------------------- sitemap & robots */

/**
 * `sitemap.xml` for the indexable pages.
 *
 * Returns `null` when there is no usable site URL: a sitemap has to contain
 * absolute addresses, and inventing them is exactly the mistake this module
 * exists to prevent. The caller decides what to say instead.
 *
 * @param {string | null} siteUrl
 * @param {{ lastmod?: string }} [options]
 */
export function sitemapXml(siteUrl, { lastmod } = {}) {
  const base = normaliseSiteUrl(siteUrl);
  if (!base) return null;
  const stamp = lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : '';

  const urls = Object.entries(PAGES).map(
    ([path, meta]) => `  <url>
    <loc>${escapeHtml(canonicalUrl(base, path))}</loc>${stamp ? `\n    ${stamp}` : ''}
    <changefreq>${meta.changefreq}</changefreq>
    <priority>${meta.priority.toFixed(1)}</priority>
  </url>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

/**
 * `robots.txt`.
 *
 * Everything is open except the three private paths, and the sitemap line is
 * only written when the domain is known — a robots file pointing at a sitemap on
 * somebody else's domain sends crawlers off-site.
 */
export function robotsTxt(siteUrl) {
  const base = normaliseSiteUrl(siteUrl);
  const lines = [
    'User-agent: *',
    'Allow: /',
    '',
    '# Order tracking, the checkout and owner alerts are per-customer screens with',
    '# nothing to read until they are in use.',
    'Disallow: /checkout',
    'Disallow: /order/',
    'Disallow: /alerts',
    '',
  ];
  if (base) lines.push(`Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}

/* ------------------------------------------------------------ head markup */

/**
 * The `<head>` block for one page, as HTML.
 *
 * Used by whatever answers a request without running the app: the Express
 * server's SPA fallback and the static Pages build. The React app sets the same
 * values itself as the customer navigates, from the same route table.
 *
 * @param {string} path
 * @param {{ siteUrl?: string | null, jsonLd?: any[], image?: string, title?: string, description?: string, index?: boolean }} [options]
 */
export function headHtml(path, options = {}) {
  const base = normaliseSiteUrl(options.siteUrl);
  const meta = pageMeta(path);
  const index = options.index ?? meta.index;
  const title = options.title ?? (meta.title || privateTitle(path));
  const description = options.description ?? meta.description;
  /* A page kept out of the index has no canonical address to declare. */
  const canonical = base && index ? canonicalUrl(base, path) : null;
  const image = options.image ?? DEFAULT_SHARE_IMAGE;

  const tags = [`<title>${escapeHtml(documentTitle(title))}</title>`];

  if (description) tags.push(`<meta name="description" content="${escapeHtml(description)}" />`);
  /* The one instruction that keeps a private page out of a search result. */
  tags.push(
    index
      ? '<meta name="robots" content="index,follow,max-image-preview:large" />'
      : '<meta name="robots" content="noindex,nofollow" />',
  );
  if (canonical) tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);

  /* Open Graph and Twitter: what a link looks like in WhatsApp and on Facebook. */
  tags.push(
    `<meta property="og:site_name" content="${escapeHtml(BRAND)}" />`,
    `<meta property="og:locale" content="${LOCALE}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(documentTitle(title))}" />`,
  );
  if (description) tags.push(`<meta property="og:description" content="${escapeHtml(description)}" />`);
  if (canonical) tags.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`);
  if (base) {
    const absolute = `${base}${image}`;
    tags.push(
      `<meta property="og:image" content="${escapeHtml(absolute)}" />`,
      `<meta property="og:image:type" content="${SHARE_IMAGE_META.type}" />`,
      `<meta property="og:image:width" content="${SHARE_IMAGE_META.width}" />`,
      `<meta property="og:image:height" content="${SHARE_IMAGE_META.height}" />`,
      `<meta property="og:image:alt" content="${escapeHtml(SHARE_IMAGE_ALT)}" />`,
      /* Twitter/X does not read the og: tags for images. */
      `<meta name="twitter:image" content="${escapeHtml(absolute)}" />`,
      `<meta name="twitter:image:alt" content="${escapeHtml(SHARE_IMAGE_ALT)}" />`,
    );
  }
  tags.push('<meta name="twitter:card" content="summary_large_image" />');
  if (description) tags.push(`<meta name="twitter:description" content="${escapeHtml(description)}" />`);
  tags.push(`<meta name="twitter:title" content="${escapeHtml(documentTitle(title))}" />`);

  /* Structured data: the shop, the site, then this page's own node. */
  const nodes = [];
  if (base) {
    nodes.push(restaurantJsonLd(base, options.settings), websiteJsonLd(base));
    const name = path === '/' ? null : title;
    const crumb = breadcrumbJsonLd(base, path, name);
    if (crumb) nodes.push(crumb);
  }
  for (const node of options.jsonLd ?? []) if (node) nodes.push(node);
  for (const node of nodes.filter(Boolean)) {
    tags.push(`<script type="application/ld+json">${jsonLdScript(node)}</script>`);
  }

  return tags.join('\n    ');
}

/** The markers the build and the server replace. Kept here so they cannot drift. */
export const HEAD_START = '<!--seo:start-->';
export const HEAD_END = '<!--seo:end-->';
