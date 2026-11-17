import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cartCount, cartSubtotal, useCart } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { HeritageBand, WhatsAppIcon } from './ui';
import { zar } from '../lib/format';
import { basketHref } from '../lib/whatsapp';

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
 * Delivery is in the plate price inside Sandton/Rosebank, so there
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
   * Once today's window has gone by there is no checkout to send this basket
   * to, so the bar's one action becomes the only one that still works: asking
   * the kitchen on WhatsApp whether it can cook the order anyway. It carries
   * the basket, so the customer still does not have to retype anything.
   */
  const shut = Boolean(catalog?.service?.orderingClosed);

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
  /*
   * Every order is a delivery now, so the minimum always applies — and it is the
   * gate on the one action here.
   *
   * Owner, 17 Nov 2026: "disable the complete order if the items are less than
   * 100". It was a sentence and nothing more: the Checkout pill stayed lit, so a
   * lone R30 bowl walked the customer through a whole checkout form only to be
   * told at the end that the button would not work. The amount is still shown,
   * because "add R70" is the useful half of that sentence — but the way forward
   * is switched off until there is enough in the basket.
   *
   * A basket cannot be empty here (the bar hides when the count is zero), so
   * there is no "no food selected" state to disable: with nothing picked the
   * bar itself is not on screen.
   */
  const minimum = Number(settings?.minDeliveryOrder ?? 100);
  const belowMinimum = subtotal < minimum;

  return (
    <>
      {/* Keeps the bar from covering the last line of the footer. */}
      <div aria-hidden="true" className="h-24" />
      <div className="fixed inset-x-0 bottom-0 z-40 bg-bone/95 backdrop-blur">
        <HeritageBand className="h-4 w-full" width={1440} on="ink" />
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
                  {/*
                    "plate" was right while every basket line was a plate. A bowl
                    of chakalaka is not one, and the bar is the last thing a
                    customer reads before paying — so the word follows what is
                    actually in there. Owner, 17 Nov 2026: the sides are sold by
                    the portion.
                  */}
                  {count} {count === 1 ? 'item' : 'items'} · delivery
                </>
              )}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-xl font-bold leading-tight text-ochre-deep tabular-nums">{zar(subtotal)}</span>
              {/*
                One line, always true: delivery is in the plate price for the
                Sandton/Rosebank run, and the fee for anywhere further is worked
                out at checkout where the address is known.
              */}
              <span className="text-xs text-ink/55" id={belowMinimum ? 'hb-basket-minimum' : undefined}>
                {belowMinimum
                  ? `Add ${zar(minimum - subtotal)} to reach the R${minimum} minimum`
                  : 'Delivery included in Sandton & Rosebank'}
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
            aria-label={`Clear the basket, ${count} item${count === 1 ? '' : 's'}`}
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
          {shut ? (
            <a
              href={basketHref(settings?.whatsapp, lines, {
                fulfilment,
                intro: 'Hi Heritage Bites! The ordering window has closed — could you still prepare this for me?',
              })}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-ochre px-5 py-2 text-xs font-bold uppercase tracking-wide text-ink shadow-[0_2px_0_0_var(--color-ink)] hover:bg-ochre-deep hover:text-bone"
            >
              <WhatsAppIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Can you cook it?</span>
              <span className="sm:hidden">Ask</span>
            </a>
          ) : (
            belowMinimum ? (
              /*
               * A link to a checkout that will refuse the basket is a dead end
               * dressed as a way forward. Rendered as a genuinely disabled
               * button — not an anchor with a look — so a keyboard or a screen
               * reader is told the same thing the colour says.
               */
              <button
                type="button"
                disabled
                aria-describedby="hb-basket-minimum"
                className="inline-flex min-h-11 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-full border-2 border-ink/20 bg-ink/5 px-5 py-2 text-xs font-bold uppercase tracking-wide text-ink/40"
              >
                Checkout
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            ) : (
              <Link
                to="/checkout"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-ochre px-5 py-2 text-xs font-bold uppercase tracking-wide text-ink shadow-[0_2px_0_0_var(--color-ink)] hover:bg-ochre-deep hover:text-bone"
              >
                Checkout
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            )
          )}
        </div>
      </div>
    </>
  );
}
