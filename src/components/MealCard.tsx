import { useState } from 'react';
import type { CartOptionPick, MenuItem } from '../lib/types';
import { zar } from '../lib/format';
import { Button, Qty } from './ui';
import { buildLine, useCart } from '../store/cart';
import { useOverlay } from '../lib/useOverlay';

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
          {zar(item.price)} <span className="font-sans text-[10px] font-normal uppercase tracking-wider text-bone/70">incl. delivery</span>
        </span>
        {item.imagePending && (
          <span className="absolute right-3 top-3 rounded-full bg-bone/90 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink">
            Photo coming soon
          </span>
        )}
        {item.spice > 0 && <span className="absolute bottom-3 right-3 text-sm">{'🌶️'.repeat(item.spice)}</span>}
      </button>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-semibold leading-tight">{item.name}</h3>
          <span className="shrink-0 font-mono text-xs text-ink/45">{item.prepMins}′</span>
        </div>
        {item.localName && (
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-ochre-deep">
            {item.localName} · {item.language}
          </p>
        )}
        {!compact && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink/60">{item.description}</p>}
        {!compact && (
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-ink/40">
            {zar(item.price)} · starch & veg included
          </p>
        )}

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
  const [picked, setPicked] = useState<Record<string, string | string[]>>(() => {
    const initial: Record<string, string | string[]> = {};
    for (const o of item.options) if (!o.multiple && o.choices[0]) initial[o.id] = o.choices[0].id;
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
      if (c) picks.push({ optionId: o.id, choiceId: c.id, label: c.label, priceDelta: c.priceDelta });
    }
  }

  const unitPrice = item.price + picks.reduce((n, p) => n + (p.priceDelta || 0), 0);

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

  const toggle = (optionId: string, choiceId: string, multiple?: boolean) => {
    setPicked((prev) => {
      if (!multiple) return { ...prev, [optionId]: choiceId };
      const current = (Array.isArray(prev[optionId]) ? prev[optionId] : []) as string[];
      const next = current.includes(choiceId) ? current.filter((c) => c !== choiceId) : [...current, choiceId];
      return { ...prev, [optionId]: next };
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
                <dt className="font-mono text-[10px] uppercase tracking-wider text-ink/40">{k}</dt>
                <dd className="text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          {item.story && (
            <div className="mt-5 rounded-2xl border-l-4 border-ochre bg-ochre/10 p-4">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ochre-deep">Every bite tells a story</p>
              <p className="text-[14px] leading-relaxed text-ink/80">{item.story}</p>
            </div>
          )}

          {item.options.map((o) => (
            <fieldset key={o.id} className="mt-5">
              <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {o.label}
                {o.required ? <span className="text-ochre-deep">*</span> : <span className="text-[11px] font-normal text-ink/40">optional{o.multiple ? ' · choose any' : ''}</span>}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {o.choices.map((c) => {
                  const val = picked[o.id];
                  const isOn = Array.isArray(val) ? val.includes(c.id) : val === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(o.id, c.id, o.multiple)}
                      aria-pressed={isOn}
                      className={`flex items-center justify-between rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${isOn ? 'border-ochre bg-ochre/15 font-semibold' : 'border-ink/12 hover:border-ink/30'}`}
                    >
                      <span>{c.label}</span>
                      {c.priceDelta > 0 && <span className="font-mono text-xs text-ink/55">+R{c.priceDelta}</span>}
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
