import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Overlay behaviour shared by the dish sheet, the basket drawer and the search
 * palette.
 *
 * All three render `role="dialog" aria-modal="true"`, which *tells* assistive
 * technology that the page behind is inert — but that attribute does nothing on
 * its own. Without this, keyboard focus stays on <body>, so Tab walks straight
 * through the overlay into the page it claims to be blocking, and there is no
 * Escape key. A screen-reader user is told the content behind is unreachable
 * and then can reach it.
 *
 * Pass `initialFocus` to choose what receives focus on open; without it the
 * first focusable descendant is used.
 *
 * Returns a ref to put on the dialog's root element.
 */
export function useOverlay<T extends HTMLElement>(
  onClose: () => void,
  initialFocus?: React.RefObject<HTMLElement | null>,
) {
  const ref = useRef<T>(null);

  /* Keep the latest handler in a ref so callers can pass an inline arrow
     without re-running the effect — otherwise every render would re-capture
     the restore target and yank focus back to the top of the dialog. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    /* Remember where focus was so closing puts it back on the control that
       opened the dialog, rather than dumping the user at the top of the page. */
    const restoreTo = document.activeElement as HTMLElement | null;

    const focusables = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );

    /* Move focus in. An explicit target wins; otherwise the first focusable
       descendant; otherwise the container itself, so Escape has somewhere to
       land when a dialog opens with nothing focusable. */
    const initial = initialFocus?.current ?? focusables()[0] ?? root;
    if (!root.contains(document.activeElement)) {
      if (initial === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      initial.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      // Keep Tab inside the overlay instead of leaking to the page behind.
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreTo?.focus?.({ preventScroll: true });
    };
    // closeRef keeps the handler current, so this runs once per open.
  }, [initialFocus]);

  return ref;
}
