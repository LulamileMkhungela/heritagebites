/**
 * Render a Markdown handoff sheet to PDF. By default this builds the technical
 * launch checklist; set HB_STATEMENT_SRC and HB_STATEMENT_OUT to build a second
 * document with the same typesetting.
 *
 * Run:  node scripts/build-statement.mjs
 *       HB_STATEMENT_SRC=docs/what-i-need-from-kemorego.md \
 *       HB_STATEMENT_OUT=docs/what-i-need-from-kemorego.pdf node scripts/build-statement.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareRuntime } from './lib/chromium-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, process.env.HB_STATEMENT_SRC ?? 'docs/what-is-needed.md');
const OUT = join(root, process.env.HB_STATEMENT_OUT ?? 'docs/what-is-needed.pdf');
const FONTS = join(root, 'public', 'fonts');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline formatting for one line of markdown. */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/** Block-level conversion, good enough for this document. */
function toHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol' | null
  let para = []; // pending paragraph lines, joined on flush
  let inItem = false; // previous line was a list item, so plain lines continue it

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    inItem = false;
  };
  const flushPara = () => {
    if (!para.length) return;
    // Join first: this document has *italic* spans that wrap across lines.
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) { flushPara(); closeList(); continue; }
    if (/^-{3,}$/.test(trimmed)) { flushPara(); closeList(); out.push('<hr>'); continue; }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList();
      const level = heading[1].length;
      const text = inline(heading[2]);
      out.push(level === 1 ? `<h1>${text}</h1>` : `<h${level}>${text}</h${level}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      inItem = true;
      continue;
    }

    // "1.1 Foo" is a numbered *heading*, not a list item; a list item's number
    // is followed by a space, never by another digit and a dot.
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered && /^\d+\.\d/.test(trimmed)) { closeList(); inItem = false; para.push(trimmed); continue; }
    if (numbered) {
      flushPara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(numbered[1])}</li>`);
      inItem = true;
      continue;
    }

    /*
     * A plain line directly under a list item is that item's continuation, not
     * a new paragraph: a wrapped step in a numbered list otherwise becomes a
     * separate paragraph, which breaks the numbering and indents the tail.
     */
    if (inItem && list) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(trimmed)}</li>`);
      continue;
    }

    closeList();
    inItem = false;
    para.push(trimmed);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

const md = readFileSync(SRC, 'utf8');
const body = toHtml(md);

const html = `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Fraunces'; font-weight: 600; src: url('${pathToFileURL(join(FONTS, 'fraunces-latin-600-normal.woff2'))}') format('woff2'); }
  @font-face { font-family: 'Fraunces'; font-weight: 700; src: url('${pathToFileURL(join(FONTS, 'fraunces-latin-700-normal.woff2'))}') format('woff2'); }
  @font-face { font-family: 'Manrope'; font-weight: 400; src: url('${pathToFileURL(join(FONTS, 'manrope-latin-400-normal.woff2'))}') format('woff2'); }
  @font-face { font-family: 'Manrope'; font-weight: 500; src: url('${pathToFileURL(join(FONTS, 'manrope-latin-500-normal.woff2'))}') format('woff2'); }
  @font-face { font-family: 'Manrope'; font-weight: 600; src: url('${pathToFileURL(join(FONTS, 'manrope-latin-600-normal.woff2'))}') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-weight: 400; src: url('${pathToFileURL(join(FONTS, 'ibm-plex-mono-latin-400-normal.woff2'))}') format('woff2'); }
  @page { size: A4; margin: 20mm 18mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Manrope', sans-serif; font-size: 9.6pt; line-height: 1.52; color: #001938; margin: 0; }
  h1 { font-family: 'Fraunces', serif; font-weight: 700; font-size: 26pt; line-height: 1.1; margin: 0 0 6mm; color: #001938; letter-spacing: -0.015em; }
  h1::after { content: ''; display: block; width: 34px; height: 4px; background: #B77E23; margin-top: 5mm; }
  h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15pt; color: #001938; margin: 8mm 0 3mm; break-after: avoid; }
  h3 { font-family: 'Manrope', sans-serif; font-weight: 600; font-size: 10.6pt; color: #001938; margin: 5.5mm 0 1.5mm; break-after: avoid; }
  p { margin: 0 0 2.6mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 5.2mm; }
  li { margin: 0 0 1.3mm; }
  strong { font-weight: 600; color: #001938; }
  em { font-style: italic; color: #0C2441; }
  code { font-family: 'IBM Plex Mono', monospace; font-size: 8.4pt; background: #F3EDDF; padding: 0.4mm 1.2mm; border-radius: 1.5mm; }
  hr { border: 0; border-top: 1px solid rgba(0,25,56,0.14); margin: 6mm 0; }
  h2, h3 { orphans: 3; widows: 3; }
  p, li { orphans: 2; widows: 2; }
</style></head>
<body>${body}</body></html>`;

const page_ = join(root, 'docs', '.statement.html');
writeFileSync(page_, html);

const runtime = await prepareRuntime();
const browser = await puppeteer.launch({
  args: [...chromium.args.filter((a) => a !== '--font-render-hinting=none'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  executablePath: runtime.exe,
  headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: runtime.libPath },
});
const page = await browser.newPage();
await page.goto(pathToFileURL(page_).href, { waitUntil: 'load' });
await page.evaluate(async () => {
  await Promise.all(['600 16px Fraunces', '700 16px Fraunces', '400 16px Manrope', '600 16px Manrope', '400 16px "IBM Plex Mono"'].map((s) => document.fonts.load(s).catch(() => null)));
  await document.fonts.ready;
});
const ready = await page.evaluate(() => document.fonts.check('600 16px Fraunces') && document.fonts.check('400 16px Manrope'));
if (!ready) throw new Error('fonts did not load; refusing to print');
await new Promise((r) => setTimeout(r, 400));
await page.pdf({ path: OUT, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '16mm', left: '18mm', right: '18mm' } });
await browser.close();
console.log(`wrote ${OUT}`);
