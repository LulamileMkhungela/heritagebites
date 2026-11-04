/**
 * Build the screenshot document as a PDF.
 *
 * No PDF library is installed and none of the usual CDNs are reachable, so this
 * writes the file by hand: one page per screen, each PNG embedded as a
 * /FlateDecode image XObject, captions drawn as vector rects plus real text in
 * the base-14 Helvetica faces (no font file to embed).
 *
 * Two things learned the hard way, both now checked at the end of the run:
 *   - object numbers are assigned from one table, because a hand-counted offset
 *     silently overwrote the page tree with the cover image and produced a
 *     valid-looking PDF with zero pages;
 *   - every xref offset is verified to land on "<n> 0 obj" before the file is
 *     declared written.
 *
 * Run:  node scripts/build-pdf.mjs
 * Out:  docs/screens/heritage-bites-screens.pdf
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng } from './lib/png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DIR = join(root, 'docs', 'screens');
const OUT = join(DIR, 'heritage-bites-screens.pdf');

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const screens = manifest.screens;

/*
 * Short headings for the public-site pages. The manifest carries each screen's
 * route and its own document title; the slug map keeps the PDF contents list
 * stable and fails loudly if a capture has no deliberate display name.
 */
const NAMES = {
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
for (const s of screens) {
  if (!NAMES[s.slug]) throw new Error(`no display name for screen "${s.slug}" in scripts/build-pdf.mjs`);
}

/* ---------------------------------------------------------------- layout -- */
const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 34;
const HEADER_H = 22;

/*
 * The base-14 fonts use WinAnsiEncoding, which is not latin1: an em dash is
 * 0x97 and a right single quote is 0x92. Writing a JS string straight through
 * latin1 truncated those to control bytes, so map them explicitly.
 */
const WIN_ANSI = { '\u2014': 0x97, '\u2013': 0x96, '\u2018': 0x91, '\u2019': 0x92, '\u201c': 0x93, '\u201d': 0x94, '\u2026': 0x85 };
const pdfString = (s) => String(s).replace(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/g, (c) => String.fromCharCode(WIN_ANSI[c]));
const esc = (s) => pdfString(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const INK = '0 0.098 0.220'; // #001938
const BONE = '0.973 0.957 0.925'; // #F8F4EC
const GOLD = '0.718 0.494 0.137'; // #B77E23
const MUTED = '0.047 0.141 0.255'; // #0C2441
/* PDF has no per-text-run colour, so every run sets its own fill first. */
const text = (str, x, y, size, font = 'F1', colour = INK) =>
  `${colour} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(str)}) Tj ET`;

function wrap(str, maxChars) {
  const words = String(str).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((`${line} ${w}`).trim().length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = (`${line} ${w}`).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ------------------------------------------------------------- objects -- */
/*
 * Object numbers come from this table and nowhere else:
 *   1 catalog · 2 page tree · 3 info · 4 cover content · 5 cover page
 *   for each screen i:  6+3i page · 7+3i content · 8+3i image
 *   900/901/902 the three base-14 fonts
 */
const COVER_CONTENT = 4;
const COVER_PAGE = 5;
const pageNum = (i) => 6 + i * 3;
const contentNum = (i) => 7 + i * 3;
const imageNum = (i) => 8 + i * 3;
const FONT_NUMS = { F1: 900, F2: 901, F3: 902 };
const FIRST_SCREEN_OBJ = 6;
const LAST_OBJ = FONT_NUMS.F3;

const chunks = [];
let cursor = 0;
const offsets = new Map();

function append(str) {
  const b = Buffer.from(str, 'latin1');
  chunks.push(b);
  cursor += b.length;
}
function appendBuffer(b) {
  chunks.push(b);
  cursor += b.length;
}
function pushObject(num, body) {
  if (offsets.has(num)) throw new Error(`object ${num} written twice`);
  offsets.set(num, cursor);
  append(`${num} 0 obj\n`);
  appendBuffer(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
  append('\nendobj\n');
}

/* ------------------------------------------------------------- content -- */
const FONTS_RES = `<< /F1 ${FONT_NUMS.F1} 0 R /F2 ${FONT_NUMS.F2} 0 R /F3 ${FONT_NUMS.F3} 0 R >>`;

/* Cover page with a contents list. */
const cover = [];
cover.push(`${BONE} rg 0 0 ${PAGE_W} ${PAGE_H} re f`);
cover.push(`${INK} rg 0 ${PAGE_H - 165} ${PAGE_W} 165 re f`);
cover.push(`${GOLD} rg ${MARGIN} ${PAGE_H - 96} 46 4 re f`);
cover.push(text('Heritage Bites', MARGIN, PAGE_H - 138, 30, 'F2', BONE));
cover.push(text('Screens, as built', MARGIN, PAGE_H - 160, 15, 'F1', GOLD));
cover.push(text(
  `Current public-site screens, captured from the running build on ${new Date(manifest.captured).toISOString().slice(0, 10)}. The staff console is intentionally removed.`,
  MARGIN, PAGE_H - 196, 8.5, 'F1', INK));
cover.push(text(
  `${screens.length} screens  ·  desktop at 1440 px, phone at 390 px  ·  each page shows the screen, what it does, and what to look for.`,
  MARGIN, PAGE_H - 209, 8.5, 'F1', INK));
cover.push(text('Contents', MARGIN, PAGE_H - 240, 10, 'F2', INK));

const perCol = Math.ceil(screens.length / 2);
screens.forEach((s, i) => {
  const col = i < perCol ? 0 : 1;
  const row = col === 0 ? i : i - perCol;
  const x = MARGIN + col * 400;
  const y = PAGE_H - 268 - row * 20;
  cover.push(text(`${String(i + 1).padStart(2, '0')}`, x, y, 9, 'F1', GOLD));
  cover.push(text(NAMES[s.slug], x + 20, y, 9.5, 'F1', INK));
  cover.push(text(s.path, x + 210, y, 7.5, 'F3', MUTED));
});

cover.push(`${INK} rg 0 0 ${PAGE_W} ${HEADER_H} re f`);
cover.push(text('Heritage Bites  ·  Every Bite Tells a Story', MARGIN, 7.5, 7.5, 'F2', BONE));
cover.push(text('Contents', PAGE_W - MARGIN - 34, 7.5, 7.5, 'F1', BONE));

/* One page per screen. */
/*
 * Caption blocks are laid out first, then the image is scaled into whatever
 * height is left above them, and the caption is anchored to the bottom margin.
 * That keeps the caption at the same place on every page while wide desktop
 * shots and tall phone shots both fill the page. The viewport label is read
 * from the PNG, never from the manifest's `view`, because mobile screens use
 * 390 px and hardcoding "1440 px" for every screen would be inaccurate.
 */
const FOOTER = HEADER_H;
const CAPTION_GAP = 18;

const pageContents = screens.map((s, i) => {
  const png = decodePng(readFileSync(join(DIR, s.file)));

  /* Caption lines, top to bottom, with the leading each one needs. */
  const lines = [];
  lines.push({ text: `${String(i + 1).padStart(2, '0')}.  ${NAMES[s.slug]}`, size: 13.5, font: 'F2', colour: INK, lead: 20 });
  lines.push({ text: `${s.path}   ·   ${png.width} px viewport   ·   ${s.title}`, size: 7, font: 'F3', colour: MUTED, lead: 12 });
  for (const line of wrap(s.notes ?? '', 118).slice(0, 2)) {
    lines.push({ text: line, size: 8.5, font: 'F1', colour: INK, lead: 11 });
  }
  lines.push({ spacer: true, lead: 6 });
  for (const line of wrap(s.look ?? '', 114).slice(0, 2)) {
    lines.push({ text: line, size: 8, font: 'F1', colour: MUTED, lead: 10.5, indent: 8 });
  }
  const captionH = lines.reduce((n, l) => n + l.lead, 0);

  /* Image box: between the header and the caption, inside the margins. */
  const imgTop = PAGE_H - FOOTER - 14;
  const captionTop = MARGIN + captionH;
  const imgBottom = captionTop + CAPTION_GAP;
  const boxH = imgTop - imgBottom;
  const boxW = PAGE_W - MARGIN * 2;
  const scale = Math.min(boxW / png.width, boxH / png.height);
  const drawW = png.width * scale;
  const drawH = png.height * scale;
  const imgX = (PAGE_W - drawW) / 2;
  const imgY = imgTop - drawH; // caption is anchored, so any slack sits here

  if (drawH > boxH + 0.5) throw new Error(`image overflows its box on ${s.slug}`);
  if (captionH > PAGE_H - FOOTER - 40) throw new Error(`caption too tall on ${s.slug}`);

  const ops = [];
  ops.push(`0.945 0.922 0.867 RG 0.6 w ${imgX} ${imgY} ${drawW} ${drawH} re S`);
  ops.push(`q ${drawW} 0 0 ${drawH} ${imgX} ${imgY} cm /Im0 Do Q`);
  ops.push(`${INK} rg 0 0 ${PAGE_W} ${FOOTER} re f`);
  ops.push(text('Heritage Bites  ·  Every Bite Tells a Story', MARGIN, 7.5, 7.5, 'F2', BONE));
  ops.push(text(`${String(i + 1).padStart(2, '0')} / ${String(screens.length).padStart(2, '0')}`, PAGE_W - MARGIN - 34, 7.5, 7.5, 'F1', BONE));

  let y = captionTop;
  let ruleY = null;
  for (const l of lines) {
    y -= l.lead;
    if (l.spacer) {
      ruleY = y + l.lead / 2;
    } else {
      ops.push(text(l.text, MARGIN + (l.indent ?? 0), y + 2, l.size, l.font, l.colour));
    }
  }
  /* The gold rule marks the "what to look for" line's left edge. */
  if (ruleY !== null) ops.push(`${GOLD} rg ${MARGIN} ${ruleY - 4} 2 8 re f`);

  return { content: ops.join('\n'), png, drawW, drawH, imgX, imgY };
});

/* -------------------------------------------------------------- assemble -- */
append('%PDF-1.4\n');
appendBuffer(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

const kids = [COVER_PAGE, ...screens.map((_, i) => pageNum(i))];
pushObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
pushObject(2, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] >>`);
pushObject(3, `<< /Producer (Heritage Bites screenshot build) /Creator (scripts/build-pdf.mjs) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);

const coverContent = cover.join('\n');
pushObject(COVER_CONTENT, `<< /Length ${Buffer.byteLength(coverContent, 'latin1')} >>\nstream\n${coverContent}\nendstream`);
pushObject(COVER_PAGE, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${FONTS_RES} >> /Contents ${COVER_CONTENT} 0 R >>`);

screens.forEach((s, i) => {
  const p = pageContents[i];

  const contentB = Buffer.from(p.content, 'latin1');
  pushObject(contentNum(i), Buffer.concat([
    Buffer.from(`<< /Length ${contentB.length} >>\nstream\n`, 'latin1'),
    contentB,
    Buffer.from('\nendstream', 'latin1'),
  ]));

  pushObject(pageNum(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Resources << /Font ${FONTS_RES} /XObject << /Im0 ${imageNum(i)} 0 R >> >> /Contents ${contentNum(i)} 0 R >>`);

  const compressed = deflateSync(p.png.rgb, { level: 9 });
  pushObject(imageNum(i), Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${p.png.width} /Height ${p.png.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'),
    compressed,
    Buffer.from('\nendstream', 'latin1'),
  ]));
});

pushObject(FONT_NUMS.F1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
pushObject(FONT_NUMS.F2, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
pushObject(FONT_NUMS.F3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');

/* ------------------------------------------------------------------ xref -- */
const xrefAt = cursor;
/* Objects are numbered 1-65 then 900-902; the gap is a linked free list. */
const FREE = 1;
const freeNums = [];
for (let n = FREE; n <= LAST_OBJ; n += 1) if (!offsets.has(n)) freeNums.push(n);
append(`xref\n0 ${LAST_OBJ + 1}\n`);
const nextFree = (idx) => (idx + 1 < freeNums.length ? freeNums[idx + 1] : 0);
append(`0000000000 ${String(nextFree(0)).padStart(5, '0')} f \n`);
for (let n = 1; n <= LAST_OBJ; n += 1) {
  const off = offsets.get(n);
  if (off === undefined) {
    const idx = freeNums.indexOf(n);
    append(`0000000000 ${String(nextFree(idx)).padStart(5, '0')} f \n`);
  } else {
    append(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
}
append(`trailer\n<< /Size ${LAST_OBJ + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

const pdf = Buffer.concat(chunks);

/* ---------------------------------------------------------------- verify -- */
/* Before writing: every xref entry must point at its object's own header. */
for (const [num, off] of offsets) {
  const at = pdf.subarray(off, off + 24).toString('latin1');
  if (!at.startsWith(`${num} 0 obj`)) throw new Error(`xref ${num} points at "${at.slice(0, 16)}"`);
}
if (!pdf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) throw new Error('missing header');
if (!pdf.subarray(-6).toString('latin1').includes('%%EOF')) throw new Error('missing EOF');

writeFileSync(OUT, pdf);
console.log(`wrote ${OUT}`);
console.log(`  ${(pdf.length / 1e6).toFixed(1)} MB · ${kids.length} pages · ${screens.length} images · ${LAST_OBJ} objects`);
