/**
 * API client.
 *
 * Every call is relative ("/api/...") — in dev Vite proxies it to the Express
 * backend, and in production Express serves both from the same origin. The
 * browser never needs to know where the backend lives.
 *
 * Two deployment shapes are supported:
 *
 *   1. Same-origin (default): Express serves the built site *and* the API.
 *      `VITE_API_BASE` may point the browser at a different API host instead.
 *   2. Static preview (GitHub Pages): there is no server at all, so the build
 *      ships a read-only catalogue snapshot and every write is refused in the
 *      browser with an honest message rather than a stack of failed requests.
 *      `VITE_STATIC_PREVIEW=1` turns that on; it is never set for the real site.
 */
import type { Catalog, Order } from './types';

const env = import.meta.env ?? {};

/**
 * Where the built site is mounted.
 *
 *   - Express serves from the domain root: BASE_URL is "/".
 *   - GitHub Pages serves a project site from a sub-folder. The preview build is
 *     made with a *relative* base ("./") on purpose, so the same folder works
 *     whether Pages publishes it at /heritagebites/ or /heritagebites/web/ —
 *     including the case where the repository root is published and the built
 *     site sits one level down. With a relative base the mount point can only be
 *     worked out at runtime — from the bundle's own resolved URL.
 */
function runtimeBase(): string {
  /*
   * A root base ("/") is treated as "not configured" on purpose.
   *
   * GitHub Pages serves this site from a sub-path (/heritagebites/web/), and
   * Vite bakes whatever base it was built with into `import.meta.env.BASE_URL`.
   * Built with base "/", the value arrives as "/" — truthy, so this used to
   * return it immediately and never run the detection below. The consequence
   * was every asset resolving against the domain root:
   *
   *     /img/logo-badge.png        → the 404 page, so the logo was broken
   *     router basename "/"        → no route matched, so the app rendered its
   *                                  own 404 on the home page
   *
   * Falling through lets the bundle's own request URL answer the question,
   * which is correct on Express ("/") and on Pages ("/heritagebites/web/")
   * without the build needing to know which host it will land on.
   */
  const configured = String(env.BASE_URL ?? '');
  if (configured && configured !== './' && configured !== '.' && configured !== '/') return configured;
  if (typeof window === 'undefined') return '/';

  /*
   * The reliable answer comes from the bundle's own request URL. With a
   * relative base the shell says `./assets/index-abc.js`, and the browser
   * resolves that against the *document's* directory — so where the app is
   * actually mounted can be read straight back off the resolved script URL.
   * The route in the address bar is irrelevant, which matters on Pages: a deep
   * link like /heritagebites/web/quest has no trailing slash and would
   * otherwise look like a directory.
   */
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  if (script?.src) {
    try {
      const { pathname } = new URL(script.src);
      const cut = pathname.indexOf('/assets/');
      if (cut >= 0) return `${pathname.slice(0, cut)}/`;
    } catch {
      /* fall through to the path-based guess */
    }
  }

  /*
   * Last resort.
   *
   * Only reached when neither a configured base nor a script URL answered.
   * Deciding the mount point from `location.pathname` here was a trap: on a
   * deep link such as /menu the pathname is the ROUTE, and treating it as a
   * base made basename "/menu" — the router then stripped "/menu" from every
   * URL and matched nothing, which is the 404 this was meant to prevent.
   *
   * The honest signal is whether this document actually loads from /assets/.
   * If it does, the site is mounted at the directory holding that folder, and
   * the pathname really is a directory. If it does not — Express serving the
   * built index from any route — the mount point is the domain root.
   */
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
  const ours = scripts.find((el) => el.src.includes('/assets/'));
  if (ours) {
    const { pathname } = new URL(ours.src);
    const cut = pathname.indexOf('/assets/');
    if (cut >= 0) return `${pathname.slice(0, cut)}/`;
  }
  return '/';
}

export const BASE_URL: string = runtimeBase();

/** Optional absolute API origin, e.g. https://api.heritagebites.co.za. */
const API_ORIGIN: string = String(env.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** True only for the static GitHub Pages build. */
export const STATIC_PREVIEW: boolean = String(env.VITE_STATIC_PREVIEW ?? '') === '1';

/**
 * In a preview the site still needs the catalogue to look like itself. It is
 * exported read-only at build time (`npm run build:pages`) and served as a
 * plain file next to the app.
 */
const STATIC_CATALOG = `${BASE_URL.replace(/\/$/, '')}/api/catalog.json`;

export const PREVIEW_NOTICE =
  'This is a preview of the Heritage Bites site, so ordering and payments are switched off. ' +
  'Please call or WhatsApp us on +27 67 013 7587 and we will take it from there.';

/**
 * What an enquiry says when there is nowhere to send it.
 *
 * An enquiry is different from an order: it does not need the Heritage Bites
 * server, only an inbox. So on the static build the contact form and the
 * customer quest post straight to the business's Formspree endpoint — the same
 * one the server forwards to — and a submission is really delivered instead of
 * being refused. This is the message for the case where even that is missing.
 */
export const NO_INBOX_NOTICE =
  'We could not send that message from this preview. Please call or WhatsApp us on +27 67 013 7587 and we will take it from there.';

/**
 * The business's inbox, compiled into the bundle.
 *
 * The endpoint normally arrives with the catalogue (`settings.contactFormspreeUrl`),
 * but that is a network fetch: if it is slow, blocked, or the snapshot is stale, the
 * contact form would refuse a message the inbox could have accepted. An enquiry is
 * the one thing on this site that must never depend on something else loading first,
 * so the address is also a build-time constant. `VITE_CONTACT_FORMSPREE_URL` overrides
 * it; the catalogue still wins when it declares a different endpoint.
 */
const FORMSPREE_URL: string = String(env.VITE_CONTACT_FORMSPREE_URL ?? '').trim();
export const DEFAULT_INBOX_ENDPOINT = FORMSPREE_URL || 'https://formspree.io/f/xvkkkwve';

/** Prefer a declared endpoint, but never end up with no inbox at all. */
const inboxEndpoint = (declared?: string) => String(declared ?? '').trim() || DEFAULT_INBOX_ENDPOINT;

/** Public paths stay relative; `/api` calls can be pointed at another origin. */
const resolve = (path: string) => (path.startsWith('/api') ? `${API_ORIGIN}${path}` : path);

export class ApiError extends Error {
  status: number;
  errors: string[];
  code?: string;
  requiresAction?: boolean;
  redirectUrl?: string;

  constructor(status: number, message: string, errors: string[] = [], extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors.length ? errors : [message];
    this.code = extra.code as string | undefined;
    this.requiresAction = extra.requiresAction as boolean | undefined;
    this.redirectUrl = extra.redirectUrl as string | undefined;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  /*
   * Nothing on a static build can be saved, charged or tracked: there is no
   * server to do it. Failing here — with an explanation and the WhatsApp number
   * — is better than a silent 404, and better than pretending a quest or an
   * order was recorded.
   */
  if (STATIC_PREVIEW && (init.method ?? 'GET').toUpperCase() !== 'GET') {
    throw new ApiError(503, PREVIEW_NOTICE, [PREVIEW_NOTICE], { preview: true });
  }

  let res: Response;
  try {
    res = await fetch(resolve(path), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, 'We could not reach the Heritage Bites kitchen. Please check your connection and try again.');
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const body = (data ?? {}) as Record<string, unknown>;
    const errors = Array.isArray(body.errors) ? (body.errors as string[]) : [];
    const message = errors[0] || (typeof body.error === 'string' ? body.error : `Request failed (${res.status})`);
    throw new ApiError(res.status, message, errors, body);
  }

  return data as T;
}

/* --------------------------- Direct enquiries ------------------------- */

/**
 * Post an enquiry straight to the monitored inbox from the browser.
 *
 * Used only by the static build, where there is no server to forward through.
 * Formspree is designed for exactly this: a public form endpoint that accepts a
 * cross-origin JSON post and emails the result. `Accept: application/json` asks
 * for a JSON reply instead of a redirect to a thank-you page.
 *
 * The payload is shaped like the server's own forwardContact/forwardQuest, so
 * an enquiry reads the same in the inbox whichever build the customer used.
 */
async function postToInbox(
  endpoint: string | undefined,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; id: string; delivered: boolean }> {
  const url = String(endpoint ?? '').trim();
  if (!url) throw new ApiError(503, NO_INBOX_NOTICE, [NO_INBOX_NOTICE], { preview: true });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, NO_INBOX_NOTICE, [NO_INBOX_NOTICE], { preview: true });
  }

  if (!res.ok) {
    throw new ApiError(res.status, NO_INBOX_NOTICE, [NO_INBOX_NOTICE], { preview: true });
  }
  return { ok: true, id: `enquiry_${Date.now().toString(36)}`, delivered: true };
}

/* ------------------------------ Public -------------------------------- */

export const api = {
  catalog: () => request<Catalog>(STATIC_PREVIEW ? STATIC_CATALOG : '/api/catalog'),

  search: (q: string) =>
    request<{ results: { id: string; name: string; localName: string; price: number; image: string; category: string; available: boolean }[]; q: string }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),

  /**
   * Server-authoritative quote. The client shows live totals, but this is what
   * actually gets charged — the server re-prices every line from its own menu.
   */
  quote: (payload: { items: unknown[]; fulfilment: string }) =>
    request<{
      lines: { itemId: string; name: string; unitPrice: number; qty: number; options: { label: string }[]; lineTotal: number }[];
      totals: { subtotal: number; delivery: number; discount: number; total: number; currency: string };
    }>('/api/quote', { method: 'POST', body: JSON.stringify(payload) }),

  /**
   * Create the order. For an online order the response also carries the Yoco
   * payment page to send the customer to — the server only includes it when a
   * payment destination is actually configured.
   */
  placeOrder: (payload: unknown) =>
    request<{
      order: Order;
      loyalty: unknown;
      trackingToken: string;
      payment?: { provider: string; redirectUrl: string };
    }>('/api/orders', { method: 'POST', body: JSON.stringify(payload) }),

  trackOrder: (code: string, token: string) => request<{ order: Order }>(`/api/orders/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`),

  cancelOrder: (code: string, token: string) => request<{ order: Order }>(`/api/orders/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: JSON.stringify({ token }) }),

  passport: (phone: string) =>
    request<{
      found: boolean;
      name?: string;
      stamps: number;
      orders: number;
      lifetime?: number;
      untilFree?: number;
      cardsCompleted?: number;
    }>('/api/passport', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  /**
   * A contact enquiry. On the static build this goes straight to the monitored
   * inbox so the form really submits instead of being refused for want of a
   * server. The declared endpoint wins; otherwise the one compiled into the
   * bundle is used, so a failed catalogue fetch cannot strand a message.
   */
  contact: (payload: unknown, endpoint?: string) => {
    const entry = (payload ?? {}) as Record<string, string>;
    if (STATIC_PREVIEW) {
      return postToInbox(inboxEndpoint(endpoint), {
        name: entry.name ?? '',
        phone: entry.phone ?? '',
        email: entry.email ?? '',
        subject: entry.subject ?? 'General enquiry',
        message: entry.message ?? '',
        _subject: `Heritage Bites website enquiry — ${entry.subject ?? 'General enquiry'}`,
        source: 'heritagebites.co.za/contact',
      });
    }
    return request<{ ok: boolean; id: string; delivered: boolean }>('/api/contact', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** A customer quest: a request for a dish, not an order. */
  quest: (payload: unknown, endpoint?: string) => {
    const entry = (payload ?? {}) as Record<string, string | number>;
    if (STATIC_PREVIEW) {
      const day = entry.serviceDay === 'either' || !entry.serviceDay ? 'Thursday or Friday' : String(entry.serviceDay);
      const summary = [
        `Meal requested: ${entry.dish ?? ''}`,
        `Service day asked for: ${day}`,
        `Plates: ${entry.plates ?? 1}`,
        entry.notes ? `Notes: ${entry.notes}` : '',
        `Reply to: ${entry.name ?? ''} · ${entry.phone ?? ''}${entry.email ? ` · ${entry.email}` : ''}`,
      ]
        .filter(Boolean)
        .join('\n');

      return postToInbox(inboxEndpoint(endpoint), {
        name: entry.name ?? '',
        phone: entry.phone ?? '',
        email: entry.email ?? '',
        subject: `Meal quest — ${entry.dish ?? ''}`.slice(0, 120),
        message: summary,
        _subject: `Heritage Bites meal quest — ${entry.name ?? ''}`.slice(0, 120),
        source: 'heritagebites.co.za/quest',
      });
    }
    return request<{ ok: boolean; id: string; delivered: boolean }>('/api/quests', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  health: () => request<{ ok: boolean; paymentDriver: string; orders: number }>('/api/health'),

};
