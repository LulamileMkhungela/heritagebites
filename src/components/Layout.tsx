import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
/* useNavigate is used by the search palette below. */
import { useCart, cartCount } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { STATIC_PREVIEW } from '../lib/api';
import { api } from '../lib/api';
import { zar } from '../lib/format';
import { useOverlay } from '../lib/useOverlay';
import { HeritageBand } from './ui';
import { basketHref, serviceEnquiry, waHref, CHANNEL_ENQUIRY } from '../lib/whatsapp';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About Us' },
  { to: '/menu', label: 'Offering / Meals' },
  { to: '/specials', label: 'This Week' },
  { to: '/contact', label: 'Contact' },
];

export default function Layout() {
  const { pathname, hash } = useLocation();
  const catalog = useCatalog((s) => s.data);
  const lines = useCart((s) => s.lines);
  const open = useCart((s) => s.open);
  const setOpen = useCart((s) => s.setOpen);
  const count = cartCount(lines);

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => setMenuOpen(false), [pathname, hash]);

  /*
   * The phone navigation is a panel, not a modal: it pushes the page down and
   * leaves the rest of the site visible. That makes "tap anywhere else to close"
   * the behaviour people expect, and without it the panel stayed open behind
   * them — the owner's complaint. A pointerdown outside the header closes it,
   * which covers the page under the panel as well as the overlay-less backdrop.
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && headerRef.current && !headerRef.current.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  /* Cmd/Ctrl-K opens search; Esc closes everything, the phone menu included. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    document.body.style.overflow = open || searchOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, searchOpen]);

  return (
    <div className="min-h-screen bg-bone">
      {/* Main navigation */}
      <header ref={headerRef} className="sticky top-0 z-50 border-b border-bone/15 bg-ink text-bone backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
          <Link to="/" onClick={() => setMenuOpen(false)} className="group flex min-h-11 min-w-11 items-center gap-2 sm:gap-3" aria-label="Heritage Bites home">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-bone text-ink transition-transform group-hover:rotate-3">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 12h16M4 12c0 4.4 3.6 8 8 8s8-3.6 8-8" />
                <path d="M7 8.5c0-1.4 1-1.4 1-2.8M11.5 8.5c0-1.4 1-1.4 1-2.8M16 8.5c0-1.4 1-1.4 1-2.8" />
              </svg>
            </span>
            {/*
              The wordmark is the only purely decorative thing in the bar, so it is
              what gives way on a 320px phone: below 360px the icon alone remains
              (the link keeps its accessible name), and the tagline only appears
              once there is room for it. Everything else in the row is a control
              and keeps its full 44px touch size.
            */}
            <span className="hidden min-w-0 leading-none min-[360px]:block">
              <span className="block truncate font-display text-base font-semibold tracking-tight text-bone sm:text-xl">Heritage Bites</span>
              <span className="mt-1 hidden truncate font-mono text-xs uppercase tracking-[0.18em] text-ochre sm:block">{catalog?.settings.tagline ?? 'Every Bite Tells a Story'}</span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-0.5 xl:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.label}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-full px-3 py-2 text-[13px] font-semibold transition-colors ${isActive ? 'bg-ochre text-ink' : 'text-bone/75 hover:bg-bone/10 hover:text-bone'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 xl:ml-2">
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true);
                setMenuOpen(false);
              }}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-bone/25 text-[13px] text-bone/75 transition-colors hover:border-ochre hover:text-bone lg:flex lg:w-auto lg:gap-2 lg:px-3 lg:py-2"
              aria-label="Search the menu"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <span className="hidden lg:inline">Search</span>
              <kbd className="hidden rounded border border-bone/25 px-1 font-mono text-xs lg:inline">⌘K</kbd>
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setMenuOpen(false);
              }}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-bone/25 bg-transparent text-[13px] font-semibold text-bone transition-colors hover:border-ochre hover:text-ochre sm:flex sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5"
              /*
                The visible "Basket" label is hidden below sm, so without this
                the button is an unnamed icon on a phone. The count is folded in
                so a screen reader hears how full the basket is, not just that
                one exists.
              */
              aria-label={count > 0 ? `Basket, ${count} item${count === 1 ? '' : 's'}` : 'Basket'}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6h15l-1.5 9h-12z" />
                <circle cx="9" cy="20" r="1.4" />
                <circle cx="18" cy="20" r="1.4" />
                <path d="M6 6 5 3H2" />
              </svg>
              <span className="hidden sm:inline">Basket</span>
              {count > 0 && (
                <span className="animate-pop absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-ochre px-1 font-mono text-xs font-bold text-ink sm:static">{count}</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-bone/25 hover:bg-bone/10 xl:hidden"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
            >
              <span className="sr-only">Menu</span>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="animate-rise border-t border-bone/15 bg-ink-2 px-4 py-3 text-bone xl:hidden">
            <div className="grid gap-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.label}
                  to={n.to}
                  end={n.end}
                  /* Tapping the route you are already on does not change the URL,
                     so the location effect never fires — close it here instead. */
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => `rounded-xl px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-ochre text-ink' : 'text-bone/75 hover:bg-bone/10'}`}
                >
                  {n.label}
                </NavLink>
              ))}
              <Link to="/passport" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-bone/75 hover:bg-bone/10">
                Loyalty card
              </Link>
            </div>
          </nav>
        )}
        <HeritageBand className="h-1.5 w-full" />
      </header>

      <PreviewStrip />
      <ServiceStrip />

      <main>
        <Outlet />
      </main>

      <Footer />
      <CartDrawer />
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} onNavigate={() => setSearchOpen(false)} />}
    </div>
  );
}

/* ---------------------------- Preview strip --------------------------- */

/**
 * The GitHub Pages build has no server, so nothing can be ordered, paid for,
 * saved or tracked from it. Saying so once, at the top of every page, is the
 * difference between a preview and a site that quietly swallows an order.
 *
 * This never renders on the real host: `STATIC_PREVIEW` is a build-time flag
 * that only `npm run build:pages` sets.
 */
function PreviewStrip() {
  const catalog = useCatalog((s) => s.data);
  const lines = useCart((s) => s.lines);
  const fulfilment = useCart((s) => s.fulfilment);
  if (!STATIC_PREVIEW) return null;
  /* Ordering is off on the preview, so this is the real order path: it opens
     WhatsApp with the basket already in the message, or an order enquiry when
     there is nothing in the basket yet. */
  const wa = basketHref(catalog?.settings?.whatsapp, lines, { fulfilment });

  return (
    <div className="bg-ink text-bone">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-ochre">Preview</span>
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-bone/75">
          Ordering and payments are switched off on this preview. Messages sent through the contact form still reach us — for
          an order, call or WhatsApp us.
        </p>
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ochre underline decoration-ochre/40 underline-offset-2 hover:text-bone"
        >
          WhatsApp
        </a>
      </div>
    </div>
  );
}

/* ---------------------------- Service strip --------------------------- */

/**
 * A one-line service status under the header, on every page.
 *
 * The kitchen only cooks on two days a week, so someone browsing on a
 * Wednesday needs to know that immediately — not after filling a basket and
 * reaching checkout. It stays out of the way when the kitchen is actually
 * serving, and it never blocks ordering: the message says when the food will
 * be cooked, and the WhatsApp link is right there.
 */
function ServiceStrip() {
  const catalog = useCatalog((s) => s.data);
  const service = catalog?.service;
  const wa = waHref(catalog?.settings?.whatsapp, serviceEnquiry(service?.headline));

  if (!service || service.open) return null;

  return (
    <div className="border-b-2 border-ochre/40 bg-ochre/15 text-ink">
      {/*
        Order matters here. On a phone the strip stacks: headline and the
        WhatsApp link share the first row and the message takes the full width
        underneath. Squeezing all three onto one line on a 390px screen left the
        sentence in a ten-character column three lines deep.
      */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="order-1 font-mono text-xs font-bold uppercase tracking-[0.18em] text-ochre-deep">
          {service.headline}
        </span>
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="order-2 ml-auto inline-flex min-h-11 shrink-0 items-center text-xs font-semibold uppercase tracking-wide text-ochre-deep underline decoration-ochre-deep/40 underline-offset-2 hover:text-ink sm:order-3"
        >
          Ask on WhatsApp
        </a>
        <p className="order-3 w-full min-w-0 text-[12px] leading-snug text-ink/75 sm:order-2 sm:w-auto sm:flex-1">
          {service.shortMessage}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------- Footer ------------------------------ */

function Footer() {
  const catalog = useCatalog((s) => s.data);
  const s = catalog?.settings;
  const wa = waHref(s?.whatsapp, CHANNEL_ENQUIRY);

  return (
    <footer className="mt-24 bg-ink text-bone">
      <HeritageBand className="h-2 w-full" />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          {/*
            A brand wordmark, not a section heading — marking it up as one put an
            <h3> on every page ahead of any real h2, so the outline jumped h1 -> h3.
          */}
          <p className="font-display text-3xl font-semibold">Heritage Bites</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-bone/65">
            South African plates cooked with care, Thursdays and Fridays. Order online for collection or delivery in Rosebank and Sandton.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={`tel:${s?.phone}`} className="inline-flex min-h-11 items-center rounded-full border border-bone/25 px-4 py-2 text-xs font-semibold hover:border-ochre hover:text-ochre">
              Call us
            </a>
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-bone/25 px-4 py-2 text-xs font-semibold hover:border-ochre hover:text-ochre">
              WhatsApp
            </a>
            <a href={`mailto:${s?.email}`} className="inline-flex min-h-11 items-center rounded-full border border-bone/25 px-4 py-2 text-xs font-semibold hover:border-ochre hover:text-ochre">
              Email
            </a>
          </div>
        </div>

        <div>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-ochre">Kitchen hours</h2>
          <ul className="space-y-1 text-sm text-bone/70">
            {(s?.hours ?? []).filter((h) => !h.closed).map((h) => (
              <li key={h.day} className="flex justify-between gap-4">
                <span>{h.label.slice(0, 3)}</span>
                <span className="font-mono text-xs">{h.open}–{h.close}</span>
              </li>
            ))}
            <li className="pt-1 text-xs text-bone/45">Closed the rest of the week</li>
          </ul>
        </div>

        <div>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-ochre">Order</h2>
          <ul className="space-y-2 text-sm text-bone/70">
            <li><Link to="/menu" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Meals</Link></li>
            <li><Link to="/specials" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">This week</Link></li>
            <li><Link to="/checkout" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Checkout &amp; pay</Link></li>
            <li><Link to="/passport" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Loyalty card</Link></li>
            <li><Link to="/quest" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Customer quest</Link></li>
            <li><Link to="/policies" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Policies &amp; terms</Link></li>
            <li>
              {s?.channels?.ubereats?.url
                ? <a href={s.channels.ubereats.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Uber Eats</a>
                : <span className="text-bone/40">Uber Eats · link coming soon</span>}
            </li>
            <li>
              {s?.channels?.mrd?.url
                ? <a href={s.channels.mrd.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center hover:text-ochre">Mr D Food</a>
                : <span className="text-bone/40">Mr D Food · link coming soon</span>}
            </li>
          </ul>
          <p className="mt-5 rounded-xl border border-bone/15 p-3 text-xs leading-relaxed text-bone/55">
            Card payments are processed by Yoco. Card details are entered in Yoco&apos;s secure window — Heritage Bites never receives them.
          </p>
        </div>
      </div>
      <div className="border-t border-bone/10 px-4 py-5">
        <div className="mx-auto max-w-7xl text-xs text-bone/45">
          <span>© {new Date().getFullYear()} Heritage Bites · Est. {s?.established ?? 2025}</span>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------ Cart drawer --------------------------- */

/*
  Split so the panel only mounts while open. useOverlay has to run on real
  mount to capture where focus was and hand it back on close; behind an early
  `return null` it would never run at all.
*/
function CartDrawer() {
  const open = useCart((s) => s.open);
  if (!open) return null;
  return <CartDrawerPanel />;
}

function CartDrawerPanel() {
  const setOpen = useCart((s) => s.setOpen);
  const lines = useCart((s) => s.lines);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const fulfilment = useCart((s) => s.fulfilment);
  const setFulfilment = useCart((s) => s.setFulfilment);
  const catalog = useCatalog((s) => s.data);
  const dialogRef = useOverlay<HTMLDivElement>(() => setOpen(false));

  const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
  const settings = catalog?.settings;
  // Delivery is included in the plate price (confirmed by the business), so the
  // basket never adds a delivery charge — only a minimum-order check applies.
  const belowMinimum = fulfilment === 'delivery' && subtotal < (settings?.minDeliveryOrder ?? 100);

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Your basket">
      <button type="button" className="absolute inset-0 bg-ink/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close basket" />
      <aside className="animate-rise absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-bone shadow-2xl">
        <header className="flex items-center justify-between border-b-2 border-ink/10 px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Your basket</h2>
            <p className="text-xs text-ink/50">{lines.length} line{lines.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border-2 border-ink/12 hover:bg-ink hover:text-bone" aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="text-4xl">🍲</span>
            <p className="font-display text-lg">Nothing in the pot yet</p>
            <p className="text-sm text-ink/55">Add a plate from the menu and it will show up here.</p>
            <Link to="/menu" onClick={() => setOpen(false)} className="mt-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-bone hover:bg-ink-3">
              Browse the menu
            </Link>
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-ink/10 px-5 py-3">
              {(['collection', 'delivery'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFulfilment(f)}
                  className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold capitalize transition-colors ${fulfilment === f ? 'bg-ink text-bone' : 'bg-ink/5 text-ink/60 hover:bg-ink/10'}`}
                >
                  {f.replace('-', ' ')}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {lines.map((l) => (
                <div key={l.key} className="flex gap-3 border-b border-ink/8 py-3 last:border-0">
                  <img src={l.image} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-tight">{l.name}</p>
                      <button type="button" onClick={() => remove(l.key)} className="text-ink/40 hover:text-chili" aria-label={`Remove ${l.name}`}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
                      </button>
                    </div>
                    {l.picks.length > 0 && <p className="mt-0.5 text-xs leading-snug text-ink/50">{l.picks.map((p) => p.label).join(' · ')}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="inline-flex items-center rounded-full border-2 border-ink/12">
                        <button type="button" onClick={() => setQty(l.key, l.qty - 1)} className="grid h-7 w-7 place-items-center hover:bg-ink hover:text-bone rounded-full" aria-label="Decrease">−</button>
                        <span className="w-6 text-center font-mono text-xs font-semibold">{l.qty}</span>
                        <button type="button" onClick={() => setQty(l.key, l.qty + 1)} className="grid h-7 w-7 place-items-center hover:bg-ink hover:text-bone rounded-full" aria-label="Increase">+</button>
                      </div>
                      <span className="font-mono text-sm font-semibold">{zar(l.unitPrice * l.qty)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <footer className="border-t-2 border-ink/10 px-5 py-4">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-ink/60"><span>Subtotal</span><span className="font-mono">{zar(subtotal)}</span></div>
                {fulfilment === 'delivery' && (
                  <div className="flex justify-between text-ink/60">
                    <span>Delivery</span>
                    <span className="font-mono">Included</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-ink/10 pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span className="font-mono">{zar(subtotal)}</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink/45">
                {belowMinimum
                  ? `Delivery orders start at ${zar(settings?.minDeliveryOrder ?? 100)}.`
                  : 'Final totals are confirmed at checkout.'}
              </p>
              <Link
                to="/checkout"
                onClick={() => setOpen(false)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-ochre px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-ink shadow-[0_2px_0_0_var(--color-ink)] transition-colors hover:bg-ochre-deep hover:text-bone"
              >
                Checkout
              </Link>
              {/*
                The basket as a WhatsApp message, one tap from the drawer it is
                already visible in. Useful on the preview build, where the
                checkout cannot take an order, and for a customer who would
                rather chat than fill in the form.
              */}
              <a
                href={basketHref(settings?.whatsapp, lines, { fulfilment })}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border-2 border-ink px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-bone"
              >
                Send this basket on WhatsApp
              </a>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

/* ----------------------------- Search palette ------------------------- */

function SearchPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; localName: string; price: number; image: string; category: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useOverlay<HTMLDivElement>(onClose, inputRef);
  const catalog = useCatalog((s) => s.data);
  const nav = useNavigate();
  const add = useCart((s) => s.add);

  /* Focus is moved in by useOverlay, which also handles Escape and keeps Tab
     inside the palette. */

  /* Debounced server-side search with a local fallback for offline moments. */
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.search(term);
        setResults(r.results);
      } catch {
        const local = (catalog?.menu ?? [])
          .filter((m) => `${m.name} ${m.localName} ${m.tags.join(' ')}`.toLowerCase().includes(term.toLowerCase()))
          .slice(0, 8)
          .map((m) => ({ id: m.id, name: m.name, localName: m.localName, price: m.price, image: m.image, category: m.category }));
        setResults(local);
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, catalog]);

  const suggestions = useMemo(
    () => ['Mogodu', 'Tshotlo', 'Smiley', 'Wings', 'Short rib', 'Lamb stew'],
    [],
  );

  const go = (id: string) => {
    onNavigate();
    onClose();
    nav(`/menu?item=${id}`);
  };

  const quickAdd = (id: string) => {
    const item = catalog?.menu.find((m) => m.id === id);
    if (!item) return;
    if (item.options.some((o) => o.required)) {
      go(id);
      return;
    }
    add({ key: `${item.id}::`, itemId: item.id, name: item.name, image: item.image, unitPrice: item.price, qty: 1, picks: [], kind: 'menu' });
  };

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Search the menu">
      <button type="button" className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} aria-label="Close search" />
      <div className="animate-rise absolute left-1/2 top-[8vh] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-3xl bg-bone shadow-2xl">
        <div className="flex items-center gap-3 border-b-2 border-ink/10 px-5">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink/40" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && results[active]) go(results[active].id);
            }}
            placeholder="Search mogodu, tshotlo, wings…"
            className="w-full bg-transparent py-4 text-base outline-none placeholder:text-ink/35"
            aria-label="Search dishes"
          />
          <button type="button" onClick={onClose} className="shrink-0 rounded-full border border-ink/15 px-2 py-1 font-mono text-xs text-ink/50 hover:bg-ink hover:text-bone">
            ESC
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {!q.trim() && (
            <div className="px-5 py-5">
              <p className="mb-2 font-mono text-xs uppercase tracking-widest text-ink/45">Try one of these</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => setQ(s)} className="rounded-full border-2 border-ink/12 px-3 py-1.5 text-sm hover:border-ochre hover:bg-ochre/10">
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-5 text-xs leading-relaxed text-ink/40">
                Search matches dish names, Setswana and isiZulu names, and ingredients. Press ⏎ to open, or + to add straight to your basket.
              </p>
            </div>
          )}

          {busy && <p className="px-5 py-6 text-sm text-ink/45">Searching…</p>}

          {!busy && q.trim() && results.length === 0 && (
            <p className="px-5 py-6 text-sm text-ink/55">
              Nothing matches “{q}”. Try <button type="button" className="font-semibold text-ochre-deep underline" onClick={() => setQ('mogodu')}>mogodu</button> or{' '}
              <button type="button" className="font-semibold text-ochre-deep underline" onClick={() => setQ('wings')}>wings</button>.
            </p>
          )}

          {results.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-3 border-b border-ink/8 px-5 py-3 ${i === active ? 'bg-ochre/10' : ''}`}
              onMouseEnter={() => setActive(i)}
            >
              <img src={r.image} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
              <button type="button" onClick={() => go(r.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block text-xs text-ink/50">{r.localName ? `${r.localName} · ` : ''}{zar(r.price)}</span>
              </button>
              <button
                type="button"
                onClick={() => quickAdd(r.id)}
                className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-bone hover:bg-ochre hover:text-ink"
              >
                + Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
