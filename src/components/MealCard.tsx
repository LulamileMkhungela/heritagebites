import { useState } from 'react';
import type { CartOptionPick, MenuItem, MenuOption } from '../lib/types';
import { zar } from '../lib/format';
import { Button, HeritageBand, Qty } from './ui';
import { buildLine, useCart } from '../store/cart';
import { useOverlay } from '../lib/useOverlay';
import { extraCost, maxPerExtra, maxPortions, portionCost } from '../../shared/service.js';

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
        {needsChoice ? 'Customise' : 'Add to cart'}
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
      /*
       * In list view the photo is a fixed-width column with a LOCKED aspect
       * ratio, not `h-full`.
       *
       * `h-full` made the image column as tall as whatever the text beside it
       * happened to need, so a two-line description gave a 136px row and a
       * three-line one gave 190px — the pictures ran from a letterbox to a
       * portrait down the same list, and the price never sat on the same line
       * twice. A 4:3 column at a fixed width gives every row the same height, so
       * the eye can run down the prices and the buttons line up.
       */
      className={`relative block shrink-0 overflow-hidden bg-ink/5 text-left ${
        isList ? 'aspect-[4/3] w-28 self-start rounded-l-2xl sm:w-40' : 'aspect-[4/3] w-full'
      }`}
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
      <article className="group flex items-start overflow-hidden rounded-2xl border-2 border-theme/10 bg-surface transition-colors hover:border-theme/25">
        {photo}
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-4 sm:min-h-24 sm:flex-row sm:items-center sm:gap-5">
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
       * A choice that can be taken more than once carries its count, so the cart
       * line can say `2 × Pap` rather than leaving the kitchen to work the
       * extras out from the plate price.
       *
       * Both kinds of counted choice end up here. A priced extra (the soft
       * drink) is charged for every one; a starch or a side includes its first
       * portion and charges only the rest. Which rule applies is decided by the
       * two helpers from the choice itself, never by a flag on the group.
       */
      const cap = o.priced ? maxPerExtra(o, c) : maxPortions(c);
      const qty = Math.min(cap, Math.max(1, counts[`${o.id}:${c.id}`] ?? 1));
      const delta = o.priced ? extraCost(c.priceDelta, qty) : portionCost(c, qty);
      picks.push({ optionId: o.id, choiceId: c.id, label: c.label, priceDelta: delta, ...(qty > 1 ? { qty } : {}) });
    }
  }

  /* The count multiplies the extra, not the plate: 2 beers beside one plate is
     R100 + R50, never 2 × R125. Each pick already carries the amount for its
     own count, so this adds it once rather than multiplying it again. */
  const unitPrice = item.price + picks.reduce((n, p) => n + (p.priceDelta || 0), 0);

  /*
   * What one extra portion of anything in this option costs.
   *
   * Read off the choices rather than a constant, so the label above the group
   * and the amount the till charges cannot drift apart. Zero means no choice in
   * the group has an extra-portion rule.
   */
  const extraPortionPrice = (o: MenuOption) =>
    Math.max(0, ...o.choices.map((c) => Number(c.extraPrice) || 0));

  /*
   * A required option with nothing chosen.
   *
   * An array with nothing in it is still truthy, so `!picked[o.id]` alone said
   * "answered" for a multiple group the customer had just emptied — and the Add
   * button stayed enabled, offering to sell a plate with no starch. Empty means
   * empty, in both the single and the multiple shape.
   */
  const answered = (v?: string | string[]) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
  const missing = item.options.filter((o) => o.required && !answered(picked[o.id]));

  const submit = () => {
    if (missing.length) {
      setToast(`Please choose ${missing[0].label.toLowerCase()}.`);
      setTimeout(() => setToast(null), 2600);
      return;
    }
    add(buildLine(item, picks, qty));
    onClose();
  };

  /**
   * Tap a choice: select it, or deselect it if it is already selected.
   *
   * **Anything selected can be deselected, in every option** (owner, 19 Nov
   * 2026: "if a user click customise and select pap they must be able to
   * deselect that applies to everything they select"). Tapping Pap by mistake
   * has to be undoable, and a required group is no exception.
   *
   * Deselecting used to be refused in two places — the last tick of a required
   * multiple group, and any required single-choice group such as the protein.
   * Both were guarding the "nothing chosen" case, which is already guarded where
   * it belongs: `missing` disables the Add button and names what is still needed,
   * so a half-built dish can never be added. Refusing the tap instead left the
   * customer holding a choice they could not take back.
   */
  const toggle = (optionId: string, choiceId: string, multiple?: boolean, _required = true, max?: number) => {
    setPicked((prev) => {
      if (!multiple) {
        /* Tapping the chosen answer clears it — for the optional drink that is
           how "no drink" is said, and for a required group it simply empties the
           group, which `missing` then reports. */
        if (prev[optionId] === choiceId) {
          const next = { ...prev };
          delete next[optionId];
          return next;
        }
        return { ...prev, [optionId]: choiceId };
      }
      const current = (Array.isArray(prev[optionId]) ? prev[optionId] : []) as string[];
      if (current.includes(choiceId)) {
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
                  <span className="text-xs font-normal text-theme-muted">
                    · pick up to {Math.max(1, Math.min(20, Number(o.max) || 1))}
                    {/*
                      What a second portion costs, before it is tapped. A
                      stepper that only shows its price after the customer has
                      pressed + is a price they agreed to without reading it.
                    */}
                    {extraPortionPrice(o) > 0 && <> · extra portion + {zar(extraPortionPrice(o))}</>}
                  </span>
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
                  const cap = o.priced ? maxPerExtra(o, c) : maxPortions(c);
                  const count = Math.min(cap, Math.max(1, counts[`${o.id}:${c.id}`] ?? 1));
                  /*
                   * Any choice the catalogue lets a customer take twice gets a
                   * stepper: the soft drink, and now the starch and the
                   * vegetable side. Owner, 19 Nov 2026: "on choose a starch,
                   * choose vegetables, can we have similar functionality like we
                   * have on add soft drink so the user can set if they want more
                   * than 1 pap, etc but when they add more than 1 pap or any the
                   * price goes up."
                   */
                  const steppable = cap > 1;
                  const setCount = (next: number) =>
                    setCounts((prev) => ({ ...prev, [`${o.id}:${c.id}`]: Math.min(cap, Math.max(1, next)) }));
                  /* Removing the only tick in a required group would leave the
                     plate incomplete, so the minus is disabled rather than dead. */
                  /*
                   * The minus at one portion removes the choice outright, even
                   * in a required group: anything selected can be deselected.
                   */
                  const delta = o.priced ? extraCost(c.priceDelta, count) : portionCost(c, count);
                  const eachPrice = o.priced ? c.priceDelta : Number(c.extraPrice) || 0;

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
                            {count === 1 ? (
                              /* The first portion of a starch or a side is
                                 inside the plate price; R0 would be a strange
                                 thing to print. A drink is charged from one. */
                              o.priced ? `+ ${zar(delta)}` : 'Included'
                            ) : (
                              <>
                                + {zar(delta)}
                                <span className="text-theme-muted"> · {zar(eachPrice)} each</span>
                              </>
                            )}
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
                      {/*
                        A second portion costs money, so "Included" alone would
                        read as "all of it is free". Show what the tap after this
                        one will cost, on the row, before it is tapped.
                      */}
                      {!o.priced && extraPortionPrice(o) > 0 && (
                        <span className="shrink-0 font-mono text-xs text-theme-muted">2nd + {zar(extraPortionPrice(o))}</span>
                      )}
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
                : `Add to cart · ${zar(unitPrice * qty)}`}
          </Button>
        </footer>

        {toast && <div className="animate-pop absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-bone">{toast}</div>}
      </div>
    </div>
  );
}
