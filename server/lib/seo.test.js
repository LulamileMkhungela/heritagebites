/**
 * Tests for the search metadata in `shared/seo.js`.
 *
 * The point of these is that the four consumers — the app, the server, the
 * static build and the two plain files on disk — cannot disagree. Most of what
 * follows is about the two ways that goes wrong:
 *
 *   1. a canonical or sitemap URL pointing at a domain this shop is not served
 *      from (which tells Google these pages are duplicates of another site), and
 *   2. a private screen — a checkout, an order behind a token, the owner's
 *      alerts — ending up in an index.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGES,
  PRIVATE_TITLES,
  canonicalUrl,
  documentTitle,
  faqJsonLd,
  headHtml,
  isPrivatePath,
  jsonLdScript,
  menuJsonLd,
  normalisePath,
  normaliseSiteUrl,
  pageMeta,
  privateTitle,
  restaurantJsonLd,
  robotsTxt,
  sitemapXml,
  websiteJsonLd,
} from '../../shared/seo.js';

const SITE = 'https://shop-test.co.za';

/* --------------------------------------------------------------- addresses */

describe('the site address', () => {
  test('a real address is kept, without its trailing slash', () => {
    assert.equal(normaliseSiteUrl('https://shop-test.co.za/'), 'https://shop-test.co.za');
    assert.equal(normaliseSiteUrl('https://shop-test.co.za/plates/'), 'https://shop-test.co.za/plates');
    assert.equal(normaliseSiteUrl('http://shop-test.co.za'), 'http://shop-test.co.za');
  });

  test('a placeholder or a local machine is refused, not used', () => {
    /*
     * A canonical tag on http://localhost:4000 tells a search engine the page
     * lives on somebody's laptop. Refusing these is what makes the callers
     * choose a real address or say nothing.
     */
    for (const value of [
      '',
      null,
      undefined,
      'localhost:4000',
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'https://your-domain.co.za',
      'https://example.com',
      'https://shop.example.co.za',
      'not a url',
      'ftp://shop-test.co.za',
      '/relative/path',
    ]) {
      assert.equal(normaliseSiteUrl(value), null, `expected ${String(value)} to be refused`);
    }
  });

  test('a canonical is one address per page, and the home page keeps its slash', () => {
    assert.equal(canonicalUrl(SITE, '/'), `${SITE}/`);
    assert.equal(canonicalUrl(SITE, '/menu'), `${SITE}/menu`);
    assert.equal(canonicalUrl(SITE, '/menu/'), `${SITE}/menu`);
    assert.equal(canonicalUrl(SITE, 'menu'), `${SITE}/menu`);
    assert.equal(canonicalUrl(null, '/menu'), null);
  });
});

/* ------------------------------------------------------------- the routes */

describe('the route table', () => {
  test('every public page has a title and a description a search result can use', () => {
    for (const [path, meta] of Object.entries(PAGES)) {
      assert.ok(meta.title, `${path} has no title`);
      assert.ok(meta.description, `${path} has no description`);
      assert.ok(meta.description.length <= 160, `${path}'s description is ${meta.description.length} characters, over the ~160 shown by Google`);
      assert.ok(meta.description.length >= 70, `${path}'s description is too short to say anything (${meta.description.length})`);
      /* The brand is appended once, by documentTitle. */
      assert.ok(!meta.title.includes('Heritage Bites'), `${path}'s title repeats the brand`);
      assert.ok(documentTitle(meta.title).endsWith('— Heritage Bites'));
    }
  });

  test('the checkout, an order and the owner alerts are never indexable', () => {
    for (const path of ['/checkout', '/order/HB-1042A', '/order', '/alerts', '/alerts/']) {
      assert.equal(isPrivatePath(path), true, `${path} must be private`);
      assert.equal(pageMeta(path).index, false);
    }
    for (const path of ['/', '/menu', '/contact', '/policies']) {
      assert.equal(isPrivatePath(path), false, `${path} must be indexable`);
    }
  });

  test('a private screen still gets a readable tab title', () => {
    assert.equal(privateTitle('/order/HB-1042A'), 'Order tracking');
    assert.equal(privateTitle('/checkout'), 'Checkout');
    assert.equal(privateTitle('/alerts'), 'Order alerts');
    assert.equal(privateTitle('/menu'), '');
    assert.deepEqual(Object.keys(PRIVATE_TITLES).sort(), ['/alerts', '/checkout', '/order']);
  });

  test('a page nobody described says nothing rather than guessing', () => {
    const meta = pageMeta('/no-such-page');
    assert.equal(meta.index, false);
    assert.equal(meta.title, '');
    assert.equal(meta.description, '');
    assert.equal(normalisePath('/no-such-page/'), '/no-such-page');
    assert.equal(normalisePath(''), '/');
  });
});

/* ------------------------------------------------------------ sitemap/robots */

describe('sitemap.xml', () => {
  test('lists every indexable page, with absolute addresses', () => {
    const xml = sitemapXml(SITE, { lastmod: '2026-10-30' });
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    for (const path of Object.keys(PAGES)) {
      assert.ok(xml.includes(`<loc>${canonicalUrl(SITE, path)}</loc>`), `${path} is missing from the sitemap`);
    }
    /* Private routes are not pages a crawler should fetch. */
    assert.ok(!xml.includes('/checkout'));
    assert.ok(!xml.includes('/order'));
    assert.ok(!xml.includes('/alerts'));
    assert.ok(xml.includes('<lastmod>2026-10-30</lastmod>'));
  });

  test('no site address means no sitemap, rather than invented URLs', () => {
    assert.equal(sitemapXml(null), null);
    assert.equal(sitemapXml(''), null);
    assert.equal(sitemapXml('http://localhost:4000'), null);
  });

  test('the XML is well-formed enough to parse', () => {
    const xml = sitemapXml(SITE);
    /* Every <url> closes, and nothing is left dangling. */
    assert.equal((xml.match(/<url>/g) ?? []).length, (xml.match(/<\/url>/g) ?? []).length);
    assert.equal((xml.match(/<loc>/g) ?? []).length, Object.keys(PAGES).length);
    assert.ok(xml.trimEnd().endsWith('</urlset>'));
  });
});

describe('robots.txt', () => {
  test('welcomes crawlers, hides the private screens, and points at the sitemap', () => {
    const txt = robotsTxt(SITE);
    assert.match(txt, /^User-agent: \*$/m);
    assert.match(txt, /^Allow: \/$/m);
    assert.match(txt, /^Disallow: \/checkout$/m);
    assert.match(txt, /^Disallow: \/order\/$/m);
    assert.match(txt, /^Disallow: \/alerts$/m);
    assert.match(txt, new RegExp(`^Sitemap: ${SITE}/sitemap.xml$`, 'm'));
  });

  test('without an address the sitemap line is left out, so it never points off-site', () => {
    const txt = robotsTxt(null);
    assert.doesNotMatch(txt, /Sitemap:/);
    assert.match(txt, /^Disallow: \/checkout$/m);
  });
});

/* -------------------------------------------------------- structured data */

describe('structured data', () => {
  test('the restaurant describes only what is true', () => {
    const node = restaurantJsonLd(SITE, { phone: '+27670137587', email: 'heritagebitesfood@gmail.com', established: 2025 });
    assert.equal(node['@type'], 'Restaurant');
    assert.equal(node.name, 'Heritage Bites');
    assert.equal(node.telephone, '+27670137587');
    /* An array, so the schema can name the cuisine twice: the country and the
       tradition a searcher actually types. */
    assert.deepEqual(node.servesCuisine, ['South African', 'African', 'Traditional']);
    assert.equal(node.foundingDate, '2025');
    /* Two suburbs plus the metro they both sit in — never a place we do not serve. */
    assert.deepEqual(node.areaServed.map((a) => a.name), ['Rosebank', 'Sandton', 'Johannesburg']);
    assert.deepEqual(node.openingHoursSpecification[0].dayOfWeek, ['Thursday', 'Friday']);
    assert.equal(node.openingHoursSpecification[0].opens, '12:00');
    assert.equal(node.openingHoursSpecification[0].closes, '13:30');
    /* The business cooks in a hired kitchen: a street address would be invented. */
    assert.equal(node.address, undefined);
    assert.equal(node.hasMenu, `${SITE}/menu`);
  });

  test('the business settings in the catalogue win over the defaults', () => {
    const node = restaurantJsonLd(SITE, {
      phoneDisplay: '+27 11 000 1111',
      deliveryAreas: ['Rosebank'],
      serviceWindow: { open: '11:30', close: '14:00' },
    });
    assert.equal(node.telephone, '+27110001111');
    assert.deepEqual(node.areaServed.map((a) => a.name), ['Rosebank', 'Johannesburg']);
    assert.equal(node.openingHoursSpecification[0].opens, '11:30');
  });

  test('the FAQ answers speak for the kitchen in the customer\'s own questions', () => {
    /*
     * This is the one block that can win part of the search result itself, so
     * the answers have to be the same facts the checkout enforces: the radius,
     * the two cooking days, the plate prices and the payment methods.
     */
    const faq = faqJsonLd(SITE, { deliveryAreas: ['Rosebank', 'Sandton'], maxDeliveryKm: 15, minDeliveryOrder: 100, outsideFee: 30 });
    assert.equal(faq['@type'], 'FAQPage');
    const names = faq.mainEntity.map((q) => q.name);
    assert.ok(names.some((n) => /deliver/i.test(n)), 'no delivery question');
    assert.ok(names.some((n) => /days/i.test(n)), 'no cooking-day question');
    assert.ok(names.some((n) => /pay/i.test(n)), 'no payment question');
    const text = faq.mainEntity.map((q) => q.acceptedAnswer.text).join(' ');
    assert.match(text, /15 km/);
    assert.match(text, /Thursdays and Fridays/);
    assert.match(text, /R100/);
    /* No FAQ without an address: the node is built from it. */
    assert.equal(faqJsonLd(null, {}), null);
  });

  test('the home head carries the FAQ; no other page repeats it', () => {
    assert.match(headHtml('/', { siteUrl: SITE, settings: { minDeliveryOrder: 100 } }), /"@type":"FAQPage"/);
    assert.doesNotMatch(headHtml('/menu', { siteUrl: SITE, settings: { minDeliveryOrder: 100 } }), /FAQPage/);
  });

  test('the restaurant names the metro as well as the suburbs, and nothing further', () => {
    const node = restaurantJsonLd(SITE, { deliveryAreas: ['Rosebank', 'Sandton'] });
    const names = node.areaServed.map((a) => a.name);
    assert.ok(names.includes('Johannesburg'));
    /* A shop configured elsewhere must not inherit Johannesburg. */
    const pretoria = restaurantJsonLd(SITE, { deliveryAreas: ['Menlyn', 'Hatfield'] });
    assert.ok(!pretoria.areaServed.map((a) => a.name).includes('Johannesburg'));
  });

  test('the offer catalog prices both plates and states the minimum order', () => {
    const node = restaurantJsonLd(SITE, { minDeliveryOrder: 100 });
    const offers = node.hasOfferCatalog.itemListElement;
    assert.deepEqual(offers.map((o) => o.price), ['100.00', '130.00']);
    assert.equal(offers[0].priceCurrency, 'ZAR');
    assert.equal(offers[0].eligibleQuantity.minValue, 100);
    assert.equal(node.potentialAction.target, `${SITE}/checkout`);
    /* And the words a customer types are in there, without inventing a place. */
    assert.match(node.keywords, /mogodu/);
    assert.doesNotMatch(node.keywords, /Pretoria|Cape Town/);
  });

  test('the website node names the same publisher as the restaurant', () => {
    const site = websiteJsonLd(SITE);
    assert.equal(site['@id'], `${SITE}/#website`);
    assert.equal(site.publisher['@id'], `${SITE}/#restaurant`);
    assert.equal(site.inLanguage, 'en-ZA');
    assert.equal(websiteJsonLd(null), null);
  });

  test('the menu offers priced plates and skips anything that cannot be ordered', () => {
    const catalog = {
      settings: { currency: 'ZAR' },
      categories: [
        { id: 'traditional', name: 'Traditional Plates' },
        { id: 'contemporary', name: 'Contemporary Plates' },
      ],
      menu: [
        { id: 'mogodu-plate', name: 'Mogodu Plate', localName: 'Mogodu', category: 'traditional', price: 100, description: 'Beef tripe.', image: '/img/mogodu.jpg' },
        { id: 'wings-plate', name: 'Wings Plate', category: 'contemporary', price: 130, description: 'Sticky wings.' },
        /* Coming soon: no price, so no offer may be claimed. */
        { id: 'kota', name: 'Kota', category: 'contemporary', price: 0, comingSoon: true },
      ],
    };
    const node = menuJsonLd(SITE, catalog);
    const items = node.hasMenuSection.flatMap((s) => s.hasMenuItem);
    assert.deepEqual(items.map((i) => i.name), ['Mogodu Plate (Mogodu)', 'Wings Plate']);
    assert.equal(items[0].offers.price, '100.00');
    assert.equal(items[0].offers.priceCurrency, 'ZAR');
    assert.equal(items[0].image, `${SITE}/img/mogodu.jpg`);
    assert.deepEqual(node.hasMenuSection.map((s) => s.name), ['Traditional Plates', 'Contemporary Plates']);
  });

  test('no catalogue or no address means no menu node', () => {
    assert.equal(menuJsonLd(SITE, null), null);
    assert.equal(menuJsonLd(SITE, { menu: [] }), null);
    assert.equal(menuJsonLd(null, { menu: [{ name: 'Mogodu', price: 100 }] }), null);
  });

  test('JSON-LD cannot break out of its script block', () => {
    const markup = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    assert.ok(!markup.includes('</script>'));
    assert.ok(markup.includes('<\\/script>'));
  });
});

/* --------------------------------------------------------------- the head */

describe('the head served for a route', () => {
  test('carries that route title, description, canonical and open graph', () => {
    const html = headHtml('/menu', { siteUrl: SITE });
    assert.match(html, /<title>The Menu &amp; Prices — Heritage Bites<\/title>/);
    assert.match(html, /<meta name="description" content="The full Heritage Bites menu and prices/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/menu" />`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${SITE}/menu" />`));
    assert.match(html, new RegExp(`<meta property="og:image" content="${SITE}/img/social-card.jpg" />`));
    assert.match(html, /<meta property="og:image:width" content="1200" \/>/);
    assert.match(html, /<meta property="og:image:height" content="630" \/>/);
    assert.match(html, /<meta property="og:site_name" content="Heritage Bites" \/>/);
    assert.match(html, /<meta name="robots" content="index,follow/);
  });

  test('a private route is noindex, with no canonical to advertise', () => {
    const html = headHtml('/order/HB-1042A', { siteUrl: SITE });
    assert.match(html, /<meta name="robots" content="noindex,nofollow" \/>/);
    assert.match(html, /<title>Order tracking — Heritage Bites<\/title>/);
    assert.doesNotMatch(html, /rel="canonical"/);
    assert.doesNotMatch(html, /og:url/);
  });

  test('escapes anything a description might contain', () => {
    const html = headHtml('/menu', { siteUrl: SITE, description: 'Traditional & "contemporary" plates' });
    assert.match(html, /content="Traditional &amp; &quot;contemporary&quot; plates"/);
  });

  test('carries the restaurant and a breadcrumb, and the menu when given one', () => {
    const menu = menuJsonLd(SITE, { menu: [{ name: 'Mogodu Plate', price: 100 }] });
    const html = headHtml('/menu', { siteUrl: SITE, jsonLd: [menu] });
    assert.match(html, /"@type":"Restaurant"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.match(html, /"@type":"Menu"/);
    /* The home page is not its own breadcrumb. */
    assert.doesNotMatch(headHtml('/', { siteUrl: SITE }), /BreadcrumbList/);
  });

  test('without an address it makes no claim about where the site lives', () => {
    const html = headHtml('/menu', { siteUrl: null });
    assert.doesNotMatch(html, /rel="canonical"/);
    assert.doesNotMatch(html, /og:url/);
    assert.doesNotMatch(html, /application\/ld\+json/);
    /* But the title and description still describe the page. */
    assert.match(html, /<title>The Menu &amp; Prices — Heritage Bites<\/title>/);
  });
});
