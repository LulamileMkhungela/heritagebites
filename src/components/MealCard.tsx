import { useState } from 'react';
import type { CartOptionPick, MenuItem } from '../lib/types';
import { zar } from '../lib/format';
import { Button, HeritageBand, Qty } from './ui';
import { buildLine, useCart } from '../store/cart';
import { useOverlay } from '../lib/useOverlay';
import { extraCost, maxPerExtra } from '../../shared/service.js';

export function MealCard({ item, onOpen, compact = false }: { item: MenuItem; onOpen: () => void; compact?: boolean }) {
  const add = useCart((s) => s.add);
  const needsChoice = item.options.some((o) => o.required);

  const quickAdd = () => {
    if (needsChoice) {
      onOpen();
      return;
    }
    add(buildLine(item, [], 1));
  };

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border-2 border-ink/10 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-ink/25 hover:shadow-[0_18px_40px_-24px_rgba(0,25,56,0.5)]">
      {/* Ndebele painted band: the card is framed, not just a photo in a box. */}
      <HeritageBand className="h-4 w-full shrink-0" width={300} tile={40} />
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full overflow-hidden bg-ink/5 text-left" aria-label={`View ${item.name}`}>
        <img
          src={item.image}
          alt={item.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
        {item.available === false && (
          <span className="absolute inset-0 grid place-items-center bg-ink/70">
            <span className="rounded-full bg-bone px-4 py-2 text-xs font-bold uppercase tracking-widest text-ink">Sold out today</span>
          </span>
        )}
        <span className="absolute bottom-3 left-3 font-mono text-lg font-bold text-bone">
          {zar(item.price)} <span className="font-sans text-xs font-normal uppercase tracking-wider text-bone/70">plate</span>
        </span>
        {item.imagePending && (
          <span className="absolute right-3 top-3 rounded-full bg-bone/90 px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-ink">
            Photo coming soon
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-semibold leading-tight">{item.name}</h3>
          <span className="shrink-0 font-mono text-xs text-ink/45">{item.prepMins}′</span>
        </div>
        {item.localName && (
          <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-ochre-deep">
            {item.localName} · {item.language}
          </p>
        )}
        {!compact && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink/60">{item.description}</p>}
        {/* The price is on the photograph and the description says what is in the
            plate; this line repeated both and named the two included suburbs on
            every card. Removed at the owner's request (16 Nov 2026). */}

        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button size="sm" variant="dark" onClick={quickAdd} disabled={item.available === false} block>
            {needsChoice ? 'Choose' : 'Add to cart'}
          </Button>
          <Button size="sm" variant="outline" onClick={onOpen} aria-label={`Details for ${item.name}`}>
            ⓘ
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * Dish detail + option picker. This is also where the heritage story lives,
 * which is the content layer that differentiates the brand from a menu grid.
 */
export function ItemModal({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const add = useCart((s) => s.add);
  const dialogRef = useOverlay<HTMLDivElement>(onClose);
  const [qty, setQty] = useState(1);
  /*
   * `picked` holds the choice, and — for an extra the customer took more than
   * one of — how many. `{ id, qty }` rather than a second map, because the count
   * belongs to the choice: switching from ginger beer to something else must not
   * carry the old count across.
   */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, string | string[]>>(() => {
    const initial: Record<string, string | string[]> = {};
    for (const o of item.options) {
      /*
       * Optional options start EMPTY.
       *
       * They used to start on their first choice, which was harmless while every
       * option was free — and became a real overcharge the moment the drink
       * arrived: a customer who only wanted a plate was silently given a R25
       * ginger beer. An optional choice must start unchosen.
       */
      if (!o.multiple && !o.required && o.choices[0]) continue;
      if (!o.multiple && o.choices[0]) initial[o.id] = o.choices[0].id;
    }
    return initial;
  });
  const [toast, setToast] = useState<string | null>(null);

  const picks: CartOptionPick[] = [];
  for (const o of item.options) {
    const val = picked[o.id];
    if (!val) continue;
    const ids = Array.isArray(val) ? val : [val];
    for (const id of ids) {
      const c = o.choices.find((x) => x.id === id);
      if (!c) continue;
      /*
       * Only a priced extra carries a count. A starch picked "twice" is still one
       * starch — and its delta is zero, so a count there would be a number with
       * no meaning that still showed up in the key and split the basket line.
       */
      const qty = o.priced ? Math.min(maxPerExtra(o, c), Math.max(1, counts[`${o.id}:${c.id}`] ?? 1)) : 1;
      picks.push({ optionId: o.id, choiceId: c.id, label: c.label, priceDelta: c.priceDelta, ...(qty > 1 ? { qty } : {}) });
    }
  }

  /* The count multiplies the extra, not the plate: 2 beers beside one plate is
     R100 + R50, never 2 × R125. */
  const unitPrice = item.price + picks.reduce((n, p) => n + extraCost(p.priceDelta || 0, p.qty), 0);

  const missing = item.options.filter((o) => o.required && !picked[o.id]);

  const submit = () => {
    if (missing.length) {
      setToast(`Please choose ${missing[0].label.toLowerCase()}.`);
      setTimeout(() => setToast(null), 2600);
      return;
    }
    add(buildLine(item, picks, qty));
    onClose();
  };

  const toggle = (optionId: string, choiceId: string, multiple?: boolean, required = true, max?: number) => {
    setPicked((prev) => {
      if (!multiple) {
        /* Tapping the chosen answer of an optional option clears it — that is
           the only way to say "no drink", and a drink nobody wanted is money
           taken for nothing. */
        if (!required && prev[optionId] === choiceId) {
          const next = { ...prev };
          delete next[optionId];
          return next;
        }
        return { ...prev, [optionId]: choiceId };
      }
      const current = (Array.isArray(prev[optionId]) ? prev[optionId] : []) as string[];
      if (current.includes(choiceId)) {
        /* A required group keeps at least one answer; unticking the last one
           would leave the dish incomplete and the error would arrive at the
           basket instead of here. */
        if (required && current.length === 1) return prev;
        return { ...prev, [optionId]: current.filter((c) => c !== choiceId) };
      }
      /* The catalogue's own cap, so the button cannot add a fourth starch the
         server would refuse. */
      const cap = Math.max(1, Math.min(20, Math.floor(Number(max) || 1)));
      if (current.length >= cap) return prev;
      return { ...prev, [optionId]: [...current, choiceId] };
    });
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[75] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
    >
      <button type="button" className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="animate-rise relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-bone shadow-2xl sm:rounded-3xl">
        <div className="relative h-52 shrink-0 sm:h-64">
          <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
          <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-bone/90 text-ink hover:bg-bone" aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <div className="absolute bottom-4 left-5 right-5 text-bone">
            <h2 className="font-display text-3xl font-semibold">{item.name}</h2>
            {item.localName && <p className="font-mono text-xs uppercase tracking-wider text-ochre">/{item.pronunciation}/ · {item.language}</p>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <p className="text-[15px] leading-relaxed text-ink/75">{item.description}</p>

          <dl className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border-2 border-ink/10 bg-white p-3 text-center">
            {[
              ['Serves', String(item.serves)],
              ['Prep', `${item.prepMins} min`],
              ['Rating', `★ ${item.rating}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-xs uppercase tracking-wider text-ink/40">{k}</dt>
                <dd className="text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {item.story && (
            <div className="mt-5 rounded-2xl border-l-4 border-ochre bg-ochre/10 p-4">
              <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Every bite tells a story</p>
              <p className="text-[14px] leading-relaxed text-ink/80">{item.story}</p>
            </div>
          )}

          {item.options.map((o) => (
            <fieldset key={o.id} className="mt-5">
              <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {o.label}
                {o.required ? <span className="text-ochre-deep">*</span> : <span className="text-xs font-normal text-ink/40">optional{o.multiple ? ' · choose any' : ''}</span>}
                {/*
                  A required group that holds several (starch, vegetable side)
                  says so, because a row of checkboxes under a bare "Choose your
                  starch" still reads as a single choice. The cap comes from the
                  catalogue, so this can never promise a fourth one.
                */}
                {o.multiple && o.required && (
                  <span className="text-xs font-normal text-ink/45">· pick up to {Math.max(1, Math.min(20, Number(o.max) || 1))}</span>
                )}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {o.choices.map((c) => {
                  const val = picked[o.id];
                  const isOn = Array.isArray(val) ? val.includes(c.id) : val === c.id;
                  /*
                   * A priced extra gets a stepper, not a switch.
                   *
                   * This is the Uber Eats shape the owner asked for: the add-on is
                   * off until it is added, adding it puts a − / + on it, and the
                   * price beside it is what that many cost. A plain toggle could
                   * only ever mean "one", so a table of four wanting four ginger
                   * beers had to add the whole plate four times — four plates they
                   * did not order.
                   */
                  const cap = maxPerExtra(o, c);
                  const count = Math.min(cap, Math.max(1, counts[`${o.id}:${c.id}`] ?? 1));
                  const steppable = Boolean(o.priced) && cap > 1;
                  const setCount = (next: number) =>
                    setCounts((prev) => ({ ...prev, [`${o.id}:${c.id}`]: Math.min(cap, Math.max(1, next)) }));

                  if (steppable && isOn) {
                    return (
                      <div
                        key={c.id}
                        /* Span both columns: a bottle name plus a stepper does not
                           fit half a modal on a phone, and truncating the name is
                           how a customer ends up not knowing what they bought. */
                        className="flex items-center justify-between gap-2 rounded-xl border-2 border-ochre bg-ochre/15 px-3 py-2 text-left text-sm sm:col-span-2"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold leading-snug">{c.label}</span>
                          <span className="font-mono text-xs text-ink/60">
                            + {zar(extraCost(c.priceDelta, count))}
                            {count > 1 && <span className="text-ink/40"> · {zar(c.priceDelta)} each</span>}
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center rounded-full border-2 border-ink/20 bg-white">
                          <button
                            type="button"
                            onClick={() => (count <= 1 ? toggle(o.id, c.id, o.multiple, Boolean(o.required), o.max) : setCount(count - 1))}
                            className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink hover:text-bone"
                            aria-label={count <= 1 ? `Remove ${c.label}` : `One fewer ${c.label}`}
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-mono text-sm font-bold" aria-live="polite">{count}</span>
                          <button
                            type="button"
                            onClick={() => setCount(count + 1)}
                            disabled={count >= cap}
                            className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink hover:text-bone disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-inherit"
                            aria-label={`One more ${c.label}`}
                          >
                            +
                          </button>
                        </span>
                      </div>
                    );
                  }

                  /*
                   * Required groups are a choice — one of these, so they read as
                   * radio buttons. An optional, priced group is an add-on, and an
                   * add-on reads as a checkbox: unticked by default, tick to take
                   * it, tick again to put it back. That is the shape the owner
                   * asked for ("add extras as checkbox") and the shape Uber Eats
                   * uses, and the difference is not decoration — a radio group
                   * cannot express "none of these", which is exactly what an
                   * optional extra most often means.
                   */
                  /*
                   * A radio only where the group holds ONE answer. A required
                   * group that takes several (starch, vegetable side) is a row of
                   * checkboxes — its required star says "pick at least one", not
                   * "pick exactly one".
                   */
                  const isChoice = Boolean(o.required) && !o.multiple;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role={isChoice ? 'radio' : 'checkbox'}
                      aria-checked={isOn}
                      onClick={() => toggle(o.id, c.id, o.multiple, Boolean(o.required), o.max)}
                      className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${isOn ? 'border-ochre bg-ochre/15 font-semibold' : 'border-ink/12 hover:border-ink/30'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {/* The visible control: a box for a checkbox, a dot for a radio. */}
                        <span
                          aria-hidden="true"
                          className={`grid h-4 w-4 shrink-0 place-items-center border-2 ${isChoice ? 'rounded-full' : 'rounded-[4px]'} ${isOn ? 'border-ochre bg-ochre' : 'border-ink/30 bg-white'}`}
                        >
                          {isOn && (isChoice
                            ? <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                            : <svg viewBox="0 0 12 12" className="h-3 w-3 text-ink" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 6.5 2.5 2.5L10 3.5" /></svg>)}
                        </span>
                        <span className="min-w-0">{c.label}</span>
                      </span>
                      {c.priceDelta > 0 && <span className="shrink-0 font-mono text-xs text-ink/55">+ {zar(c.priceDelta)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t-2 border-ink/10 bg-bone px-5 py-4">
          <Qty value={qty} onChange={setQty} />
          <Button onClick={submit} disabled={item.available === false} className="flex-1" size="lg">
            {item.available === false ? 'Sold out' : `Add to basket · ${zar(unitPrice * qty)}`}
          </Button>
        </footer>

        {toast && <div className="animate-pop absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-bone">{toast}</div>}
      </div>
    </div>
  );
}
