import { useEffect } from 'react';

export const BRAND = 'Heritage Bites';

/**
 * Sets the document title for the current screen.
 *
 * A single-page app ships with whatever <title> is in index.html and never
 * changes it, so every tab, bookmark and shared link reads the same thing — and
 * search engines index one title for the whole site. Each page states its own.
 *
 * Restores the previous title on unmount so a nested route popping back does not
 * leave a stale title behind.
 */
export function useDocumentTitle(pageTitle?: string | null) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = pageTitle ? `${pageTitle} — ${BRAND}` : BRAND;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);
}
