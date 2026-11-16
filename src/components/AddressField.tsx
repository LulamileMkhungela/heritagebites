import { useEffect, useId, useRef, useState } from 'react';
import { Field, inputCls } from './ui';
import { DELIVERY_ZONES, MIN_QUERY_LENGTH, suggestAddresses, type AddressSuggestion } from '../lib/address';
import { deliveryAreaOptions, deliveryAreasLabel, deliveryAddressProblem } from '../../shared/service.js';
import type { Settings } from '../lib/types';

/**
 * The delivery address, in three boxes.
 *
 * The owner's request (16 Nov 2026): "delivery address (house number, street and
 * suburb) on checkout page". It used to be one combobox that accepted anything,
 * with the suburb asked for twice — once in a select and once inside the free-text
 * sentence — so a customer could type a street with no number and the order still
 * went through. Three boxes make the address a fact: the number and the street are
 * what a driver needs, and the suburb is what decides which side of the delivery
 * line the order sits on.
 *
 * What each box does:
 *
 *   - **House number** is a real field, not a hint. It is the one part of an
 *     address a geocoder never needs in order to find the street, so suggestions
 *     are keyed off the street and the number is put back on top of the result.
 *   - **Street** is the suggestion box: type a couple of letters and pick the
 *     result, which carries the map's coordinates — the evidence the distance
 *     check uses and the same pair the server prices from.
 *   - **Suburb** is the delivery area the customer picks, and picking a street
 *     moves it to the suburb the map names. It is asked once now, not twice.
 *
 * Two checks still live here, because they belong to the address rather than to
 * the form around it:
 *
 *   1. An address that names the *other* one of the two included suburbs is a
 *      hard error — the kitchen would be sent outside the boundary the customer
 *      believes they ordered inside. "Another area — within 15 km" is never a
 *      contradiction; the distance check prices that order instead.
 *   2. An address that names no area at all only warrants a "check the suburb"
 *      note, because plenty of real addresses are just a street and a number.
 *
 * The combobox is hand-built rather than a `<datalist>`: datalist gives no
 * control over the second line of each suggestion, cannot say which suburb a
 * result belongs to, and behaves differently in every browser.
 *
 * Suggestions are an assist: with no network the boxes are ordinary text inputs
 * and the checkout still works.
 */
export function AddressField({
  house,
  street,
  suburb,
  area,
  settings,
  hintArea,
  errors,
  note,
  onHouseChange,
  onStreetChange,
  onSuburbChange,
  onAreaChange,
  onPick,
}: {
  /** The house number, on its own, exactly as the customer types it ("12", "12A"). */
  house: string;
  /** The street line, without the house number. */
  street: string;
  /** The suburb, as a postal address has it ("Illovo", "Rosebank"). */
  suburb: string;
  /** The delivery area the order is priced against — the select beside the suburb. */
  area: string;
  settings?: Settings | null;
  /** Area the picked suggestion belongs to, so the parent can validate with it. */
  hintArea: string | null;
  errors?: { house?: string; street?: string; suburb?: string; area?: string };
  note?: string;
  onHouseChange: (value: string) => void;
  onStreetChange: (value: string) => void;
  onSuburbChange: (value: string) => void;
  onAreaChange: (value: string) => void;
  onPick: (suggestion: AddressSuggestion) => void;
}) {
  const listId = useId();
  /* The reach the suggestions are cut at, from the same settings the server prices with. */
  const maxKm = Number(settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm);
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
    /*
     * The street alone drives the lookup. A query of "12 Oxford" is what Photon
     * answers worst (see the fixtures in the smoke suite: a house number plus a
     * half-typed street finds nothing), and the number is now a field of its own,
     * so there is no reason to send it. `applyHouseHint` still puts it back onto
     * the result if the customer types one into the street box out of habit.
     */
    const q = street.trim();
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
       * "Choose an area" select this replaced. The whole delivery radius is
       * searched; results past the delivery limit are dropped (see
       * `filterSuggestions`), and picking a result moves the area select to match
       * or leaves it on "Other" for a suburb outside the two.
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
  }, [street, open]);

  const choose = (suggestion: AddressSuggestion) => {
    setOpen(false);
    setSuggestions([]);
    onPick(suggestion);
    inputRef.current?.focus();
  };

  /*
   * What the one-line address would say, for the area check only.
   *
   * The box the customer edits is three inputs now, but "does this address name
   * the other included suburb" is a question about the whole address — so the
   * parts are joined back into a sentence for the check that already understands
   * sentences, rather than teaching it a second shape and risking the two
   * disagreeing. The value is never displayed and never sent.
   */
  const addressLine = [house, street, suburb].map((part) => part.trim()).filter(Boolean).join(', ');

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
  const problem = deliveryAddressProblem(addressLine, area, settings, hintArea);
  const shownError = errors?.street || (problem?.level === 'error' ? problem.message : '');
  const shownNote = note || (problem?.level === 'warn' ? problem.message : '');

  return (
    /*
     * Six columns at every width, not only from `sm` up.
     *
     * On a phone this used to be one column, so each of the three boxes took a
     * full line — house number, street and suburb read as three stacked
     * paragraphs rather than one address, and the number got a line as wide as a
     * street. The rows are now house number + street, then suburb, then the
     * delivery area: the same three facts, laid out the way an address is read on
     * a phone. Widths are still generous enough for the street suggestion list.
     */
    <div className="relative grid grid-cols-6 gap-3 sm:col-span-2">
      {/* House number: narrow, numeric keypad on a phone, and required. */}
      <div className="col-span-2 sm:col-span-1">
        <Field label="House no." error={errors?.house}>
          <input
            className={inputCls}
            value={house}
            onChange={(event) => onHouseChange(event.target.value)}
            placeholder="12"
            inputMode="numeric"
            autoComplete="address-line2"
            aria-invalid={Boolean(errors?.house)}
          />
        </Field>
      </div>

      {/* Street: the suggestion box. `relative` so its list floats over the fields below. */}
      <div className="relative col-span-4 sm:col-span-3">
        {/*
          No hint under the street on a phone.
          
          "pick it from the list so we can check the distance" is longer than the
          street label and the box beside it put together: at 390px it wrapped to
          two lines, pushed the street field down below the house-number box, and
          made a two-field row look broken. The suggestion list already says what
          it wants — it opens as soon as the box is focused, names each street and
          its suburb, and the footer line explains the radius. The words are still
          on the field for a screen reader, and they still appear at `sm` and up
          where there is room on the line.
        */}
        <Field
          label="Street"
          error={shownError}
          hint={<span className="hidden sm:inline">pick it from the list so we can check the distance</span>}
        >
          <input
            ref={inputRef}
            className={inputCls}
            value={street}
            onChange={(event) => {
              onStreetChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            /* A short delay lets a suggestion's mousedown land before the list closes. */
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            placeholder="Oxford Road"
            autoComplete="address-line1"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
            aria-invalid={Boolean(shownError)}
          />
        </Field>

        {open && (busy || suggestions.length > 0 || searched) && (
          <div className="absolute z-30 mt-1 w-full min-w-64 overflow-hidden rounded-2xl border-2 border-ink/12 bg-white shadow-xl">
            <ul id={listId} role="listbox" aria-label="Street suggestions" className="max-h-64 overflow-y-auto">
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
                      {/* The street and its suburb, not the sentence the old
                          single box produced: the house number is a field now. */}
                      <span className="block truncate font-medium">
                        {suggestion.street || suggestion.line.replace(/^\d+[A-Za-z]?\s+/, '')}
                      </span>
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
                  ? `No street within ${maxKm} km of the kitchen found — type it in full.`
                  : `Anywhere within ${maxKm} km · delivery included in ${deliveryAreasLabel(settings)}`}
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

      {/*
        The suburb, as a postal address has it — the third part of "house number,
        street and suburb". It is typed (or filled by picking a street), not
        chosen from a list: a customer in Illovo lives in a suburb that is not
        called Sandton, and making them say "Sandton" to get a plate was the
        fudge this field removes.
      */}
      <div className="col-span-6 sm:col-span-2">
        <Field label="Suburb" error={errors?.suburb}>
          <input
            className={inputCls}
            value={suburb}
            onChange={(event) => onSuburbChange(event.target.value)}
            placeholder="Illovo"
            autoComplete="address-level3"
            aria-invalid={Boolean(errors?.suburb)}
          />
        </Field>
      </div>

      {/*
        What the suburb *costs*. The three boxes say where the food goes; this
        says which side of the delivery line that is, and it is the customer's
        call only where the map cannot make it — a street that names Rosebank
        fills it, and "Another area" is how a Bryanston address gets priced
        instead of refused.
      */}
      <div className="col-span-6">
        <Field label="Delivery area" hint="decides the fee" error={errors?.area}>
          <select
            className={inputCls}
            value={area}
            onChange={(event) => onAreaChange(event.target.value)}
            aria-invalid={Boolean(errors?.area)}
          >
            {deliveryAreaOptions(settings).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Field>
      </div>

      {shownNote && !shownError && (
        <p className="col-span-6 flex items-start gap-1.5 text-[12px] leading-snug text-ochre-deep" role="status">
          <span aria-hidden="true">!</span>
          <span>{shownNote}</span>
        </p>
      )}
    </div>
  );
}
