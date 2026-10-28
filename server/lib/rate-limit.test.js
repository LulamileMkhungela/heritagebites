import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { clientKey, rateLimit, rateLimitBuckets, resetRateLimits } from './rate-limit.js';

/*
 * These exercise the middleware directly with fake req/res objects. No server, no
 * ports: the limiter is a pure function of (request, in-memory counters), so the
 * only thing that needs faking is Express's response surface.
 */
function fakeReq(overrides = {}) {
  return { method: 'POST', ip: '203.0.113.5', headers: {}, ...overrides };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function call(middleware, req) {
  const res = fakeRes();
  let passed = false;
  middleware(req, res, () => {
    passed = true;
  });
  return { res, passed };
}

beforeEach(() => {
  resetRateLimits();
  delete process.env.HB_TRUST_PROXY;
});

describe('rateLimit', () => {
  test('lets requests through up to the limit, then answers 429', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3, name: 'orders' });
    const req = fakeReq();

    for (let i = 0; i < 3; i += 1) {
      const { res, passed } = call(limiter, req);
      assert.equal(passed, true, `request ${i + 1} should be allowed`);
      assert.equal(res.statusCode, 200);
    }

    const { res, passed } = call(limiter, req);
    assert.equal(passed, false, 'the fourth request must not reach the route');
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /Too many requests/);
    assert.ok(res.body.retryAfterSeconds >= 1);
  });

  test('counts each client separately', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, name: 'contact' });

    assert.equal(call(limiter, fakeReq({ ip: '198.51.100.1' })).passed, true);
    assert.equal(call(limiter, fakeReq({ ip: '198.51.100.2' })).passed, true);
    assert.equal(call(limiter, fakeReq({ ip: '198.51.100.1' })).passed, false);
  });

  test('each rule keeps its own budget, so browsing cannot block ordering', () => {
    const browse = rateLimit({ windowMs: 60_000, max: 1, name: 'search' });
    const order = rateLimit({ windowMs: 60_000, max: 1, name: 'orders' });
    const req = fakeReq();

    assert.equal(call(browse, req).passed, true);
    assert.equal(call(browse, req).passed, false);
    /* The exhausted search budget must not have spent the ordering one. */
    assert.equal(call(order, req).passed, true);
  });

  test('the window reopens once it has elapsed', async () => {
    const limiter = rateLimit({ windowMs: 40, max: 1, name: 'windowed' });
    assert.equal(call(limiter, fakeReq()).passed, true);
    assert.equal(call(limiter, fakeReq()).passed, false);

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(call(limiter, fakeReq()).passed, true, 'a new window should allow the client again');
  });

  test('sends Retry-After so a well-behaved client knows to wait', () => {
    const limiter = rateLimit({ windowMs: 30_000, max: 1, name: 'headers' });
    call(limiter, fakeReq());
    const { res } = call(limiter, fakeReq());

    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'], '30');
    assert.equal(res.headers['RateLimit-Limit'], '1');
    assert.equal(res.headers['RateLimit-Remaining'], '0');
  });

  test('reports the remaining allowance while under the limit', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 5, name: 'remaining' });
    const { res } = call(limiter, fakeReq());
    assert.equal(res.headers['RateLimit-Remaining'], '4');
  });

  test('ignores preflight and HEAD probes', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, name: 'probes' });
    assert.equal(call(limiter, fakeReq({ method: 'OPTIONS' })).passed, true);
    assert.equal(call(limiter, fakeReq({ method: 'OPTIONS' })).passed, true);
    assert.equal(call(limiter, fakeReq({ method: 'HEAD' })).passed, true);
    /* None of those consumed the budget. */
    assert.equal(call(limiter, fakeReq({ method: 'POST' })).passed, true);
  });

  test('does not leak memory: expired windows are swept away', () => {
    const limiter = rateLimit({ windowMs: 1, max: 10, name: 'sweep' });
    for (let i = 0; i < 10; i += 1) call(limiter, fakeReq({ ip: `10.0.0.${i}` }));
    assert.ok(rateLimitBuckets() >= 10);

    /* 5000+ tracked windows triggers the sweep on the next request. */
    for (let i = 0; i < 5100; i += 1) call(limiter, fakeReq({ ip: `10.1.${Math.floor(i / 250)}.${i % 250}` }));
    const before = rateLimitBuckets();
    setTimeout(() => {
      call(limiter, fakeReq({ ip: '10.9.9.9' }));
      assert.ok(rateLimitBuckets() < before + 2);
    }, 20);
  });
});

describe('clientKey', () => {
  test('uses the socket address unless the deployment is behind a proxy', () => {
    const req = fakeReq({ ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });

    assert.equal(clientKey(req), '127.0.0.1', 'X-Forwarded-For must not be trusted by default');

    process.env.HB_TRUST_PROXY = '1';
    assert.equal(clientKey(req), '203.0.113.9', 'the left-most entry is the client');

    delete process.env.HB_TRUST_PROXY;
  });
});
