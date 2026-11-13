import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
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
  return (
    <div className="mb-4 flex items-center gap-3">
      <DiamondMark className="h-3 w-3 shrink-0" pigment="ochre" />
      <span className="h-px w-8 bg-ochre" />
      <span className={`font-mono text-xs font-semibold uppercase tracking-[0.22em] ${onDark ? 'text-ochre' : 'text-ochre-deep'}`}>{children}</span>
    </div>
  );
}

/* ------------------------------ Spinner ------------------------------- */

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
 * The reference is Dr Esther Mahlangu's Ndebele wall painting, and what makes
 * it recognisable is four things together: a chalk-white ground, a heavy ink
 * contour around every filled shape, flat pigment inside that contour, and
 * nested "echo" bands repeating the same shape smaller. Drop any one and it
 * stops being the painting and becomes generic decoration.
 *
 * Two things defeated the first version of this block, and both are worth
 * stating because the fixes are structural, not cosmetic:
 *
 * 1. STRETCHING. Every band used preserveAspectRatio="none" to fill the page
 *    width. A path stretched 6× horizontally also has its stroke stretched:
 *    a 1.2-unit contour rendered 7px wide and 1px tall, so the ink outline
 *    turned into a black wedge and the chevron into a smear. No amount of
 *    extra geometry survives that.
 *
 *    Bands are now TILED, not stretched — a <pattern> repeats a tile at its
 *    natural size, so the geometry never distorts at any viewport width. This
 *    is the one place a pattern id is safe: React's useId gives every instance
 *    its own, so the duplicate-id problem that killed the very first version
 *    (twelve elements sharing id="hb-band") cannot recur.
 *
 * 2. HEIGHT. Six pixels cannot hold a ground, a contour and a fill. A chevron
 *    needs about fourteen to keep an ink edge; below that the three collapse
 *    into each other. Bands are h-3 at the thinnest and h-4 to h-6 where the
 *    composition is meant to be seen.
 *
 * Scale map:
 *
 *   HeritageBand   12–24px tall, tiled      -> flat chevrons between kerbs
 *   WovenRule      6–8px,  96–160px wide    -> stepped blocks, small
 *   ShweshwePanel  24px,   ~463px wide      -> four cloth registers
 *   HeritageMark   28px                      -> nested chevrons
 *   PotMark        16px                      -> one silhouette
 *   DiamondMark    12px                      -> three echoes
 *
 * Every motif is decorative and points nowhere: aria-hidden and
 * focusable="false".
 */

/** Ndebele pigments, plus the brand navy used as the painting's contour. */
export const MHALANGU = {
  ochre: 'var(--color-ochre)', /* #b77e23 — the brand gold, the lead accent */
  gold: '#d99b2b',             /* brighter mid-gold of a freshly painted band */
  red: '#a33b26',              /* clay red, as on a painted wall */
  blue: '#1f4e79',             /* sky blue, darker than the navy contour */
  green: '#2f6b4f',            /* leaf green */
  chalk: '#f7f2e6',            /* the lime-plaster white the paint sits on */
  ink: 'var(--color-ink)',     /* #001938 — every contour */
} as const;

type Pigment = keyof typeof MHALANGU;
const P = MHALANGU;

/** The repeating sequence. Four pigments, so a four-unit tile loops cleanly. */
const CYCLE: Pigment[] = ['ochre', 'red', 'blue', 'green'];

/* ---------------------------------------------------------------------- */
/* Repetition helpers                                                      */
/* ---------------------------------------------------------------------- */

/**
 * A per-instance id, safe for a <pattern>.
 *
 * useId alone is not enough here. React 18 returns short ids like "r0" inside a
 * root that is not a server-rendered tree, and two ids were colliding in
 * practice: every band on the page resolved to href "#hb-band-r0", so only the
 * first one's <defs> was ever used and the rest painted nothing.
 *
 * A module-level counter appended to the useId value makes the id unique for
 * the document regardless of what useId returns.
 */
let patternSeq = 0;
function usePatternId(prefix: string) {
  const base = useId().replace(/:/g, '');
  const seq = useRef<number | null>(null);
  if (seq.current === null) seq.current = ++patternSeq;
  return `${prefix}-${base}-${seq.current}`;
}

/** Repeat an inline group across `count` tiles of `w`. */
function tile(count: number, w: number, draw: (i: number) => React.ReactNode) {
  return Array.from({ length: count }, (_, i) => (
    <g key={i} transform={`translate(${i * w} 0)`}>
      {draw(i)}
    </g>
  ));
}

/** Echoed diamond: concentric diamonds, each band its own pigment, ink-contoured. */
function diamonds(cx: number, cy: number, radii: number[], pigments: Pigment[]) {
  return radii.map((r, i) => (
    <path
      key={i}
      d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`}
      fill={P[pigments[i % pigments.length]]}
      stroke={P.ink}
      strokeWidth={i === 0 ? 1.2 : 1}
      strokeLinejoin="miter"
    />
  ));
}

/**
 * The diamond-and-dot mark: the atom of the painting, at heading scale.
 *
 * Three echoes in twelve pixels is the limit; a chalk halo sits behind so the
 * ink body still reads when the mark is placed on navy rather than paper.
 */
export function DiamondMark({ className = '', pigment = 'ochre', style }: { className?: string; pigment?: Pigment; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 16 16" className={className} style={style} aria-hidden="true" focusable="false">
      <path d="M8 0.4 L15.6 8 L8 15.6 L0.4 8 Z" fill={P.chalk} />
      {diamonds(8, 8, [7.2, 4.8, 2.2], ['ink', 'chalk', pigment])}
    </svg>
  );
}

/**
 * HeritageBand — the full-bleed rule that closes a section or crowns a card.
 *
 * A tiled register of flat chevrons between two pinstripe kerbs, on a chalk
 * ground.
 *
 * The tiling is the whole trick, and it took three attempts to get right. With
 * preserveAspectRatio="none" a 1000-unit viewBox forced into a 290px card
 * squeezes each 64-unit tile to 18px wide while it stays 16px tall — the
 * chevrons come out as thin dark spikes. A <pattern> does not rescue that,
 * because the pattern is squeezed by the same transform.
 *
 * So the viewBox is set to the width the element is ACTUALLY given, and the
 * pattern tile with it. The 290px card gets a 290-unit viewBox and 32-unit
 * tiles; the full-bleed rule gets 1440 and 64. Aspect ratio is then ~1:1 and
 * nothing is distorted, while the tiling still fills the width at every size
 * without knowing it in advance — the pattern repeats to the edge by itself.
 */
export function HeritageBand({
  className = '',
  on = 'chalk',
  style,
  width = 1440,
  tile: tileSize = 64,
}: {
  className?: string;
  on?: 'chalk' | 'ink';
  style?: React.CSSProperties;
  /** The width the band is rendered at. Governs the viewBox so nothing distorts. */
  width?: number;
  tile?: number;
}) {
  const id = usePatternId('hb-band');
  const dark = on === 'ink';
  const height = 16;
  const step = tileSize / 4;
  const base = height - 4.4;
  const apex = 5.2;
  const kerb = dark ? P.chalk : P.ink;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'block', width: '100%', ...style }}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={id} width={tileSize} height={height} patternUnits="userSpaceOnUse">
          <rect width={tileSize} height={height} fill={P.chalk} />
          {Array.from({ length: 4 }, (_, k) => {
            const cx = k * step + step / 2;
            return (
              <path
                key={k}
                d={`M${cx - step} ${base} L${cx} ${apex} L${cx + step} ${base} Z`}
                fill={P[CYCLE[k]]}
                stroke={P.ink}
                strokeWidth="1.4"
                strokeLinejoin="miter"
              />
            );
          })}
        </pattern>
      </defs>
      <rect width={width} height={height} fill={P.chalk} />
      <rect width={width} height={height} fill={`url(#${id})`} />
      {/* Kerb above, plinth below: the pinstripe that frames a painted band. */}
      <rect width={width} height="2" fill={kerb} />
      <rect y="2" width={width} height="1.2" fill={P.gold} />
      <rect y={height - 3.2} width={width} height="1.2" fill={P.gold} />
      <rect y={height - 2} width={width} height="2" fill={kerb} />
    </svg>
  );
}

/**
 * WovenRule — the stepped block rule in the hero and on checkout.
 *
 * Rendered 96–160px wide at 6–8px tall, so it tiles too: each block keeps its
 * contour instead of smearing. Alternating blocks sit at two heights, which is
 * what makes it read as woven rather than as a bar chart.
 */
export function WovenRule({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const id = usePatternId('hb-woven');
  return (
    <svg viewBox="0 0 96 8" className={className} style={style} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width="16" height="8" patternUnits="userSpaceOnUse">
          <rect width="16" height="8" fill={P.chalk} />
          {[0, 1, 2, 3].map((k) => (
            <rect
              key={k}
              x={k * 4 + 0.5}
              y={k % 2 === 0 ? 1.2 : 3.4}
              width="3"
              height="3.4"
              fill={P[CYCLE[k]]}
              stroke={P.ink}
              strokeWidth="0.9"
            />
          ))}
        </pattern>
      </defs>
      <rect width="96" height="8" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * ShweshwePanel — the cloth print, hero-sized.
 *
 * Four registers of alternating up/down triangles on a chalk ground. Rendered
 * ~463×24, so each register is 6px: enough for a fill and a contour, which is
 * all it needs. The old version drew three thin rows on navy, where the ink
 * contour had nothing to contrast against and the print vanished.
 */
export function ShweshwePanel({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 96 24" className={className} style={style} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect width="96" height="24" fill={P.chalk} />
      {CYCLE.map((pig, r) => (
        <g key={r}>
          {tile(12, 8, (i) => (
            <path
              d={
                (i + r) % 2 === 0
                  ? `M0 ${r * 6} L4 ${r * 6 + 6} L8 ${r * 6} Z`
                  : `M0 ${r * 6 + 6} L4 ${r * 6} L8 ${r * 6 + 6} Z`
              }
              fill={P[pig]}
              stroke={P.ink}
              strokeWidth="0.8"
              strokeLinejoin="miter"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * HeritageMark — the chevron pair beside a heading or a list item.
 *
 * Rendered at 28×28, which is enough room for nested chevrons with real ink
 * weight. The old version was two thin strokes: a stroke keeps its width but has
 * no interior, so the mark carried no pigment at all. These are filled fans with
 * a chalk echo inside.
 */
export function HeritageMark({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true" focusable="false">
      <path d="M3 16 L9 7 L15 16 Z" fill={P.ochre} stroke={P.ink} strokeWidth="1.8" strokeLinejoin="miter" />
      <path d="M5.6 14.2 L9 9.4 L12.4 14.2 Z" fill={P.chalk} stroke={P.ink} strokeWidth="1.1" strokeLinejoin="miter" />
      <path d="M10 20 L16 11 L22 20 Z" fill={P.blue} stroke={P.ink} strokeWidth="1.8" strokeLinejoin="miter" />
      <path d="M12.6 18.2 L16 13.4 L19.4 18.2 Z" fill={P.chalk} stroke={P.ink} strokeWidth="1.1" strokeLinejoin="miter" />
    </svg>
  );
}

/**
 * PotMark — the three-legged pot, rendered at 16×16.
 *
 * Sixteen pixels cannot carry a rim, a belly band, flames and three legs. The
 * old version tried all four in hairlines and read as a teacup. What survives at
 * this size is one silhouette: a body wider than it is tall, a flat rim, and
 * three splayed legs — one pigment, one contour, one interior line.
 */
export function PotMark({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} aria-hidden="true" focusable="false">
      <path
        d="M4 7 H28 V12.5 C28 18 24 22 18.5 22.6 L20.6 27 H15.8 L14.4 23.4 H17.2 L15.4 22.6 H16.6 L14.8 27 H10 L12.2 22.6 C6.5 22 3 18 3 12.5 Z"
        fill={P.ochre}
        stroke={P.ink}
        strokeWidth="2.4"
        strokeLinejoin="miter"
      />
      {/* The one interior echo that still reads: a rim line. */}
      <path d="M5.4 11 H26.6" stroke={P.ink} strokeWidth="2" />
    </svg>
  );
}

/* ---------------------------- Channel icons ---------------------------- */

/*
 * The delivery partners, drawn rather than lettered.
 *
 * These used to be two-letter text ("UE", "MD", "WA") inside a plate. That is a
 * placeholder that shipped: a customer looking for the app they already have on
 * their phone recognises a mark, not an abbreviation. Each icon below is the
 * partner's own silhouette in a single path, so it costs one inline node and no
 * network request.
 *
 * They are decorative — the card beside each one carries the name in text — so
 * every icon is aria-hidden.
 */
export function UberEatsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" fill="currentColor">
      {/*
        The Uber Eats wordmark, "Uber" stacked over "Eats", from the official
        brand path — the same mark that sits on the customer's home screen.

        What was here before was drawn from memory and wrong twice over: first
        two plain bars (which read as a hamburger-menu button), then a takeaway
        box with a dotted band, which is not the Uber Eats logo at all.
      */}
      <path d="M0 2.8645v4.9972c0 1.8834 1.3315 3.1297 3.0835 3.1297a2.9652 2.9652 0 0 0 2.1502-.876v.7425H6.445V2.8645H5.223v4.9339c0 1.2642-.8696 2.1198-1.9954 2.122-1.1386-.0023-1.997-.834-1.997-2.122V2.8645zm7.3625 0v7.9934h1.163v-.7318a2.9915 2.9915 0 0 0 2.1177.876c1.714.048 3.1295-1.3283 3.1295-3.0429s-1.4155-3.091-3.1295-3.0429a2.9674 2.9674 0 0 0-2.107.876V2.8645zm9.8857 2.0561c-1.6752-.0074-3.0369 1.3492-3.0356 3.0245 0 1.7366 1.3732 3.0373 3.1537 3.0373a3.123 3.123 0 0 0 2.5578-1.2438l-.8495-.6177a2.0498 2.0498 0 0 1-1.7083.8585c-.9763.0126-1.8147-.6915-1.971-1.6553h4.818v-.379c0-1.734-1.254-3.0238-2.9638-3.0245zm6.1632.0667a1.5943 1.5943 0 0 0-1.376.7657v-.7186h-1.163v5.8235h1.1741V7.5465c0-.9023.5581-1.4847 1.3268-1.4847h.4949V4.9886c-.1576.0013-.3186-.0009-.4568-.0013zm-6.2034.944a1.844 1.844 0 0 1 1.8337 1.486H15.424a1.844 1.844 0 0 1 1.784-1.486zm-6.6589.0056c1.1223-.0084 2.0365.8992 2.0364 2.0215-.0026 1.1203-.914 2.0258-2.0343 2.021a2.0151 2.0151 0 0 1-1.4159-.5987A2.0152 2.0152 0 0 1 8.55 7.9592a2.0152 2.0152 0 0 1 .5838-1.422 2.0152 2.0152 0 0 1 1.4153-.6003zM0 12.9864v7.9716h5.7222v-1.3666H1.5458v-1.971h4.0647v-1.314H1.5458v-1.9556h4.1764v-1.3644zm14.5608.4097v1.6861h-1.1519v1.338h1.1545v3.143c0 .7927.5712 1.4209 1.6005 1.4209h1.6425L17.8 19.646h-1.1412c-.3482 0-.5714-.1509-.5714-.464v-2.7683H17.8v-1.3316h-1.7062v-1.686zm-5.2974 1.5275c-1.7348-.0103-3.141 1.4035-3.1214 3.1382.0196 1.7346 1.4575 3.1163 3.1915 3.0668a2.9915 2.9915 0 0 0 1.912-.6655v.532h1.5175v-5.9129h-1.509v.5257a3.0047 3.0047 0 0 0-1.9205-.6835c-.0244-.0007-.0492-.0006-.0701-.0008zm11.771.0077c-1.5855 0-2.7002.6437-2.7002 1.8854 0 .8607.6132 1.4213 1.936 1.695l1.4478.3286c.5694.1095.7224.2585.7224.4906 0 .3701-.438.6022-1.1279.6022-.876 0-1.3774-.1907-1.5723-.8477h-1.533c.219 1.2307 1.1563 2.05 3.0484 2.05h.0022c1.752 0 2.7422-.819 2.7422-1.9534 0-.8059-.5847-1.4084-1.8089-1.6668l-1.2943-.2605c-.7511-.1358-.988-.2738-.988-.5454 0-.357.3616-.5757 1.0295-.5757.7227 0 1.2527.1925 1.406.8473h1.5175c-.0854-1.2286-.9899-2.0497-2.8273-2.0497zM9.467 16.1815c1.0092.0096 1.8188.8369 1.8067 1.8461.0014 1.0046-.8198 1.816-1.8243 1.8025-1.0075-.0048-1.8203-.8256-1.8155-1.833.0048-1.0076.8255-1.8204 1.833-1.8156z" />
    </svg>
  );
}

export function MrDIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      {/*
        Mr D Food: "MR" set small above the great D, with the two strides that
        make the D look like it is running. That is the mark on the South
        African app icon — not a cloche, which is what used to be here and reads
        as "restaurant" rather than as the partner the owner named.
      */}
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M10.6 13.6V7.6l1.85 2.65L14.3 7.6v6" />
        <path d="M16.85 13.6V7.6h1.9a1.5 1.5 0 0 1 0 3h-1.9m2.15 0.05 1.7 2.95" />
      </g>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12.4 18.4h10.9a12.6 12.6 0 0 1 0 25.2H12.4zm6.2 6.6v12h4.5a6 6 0 0 0 0-12z"
      />
      <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M31.4 38 35.2 41.8 40 43" />
        <path d="M20.2 41.2 16.4 43 12 43.4" />
      </g>
    </svg>
  );
}

export function WhatsAppIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" fill="currentColor">
      {/* Handset inside a speech bubble — the WhatsApp silhouette. */}
      <path d="M12 2a9.6 9.6 0 0 0-8.2 14.6L2 22l5.5-1.7A9.6 9.6 0 1 0 12 2Zm0 1.9a7.7 7.7 0 1 1-3.9 14.4l-.5-.3-3 .9.9-2.9-.3-.5A7.7 7.7 0 0 1 12 3.9Z" />
      <path d="M9.2 7.6c-.3 0-.7.1-1 .4-.4.4-.9 1-.9 2 0 1.1.7 2.1 1.1 2.6.5.6 1.7 2.1 4.2 3 2 .7 2.5.6 2.9.6.5 0 1.5-.5 1.7-1.1.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.5.1l-.6.8c-.1.2-.3.2-.5.1-.4-.2-1.1-.5-1.6-1.1-.4-.5-.6-.9-.7-1.1-.1-.2 0-.3.1-.4l.4-.5c.1-.2.1-.3 0-.5l-.7-1.6c-.2-.4-.4-.4-.5-.4Z" />
    </svg>
  );
}

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
