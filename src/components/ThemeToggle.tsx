import { useEffect, useState } from 'react';

/*
 * Light / dark / follow-the-device.
 *
 * Three states, not a boolean, because "match my phone" is a real preference
 * and a two-way switch silently discards it the first time it is touched. The
 * storage key holds 'light' | 'dark' | 'system'.
 *
 * The initial paint is handled by an inline script in index.html, not by this
 * component: React mounts after first paint, so a theme applied here would
 * flash the light palette at a dark-mode customer for as long as the bundle
 * takes to parse. This only reads and changes what that script set up.
 */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'hb.theme';

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* Private mode, or storage disabled. Follow the device. */
  }
  return 'system';
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
  } else {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* nothing to do */
    }
  }
  /*
   * The address bar / status bar tint. On a phone this is the strip of colour
   * above the page, and leaving it navy while the page is near-black makes the
   * app look like it has a seam across the top.
   */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = theme === 'dark'
      || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#071120' : '#001938');
  }
}

const LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Device',
};

const NEXT: Record<Theme, Theme> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => readStored());

  /*
   * Keep the control honest when the device changes underneath it. If the
   * customer is on "Device" and the phone flips to dark at sunset, the icon
   * should still be the one that is true.
   */
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => apply('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  const cycle = () => {
    const next = NEXT[theme];
    setTheme(next);
    apply(next);
  };

  /* Which icon to draw: one for the current setting, with a dot for "device". */
  const prefersDark = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const shown = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

  return (
    <button
      type="button"
      onClick={cycle}
      /*
       * The label states the current setting and the action, because a single
       * word on a cycling button is ambiguous: "Dark" could mean "you are in
       * dark" or "go to dark".
       */
      aria-label={`Appearance: ${LABELS[theme]}. Switch to ${LABELS[NEXT[theme]]}`}
      title={`Appearance: ${LABELS[theme]}`}
      className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-bone/25 text-current hover:bg-bone/10 ${className}`}
    >
      {shown === 'dark' ? (
        /* Moon */
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        /* Sun */
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
      {theme === 'system' && (
        /* A dot marks "follow the device" — the icon alone only shows one side. */
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
    </button>
  );
}
