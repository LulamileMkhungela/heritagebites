import { useState } from 'react';
import type { CartOptionPick, MenuItem } from '../lib/types';
import { zar } from '../lib/format';
import { Button, HeritageBand, Qty } from './ui';
import { buildLine, useCart } from '../store/cart';
import { useOverlay } from '../lib/useOverlay';
import { extraCost, maxPerExtra } from '../../shared/service.js';

export function MealCard({
  item,
  onOpen,
  compact = false,
  layout = 'grid',
}: {
  item: MenuItem;
  onOpen: () => void;
  compact?: boolean;
  /**
   * Grid is the photo card the page has always shown; list is the same card laid
   * on its side — picture left, everything else in a column — for comparing
   * prices and descriptions down the page.
   *
   * Owner, 17 Nov 2026: "the meals listview must have a listview and gridview".
   */
  layout?: 'grid' | 'list';
}) {
  const add = useCart((s) => s.add);
  const needsChoice = item.options.some((o) => o.required);
  const isList = layout === 'list';

  const quickAdd = () => {
    if (needsChoice) {
      onOpen();
      return;
    }
    add(buildLine(item, [], 1));
  };

  /*
   * The price, moved to the far right of the card.
   *
   * Owner, 17 Nov 2026: "the plate text must be far to the right in the card",
   * having been the left. In grid view it now sits at the right end of the row
   * under the photo, price first and the unit after it; in list view it is the
   * rightmost thing on the row, level with the dish name, so a column of cards
   * reads as a price column.
   *
   * The unit is "plate" or "portion" from the item itself — a bowl of chakalaka
   * is not a plate, and printing "plate" beside R30 would be a small lie repeated
   * on nine cards.
   */
  const unit = item.portion ? 'portion' : 'plate';
  const priceBlock = (
    <span className={`flex shrink-0 items-baseline gap-1 font-mono font-bold ${isList ? 'text-xl' : 'text-lg'}`}>
      {zar(item.price)}
      <span className="font-sans text-[11px] font-normal uppercase tracking-wider text-theme-muted">{unit}</span>
    </span>
  );

  const actions = (
    /*
     * In list view the price and the buttons share one row, and at 390px a
     * `w-full` button beside a price has nowhere to go — it overflowed the card
     * by about 20px, which the customer sees as a clipped "CHOOSE". Below `sm`
     * the buttons take only the space their label needs; from `sm` they sit in
     * a fixed row at the end.
     */
    <div className={`flex items-center gap-2 ${isList ? 'shrink-0 sm:w-auto' : 'w-full'}`}>
      <Button size="sm" variant="dark" onClick={quickAdd} disabled={item.available === false} block>
        {/* "basket", everywhere: the sheet footer, the bar and the drawer all
            call it the basket, and one card calling it a cart is a second word
            for the same thing. */}
        {needsChoice ? 'Choose' : 'Add to basket'}
      </Button>
      <Button size="sm" variant="outline" onClick={onOpen} aria-label={`Details for ${item.name}`}>
        ⓘ
      </Button>
    </div>
  );

  const photo = (
    <button
      type="button"
      onClick={onOpen}
      className={`relative block overflow-hidden bg-ink/5 text-left ${isList ? 'h-full w-32 shrink-0 sm:w-44' : 'aspect-[4/3] w-full'}`}
      aria-label={`View ${item.name}`}
    >
      <img
        src={item.image}
        alt={item.name}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      {!isList && <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />}
      {item.available === false && (
        <span className="absolute inset-0 grid place-items-center bg-ink/70">
          <span className="rounded-full bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-widest text-theme">Sold out today</span>
        </span>
      )}
      {item.imagePending && (
        <span className="absolute right-3 top-3 rounded-full bg-canvas/90 px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-theme">
          Photo coming soon
        </span>
      )}
    </button>
  );

  /* ------------------------------- list -------------------------------- */
  if (isList) {
    return (
      <article className="group flex overflow-hidden rounded-2xl border-2 border-theme/10 bg-surface transition-colors hover:border-theme/25">
        {photo}
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg font-semibold leading-tight">{item.name}</h3>
            {item.localName && (
              <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-accent">{item.localName}</p>
            )}
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-theme-soft">{item.description}</p>
            {item.portion && <p className="mt-1 text-[12px] text-theme-muted">{item.portion}</p>}
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2 sm:mt-0 sm:flex-nowrap sm:justify-end sm:pt-0">
            {priceBlock}
            {actions}
          </div>
        </div>
      </article>
    );
  }

  /* ------------------------------- grid -------------------------------- */
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border-2 border-theme/10 bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-theme/25 hover:shadow-[0_18px_40px_-24px_rgba(0,25,56,0.5)]">
      {/* Ndebele painted band: the card is framed, not just a photo in a box. */}
      <HeritageBand className="h-4 w-full shrink-0" width={300} tile={40} />
      {photo}

      <div className="flex flex-1 flex-col p-4">
        {/*
          No prep figure beside the name.

          It read "20′" next to "Tlhakwana", which the owner called out as
          confusing — and it was: a number with no label, sitting where a price
          or a badge usually goes, saying nothing a customer could act on. The
          kitchen cooks in batches on two days a week, so a per-plate prep time
          was never the honest answer to "when will it arrive" anyway. The dish
          sheet states the serving and the rating, which are real.
        */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold leading-tight">{item.name}</h3>
          {/* The price, at the far right of the card body. */}
          {priceBlock}
        </div>
        {item.localName && (
          <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-accent">{item.localName}</p>
        )}
        {!compact && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-theme-soft">{item.description}</p>}
        {item.portion && <p className="mt-1 text-[12px] text-theme-muted">{item.portion}</p>}

        <div className="mt-auto pt-4">{actions}</div>
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
      <div className="animate-rise relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-canvas shadow-2xl sm:rounded-3xl">
        <div className="relative h-52 shrink-0 sm:h-64">
          <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
          <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-canvas/90 text-theme hover:bg-canvas" aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <div className="absolute bottom-4 left-5 right-5 text-bone">
            <h2 className="font-display text-3xl font-semibold">{item.name}</h2>
            {item.localName && <p className="font-mono text-xs uppercase tracking-wider text-accent">/{item.pronunciation}/ · {item.language}</p>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <p className="text-[15px] leading-relaxed text-theme-soft">{item.description}</p>

          <dl className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border-2 border-theme/10 bg-surface p-3 text-center">
            {[
              ['Serves', String(item.serves)],
              ['Rating', `★ ${item.rating}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-mono text-xs uppercase tracking-wider text-theme-muted">{k}</dt>
                <dd className="text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {item.story && (
            <div className="mt-5 rounded-2xl border-l-4 border-ochre bg-ochre/10 p-4">
              <p className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-accent">Every bite tells a story</p>
              <p className="text-[14px] leading-relaxed text-theme-soft">{item.story}</p>
            </div>
          )}

          {item.options.map((o) => (
            <fieldset key={o.id} className="mt-5">
              <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {o.label}
                {o.required ? <span className="text-accent">*</span> : <span className="text-xs font-normal text-theme-muted">optional{o.multiple ? ' · choose any' : ''}</span>}
                {/*
                  A required group that holds several (starch, vegetable side)
                  says so, because a row of checkboxes under a bare "Choose your
                  starch" still reads as a single choice. The cap comes from the
                  catalogue, so this can never promise a fourth one.
                */}
                {o.multiple && o.required && (
                  <span className="text-xs font-normal text-theme-muted">· pick up to {Math.max(1, Math.min(20, Number(o.max) || 1))}</span>
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
                          <span className="font-mono text-xs text-theme-soft">
                            + {zar(extraCost(c.priceDelta, count))}
                            {count > 1 && <span className="text-theme-muted"> · {zar(c.priceDelta)} each</span>}
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center rounded-full border-2 border-theme/20 bg-surface">
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
                      className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${isOn ? 'border-ochre bg-ochre/15 font-semibold' : 'border-theme/12 hover:border-theme/30'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {/* The visible control: a box for a checkbox, a dot for a radio. */}
                        <span
                          aria-hidden="true"
                          className={`grid h-4 w-4 shrink-0 place-items-center border-2 ${isChoice ? 'rounded-full' : 'rounded-[4px]'} ${isOn ? 'border-ochre bg-ochre' : 'border-theme/30 bg-surface'}`}
                        >
                          {isOn && (isChoice
                            ? <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                            : <svg viewBox="0 0 12 12" className="h-3 w-3 text-theme" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 6.5 2.5 2.5L10 3.5" /></svg>)}
                        </span>
                        <span className="min-w-0">{c.label}</span>
                      </span>
                      {c.priceDelta > 0 && <span className="shrink-0 font-mono text-xs text-theme-soft">+ {zar(c.priceDelta)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t-2 border-theme/10 bg-canvas px-5 py-4">
          <Qty value={qty} onChange={setQty} />
          {/*
            A dish with a required choice cannot be added until the choice is
            made — and the button is now actually disabled rather than letting
            the tap through to a toast. Owner, 17 Nov 2026: "disable that if
            there is no food selected". The plate builder has behaved this way
            for a while; the dish sheet was the one place that refused after the
            tap instead of before it, which reads as the button being broken.
          */}
          <Button
            onClick={submit}
            disabled={item.available === false || missing.length > 0}
            className="flex-1"
            size="lg"
          >
            {item.available === false
              ? 'Sold out'
              : missing.length
                ? `Pick a ${missing[0].label.toLowerCase().replace(/^choose your\s+/, '')}`
                : `Add to basket · ${zar(unitPrice * qty)}`}
          </Button>
        </footer>

        {toast && <div className="animate-pop absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-bone">{toast}</div>}
      </div>
    </div>
  );
}
