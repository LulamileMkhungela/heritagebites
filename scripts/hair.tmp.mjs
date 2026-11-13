import { dirname } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { prepareRuntime } from './lib/chromium-runtime.mjs';
const runtime = await prepareRuntime();
const browser = await puppeteer.launch({
  args: [...chromium.args.filter((a) => a !== '--font-render-hinting=none'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars'],
  executablePath: runtime.exe, headless: 'shell', protocolTimeout: 240000,
  env: { ...process.env, LD_LIBRARY_PATH: runtime.libPath, FONTCONFIG_PATH: dirname(runtime.fontsConf) },
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1400, deviceScaleFactor: 6 });
await page.goto('http://127.0.0.1:4000/', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 900));
const h = await page.evaluate(() => document.body.scrollHeight);
await page.setViewport({ width: 1440, height: Math.min(h, 7000), deviceScaleFactor: 6 });
await new Promise((r) => setTimeout(r, 1600));
const box = await page.evaluate(() => {
  const el = document.querySelector('span.h-px');
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height };
});
console.log('hairline', JSON.stringify(box));
await page.screenshot({ path: '/home/user/preview-shots/z-hairline-before.png', clip: { x: box.x - 40, y: box.y - 14, width: 220, height: 32 } });
await browser.close();
