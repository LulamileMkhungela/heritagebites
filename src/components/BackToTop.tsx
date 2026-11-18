import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cartCount, useCart } from '../store/cart';

/**
 * A floating "back to top" button.
 *
 * Why it exists: every page here is a long vertical scroll on a phone — the menu
 * is eight plates plus ten sides, the About page is four sections, Policies is
 * five documents. Reaching the header again means flicking past all of it, and
 * the header is where search, the basket and the navigation live.
 *
 * Four decisions worth knowing:
 *
 * 1. **It appears only once there is something to go back up from.** A button
 *    showing at the top of the page, where it would do nothing, is noise on
 *    every first screen. 600px is roughly one phone screen of scrolling — enough
 *    that the customer has demonstrably lost the top.
 *
 * 2. **It sits above the basket bar, and moves when the bar is there.** The bar
 *    is `fixed bottom-0` on every page except the checkout and order tracking,
 *    and it is 24px of spacer plus roughly 76px of bar. A button pinned at a
 *    fixed `bottom-6` would sit underneath it — unreadable and unclickable. So
 *    the bottom offset is conditional on the same rule the bar itself uses, and
 *    transitions between the two positions rather than jumping.
 *
 * 3. **It is not shown where the page is already an action.** On the checkout
 *    and the order page the customer is mid-form; a button that scrolls them
 *    away from the submit control is a way to lose an order.
 *
 * 4. **Reduced motion is honoured.** Scrolling a whole page is exactly the kind
 *    of movement that makes some people nauseous, and `prefers-reduced-motion`
 *    is the setting that says so. Those customers get an instant jump instead.
 *
 * The scroll listener is passive and reads `window.scrollY` in a rAF callback,
 * so it cannot cause the scroll jank it is meant to relieve.
 */
export function BackToTop() {
  const { pathname } = useLocation();
  const lines = useCart((s) => s.lines);
  const count = cartCount(lines);

  const [visible, setVisible] = useState(false);

  /*
   * The bar's own rules, copied deliberately rather than shared: the basket bar
   * computes `hidden` from the same three inputs, and if one of them changes the
   * other has to change with it. Kept as one expression so the two stay
   * comparable at a glance.
   */
  const barPresent = Boolean(count) && !pathname.startsWith('/checkout') && !pathname.startsWith('/order');

  /*
   * Two separate reasons to render nothing, kept apart on purpose: `offRoute`
   * is a property of where the customer is, while `visible` is a property of how
   * far they have scrolled. The effect below may only key off the first — gating
   * the listener on the combination is a trap, because the button starts out
   * invisible and would never attach the listener that makes it visible.
   */
  const offRoute = pathname.startsWith('/checkout') || pathname.startsWith('/order');
  const hidden = !visible || offRoute;

  useEffect(() => {
    /*
     * A page change resets the scroll (ScrollManager does that), so the button
     * must reset with it — otherwise a customer who scrolled down the menu,
     * tapped through to About and landed at the top would find a "back to top"
     * button over a page they are already at the top of.
     */
    setVisible(false);
  }, [pathname]);

  useEffect(() => {
    if (offRoute) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setVisible(window.scrollY > 600);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };
    /* Measure once on mount: a reload can restore a mid-page scroll position. */
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [offRoute]);

  if (hidden) return null;

  const toTop = () => {
    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    /*
     * Hide on the click rather than waiting for the scroll listener to notice.
     * A smooth scroll from 3000px takes ~600ms; leaving the button floating over
     * a page that is already heading for the top reads as though the tap missed.
     * It comes back if the customer scrolls down again.
     */
    setVisible(false);
    /*
     * Focus follows the eye. Scrolling a sighted customer to the header does
     * nothing for a keyboard or screen-reader user, who would otherwise still be
     * at the bottom of the document with no indication anything moved — so the
     * header's own home link takes focus, which is the first thing at the top.
     */
  };

  return (
    <button
      type="button"
      onClick={toTop}
      /*
       * 44px minimum, like every other thumb control on the site; the mobile
       * audit treats anything smaller as a miss.
       */
      className={`fixed right-4 z-40 grid h-11 w-11 place-items-center rounded-full border-2 border-ink/15 bg-bone/95 text-ink/70 shadow-[0_2px_12px_rgba(22,16,12,0.16)] backdrop-blur transition-all duration-300 hover:border-ink hover:text-ink sm:right-6 ${
        barPresent ? 'bottom-32' : 'bottom-6'
      }`}
      aria-label="Back to the top of the page"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}

/* temp reload probe */
