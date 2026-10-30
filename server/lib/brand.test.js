/**
 * The brand assets: the logo, the tab icon, the home-screen icons and the card a
 * pasted link shows.
 *
 * These are files on disk, so nothing else in the suite would notice if one went
 * missing, was 0 bytes, or was the wrong size for the platform that asks for it.
 * A missing `og:image` is invisible to the shop and glaring to a customer: the
 * link they paste into WhatsApp is the first thing most people ever see.
 *
 * Dimensions are read from the PNG and JPEG headers directly rather than trusted
 * from the build script — the point is to check the file, not the intent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const PUBLIC = join(ROOT, 'public');

/** Width, height and format, straight out of the file. */
function imageInfo(path) {
  const buffer = readFileSync(path);
  /* PNG: the IHDR is the first chunk, at a fixed offset. */
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  /* JPEG: walk the segments to the frame header (SOF0/1/2). */
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { format: 'jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  /* ICO: 6-byte header, then 16-byte directory entries (0 means 256). */
  if (buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1) {
    const count = buffer.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      sizes.push({ width: buffer[entry] || 256, height: buffer[entry + 1] || 256 });
    }
    return { format: 'ico', sizes };
  }
  throw new Error(`${path} is not a PNG, JPEG or ICO file`);
}

const info = (relative) => imageInfo(join(PUBLIC, relative));
const size = (relative) => statSync(join(PUBLIC, relative)).size;

describe('the logo and the icons', () => {
  test('the full badge exists at a size worth showing', () => {
    const badge = info('img/logo-badge.png');
    assert.equal(badge.format, 'png');
    assert.ok(badge.width >= 512, `the badge is only ${badge.width}px`);
    assert.equal(badge.width, badge.height, 'the badge must be square');

    /* An ink copy, because white artwork disappears on a light page. */
    assert.ok(existsSync(join(PUBLIC, 'img/logo-badge-ink.png')), 'no ink copy of the badge');
    const ink = info('img/logo-badge-ink.png');
    assert.equal(ink.width, badge.width);
  });

  test('the tab icon is every size a browser asks for', () => {
    assert.deepEqual(info('favicon-32.png'), { format: 'png', width: 32, height: 32 });
    assert.deepEqual(info('favicon-16.png'), { format: 'png', width: 16, height: 16 });

    /*
     * The .ico still matters: older Windows and some feed readers only ask for
     * /favicon.ico, and a 404 there is the grey globe icon.
     */
    const ico = info('favicon.ico');
    assert.equal(ico.format, 'ico');
    assert.deepEqual(
      ico.sizes.map((s) => s.width).sort((a, b) => a - b),
      [16, 32, 48],
      'the .ico should hold 16, 32 and 48px',
    );
  });

  test('the phone icons are the sizes iOS and Android expect', () => {
    assert.deepEqual(info('apple-touch-icon.png'), { format: 'png', width: 180, height: 180 });
    assert.deepEqual(info('icon-192.png'), { format: 'png', width: 192, height: 192 });
    assert.deepEqual(info('icon-512.png'), { format: 'png', width: 512, height: 512 });
    assert.deepEqual(info('icon-maskable-512.png'), { format: 'png', width: 512, height: 512 });

    /*
     * iOS composites transparency onto black. An RGBA file with a transparent
     * corner would get black corners on the home screen, so this one is opaque.
     */
    const png = readFileSync(join(PUBLIC, 'apple-touch-icon.png'));
    const colourType = png[25];
    assert.ok(colourType === 2 || colourType === 6, `unexpected PNG colour type ${colourType}`);
    if (colourType === 6) {
      /* RGBA is fine only if it is never actually transparent. */
      assert.ok(png.includes(Buffer.from('tRNS')) === false);
    }
  });

  test('no icon file is empty', () => {
    for (const file of [
      'favicon.ico',
      'favicon-16.png',
      'favicon-32.png',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'img/logo-badge.png',
      'img/logo-badge-ink.png',
      'img/social-card.jpg',
    ]) {
      assert.ok(size(file) > 400, `${file} is ${size(file)} bytes — effectively empty`);
      /* A social card is the one that may be large; nothing should be absurd. */
      assert.ok(size(file) < 1_500_000, `${file} is ${Math.round(size(file) / 1024)} KB, too heavy to load`);
    }
  });
});

describe('the share card', () => {
  test('is the size link previews are built for', () => {
    /*
     * 1200×630 is the 1.91:1 that WhatsApp, Facebook, LinkedIn and Slack all
     * crop to. Any other ratio has something cut off the top or the sides.
     */
    assert.deepEqual(info('img/social-card.jpg'), { format: 'jpeg', width: 1200, height: 630 });
  });

  test('the app and the server both point at it, at the right size', async () => {
    const { DEFAULT_SHARE_IMAGE, SHARE_IMAGE_META, headHtml } = await import('../../shared/seo.js');
    assert.equal(DEFAULT_SHARE_IMAGE, '/img/social-card.jpg');
    assert.deepEqual(SHARE_IMAGE_META, { width: 1200, height: 630, type: 'image/jpeg' });

    const html = headHtml('/menu', { siteUrl: 'https://shop.test' });
    const property = (name) => new RegExp(`<meta property="${name}" content="([^"]*)"`).exec(html)?.[1];

    /* Dimensions are what stop a scraper guessing the crop. */
    assert.equal(property('og:image'), 'https://shop.test/img/social-card.jpg');
    assert.equal(property('og:image:width'), '1200');
    assert.equal(property('og:image:height'), '630');
    assert.equal(property('og:image:type'), 'image/jpeg');
    assert.match(property('og:image:alt') ?? '', /Heritage Bites/);
    /* Twitter needs its own tags; it ignores og:* for images. */
    assert.match(html, /<meta name="twitter:image" content="https:\/\/shop\.test\/img\/social-card\.jpg" \/>/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  });

  test('every route shares the same card, so the brand is recognisable everywhere', async () => {
    const { PAGES, headHtml } = await import('../../shared/seo.js');
    for (const path of Object.keys(PAGES)) {
      const html = headHtml(path, { siteUrl: 'https://shop.test' });
      assert.match(html, /og:image" content="https:\/\/shop\.test\/img\/social-card\.jpg"/, `${path} shares a different image`);
    }
  });
});

describe('the page head', () => {
  test('asks for the badge, the icons and the manifest, and every one exists', () => {
    const shell = readFileSync(join(ROOT, 'index.html'), 'utf8');

    /* The browser tab. `.ico` first for old clients, the PNGs for the rest. */
    assert.match(shell, /<link rel="icon" href="\/favicon\.ico"/);
    assert.match(shell, /<link rel="icon" href="\/favicon-32\.png"/);
    assert.match(shell, /<link rel="icon" href="\/favicon-16\.png"/);
    /* The home screen on iOS, and the manifest Android reads. */
    assert.match(shell, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    assert.match(shell, /<link rel="manifest" href="\/manifest\.webmanifest"/);

    /* No leftover reference to an icon that was replaced. */
    assert.ok(!shell.includes('favicon.svg'), 'the head still points at the old SVG icon');

    /*
     * A link to a file that is not there is worse than no link: the tab keeps
     * whatever it had before. Check every icon path named in the head.
     */
    for (const match of shell.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)) {
      const file = match[1].replace(/^\//, '');
      assert.ok(existsSync(join(PUBLIC, file)), `the head links ${match[1]} but public/${file} does not exist`);
    }
  });
});

describe('the manifest', () => {
  test('is valid JSON and names icons that exist', () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.short_name, 'Heritage Bites');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.theme_color.toLowerCase(), '#16100c');
    assert.ok(manifest.icons.length >= 3);

    for (const icon of manifest.icons) {
      const file = icon.src.replace(/^\//, '');
      assert.ok(existsSync(join(PUBLIC, file)), `${icon.src} is in the manifest but not on disk`);
      const [w, h] = icon.sizes.split('x').map(Number);
      const actual = info(file);
      assert.deepEqual({ width: actual.width, height: actual.height }, { width: w, height: h }, `${icon.src} is not ${icon.sizes}`);
    }
    /* Android drops an icon that declares itself maskable without the margin. */
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  });
});
