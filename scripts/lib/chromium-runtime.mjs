/*
 * Headless Chromium for this sandbox, shared by the screenshot and PDF scripts.
 *
 * @sparticuz/chromium unpacks the browser and a set of libs to /tmp, but the
 * al2023 bundle it extracts on this host lacks the NSS libs the shell binary
 * links against (libnss3, libnspr4, libnssutil3). chrome-aws-lambda ships
 * exactly those, so unpack both and put them on LD_LIBRARY_PATH.
 *
 * /tmp does not survive a sandbox restart, so this re-extracts on every run
 * rather than trusting whatever is already there.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const TMP = '/tmp/hb-capture';

/* ------------------------------------------------------------------ libs */
/*
 * @sparticuz/chromium unpacks the browser and a set of libs to /tmp, but the
 * al2023 bundle it extracts on this host lacks the NSS libs the shell binary
 * links against (libnss3, libnspr4, libnssutil3). chrome-aws-lambda ships
 * exactly those, so unpack both and put them on LD_LIBRARY_PATH.
 */
export async function prepareRuntime() {
  const exe = await chromium.executablePath();
  const libDir = join(TMP, 'libs');
  const fontDir = join(TMP, 'fonts');
  mkdirSync(libDir, { recursive: true });
  mkdirSync(fontDir, { recursive: true });

  // Host libs: prefer the al2023 bundle from @sparticuz, then any aws.tar.br we
  // can find in node_modules (chrome-aws-lambda), so this works without either
  // package being pinned to an exact version.
  const candidates = [
    join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'),
    join(root, 'node_modules/chrome-aws-lambda/bin/aws.tar.br'),
  ];
  const libs = [];
  for (const c of candidates) {
    if (!statSyncExists(c)) continue;
    const dest = join(TMP, 'l' + libs.length);
    writeFileSync(`${dest}.tar`, brotliDecompressSync(readFileSync(c)));
    mkdirSync(dest, { recursive: true });
    execFileSync('tar', ['-xf', `${dest}.tar`, '-C', dest]);
    // Both bundles drop the .so files either at the root or in lib/.
    const found = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.so') || e.name.includes('.so.')) found.push(p);
      }
    };
    walk(dest);
    libs.push(...found);
  }
  for (const l of libs) {
    const target = join(libDir, l.split('/').pop());
    try { execFileSync('cp', ['-n', l, target]); } catch { /* keep going */ }
  }
  const libPath = [libDir, ...libs.map((l) => dirname(l))].join(':');

  // The site self-hosts its fonts in dist/fonts now, so fontconfig is only a
  // backstop for any fallback glyph coverage the shell needs.
  const fontsConf = join(fontDir, 'fonts.conf');
  writeFileSync(
    fontsConf,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${join(root, 'dist/fonts')}</dir>
  <dir>${join(fontDir, 'ttf')}</dir>
  <cachedir>${join(fontDir, 'cache')}</cachedir>
</fontconfig>`,
  );

  return { exe, libPath, fontsConf };
}

const statSyncExists = (p) => { try { statSync(p); return true; } catch { return false; } };
