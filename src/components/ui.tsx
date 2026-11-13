import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/* ------------------------------- Button ------------------------------- */

type Variant = 'primary' | 'ghost' | 'outline' | 'dark' | 'whatsapp' | 'onDark' | 'danger';

/*
 * Variants carry their own colour on purpose.
 *
 * Overriding colour through `className` does not work in Tailwind: `text-bone`
 * passed in a className and `text-ink` inside the variant are both single-class
 * utilities with equal specificity, so whichever the stylesheet emits last wins —
 * not whichever was written last. That is how the homepage's "View the menu"
 * button shipped invisible: a ghost variant (text-ink) overridden with text-bone
 * on a dark hero, and the ink won. Add a variant instead of overriding.
 */
const variants: Record<Variant, string> = {
  primary: 'bg-ochre text-ink hover:bg-ochre-deep hover:text-bone shadow-[0_2px_0_0_var(--color-ink)]',
  dark: 'bg-ink text-bone hover:bg-ink-3 border border-ink',
  outline: 'border-2 border-ink text-ink hover:bg-ink hover:text-bone',
  ghost: 'text-ink hover:bg-ink/5',
  /* For heroes and cards that are already ink — never for a light background. */
  onDark: 'border border-bone/30 text-bone hover:bg-bone/10',
  danger: 'border-2 border-chili text-chili hover:bg-chili hover:text-bone',
  whatsapp: 'bg-ochre text-ink hover:bg-ochre-deep hover:text-bone',
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}

export function Button({ variant = 'primary', size = 'md', block, className = '', children, ...rest }: BtnProps) {
  /*
    44px is the smallest comfortable touch target (Apple's HIG says 44pt, Android
    says 48dp). These are the only two pill buttons in the app, so the floor is
    set here rather than patched page by page: min-h keeps the height honest even
    when the label is one short word.
  */
  const sizes = { sm: 'min-h-11 min-w-11 px-3.5 py-2 text-sm', md: 'min-h-11 min-w-11 px-5 py-2.5 text-sm', lg: 'min-h-12 min-w-12 px-7 py-3.5 text-base' }[size];
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold uppercase tracking-wide transition-all duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${sizes} ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: { to?: string; href?: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; className?: string; children: ReactNode } & Record<string, unknown>) {
  /*
    44px is the smallest comfortable touch target (Apple's HIG says 44pt, Android
    says 48dp). These are the only two pill buttons in the app, so the floor is
    set here rather than patched page by page: min-h keeps the height honest even
    when the label is one short word.
  */
  const sizes = { sm: 'min-h-11 min-w-11 px-3.5 py-2 text-sm', md: 'min-h-11 min-w-11 px-5 py-2.5 text-sm', lg: 'min-h-12 min-w-12 px-7 py-3.5 text-base' }[size];
  const cls = `inline-flex items-center justify-center gap-2 rounded-full font-semibold uppercase tracking-wide transition-all duration-200 active:translate-y-px ${sizes} ${variants[variant]} ${className}`;
  if (href) {
    return (
      <a href={href} className={cls} {...(rest as object)} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link to={to ?? '#'} className={cls} {...(rest as object)}>
      {children}
    </Link>
  );
}

/* -------------------------------- Badge ------------------------------- */

export function Badge({ children, tone = 'ochre', className = '' }: { children: ReactNode; tone?: string; className?: string }) {
  const tones: Record<string, string> = {
    ochre: 'bg-ochre/20 text-ochre-deep border-ochre/40',
    chili: 'bg-chili/15 text-chili border-chili/30',
    morogo: 'bg-ochre/15 text-ochre-deep border-ochre/30',
    clay: 'bg-clay/15 text-clay border-clay/30',
    sky: 'bg-sky/15 text-sky border-sky/30',
    ink: 'bg-ink/10 text-ink border-ink/20',
    bone: 'bg-bone/15 text-bone border-bone/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${tones[tone] ?? tones.ochre} ${className}`}>
      {children}
    </span>
  );
}

/* ------------------------------- Reveal ------------------------------- */

export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(20px)', transition: `opacity .7s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .7s cubic-bezier(.16,1,.3,1) ${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ------------------------------ Section ------------------------------- */

export function SectionLabel({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  /*
   * The label now opens with the painting's atom rather than a plain rule: an
   * echoed diamond, then the coloured dash, then the words. It appears above
   * every section on every page, so this is where the language is stated most
   * often — a hairline alone said nothing.
   */
  return (
    <div className="mb-4 flex items-center gap-3">
      <DiamondMark className="h-3.5 w-3.5 shrink-0" pigment="ochre" />
      <span className="h-px w-6 bg-ochre" />
      <span className={`font-mono text-xs font-semibold uppercase tracking-[0.22em] ${onDark ? 'text-ochre' : 'text-ochre-deep'}`}>{children}</span>
    </div>
  );
}

export function Spinner({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-ink/60">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ochre border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/* -------------------------------- Toast ------------------------------- */

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2">
      <div className="animate-pop rounded-full bg-ink px-5 py-3 text-sm font-medium text-bone shadow-xl">{message}</div>
    </div>
  );
}

/* --------------------------- SA motifs -------------------------------- */

/*
 * Heritage graphics, drawn rather than photographed.
 *
 * The reference is Dr Esther Mahlangu's Ndebele wall painting. Four things in it
 * look like nothing else, and all four are load-bearing here:
 *
 *   1. A chalk-white ground. The colour is painted onto lime plaster, so the
 *      white is not empty space — it is the brightest pigment in the scheme.
 *   2. Heavy black outlines. Every shape is drawn, not filled to its edge; the
 *      ink contour is what makes the colour read as painted rather than printed.
 *   3. Nested "echo" shapes. A diamond inside a diamond inside a diamond, each
 *      band a different colour, so the eye keeps finding another edge.
 *   4. Pinstripe kerbs. Thin stacked rules — black, white, colour — run along
 *      the borders and between the big shapes.
 *
 * The palette below is a translation, not a copy: the brand's antique gold stays
 * the lead accent, and the earth/clay red, sky blue, leaf green and chalk are
 * pitched to sit beside navy and bone without turning the shopfront into a
 * gallery wall.
 *
 * Everything here is decorative and points nowhere: each motif is aria-hidden
 * and focusable="false". Repeating tiles are generated as real geometry rather
 * than <pattern id="…">, because a pattern needs a document-global id and every
 * meal card would then emit the same one (duplicate ids are invalid, and they
 * also forced every instance of a motif to be identical).
 */

/** Ndebele pigments, plus the brand navy used as the painting's outline. */
export const MHALANGU = {
  ochre: 'var(--color-ochre)', /* #b77e23 — the brand gold, the lead accent */
  gold: '#d99b2b', /* the brighter mid-gold of a freshly painted band */
  red: '#a33b26', /* clay red, as on a painted wall */
  blue: '#1f4e79', /* sky blue, darker than the navy ink */
  green: '#2f6b4f', /* leaf green */
  chalk: '#f7f2e6', /* the lime-plaster white the paint sits on */
  ink: 'var(--color-ink)', /* #001938 — every contour */
} as const;

type Pigment = keyof typeof MHALANGU;
const P = MHALANGU;

/* ---------------------------------------------------------------------- */
/* Repetition helpers                                                      */
/* ---------------------------------------------------------------------- */

/**
 * Repeat an inline group across `count` tiles of `w`.
 *
 * This is what a <pattern> would do, without needing an id — so a motif can be
 * used as many times on a page as it likes.
 */
function tile(count: number, w: number, draw: (x: number) => React.ReactNode) {
  return Array.from({ length: count }, (_, i) => (
    <g key={i} transform={`translate(${i * w} 0)`}>
      {draw(i)}
    </g>
  ));
}

/** Echoed diamond: concentric diamonds, each band its own pigment. */
function diamonds(cx: number, cy: number, radii: number[], pigments: Pigment[]) {
  return radii.map((r, i) => (
    <path
      key={i}
      d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`}
      fill={P[pigments[i % pigments.length]]}
      stroke={P.ink}
      strokeWidth={i === 0 ? 1.6 : 0.9}
      strokeLinejoin="miter"
    />
  ));
}

/**
 * Nested chevron fan, built from filled triangles rather than offset strokes.
 *
 * Stroking a path and moving it sideways does not keep the legs parallel — the
 * bands cross and the motif reads as a wishbone. Drawing each register as a
 * triangle with its apex pulled down and its base pulled in by the same ratio
 * keeps every leg on one slope, so the colours sit in true parallel bands. The
 * ink contour is each triangle's own stroke, which is why the band divisions
 * are outlined for free.
 */
function chevronFan(
  cx: number,
  apexY: number,
  baseY: number,
  halfW: number,
  registers: { colour: Pigment; t: number; w?: number }[],
) {
  const k = halfW / (baseY - apexY);
  return registers.map(({ colour, t, w = 0.9 }, i) => {
    const ay = apexY + t;
    const hw = halfW - t * k;
    return (
      <path
        key={i}
        d={`M${cx} ${ay} L${cx + hw} ${baseY} L${cx - hw} ${baseY} Z`}
        fill={P[colour]}
        stroke={P.ink}
        strokeWidth={w}
        strokeLinejoin="miter"
      />
    );
  });
}

/* ---------------------------------------------------------------------- */
/* Bands — the section and card edges                                      */
/* ---------------------------------------------------------------------- */

/**
 * Ndebele painted kerb: a pinstripe rail, a run of echoed diamonds, a second
 * pinstripe rail. The full grammar of a painted border in 20px of height.
 *
 * `on` picks the ground — chalk for paper sections, ink for the navy bars — and
 * only changes the rail and the kerb colour, never the diamonds.
 */
export function HeritageBand({ className = '', on = 'chalk', style }: { className?: string; on?: 'chalk' | 'ink'; style?: React.CSSProperties }) {
  /*
   * Drawn at roughly the ratio it is used at.
   *
   * The band is stretched across the full page width but is only 10–16 px tall,
   * so `preserveAspectRatio="none"` squashes it vertically by about 40×. A
   * viewBox of 128×16 (8:1) against a 1440×10 box (144:1) turned the triangles
   * into slivers. At 480×12 the two ratios are close enough that a triangle is
   * still a triangle, and the shape survives the stretch.
   *
   * Only two devices are used, because that is all that survives at this size:
   * a pinstripe kerb and a register of solid triangles.
   */
  const ground = on === 'ink' ? P.ink : P.chalk;
  const rail = on === 'ink' ? P.chalk : P.ink;
  const wedges: Pigment[] = ['red', 'blue', 'green', 'gold'];
  return (
    <svg viewBox="0 0 480 12" className={className} style={style} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect width="480" height="12" fill={ground} />
      <rect y="0" width="480" height="1.6" fill={rail} />
      <rect y="1.6" width="480" height="1" fill={P.gold} />
      {tile(60, 8, (i) => (
        <path
          d={i % 2 === 0 ? 'M0 10.4 L4 3 L8 10.4 Z' : 'M0 3 L4 10.4 L8 3 Z'}
          fill={P[wedges[i % 4]]}
          stroke={P.ink}
          strokeWidth="1"
          strokeLinejoin="miter"
        />
      ))}
      <rect y="10.4" width="480" height="1.6" fill={rail} />
    </svg>
  );
}

/**
 * Bespoke geometric band, the width of a card's head.
 *
 * Used where a band needs to read as a designed object rather than a repeat:
 * a fan of nested chevrons over a stepped plinth, in the palette's order.
 */
export function HeritageFrieze({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  /*
   * Three bold registers, not six fine ones.
   *
   * The first version nested six bands and was legible at 70 px but turned to
   * noise at 32 px, which is the height a meal card actually gives it. Fewer,
   * fatter bands survive both sizes, so the fan still reads as a painted
   * chevron when it is only a thumbnail of one.
   *
   * The viewBox is wide (640) because a frieze is stretched to the section
   * width; a short viewBox shears the chevrons when it is stretched.
   */
  return (
    <svg viewBox="0 0 640 48" className={className} style={style} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect width="640" height="48" fill={P.chalk} />
      {tile(16, 40, (i) => {
        const lead: Pigment[] = ['red', 'blue', 'green', 'gold'];
        const accent: Pigment[] = ['blue', 'green', 'gold', 'red'];
        return (
          <g>
            {chevronFan(20, 5, 38, 18, [
              { colour: 'ink', t: 0, w: 1.2 },
              { colour: lead[i % 4], t: 5 },
              { colour: 'chalk', t: 10 },
              { colour: accent[i % 4], t: 15 },
              { colour: 'chalk', t: 20 },
              { colour: 'gold', t: 25 },
            ])}
          </g>
        );
      })}
      {/* A single plinth rule, not a mosaic of blocks: at card size the mosaic
          became grey mush, and the chevrons above it are the subject anyway. */}
      <rect y="38" width="640" height="4" fill={P.ink} />
      <rect y="42" width="640" height="3" fill={P.gold} />
      <rect y="45" width="640" height="3" fill={P.ink} />
    </svg>
  );
}

/**
 * Widened shweshwe print: the cloth's triangle rows, at poster scale.
 *
 * Three stacked registers — up-chevrons, echoed diamonds, down-chevrons — with
 * alternating field colours, so it reads as fabric rather than as a gradient.
 */
export function ShweshwePanel({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 96 68" className={className} style={style} aria-hidden="true" focusable="false">
      <rect width="96" height="68" fill={P.chalk} />
      {/* Register 1: echoed up-chevrons. */}
      {tile(6, 16, (i) => (
        <g>
          {chevronFan(8, 3, 22, 7.4, [
            { colour: i % 2 ? 'blue' : 'red', t: 0, w: 1 },
            { colour: 'chalk', t: 5 },
            { colour: i % 2 ? 'gold' : 'green', t: 10 },
          ])}
        </g>
      ))}
      <rect y="22" width="96" height="1.8" fill={P.ink} />
      <rect y="23.8" width="96" height="1.2" fill={P.gold} />
      {/* Register 2: echoed diamonds. */}
      {tile(6, 16, (i) => (
        <g>{diamonds(8, 33, [8, 5.2, 2.2], [i % 2 ? 'green' : 'gold', 'chalk', 'red'])}</g>
      ))}
      <rect y="41.4" width="96" height="1.2" fill={P.blue} />
      <rect y="42.6" width="96" height="1.8" fill={P.ink} />
      {/* Register 3: the echoed fan inverted. */}
      {tile(6, 16, (i) => (
        <g>
          <g transform="translate(0 44) scale(1 -1) translate(0 -22)">
            {chevronFan(8, 3, 22, 7.4, [
              { colour: i % 2 ? 'gold' : 'green', t: 0, w: 1 },
              { colour: 'chalk', t: 5 },
              { colour: i % 2 ? 'red' : 'blue', t: 10 },
            ])}
          </g>
        </g>
      ))}
    </svg>
  );
}

/**
 * Ndebele stepped rule: a pinstripe ladder with an echoed diamond at each turn.
 * The section-closing device, where a plain hairline used to be.
 */
export function WovenRule({ className = '', on = 'chalk', style }: { className?: string; on?: 'chalk' | 'ink'; style?: React.CSSProperties }) {
  const rail = on === 'ink' ? P.chalk : P.ink;
  return (
    <svg viewBox="0 0 320 10" className={className} style={style} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {tile(8, 16, (i) => (
        <g>
          <rect x="0" y="0" width="16" height="4" fill={P[i % 2 ? 'blue' : 'ochre']} />
          <rect x="0" y="0" width="16" height="4" fill="none" stroke={rail} strokeWidth="1" />
          <rect x="0" y="6" width="16" height="4" fill={P[i % 2 ? 'ochre' : 'blue']} />
          <rect x="0" y="6" width="16" height="4" fill="none" stroke={rail} strokeWidth="1" />
          <path d="M8 0.6 L15 5 L8 9.4 L1 5 Z" fill={P.chalk} stroke={rail} strokeWidth="0.8" />
          <path d="M8 2.6 L11.6 5 L8 7.4 L4.4 5 Z" fill={P.red} />
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------------- */
/* Marks — small, and used repeatedly                                     */
/* ---------------------------------------------------------------------- */

/**
 * A pair of Ndebele chevrons, drawn as painted strokes: a chalk ground-stroke
 * under a coloured one, then the ink contour. The mark used beside headings.
 */
export function HeritageMark({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 36 32" className={className} style={style} aria-hidden="true" focusable="false">
      {chevronFan(18, 5, 29, 15, [
        { colour: 'ink', t: 0, w: 1.1 },
        { colour: 'red', t: 4 },
        { colour: 'chalk', t: 8 },
        { colour: 'gold', t: 12 },
        { colour: 'chalk', t: 16 },
      ])}
    </svg>
  );
}

/**
 * Standalone echoed diamond — the painting's atom, for badges and bullet marks.
 */
export function DiamondMark({ className = '', pigment = 'ochre', style }: { className?: string; pigment?: Pigment; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={style} aria-hidden="true" focusable="false">
      {/* A chalk halo so an ink-bodied diamond still reads on the navy bars. */}
      <path d="M8 0.4 L15.6 8 L8 15.6 L0.4 8 Z" fill={P.chalk} />
      {diamonds(8, 8, [7.2, 4.6, 2], ['ink', 'chalk', pigment])}
    </svg>
  );
}

/**
 * The three-legged pot, painted: flat pigment fills inside a heavy ink contour,
 * with a chalk ground-stroke behind it so it holds on a navy field.
 */
export function PotMark({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  /*
   * A three-legged pot, not a bowl: the body is wider than tall and stops well
   * above the baseline, so the three splayed legs have somewhere to be. Every
   * part carries a chalk halo first, which is what lets the ink contour survive
   * on the navy bars it is most often placed on.
   */
  const body = 'M4 12.6h24l-2.2 9.2a5 5 0 0 1-4.9 3.8H11.1a5 5 0 0 1-4.9-3.8Z';
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} aria-hidden="true" focusable="false">
      <g stroke={P.chalk} strokeWidth="4.8" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <path d={body} />
        <path d="M9.6 25.4 6 31M16 25.6V31M22.4 25.4 26 31" />
        <rect x="1.4" y="9.2" width="29.2" height="4.2" rx="1.6" />
      </g>
      <path d="M9.6 25.4 6 31M16 25.6V31M22.4 25.4 26 31" stroke={P.ink} strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <path d={body} fill={P.red} stroke={P.ink} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6.2 16.6h19.6l-1 4.4H7.1Z" fill={P.gold} stroke={P.ink} strokeWidth="1" strokeLinejoin="round" />
      <rect x="1.4" y="9.2" width="29.2" height="4.2" rx="1.6" fill={P.chalk} stroke={P.ink} strokeWidth="1.8" />
    </svg>
  );
}

/**
 * Full Ndebele panel — the "big motif" for a hero or an empty surface.
 *
 * Deliberately built from the three devices above (echoed diamonds, chevron
 * fans, pinstripe kerbs) rather than from new shapes: it is the same visual
 * language at a larger size, which is what stops the page looking decorated
 * at random.
 */
export function NdebelePanel({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  /*
   * A painted panel in the Mahlangu manner: the wings are large flat colour
   * wedges divided on the diagonal inside a heavy ink frame, each hung with a
   * small pendant arrow; the centre is a column of echoed diamonds on sky.
   *
   * Two constraints shape it. It cannot use concentric chevrons — the first
   * version did, and the wings read as capital A's, a letterform rather than a
   * painting. And its viewBox has to match the box it is put in: at 320×128
   * (2.5:1) inside a 463×112 card (4.1:1) `slice` cropped the top and bottom off
   * the diamonds. So it is drawn wide, 4:1, and laid out as two registers per
   * wing rather than three.
   */
  const W = 320;
  const H = 80;
  const colX = 118;
  const colW = 84;

  const registers: { a: Pigment; b: Pigment; c: Pigment }[] = [
    { a: 'green', b: 'gold', c: 'red' },
    { a: 'blue', b: 'red', c: 'gold' },
  ];

  const wing = (flip: boolean) => (
    <g transform={flip ? `translate(${W} 0) scale(-1 1)` : undefined}>
      {registers.map(({ a, b, c }, i) => {
        const y = 10 + i * 34;
        const h = 30;
        return (
          <g key={i}>
            <rect x="11" y={y} width="97" height={h} fill={P.chalk} stroke={P.ink} strokeWidth="2.2" />
            {/* The large wedge, cut corner to corner. */}
            <path d={`M11 ${y} L108 ${y} L11 ${y + h} Z`} fill={P[a]} stroke={P.ink} strokeWidth="1.8" strokeLinejoin="miter" />
            {/* Two echoes between parallel diagonals, so they read as bands. */}
            <path d={`M21 ${y + 5} L98 ${y + 5} L21 ${y + h - 5} Z`} fill={P[b]} stroke={P.ink} strokeWidth="1.5" strokeLinejoin="miter" />
            <path d={`M31 ${y + 10} L86 ${y + 10} L31 ${y + h - 10} Z`} fill={P[c]} stroke={P.ink} strokeWidth="1.3" strokeLinejoin="miter" />
            {/* Pendant arrow hanging off the inner edge. */}
            <path d={`M108 ${y + h / 2 - 8} L119 ${y + h / 2} L108 ${y + h / 2 + 8} Z`} fill={P.gold} stroke={P.ink} strokeWidth="1.6" strokeLinejoin="miter" />
          </g>
        );
      })}
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} style={style} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width={W} height={H} fill={P.chalk} />
      {wing(false)}
      {wing(true)}

      {/* Central column: two echoed diamonds on sky. */}
      <rect x={colX} y="6" width={colW} height={H - 12} fill={P.blue} stroke={P.ink} strokeWidth="2.4" />
      {[26, 54].map((cy, idx) => (
        <g key={cy}>
          {diamonds(colX + colW / 2, cy, [16, 11.8, 7.8, 3.8, 1.5], [idx % 2 ? 'gold' : 'red', 'chalk', idx % 2 ? 'green' : 'gold', 'chalk', 'ink'])}
        </g>
      ))}

      {/* Ink frame, gold inner kerb. */}
      <rect x="0" y="0" width={W} height="5" fill={P.ink} />
      <rect x="0" y={H - 5} width={W} height="5" fill={P.ink} />
      <rect x="0" y="5" width={W} height="2" fill={P.gold} />
      <rect x="0" y={H - 7} width={W} height="2" fill={P.gold} />
      <rect x="0" y="0" width="5" height={H} fill={P.ink} />
      <rect x={W - 5} y="0" width="5" height={H} fill={P.ink} />
    </svg>
  );
}

/* ------------------------------ Field -------------------------------- */
/* ------------------------------ Field -------------------------------- */

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /**
   * Marks the field as mandatory with a red asterisk.
   *
   * Only the asterisk is red: the label stays ink, because a red "Your name"
   * reads as an error before the customer has typed anything. The word itself is
   * not written out either — an asterisk is the convention, and "required" next
   * to a field the browser already enforces is noise.
   */
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="ml-1 text-chili">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </span>
        {hint && !error && <span className="text-xs text-ink/45">{hint}</span>}
      </span>
      {children}
      {/* Errors can quote the business's number (the "no inbox" notice), so the
          text goes through ContactText and stays tappable in the message. */}
      {error && (
        <span className="mt-1 block text-[12px] font-medium text-chili">
          <ContactText>{error}</ContactText>
        </span>
      )}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border-2 border-ink/12 bg-white px-4 py-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-ochre';

/* --------------------------- Contact links ---------------------------- */

/**
 * The business's own number and address, as they appear inside a sentence.
 *
 * Kept deliberately narrow: this links the kitchen's real number and inbox and
 * nothing else, because the same pages carry placeholder numbers ("e.g.
 * 082 123 4567") that must stay plain text — a tap-to-dial link on an example
 * number is a call to a stranger.
 */
const HB_PHONE = /(?:\+27|0)\s?67\s?013\s?7587/;
const HB_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;

/**
 * Render a sentence with the kitchen's phone number and email address as links.
 *
 * Used for copy this file does not hand-write — API error notices, policy notes,
 * the service strip — so "+27 67 013 7587" is tappable wherever it appears. On a
 * phone, a number a customer cannot tap is a dead end.
 */
export function ContactText({ children, className = '' }: { children: string; className?: string }) {
  const parts = String(children ?? '').split(new RegExp(`(${HB_PHONE.source}|${HB_EMAIL.source})`, 'g'));

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (HB_PHONE.test(part)) {
          return (
            <a key={index} href={`tel:${part.replace(/[^\d+]/g, '')}`} className="font-semibold underline underline-offset-2">
              {part}
            </a>
          );
        }
        if (HB_EMAIL.test(part)) {
          return (
            <a key={index} href={`mailto:${part}`} className="font-semibold underline underline-offset-2">
              {part}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}

/* --------------------------- Quantity stepper ------------------------- */

export function Qty({ value, onChange, min = 1, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="inline-flex items-center rounded-full border-2 border-ink/12 bg-white">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-9 w-9 place-items-center rounded-full text-lg text-ink transition-colors hover:bg-ink hover:text-bone disabled:opacity-30"
        disabled={value <= min}
      >
        −
      </button>
      <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-9 w-9 place-items-center rounded-full text-lg text-ink transition-colors hover:bg-ink hover:text-bone disabled:opacity-30"
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}
