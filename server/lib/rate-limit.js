/**
 * Small in-process rate limiter.
 *
 * Why hand-rolled: the whole app is a single Node process with a JSON store, so
 * a fixed-window counter in a Map is the right size of tool. It costs nothing,
 * adds no dependency, and is honest about its limits — see the caveat below.
 *
 * What it is defending against is the cheap, real abuse: someone scripting
 * thousands of orders (the store is a JSON file, so that is disk exhaustion, not
 * just noise), enumerating phone numbers against the loyalty lookup, or using the
 * contact/quest forms to relay spam to the business inbox. It is not defending
 * against a determined attacker; HTTPS, a proxy and monitoring are for that.
 *
 * Caveat, stated plainly because it matters: counters live in memory, so a
 * restart forgets them, and if the app ever runs as more than one process each
 * process keeps its own. That is fine for one small restaurant on one server, and
 * it is why the limits are generous enough to never bother a real customer.
 */

/** @typedef {{ windowMs: number, max: number, name: string }} Rule */

const buckets = new Map();

/**
 * A client identity for rate limiting.
 *
 * Behind a host's reverse proxy every request arrives from 127.0.0.1, so the real
 * client is in X-Forwarded-For — but trusting that header by default would let
 * anyone bypass every limit by inventing an address. So it is only read when the
 * deployment says it is behind a proxy (HB_TRUST_PROXY=1), matching how Express's
 * own `trust proxy` setting is configured in server/index.js.
 */
export function clientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (process.env.HB_TRUST_PROXY === '1' && typeof forwarded === 'string' && forwarded) {
    /* The left-most entry is the client; the rest are proxies that appended to it. */
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/** Drop windows that have expired so the map cannot grow without bound. */
function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Build an Express middleware enforcing one rule.
 *
 * `key` defaults to clientKey, but callers may narrow it (for example to include
 * the route), because a shared counter across every endpoint would let a busy
 * menu page exhaust the allowance for placing an order.
 */
export function rateLimit({ windowMs, max, name = 'default', key = clientKey }) {
  return function rateLimitMiddleware(req, res, next) {
    /*
     * CORS preflights and HEAD probes are not work; counting them would penalise
     * a legitimate browser that is only asking permission.
     */
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();

    const now = Date.now();
    if (buckets.size > 5000) sweep(now);

    const allowance = typeof max === 'function' ? max() : max;
    const id = `${name}:${key(req)}`;
    let bucket = buckets.get(id);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(id, bucket);
    }

    bucket.count += 1;

    if (bucket.count > allowance) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.set('RateLimit-Limit', String(allowance));
      res.set('RateLimit-Remaining', '0');
      res.set('RateLimit-Reset', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
        retryAfterSeconds: retryAfter,
      });
    }

    res.set('RateLimit-Limit', String(allowance));
    res.set('RateLimit-Remaining', String(Math.max(0, allowance - bucket.count)));
    return next();
  };
}

/**
 * A limit that can be raised across the whole app from one place.
 *
 * The test suite is one client on one address and places far more orders in a
 * minute than any real customer would, so it multiplies every allowance rather
 * than switching the limiter off — the wiring stays under test, only the numbers
 * change. Anything that is not a positive number leaves the limit at its default,
 * because a typo in an env var must not disable abuse protection by accident.
 */
export function scaledMax(base) {
  return () => {
    const raw = Number(process.env.HB_RATE_LIMIT_MULTIPLIER);
    const factor = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return Math.max(1, Math.round(base * factor));
  };
}

/** Test helper: forget every counter, as a restart would. */
export function resetRateLimits() {
  buckets.clear();
}

/** Test helper: how many windows are currently tracked. */
export function rateLimitBuckets() {
  return buckets.size;
}
