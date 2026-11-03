/**
 * The owner's details: what they mean, and what is wrong with them.
 *
 * The failures this guards against are all silent. A blank HB_PUBLIC_URL and an
 * App Password with a space in it both look configured from the outside, and
 * both end with a paying customer and a kitchen that never hears about them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notificationSetup, PLACEHOLDER_ORIGIN } from './notification-setup.js';

const ROOT = new URL('../../', import.meta.url).pathname;

/**
 * Every HB_ variable the notification path reads — taken from the source, not
 * from a list somebody remembered to update.
 *
 * A hand-written list is how this test would have passed while missing a
 * variable: add `HB_SMTP_TIMEOUT` to the code and the old assertion would still
 * be green. This reads the server sources and takes the names from there.
 *
 * `HB_CUSTOMER_SMTP_` and `HB_SMTP_` are the prefixes built by `readSmtp()`, so
 * they are expanded to the five settings each really reads.
 */
const PREFIX_SETTINGS = ['HOST', 'PORT', 'SECURE', 'USER', 'PASS', 'FROM'];

function notificationVarsFromSource() {
  /*
   * Only environments reads, not every mention.
   *
   * The first version of this scanned for `HB_[A-Z_]+` anywhere, which picked up
   * names out of log messages and comments — `"HB_VAPID_* are not a valid key
   * pair"` produced a variable called `HB_VAPID_`. A test that invents its own
   * findings teaches you to ignore it.
   */
  /*
   * Exactly the notification surface: the modules that decide who is told about
   * an order, and the two scripts that report on it. Scanning the whole server
   * dragged in HOSTNAME and NODE_ENV from the screenshot tooling, which is noise
   * in a list whose job is to be trusted.
   */
  const sources = [
    join(ROOT, 'server', 'lib', 'order-notifications.js'),
    join(ROOT, 'server', 'lib', 'web-push.js'),
    join(ROOT, 'server', 'lib', 'notification-setup.js'),
    join(ROOT, 'scripts', 'notification-check.mjs'),
    join(ROOT, 'scripts', 'check-notification-setup.mjs'),
  ];

  const names = new Set();
  for (const file of sources) {
    const code = readFileSync(file, 'utf8');
    /* process.env.HB_X and process.env['HB_X'] */
    for (const match of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1]);
    for (const match of code.matchAll(/process\.env\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\]/g)) names.add(match[1]);

    /* Prefixes: readSmtp('HB_SMTP_') reads HOST, PORT, SECURE, USER, PASS, FROM. */
    for (const match of code.matchAll(/readSmtp\(\s*['"]([A-Z][A-Z0-9_]+_)['"]\s*\)/g)) {
      for (const suffix of PREFIX_SETTINGS) names.add(`${match[1]}${suffix}`);
    }
  }
  return [...names].sort();
}

const NOTIFICATION_VARS = notificationVarsFromSource();

/**
 * Names that surface in the scan but are not the owner's notification duty.
 *
 * Listed one by one, with a reason, rather than hidden behind a pattern — so the
 * next person can see this was considered, not forgotten.
 */
const NOT_AN_OWNER_SETTING = {
  NODE_ENV: "Node's own mode, set by the host",
  SMOKE_BASE: 'test alias for HB_BASE, never used in production',
};

/**
 * Settings the template may mention that the scan cannot see: they are read
 * outside the notification modules.
 */
const MENTIONED_ELSEWHERE = {
  HB_BASE: 'a command-line example (`HB_BASE=https://… npm run notify:check`)',
  HB_CONTACT_FORMSPREE_URL: 'the contact-form inbox, read by server/index.js',
};

/**
 * Run with exactly these settings; everything else is neutralised.
 *
 * Without the clearing step a developer's own `.env` leaks into the test run and
 * the results depend on whose laptop it is. dotenv loads that file into
 * `process.env` for the server, so the tests must clear the same names.
 */
async function withEnv(vars, fn) {
  const saved = {};
  for (const key of NOTIFICATION_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const SMTP = {
  HB_SMTP_HOST: 'smtp.example.test',
  HB_SMTP_PORT: '465',
  HB_SMTP_USER: 'kitchen@example.test',
  HB_SMTP_PASS: 'abcd efgh ijkl mnop',
  HB_SMTP_FROM: 'kitchen@example.test',
  HB_ORDER_ALERT_EMAIL: 'owner@example.test',
};

const VAPID = {
  HB_VAPID_PUBLIC_KEY: 'BFL1umscqQ4vsjNVpaxn-VzU96JyyIY_ZQOuCSgrrxUdHPNhPZK57gakhlpTq89oDnUkqP0-5_uPlW2i6QN601I',
  HB_VAPID_PRIVATE_KEY: 'ROjzAUzVn0nhRB53BXgOV0Ar-u6QeCUpjK1BfXwmucU',
  HB_VAPID_SUBJECT: 'mailto:kitchen@example.test',
  HB_OWNER_PUSH_KEY: 'a-long-enough-owner-key-1234',
};

const codes = (setup) => setup.issues.map((issue) => issue.code);
const find = (setup, code) => setup.issues.find((issue) => issue.code === code);

describe('a complete setup', () => {
  test('is ready, and says where the ticket goes and what receipts link to', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'https://shop.example.test' }, () => {
      const setup = notificationSetup();
      assert.equal(setup.ready, true, `unexpected issues: ${JSON.stringify(setup.issues)}`);
      /*
       * Nothing to fix, but one thing worth saying: receipts ride the kitchen's
       * own account, which lands in spam more often. A warning must not make the
       * setup "not ready" — mail still goes out.
       */
      assert.deepEqual(setup.issues.map((i) => i.severity), ['warn']);
      assert.equal(setup.issues[0].code, 'shared-sender');
      assert.equal(setup.kitchenEmail.to, 'owner@example.test');
      assert.equal(setup.kitchenEmail.host, 'smtp.example.test');
      assert.equal(setup.origin, 'https://shop.example.test');
      assert.equal(setup.originIsPlaceholder, false);
    });
  });

  test('spaces inside a pasted Gmail App Password are removed, not sent to the server', async () => {
    /*
     * Google displays App Passwords as "abcd efgh ijkl mnop". Pasting all four
     * groups is the obvious thing to do, and a password with spaces fails
     * authentication with a message that never mentions them.
     */
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'https://shop.example.test' }, async () => {
      const { emailConfig } = await import('./order-notifications.js');
      assert.equal(emailConfig().pass, 'abcdefghijklmnop');
    });
  });
});

describe('the tracking link inside a receipt', () => {
  test('an unset HB_PUBLIC_URL is an error, because the fallback is another restaurant', async () => {
    await withEnv({ ...SMTP }, () => {
      const setup = notificationSetup();
      const issue = find(setup, 'public-url');
      assert.ok(issue, 'the placeholder origin must be reported');
      assert.equal(issue.severity, 'error');
      /* The message must name the trap, not just say "invalid". */
      assert.match(issue.message, /DIFFERENT restaurant/);
      assert.equal(setup.originIsPlaceholder, true);
      assert.equal(setup.origin, PLACEHOLDER_ORIGIN);
      assert.equal(setup.ready, false);
    });
  });

  test('an explicit placeholder host is caught as well as a blank one', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: PLACEHOLDER_ORIGIN }, () => {
      assert.ok(find(notificationSetup(), 'public-url'));
    });
  });

  test('a nonsense or path-carrying address is refused', async () => {
    for (const bad of ['not a url', 'https://shop.example.test/menu', 'your-domain.test']) {
      await withEnv({ ...SMTP, HB_PUBLIC_URL: bad }, () => {
        const issue = find(notificationSetup(), 'public-url');
        assert.ok(issue, `${bad} should be rejected`);
      });
    }
  });

  test('plain http is refused in public, allowed on a laptop', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'http://shop.example.test' }, () => {
      assert.match(find(notificationSetup(), 'public-url').message, /plain http/);
    });
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'http://localhost:4000' }, () => {
      assert.equal(find(notificationSetup(), 'public-url'), undefined);

      assert.equal(notificationSetup().ready, true);
    });
  });

  test('a trailing slash is tolerated: it is the same site', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'https://shop.example.test/' }, () => {
      assert.equal(notificationSetup().origin, 'https://shop.example.test');
      assert.equal(find(notificationSetup(), 'public-url'), undefined);
    });
  });
});

describe('reaching the kitchen', () => {
  test('no SMTP and no push is an error, not a note', async () => {
    await withEnv({}, () => {
      const setup = notificationSetup();
      const issue = find(setup, 'kitchen-unreachable');
      assert.ok(issue);
      assert.equal(issue.severity, 'error');
      assert.equal(setup.ready, false);
      assert.equal(setup.kitchenEmail, null);
    });
  });

  test('push without an enrolled device is still unreachable when there is no email', async () => {
    await withEnv({ ...VAPID }, () => {
      const setup = notificationSetup();
      assert.ok(find(setup, 'kitchen-unreachable'));
      assert.match(find(setup, 'kitchen-unreachable').message, /no kitchen device has enrolled/);
    });
  });

  test('email alone is enough to be reachable', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'https://shop.example.test' }, () => {
      assert.equal(find(notificationSetup(), 'kitchen-unreachable'), undefined);
    });
  });

  test('a misspelled alert address is caught, because that ticket goes nowhere', async () => {
    await withEnv({ ...SMTP, HB_ORDER_ALERT_EMAIL: 'owner@example' }, () => {
      assert.ok(find(notificationSetup(), 'alert-address-invalid'));
    });
  });
});

describe('push', () => {
  test('keys without an owner key mean no device can ever enrol', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'https://shop.example.test', ...VAPID, HB_OWNER_PUSH_KEY: 'short' }, () => {
      const setup = notificationSetup();
      assert.equal(setup.push.reason, 'no-owner-key');
      const issue = find(setup, 'no-owner-key');
      assert.ok(issue);
      assert.equal(issue.severity, 'error');
    });
  });

  test('a tampered key pair is reported as unusable rather than ignored', async () => {
    await withEnv({ ...VAPID, HB_VAPID_PRIVATE_KEY: 'not-a-real-private-key' }, () => {
      const setup = notificationSetup();
      assert.equal(setup.push.reason, 'invalid-keys');
      assert.ok(find(setup, 'push-keys'));
    });
  });

  test('dry run is a warning: it looks like it works and delivers nothing', async () => {
    await withEnv({ ...SMTP, HB_PUBLIC_URL: 'https://shop.example.test', HB_PUSH_DRY_RUN: 'true' }, () => {
      const setup = notificationSetup();
      const issue = find(setup, 'push-dry-run');
      assert.ok(issue);
      assert.equal(issue.severity, 'warn');
      /* A warning must not fail the check: mail still works. */
      assert.equal(setup.ready, true);
    });
  });
});

describe('the template the owner fills in', () => {
  const template = readFileSync(join(ROOT, 'notifications.env.example'), 'utf8');
  const lines = template.split('\n');
  /* An assignment at the start of a line, e.g. HB_SMTP_HOST=... */
  const assigned = new Set(
    lines.map((line) => /^#?\s*(HB_[A-Z_0-9]+)=/.exec(line)?.[1]).filter(Boolean),
  );

  test('documents every variable the notification code reads', () => {
    const relevant = NOTIFICATION_VARS.filter((name) => !(name in NOT_AN_OWNER_SETTING));
    /* A sanity floor: if the scan stops finding the modules, say so rather than
     * passing an empty comparison. */
    assert.ok(relevant.length >= 18, `the scan found only ${relevant.length} variables — is it still reading the right files?`);
    const missing = relevant.filter((name) => !assigned.has(name));
    assert.deepEqual(missing, [], `notifications.env.example does not mention: ${missing.join(', ')}`);
  });

  test('every name in the template is one the code actually reads', () => {
    /*
     * The other direction: a typo such as HB_SMPT_HOST would show up as a missing
     * variable above, but a made-up one (HB_SMTP_PASSWORD) would quietly do
     * nothing. Cross-check both ways.
     */
    const known = new Set(notificationVarsFromSource());
    const invented = [...assigned].filter((name) => !known.has(name) && !(name in MENTIONED_ELSEWHERE));
    assert.deepEqual(invented, [], `notifications.env.example names variables nothing reads: ${invented.join(', ')}`);
  });

  test('never shows a real secret', () => {
    /*
     * The file is committed. It may contain the shop's public email address, but
     * no password and no push key — those are the owner's, and the template's job
     * is to say where they come from.
     */
    assert.match(template, /HB_SMTP_PASS="paste the 16-character Google App Password here"/);
    for (const name of ['HB_VAPID_PUBLIC_KEY', 'HB_VAPID_PRIVATE_KEY', 'HB_OWNER_PUSH_KEY']) {
      const line = lines.find((l) => l.startsWith(`${name}=`));
      assert.ok(line, `${name} should be present and empty`);
      assert.equal(line.trim(), `${name}=`, `${name} must be blank in the committed template`);
    }
  });

  test('does not ship the foreign placeholder as the answer', () => {
    /* The template must not hand someone heritagebites.co.za as a default. */
    const publicUrl = lines.find((l) => l.startsWith('HB_PUBLIC_URL='));
    assert.ok(publicUrl);
    assert.ok(!publicUrl.includes(PLACEHOLDER_ORIGIN), 'the template must not suggest the other restaurant\'s domain');
    assert.match(publicUrl, /your-shop-address-here/);
  });

  test('tells the owner what to do before it shows them any values', () => {
    /* The first lines are instructions, not settings. */
    const head = lines.slice(0, 20).join('\n');
    assert.match(head, /WHAT YOU FILL IN/);
    assert.match(head, /Save this file as\s+\.env/);
  });
});
