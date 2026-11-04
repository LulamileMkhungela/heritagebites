/**
 * Build one sendable handoff PDF containing the current public-site screenshots
 * followed by the owner checklist prepared for Kemorego. The standalone screen,
 * owner-checklist and technical-launch PDFs remain available separately.
 *
 * Run: node scripts/build-combined-pdf.mjs
 * Out: docs/heritage-bites-complete.pdf
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const screenDir = join(root, 'docs', 'screens');
const mdPath = join(root, 'docs', 'what-i-need-from-kemorego.md');
const outPath = join(root, 'docs', 'heritage-bites-complete.pdf');
const htmlPath = join(root, 'docs', '.combined.html');
const fontsDir = join(root, 'public', 'fonts');
const manifest = JSON.parse(readFileSync(join(screenDir, 'manifest.json'), 'utf8'));
const markdown = readFileSync(mdPath, 'utf8');

const names = {
  '01-home': 'Home',
  '02-home-mobile': 'Home on a phone',
  '03-menu': 'Meals',
  '04-menu-dish': 'Dish details',
  '05-plate-builder': 'Build a Traditional Plate',
  '06-specials': 'This week',
  '07-about': 'About Us',
  '08-contact': 'Contact',
  '09-loyalty-card': 'Loyalty card',
  '10-checkout-empty': 'Checkout, empty',
  '11-checkout-filled': 'Checkout, delivery',
  '12-checkout-mobile': 'Checkout on a phone',
  '13-order-tracking': 'Order receipt and details',
  '14-order-tracking-mobile': 'Order receipt on a phone',
  '15-not-found': 'Not found',
  '16-customer-quest': 'Customer quest',
  '17-customer-quest-mobile': 'Customer quest on a phone',
};
for (const screen of manifest.screens) {
  if (!names[screen.slug]) throw new Error(`No display name for screen ${screen.slug}`);
  if (!screen.file || !readFileSync(join(screenDir, screen.file))) throw new Error(`Missing screenshot for ${screen.slug}`);
}
if (manifest.failed?.length) throw new Error(`Screenshots failed: ${manifest.failed.join(', ')}`);

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (text) => escapeHtml(text)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');

function markdownToHtml(source) {
  const out = [];
  let list = null;
  let paragraph = [];
  let inItem = false;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
    inItem = false;
  };
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      flushParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }
    const item = line.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (item) {
      flushParagraph();
      const kind = item[1].endsWith('.') ? 'ol' : 'ul';
      if (list !== kind) {
        closeList();
        list = kind;
        out.push(`<${list}>`);
      }
      out.push(`<li>${inline(item[2])}</li>`);
      inItem = true;
      continue;
    }
    if (inItem && list) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line)}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return out.join('\n');
}

const screenshotPages = manifest.screens.map((screen, index) => {
  const image = readFileSync(join(screenDir, screen.file)).toString('base64');
  const view = screen.view === 'mobile' ? 'Phone · 390 px' : 'Desktop';
  const path = screen.tracking ? '/order/[secure-link]' : screen.path;
  return `<section class="screen-page">
    <div class="page-kicker">SCREEN ${String(index + 1).padStart(2, '0')} OF ${manifest.screens.length} · ${view}</div>
    <h2>${escapeHtml(names[screen.slug])}</h2>
    <div class="route">${escapeHtml(path)}</div>
    <div class="image-frame"><img src="data:image/png;base64,${image}" alt="${escapeHtml(names[screen.slug])} page screenshot"></div>
    <p class="notes">${escapeHtml(screen.notes ?? '')}</p>
    <p class="look">${escapeHtml(screen.look ?? '')}</p>
  </section>`;
}).join('\n');

const capturedDate = new Date(manifest.captured).toISOString().slice(0, 10);
const checklistHtml = markdownToHtml(markdown);
const fontData = (file) => `data:font/woff2;base64,${readFileSync(join(fontsDir, file)).toString('base64')}`;
const html = `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><title>Heritage Bites — Site screens and Kemorego checklist</title>
<style>
  @font-face { font-family: Fraunces; font-weight: 600; src: url('${fontData('fraunces-latin-600-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Fraunces; font-weight: 700; src: url('${fontData('fraunces-latin-700-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Manrope; font-weight: 400; src: url('${fontData('manrope-latin-400-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Manrope; font-weight: 500; src: url('${fontData('manrope-latin-500-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Manrope; font-weight: 600; src: url('${fontData('manrope-latin-600-normal.woff2')}') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-weight: 400; src: url('${fontData('ibm-plex-mono-latin-400-normal.woff2')}') format('woff2'); }
  @page { size: A4 landscape; margin: 12mm 16mm 12mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #001938; font: 9pt/1.45 Manrope, Arial, sans-serif; }
  .cover, .screen-page { break-after: page; page-break-after: always; }
  .cover { box-sizing: border-box; height: 185mm; padding: 18mm 20mm; color: #F8F4EC; background: #001938; display: flex; flex-direction: column; justify-content: center; }
  .cover .eyebrow, .page-kicker { font: 8pt 'IBM Plex Mono', monospace; letter-spacing: .18em; color: #B77E23; text-transform: uppercase; }
  .cover h1 { margin: 7mm 0 3mm; font: 700 34pt/1.05 Fraunces, Georgia, serif; }
  .cover .deck { max-width: 210mm; font-size: 12pt; line-height: 1.55; color: #F1EBDD; }
  .cover .caveat { margin-top: 8mm; padding-top: 5mm; border-top: 1px solid #0C2441; max-width: 230mm; font-size: 9pt; color: #F1EBDD; }
  .cover .date { margin-top: 12mm; font: 8pt 'IBM Plex Mono', monospace; color: #B77E23; }
  .screen-page { box-sizing: border-box; height: 185mm; display: flex; flex-direction: column; overflow: hidden; }
  .page-kicker { margin-bottom: 2mm; }
  .screen-page h2 { margin: 0; font: 600 20pt/1.15 Fraunces, Georgia, serif; color: #001938; }
  .route { margin: 1.5mm 0 3mm; color: #0C2441; font: 8pt 'IBM Plex Mono', monospace; }
  .image-frame { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; border: 1px solid #F1EBDD; background: #FFFFFF; overflow: hidden; }
  .image-frame img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
  .notes { margin: 3mm 0 0; color: #001938; font-size: 8.5pt; }
  .look { margin: 1mm 0 0; padding-left: 3mm; border-left: 2px solid #B77E23; color: #0C2441; font-size: 8pt; }
  .checklist { break-before: page; page-break-before: always; }
  .checklist h1 { margin: 0 0 5mm; font: 700 25pt/1.1 Fraunces, Georgia, serif; color: #001938; }
  .checklist h1::after { content: ''; display: block; width: 34px; height: 3px; background: #B77E23; margin-top: 4mm; }
  .checklist h2 { margin: 7mm 0 2.5mm; font: 600 15pt/1.2 Fraunces, Georgia, serif; color: #001938; break-after: avoid; page-break-after: avoid; }
  .checklist h3 { margin: 5mm 0 1.5mm; font: 600 10pt/1.25 Manrope, Arial, sans-serif; color: #001938; break-after: avoid; page-break-after: avoid; }
  .checklist p { margin: 0 0 2.5mm; }
  .checklist ul, .checklist ol { margin: 0 0 3mm; padding-left: 6mm; }
  .checklist li { margin: 0 0 1.2mm; }
  .checklist strong { font-weight: 600; color: #001938; }
  .checklist em { color: #0C2441; }
  .checklist code { padding: .3mm 1mm; background: #F3EDDF; font: 8pt 'IBM Plex Mono', monospace; }
  .checklist hr { border: 0; border-top: 1px solid #F1EBDD; margin: 5mm 0; }
  .checklist h2, .checklist h3, .checklist p, .checklist li { orphans: 2; widows: 2; }
</style></head>
<body>
  <section class="cover">
    <div class="eyebrow">Heritage Bites · Project handoff</div>
    <h1>Current site screens<br>and owner checklist</h1>
    <p class="deck">A visual record of the public storefront, followed by the confirmations and launch details needed from Kemorego.</p>
    <p class="caveat">The customer flow works in tests. Background order-email alerts are built but await Gmail SMTP setup; the Contact form is not emailed, there is no staff status workflow, and card checkout remains in sandbox mode.</p>
    <p class="date">${manifest.screens.length} public screens · captured ${capturedDate}</p>
  </section>
  ${screenshotPages}
  <article class="checklist">${checklistHtml}</article>
</body></html>`;

writeFileSync(htmlPath, html);
let browser;
try {
  const runtime = await prepareRuntime();
  browser = await puppeteer.launch({
    args: [...chromium.args.filter((a) => a !== '--font-render-hinting=none'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    executablePath: runtime.exe,
    headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: runtime.libPath, FONTCONFIG_PATH: dirname(runtime.fontsConf) },
  });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 45000 });
  const fontSpecs = [
    '600 16px Fraunces', '700 16px Fraunces', '400 16px Manrope', '500 16px Manrope',
    '600 16px Manrope', '400 16px "IBM Plex Mono"',
  ];
  let fontStatus;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(async (specs) => {
      await Promise.all(specs.map((spec) => document.fonts.load(spec).catch(() => null)));
      await document.fonts.ready;
    }, fontSpecs);
    fontStatus = await page.evaluate(() => ({
      ready: document.fonts.check('600 16px Fraunces') && document.fonts.check('400 16px Manrope'),
      faces: [...document.fonts].map((face) => `${face.family}:${face.weight}:${face.status}`),
    }));
    if (fontStatus.ready) break;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await page.reload({ waitUntil: 'load', timeout: 45000 });
    }
  }
  if (!fontStatus?.ready) throw new Error(`Required fonts did not load; refusing to create a partial handoff PDF. Faces: ${fontStatus?.faces.join(', ')}`);
  await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true, timeout: 120000 });
  console.log(`wrote ${outPath}`);
  console.log(`  ${manifest.screens.length} public screens plus Kemorego's owner checklist`);
} finally {
  await browser?.close().catch(() => {});
  rmSync(htmlPath, { force: true });
}
