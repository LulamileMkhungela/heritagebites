import { useEffect } from 'react';
import { BASE_URL } from './api';
import { useCatalog } from '../store/catalog';
import {
  BRAND,
  DEFAULT_SHARE_IMAGE,
  LOCALE,
  SHARE_IMAGE_ALT,
  SHARE_IMAGE_META,
  breadcrumbJsonLd,
  canonicalUrl,
  documentTitle,
  jsonLdScript,
  normaliseSiteUrl,
  pageMeta,
  privateTitle,
  restaurantJsonLd,
  websiteJsonLd,
} from '../../shared/seo.js';

/**
 * Per-page search metadata, set from the route table in `shared/seo.js`.
 *
 * A single-page app ships one `<title>` and one description in `index.html` and
 * — left alone — every route is indexed under the home page's summary. So each
 * page states its own title, description, canonical address and structured data
 * as it mounts, from the same table the server and the static build use.
 *
 * Three things are deliberate:
 *
 *   1. **The canonical is self-referential.** It is built from the address the
 *      page is actually being served from (`VITE_SITE_URL` when the build knows
 *      it, otherwise the browser's own origin), never from a domain typed into
 *      the source. A canonical pointing at a site this app is not served from
 *      tells Google these pages are duplicates of somebody else's.
 *   2. **Private screens are `noindex`.** The checkout, an order's tracking page
 *      and the owner's alerts have nothing to show a searcher.
 *   3. **Nothing is claimed that the page does not show.** The structured data is
 *      built from the same catalogue the customer is looking at.
 *
 * The tags live under `data-hb-seo` and are updated in place, so navigating
 * between routes replaces them instead of leaving a pile of stale ones.
 */

export interface PageSeoOptions {
  /** Overrides the route table's title (dynamic pages: an order code, a dish). */
  title?: string;
  description?: string;
  /** `false` keeps the page out of search results. Defaults to the route table. */
  index?: boolean;
  /** Extra schema.org nodes for this page, e.g. a Menu built from the catalogue. */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown> | null> | null;
  image?: string;
}

/**
 * Where this build is served from.
 *
 * `VITE_SITE_URL` is baked in by `scripts/build-seo.mjs` when the deployment
 * address is known. Without it the browser's own origin is the only truthful
 * answer, including on a preview host — a self-canonical is correct wherever the
 * page happens to be.
 */
export function resolveSiteUrl(): string | null {
  const env = (import.meta as { env?: Record<string, string> }).env;
  const configured = normaliseSiteUrl(env?.VITE_SITE_URL);
  if (configured) return configured;

  if (typeof window === 'undefined' || !window.location?.origin) return null;
  try {
    /* `BASE_URL` is where the app is mounted (/ on Express, ./web/ on Pages). */
    const base = new URL(BASE_URL || '/', window.location.href);
    /*
     * Run it through the same check the build and the server use, so a canonical
     * is never written for `localhost`: a dev machine and a preview host are not
     * addresses a search engine should be told about.
     */
    return normaliseSiteUrl(`${base.origin}${base.pathname}`);
  } catch {
    return normaliseSiteUrl(window.location.origin);
  }
}

/**
 * The site's own address, for callers that build structured data themselves
 * (the menu, which reads the catalogue).
 */
export function currentSiteUrl(): string | null {
  return resolveSiteUrl();
}

/** Find or create a tag in <head>, so each page updates rather than duplicates. */
function tag<T extends Element>(selector: string, create: () => T): T | null {
  const existing = document.head.querySelector<T>(selector);
  if (existing) return existing;
  if (!document.head) return null;
  const element = create();
  element.setAttribute('data-hb-seo', '');
  document.head.appendChild(element);
  return element;
}

function setMeta(attribute: 'name' | 'property', key: string, content: string | null) {
  const selector = `meta[${attribute}="${key}"]`;
  if (content === null) {
    /*
     * Only take away a tag this hook wrote. A server-rendered canonical or
     * og:url knows the deployment's address even when the browser cannot work it
     * out (a proxy, a preview host, plain http on a LAN), and deleting it would
     * be worse than leaving it.
     */
    const existing = document.head.querySelector(selector);
    if (existing?.hasAttribute('data-hb-seo')) existing.remove();
    return;
  }
  const element = tag(selector, () => {
    const meta = document.createElement('meta');
    meta.setAttribute(attribute, key);
    return meta;
  });
  element?.setAttribute('content', content);
}

/**
 * Apply a page's search metadata.
 *
 * @param path   the route (`/menu`), or a pattern for a dynamic route
 * @param options overrides for pages the route table cannot describe on its own
 */
export function usePageSeo(path: string, options: PageSeoOptions = {}) {
  const { title, description, index, jsonLd, image } = options;
  /*
   * The business details in the structured data come from the same catalogue the
   * page is showing (phone, email, delivery areas, service window). Read here
   * rather than passed in, so no page can describe the shop differently.
   */
  const settings = useCatalog((s) => s.data?.settings);
  /*
   * The extra nodes and the settings are built inline by the pages, so they are
   * new objects on every render. Comparing them by value keeps the effect from
   * rewriting the head on every keystroke in a form.
   */
  const jsonLdKey = JSON.stringify(jsonLd ?? null);
  const settingsKey = JSON.stringify(settings ?? null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const meta = pageMeta(path);
    const indexable = index ?? meta.index;
    /* A private screen still needs a sensible tab title ("Order tracking"). */
    const ownTitle = title ?? (meta.title || privateTitle(path));
    const ownDescription = description ?? meta.description;
    const siteUrl = resolveSiteUrl();

    document.title = documentTitle(ownTitle);

    setMeta('name', 'description', ownDescription || null);
    setMeta('name', 'robots', indexable ? 'index,follow,max-image-preview:large' : 'noindex,nofollow');

    /* No canonical on a page that is deliberately out of the index. */
    const canonical = siteUrl && indexable ? canonicalUrl(siteUrl, path) : null;
    const canonicalTag = canonical ? tag('link[rel="canonical"]', () => {
      const link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      return link;
    }) : null;
    if (canonicalTag && canonical) canonicalTag.setAttribute('href', canonical);
    if (!canonical) {
      /* Leave a canonical the server wrote; remove only our own stale one. */
      const existing = document.head.querySelector('link[rel="canonical"]');
      if (existing?.hasAttribute('data-hb-seo')) existing.remove();
    }

    /* How the link looks when it is pasted into WhatsApp or Facebook. */
    setMeta('property', 'og:site_name', BRAND);
    setMeta('property', 'og:locale', LOCALE);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:title', documentTitle(ownTitle));
    setMeta('property', 'og:description', ownDescription || null);
    setMeta('property', 'og:url', canonical);
    /* The share card, with the size a scraper needs to render it correctly. */
    const shareImage = siteUrl ? `${siteUrl}${image ?? DEFAULT_SHARE_IMAGE}` : null;
    setMeta('property', 'og:image', shareImage);
    setMeta('property', 'og:image:type', shareImage ? SHARE_IMAGE_META.type : null);
    setMeta('property', 'og:image:width', shareImage ? String(SHARE_IMAGE_META.width) : null);
    setMeta('property', 'og:image:height', shareImage ? String(SHARE_IMAGE_META.height) : null);
    setMeta('property', 'og:image:alt', shareImage ? SHARE_IMAGE_ALT : null);
    /* Twitter/X does not read the og: tags for images. */
    setMeta('name', 'twitter:image', shareImage);
    setMeta('name', 'twitter:image:alt', shareImage ? SHARE_IMAGE_ALT : null);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', documentTitle(ownTitle));
    setMeta('name', 'twitter:description', ownDescription || null);

    /*
     * Structured data, as one @graph: the shop, the site, this page's place in
     * the hierarchy, and whatever the page adds (the menu, for /menu).
     */
    const nodes: Array<Record<string, unknown> | null> = [];
    if (siteUrl) {
      nodes.push(restaurantJsonLd(siteUrl, settings ?? {}), websiteJsonLd(siteUrl));
      if (path !== '/') nodes.push(breadcrumbJsonLd(siteUrl, path, ownTitle));
    }
    for (const extra of Array.isArray(jsonLd) ? jsonLd : [jsonLd]) if (extra) nodes.push(extra);

    const graph = nodes.filter(Boolean);
    const existing = document.head.querySelector<HTMLScriptElement>('script[data-hb-seo-jsonld]');
    if (!graph.length) {
      existing?.remove();
      return;
    }
    const script = existing ?? document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-hb-seo-jsonld', '');
    script.textContent = jsonLdScript({ '@context': 'https://schema.org', '@graph': graph });
    if (!existing) document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, title, description, index, image, jsonLdKey, settingsKey]);
}
