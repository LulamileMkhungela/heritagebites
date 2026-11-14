/**
 * Build the invoice as a sendable PDF.
 *
 * The invoice is written once, in markdown (`docs/invoice-2026-11.md`), so the
 * number and the scope live somewhere a person can read and edit. This renders
 * that same file in the brand faces and the Mahlangu palette the rest of the
 * handover documents use, so it does not arrive looking like a different
 * supplier's paperwork.
 *
 * Run:  node scripts/build-invoice-pdf.mjs
 * Out:  docs/invoice-2026-11.pdf
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const mdPath = join(root, 'docs', 'invoice-2026-11.md');
const outPath = join(root, 'docs', 'invoice-2026-11.pdf');
const htmlPath = join(root, 'docs', '.invoice.html');
const fontsDir = join(root, 'public', 'fonts');

const source = readFileSync(mdPath, 'utf8');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

/*
 * The same small parser the handover PDF uses, extended with tables because an
 * invoice is mostly tables. Kept deliberately dumb: it only has to handle this
 * one file, and a real markdown library is not a dependency worth adding here.
 */
function markdownToHtml(src) {
  const out = [];
  let list = null;
  let para = [];
  let inItem = false;
  let table = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; inItem = false; } };
  const closeTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
    for (const r of rows) out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
    out.push('</tbody></table>');
    table = null;
  };
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    if (/^\|/.test(line)) {
      flushPara(); closeList();
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) table = [];
      table.push(cells);
      continue;
    }
    closeTable();

    if (!line) { flushPara(); closeList(); continue; }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushPara(); closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }

    const item = line.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (item) {
      flushPara();
      const kind = item[1].endsWith('.') ? 'ol' : 'ul';
      if (list !== kind) { closeList(); list = kind; out.push(`<${list}>`); }
      out.push(`<li>${inline(item[2])}</li>`);
      inItem = true;
      continue;
    }
    if (inItem && list) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line)}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara(); closeList(); closeTable();
  return out.join('\n');
}

/* The first heading block becomes the cover; the rest is the document body. */
const bodyHtml = markdownToHtml(source);

const font = (file) => `data:font/woff2;base64,${readFileSync(join(fontsDir, file)).toString('base64')}`;

const html = `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><title>Heritage Bites — Invoice HB-2026-11-01</title>
<style>
  @font-face { font-family: Fraunces; font-weight: 600; src: url('${font('fraunces-latin-600-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Fraunces; font-weight: 700; src: url('${font('fraunces-latin-700-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Manrope; font-weight: 400; src: url('${font('manrope-latin-400-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Manrope; font-weight: 500; src: url('${font('manrope-latin-500-normal.woff2')}') format('woff2'); }
  @font-face { font-family: Manrope; font-weight: 600; src: url('${font('manrope-latin-600-normal.woff2')}') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-weight: 400; src: url('${font('ibm-plex-mono-latin-400-normal.woff2')}') format('woff2'); }
  @page { size: A4; margin: 16mm 16mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #001938; font: 9.5pt/1.5 Manrope, Arial, sans-serif; }
  h1 { margin: 0 0 2mm; font: 700 26pt/1.05 Fraunces, Georgia, serif; }
  h1::after { content: ''; display: block; width: 34px; height: 3px; background: #B77E23; margin-top: 3mm; }
  h2 { margin: 8mm 0 3mm; font: 600 14pt/1.2 Fraunces, Georgia, serif; color: #001938; break-after: avoid; }
  h3 { margin: 6mm 0 2mm; font: 600 9.5pt/1.3 Manrope, Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #B77E23; break-after: avoid; }
  p { margin: 0 0 2.5mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin: 0 0 1.2mm; }
  strong { font-weight: 600; }
  em { color: #0C2441; }
  a { color: #0C2441; text-decoration: none; }
  code { padding: .3mm 1mm; background: #F3EDDF; font: 8pt 'IBM Plex Mono', monospace; }
  hr { border: 0; border-top: 1px solid #F1EBDD; margin: 6mm 0; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 8.5pt; break-inside: avoid; }
  th { text-align: left; padding: 2mm 2.5mm; background: #001938; color: #F8F4EC; font-weight: 600; }
  td { padding: 2mm 2.5mm; border-bottom: 1px solid #F1EBDD; vertical-align: top; }
  tr:nth-child(even) td { background: #FBF8F1; }
  h2, h3, p, li, td { orphans: 2; widows: 2; }
</style></head>
<body>${bodyHtml}</body></html>`;

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
  /* Wait for the brand faces, or the PDF is laid out in fallback metrics. */
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('600 16px Fraunces'),
      document.fonts.load('700 16px Fraunces'),
      document.fonts.load('400 16px Manrope'),
      document.fonts.load('600 16px Manrope'),
    ]);
    await document.fonts.ready;
  });
  await page.pdf({ path: outPath, format: 'A4', printBackground: true, margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' } });
  console.log(`✔ wrote ${outPath}`);
} finally {
  if (browser) await browser.close();
  rmSync(htmlPath, { force: true });
}
