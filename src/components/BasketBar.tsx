import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cartCount, cartSubtotal, useCart } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { HeritageBand } from './ui';
import { zar } from '../lib/format';

/**
 * The running basket total, pinned to the bottom of the screen.
 *
 * Why it exists: a customer orders several plates in a row, and the total used
 * to be visible only inside the basket drawer — so the answer to "what have I
 * spent so far?" was always one tap and one dismissal away, on a page that is a
 * long scroll on a phone. This bar is on every page, updates the moment a plate
 * is added, and carries the one action that matters next: checkout.
 *
 * It deliberately does not appear on the checkout page (the total is the page),
 * inside the order tracking page (that basket is already an order), or while
 * the basket drawer is open (the drawer is showing the same numbers).
 *
 * Collection is the plate price; delivery adds one flat fee, so there
 * is no extra delivery line to add — the bar says so rather than leaving the
 * customer to wonder what will be added at the next step.
 */
export function BasketBar() {
  const { pathname } = useLocation();
  const lines = useCart((s) => s.lines);
  const open = useCart((s) => s.open);
  const setOpen = useCart((s) => s.setOpen);
  const clear = useCart((s) => s.clear);
  const fulfilment = useCart((s) => s.fulfilment);
  const catalog = useCatalog((s) => s.data);

  const count = cartCount(lines);
  const subtotal = cartSubtotal(lines);

  /*
   * Adding no longer opens the drawer, so the bar is the only feedback that the
   * tap worked. When the count goes up it says so for a moment — the same job
   * the drawer used to do, without taking the menu away from the customer.
   */
  const previous = useRef(count);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    const added = count - previous.current;
    previous.current = count;
    if (added <= 0) return;
    setFlash(added === 1 ? 'Added to basket' : `${added} added to basket`);
    const timer = setTimeout(() => setFlash(''), 2200);
    return () => clearTimeout(timer);
  }, [count]);

  const hidden = open || !count || pathname.startsWith('/checkout') || pathname.startsWith('/order');
  if (hidden) return null;

  const settings = catalog?.settings;
  /* Delivery has a minimum order; collection has none. Say which one applies. */
  const belowMinimum = fulfilment === 'delivery' && subtotal < (settings?.minDeliveryOrder ?? 100);
  /* The fee itself is added at checkout, where the address is known. */
  const deliveryFee = Number(settings?.deliveryFlat ?? 0);

  return (
    <>
      {/* Keeps the bar from covering the last line of the footer. */}
      <div aria-hidden="true" className="h-24" />
      <div className="fixed inset-x-0 bottom-0 z-40 bg-bone/95 backdrop-blur">
        <HeritageBand className="h-2 w-full" on="ink" />
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 min-w-0 flex-1 text-left"
            aria-label={`Open your basket, ${count} item${count === 1 ? '' : 's'}, ${zar(subtotal)}`}
          >
            <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink/50">
              {flash ? (
                <span className="text-ochre-deep" role="status">✓ {flash}</span>
              ) : (
                <>
                  {count} {count === 1 ? 'plate' : 'plates'} · {fulfilment === 'delivery' ? 'delivery' : 'collection'}
                </>
              )}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-xl font-bold leading-tight text-ochre-deep tabular-nums">{zar(subtotal)}</span>
              {/*
                The second line follows the basket, not the business. It used to
                say "Delivery included" whatever the customer had chosen, which
                reads as nonsense on a collection order — the delivery is not
                included in anything they are collecting.
              */}
              <span className="text-xs text-ink/55">
                {fulfilment === 'delivery'
                  ? belowMinimum
                    ? `Add ${zar((settings?.minDeliveryOrder ?? 100) - subtotal)} for delivery`
                    : `${deliveryFee > 0 ? `+ ${zar(deliveryFee)} delivery` : 'Delivery included'} at checkout`
                  : 'Collection — nothing extra'}
              </span>
            </span>
          </button>

          {/*
            Empty the whole basket without opening it. Someone who has tried
            three plates and wants to start again should not have to open the
            drawer, scroll it and confirm — and the bar is where their
            selection is already summarised.
          */}
          <button
            type="button"
            onClick={clear}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-ink/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink/60 transition-colors hover:border-chili hover:text-chili sm:px-4"
            aria-label={`Clear the basket, ${count} plate${count === 1 ? '' : 's'}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6" />
            </svg>
            <span className="hidden sm:inline">Clear</span>
          </button>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="hidden min-h-11 items-center rounded-full border-2 border-ink/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide hover:border-ink sm:inline-flex"
          >
            Basket
          </button>
          <Link
            to="/checkout"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-ochre px-5 py-2 text-xs font-bold uppercase tracking-wide text-ink shadow-[0_2px_0_0_var(--color-ink)] hover:bg-ochre-deep hover:text-bone"
          >
            Checkout
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </Link>
        </div>
      </div>
    </>
  );
}
