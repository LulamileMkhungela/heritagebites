import { useEffect, useId, useRef, useState } from 'react';
import { Field, inputCls } from './ui';
import { MIN_QUERY_LENGTH, suggestAddresses, type AddressSuggestion } from '../lib/address';
import { deliveryAreasLabel, deliveryAddressProblem } from '../../shared/service.js';
import type { Settings } from '../lib/types';

/**
 * The delivery address box.
 *
 * Two jobs, and they are related:
 *
 *   1. Suggest addresses as the customer types (OpenStreetMap via Photon, see
 *      `src/lib/address.ts`), and autofill the suburb when the picked address
 *      belongs to one the kitchen delivers to.
 *   2. Check the address against the delivery area the customer chose. An
 *      address that names another area is a hard error — the kitchen would be
 *      sent outside the boundary the customer believes they ordered inside. An
 *      address that names no area at all only warrants a "check the suburb"
 *      note, because plenty of real addresses are just a street and a number.
 *
 * The combobox is hand-built rather than a `<datalist>`: datalist gives no
 * control over the second line of each suggestion, cannot say which suburb a
 * result belongs to, and behaves differently in every browser.
 *
 * Suggestions are an assist: with no network the input is a plain text box and
 * the checkout still works.
 */
export function AddressField({
  address,
  area,
  settings,
  hintArea,
  error,
  note,
  onChange,
  onPick,
}: {
  address: string;
  area: string;
  settings?: Settings | null;
  /** Area the picked suggestion belongs to, so the parent can validate with it. */
  hintArea: string | null;
  error?: string;
  note?: string;
  onChange: (value: string) => void;
  onPick: (suggestion: AddressSuggestion) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  /** True once a query has come back — used to say "no matches" only when true. */
  const [searched, setSearched] = useState(false);

  /*
   * Debounced lookup. Three guards matter here:
   *   - 350 ms, so a fast typist causes one request, not one per letter;
   *   - the previous request is aborted when the text changes;
   *   - nothing is requested unless the field is focused and has enough text,
   *     because Photon is a free service and every keystroke is somebody else's
   *     bandwidth.
   */
  useEffect(() => {
    const q = address.trim();
    if (!open || q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearched(false);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    let alive = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      /*
       * Deliberately *not* narrowed to the selected area.
       *
       * The checkout now opens with Rosebank already selected, and filtering the
       * geocoder by that choice would leave a Sandton customer typing a real
       * Sandton street into an empty list — the one outcome worse than the
       * "Choose an area" select this replaced. Both delivery areas are searched;
       * everything outside them is still dropped (see `filterSuggestions`), and
       * picking a result moves the area select to match.
       */
      const found = await suggestAddresses(q, { signal: controller.signal, settings });
      if (!alive) return;
      setBusy(false);
      setSearched(true);
      setSuggestions(found);
      setActive(0);
    }, 350);

    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
    /* `settings` is deliberately not a dependency: it is static for the session,
       and including the object would re-run the debounce on every render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, open]);

  const choose = (suggestion: AddressSuggestion) => {
    setOpen(false);
    setSuggestions([]);
    onPick(suggestion);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  };

  /*
   * Live check while the customer edits, so the mismatch is caught before submit.
   *
   * `|| ` and not `??` on purpose: the parent clears its error by setting an
   * empty string, and `'' ?? live` keeps the empty string — the own-check message
   * then never appeared. Empty means "no error" here, so a truthiness test is
   * what this actually means.
   */
  const problem = deliveryAddressProblem(address, area, settings, hintArea);
  const shownError = error || (problem?.level === 'error' ? problem.message : '');
  const shownNote = note || (problem?.level === 'warn' ? problem.message : '');

  return (
    <div className="relative">
      <Field label="Delivery address" error={shownError} hint="house number, street and suburb">
        <input
          ref={inputRef}
          className={inputCls}
          value={address}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          /* A short delay lets a suggestion's mousedown land before the list closes. */
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="12 Oxford Road, Illovo, Sandton"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
          aria-invalid={Boolean(shownError)}
        />
      </Field>

      {shownNote && !shownError && (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-ochre-deep" role="status">
          <span aria-hidden="true">!</span>
          <span>{shownNote}</span>
        </p>
      )}

      {open && (busy || suggestions.length > 0 || searched) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-2xl border-2 border-ink/12 bg-white shadow-xl">
          <ul id={listId} role="listbox" aria-label="Address suggestions" className="max-h-64 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.id} role="option" aria-selected={index === active} id={`${listId}-${index}`}>
                <button
                  type="button"
                  /* mousedown, not click: the input's blur fires first on some
                     browsers and would tear the list out from under the tap. */
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(suggestion);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-ochre/10 ${index === active ? 'bg-ochre/10' : ''}`}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11Z" />
                    <circle cx="12" cy="10" r="2.5" />
                  </svg>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{suggestion.line}</span>
                    <span className="block truncate text-[12px] text-ink/50">
                      {suggestion.detail}
                      {suggestion.area && (
                        <span className="ml-1 font-semibold text-ochre-deep">· {suggestion.area} delivery</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-ink/8 px-3 py-1.5 text-[11px] text-ink/40">
            {busy && !suggestions.length
              ? 'Looking up addresses…'
              : searched && !suggestions.length
                ? `No address in ${deliveryAreasLabel(settings)} found — type it in full.`
                : `${deliveryAreasLabel(settings)} addresses only`}
            {' · '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink/70"
            >
              © OpenStreetMap
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
