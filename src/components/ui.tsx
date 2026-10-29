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

/* ------------------------------ Pattern ------------------------------- */

/** Setswana/Ndebele-inspired geometric band. Pure SVG, scales cleanly. */
export function HeritageBand({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" className={className} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="hb-band" width="24" height="12" patternUnits="userSpaceOnUse">
          <path d="M0 6 L6 0 L12 6 L6 12 Z" fill="var(--color-ochre)" />
          <path d="M12 6 L18 0 L24 6 L18 12 Z" fill="var(--color-ink)" opacity="0.85" />
          <circle cx="6" cy="6" r="1.4" fill="var(--color-ink)" />
          <circle cx="18" cy="6" r="1.4" fill="var(--color-ink)" />
        </pattern>
      </defs>
      <rect width="120" height="12" fill="url(#hb-band)" />
    </svg>
  );
}

/* ------------------------------ Field -------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{label}</span>
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
