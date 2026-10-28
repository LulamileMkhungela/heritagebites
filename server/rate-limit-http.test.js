/**
 * Rate limiting, over real HTTP.
 *
 * The unit tests in server/lib/rate-limit.test.js pin the counting rules; this
 * file proves the middleware is actually mounted on the routes and that a client
 * which ignores the 429 is stopped at the door rather than reaching the handler.
 *
 * It runs in its own process with its own tight multiplier, so it cannot spend
 * the allowance of any other test file — node --test isolates modules per file.
 */
import { test, after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
const TMP = mkdtempSync(join(tmpdir(), 'hb-limit-test-'));
process.env.HB_DATA_DIR = TMP;

/*
 * A tenth of the production allowance: the catalogue drops from 180 a minute to
 * 18, so this test needs a handful of requests instead of a hundred and eighty.
 * The limiter stays switched on, which is the point.
 */
process.env.HB_RATE_LIMIT_MULTIPLIER = '0.1';

const { app } = await import('./index.js');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
  rmSync(TMP, { recursive: true, force: true });
});

describe('rate limiting over HTTP', () => {
  test('a client that keeps going gets 429 with Retry-After, not a crash', async () => {
    const limit = Number((await fetch(`${base}/api/catalog`).then((r) => r.headers.get('RateLimit-Limit'))));
    /* The catalogue allows 180 a minute; the multiplier is 0.1. */
    assert.equal(limit, 18, 'a tenth of 180 a minute');

    let blocked = null;
    for (let i = 0; i < limit + 2; i += 1) {
      const res = await fetch(`${base}/api/catalog`);
      if (res.status === 429) {
        blocked = res;
        break;
      }
    }

    assert.ok(blocked, 'the limiter must eventually refuse the request');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) >= 1, 'the client is told how long to wait');
    assert.equal(blocked.headers.get('RateLimit-Remaining'), '0');

    const body = await blocked.json();
    assert.match(body.error, /Too many requests/);
    assert.ok(body.retryAfterSeconds >= 1);
  });

  test('the health endpoint is never limited — an uptime monitor must always get an answer', async () => {
    const statuses = [];
    for (let i = 0; i < 15; i += 1) {
      statuses.push((await fetch(`${base}/api/health`)).status);
    }
    assert.deepEqual(new Set(statuses), new Set([200]), 'every health check answered 200');
  });
});
