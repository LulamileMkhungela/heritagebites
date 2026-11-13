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
  return (
    <div className="mb-4 flex items-center gap-3">
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
 * The reference is Dr Esther Mahlangu's Ndebele wall painting: flat, bold
 * geometry — chevrons, triangles, stepped bands — in saturated earth and sky
 * colour, held inside crisp black outlines. Her palette is the source of the
 * four accents below (ochre, clay red, sky blue, leaf green) and they sit on
 * the brand's existing midnight navy and bone paper, which is what keeps the
 * page looking like Heritage Bites rather than a pastiche.
 *
 * Colour is used structurally, not decoratively: a band anchors a section, a
 * chevron ticks a list, the pot marks the kitchen. Every motif is decorative,
 * so each is aria-hidden and points nowhere.
 */

/** Ndebele earth-and-sky accents, layered on the brand palette. */
const MHALANGU = {
  ochre: 'var(--color-ochre)',      /* #b77e23 — the brand gold */
  red: '#a33b26',                    /* clay red, as on a painted wall */
  blue: '#1f4e79',                   /* sky blue, darker than the navy ink */
  green: '#2f6b4f',                  /* leaf green */
  ink: 'var(--color-ink)',
};

/**
 * Ndebele painted band: stepped chevrons in the Mahlangu palette.
 * Used to close a section or crown a card.
 */
export function HeritageBand({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" className={className} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hb-band" width="30" height="12" patternUnits="userSpaceOnUse">
          <rect width="30" height="12" fill={MHALANGU.ink} />
          <path d="M0 6 L5 1 L10 6 L5 11 Z" fill={MHALANGU.ochre} />
          <path d="M10 6 L15 1 L20 6 L15 11 Z" fill={MHALANGU.red} />
          <path d="M20 6 L25 1 L30 6 L25 11 Z" fill={MHALANGU.blue} />
        </pattern>
      </defs>
      <rect width="120" height="12" fill="url(#hb-band)" />
    </svg>
  );
}

/**
 * Ndebele triangle print — the wall-painting motif at small scale.
 * Three rows, each a different accent, all outlined in ink.
 */
export function ShweshwePanel({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 24" className={className} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hb-shweshwe" width="16" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 0 L8 8 L16 0 Z" fill={MHALANGU.ochre} stroke={MHALANGU.ink} strokeWidth="0.75" />
          <path d="M0 8 L8 16 L16 8 Z" fill={MHALANGU.blue} stroke={MHALANGU.ink} strokeWidth="0.75" />
          <path d="M0 16 L8 24 L16 16 Z" fill={MHALANGU.red} stroke={MHALANGU.ink} strokeWidth="0.75" />
        </pattern>
      </defs>
      <rect width="96" height="24" fill="url(#hb-shweshwe)" />
    </svg>
  );
}

/** A pair of Ndebele chevrons: the mark used beside headings and in lists. */
export function HeritageMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d="M2 14 L8 6 L14 14" fill="none" stroke={MHALANGU.ochre} strokeWidth="2.5" strokeLinecap="square" />
      <path d="M9 18 L15 10 L21 18" fill="none" stroke={MHALANGU.blue} strokeWidth="2.5" strokeLinecap="square" />
    </svg>
  );
}

/** The three-legged pot, in the same flat painted style, with painted flames. */
export function PotMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path d="M6 13h20l-2 11a4 4 0 0 1-4 3.4H12A4 4 0 0 1 8 24Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M11 9c0-2 2-2 2-4M16 9c0-2 2-2 2-4M21 9c0-2 2-2 2-4" fill="none" stroke={MHALANGU.red} strokeWidth="2" strokeLinecap="round" />
      <path d="M3 15h3M26 15h3" stroke={MHALANGU.green} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Ndebele stepped rule: alternating colour, ink-outlined blocks.
 * The section-closing device, where a plain hairline used to be.
 */
export function WovenRule({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 8" className={className} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="hb-woven" width="16" height="8" patternUnits="userSpaceOnUse">
          <rect x="0" y="2" width="8" height="4" fill={MHALANGU.ochre} stroke={MHALANGU.ink} strokeWidth=".5" />
          <rect x="8" y="4" width="8" height="4" fill={MHALANGU.blue} stroke={MHALANGU.ink} strokeWidth=".5" />
        </pattern>
      </defs>
      <rect width="120" height="8" fill="url(#hb-woven)" />
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
