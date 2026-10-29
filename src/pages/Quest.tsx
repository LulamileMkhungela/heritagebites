import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { normalisePhone } from '../lib/format';
import { Button, Badge, Field, HeritageBand, Reveal, SectionLabel, inputCls } from '../components/ui';
import { useCatalog } from '../store/catalog';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { waHref } from '../lib/whatsapp';
import { asset } from '../lib/assets';

/*
 * Customer quests.
 *
 * A quest is a request for a specific meal — the dish someone wishes we cooked.
 * The page deliberately runs in a fixed order: look first, then ask. Step one is
 * a *reference* of what the kitchen already cooks, drawn from the live catalogue
 * so it can never drift from the real menu. It is view only on purpose: the
 * cards are not links, carry no photos, no descriptions and no add-to-basket
 * control, so a quest cannot be mistaken for an order and no dish detail page
 * opens from here. If the dish somebody wants is not in that list, step two is
 * the form — and a person reads it and replies.
 */

const SERVICE_DAYS = [
  { value: 'either', label: 'Either Thursday or Friday' },
  { value: 'Thursday', label: 'Thursday' },
  { value: 'Friday', label: 'Friday' },
];

/** "Choose your protein" → "Protein"; the reference column heading. */
const groupHeading = (label: string) => label.replace(/^choose your\s+/i, '');

export default function Quest() {
  useDocumentTitle('Customer quest');
  const catalog = useCatalog((s) => s.data);
  const s = catalog?.settings;

  const [form, setForm] = useState({ name: '', phone: '', email: '', dish: '', serviceDay: 'either', plates: '1', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [delivered, setDelivered] = useState(false);

  /*
   * The quest page's WhatsApp link carries whatever the customer has typed so
   * far, so a half-filled form can still reach the kitchen in one tap instead of
   * being retyped in the chat.
   */
  const questMessage = [
    'Hi Heritage Bites, I have a meal quest:',
    form.dish.trim() ? `Dish: ${form.dish.trim()}` : '',
    form.plates.trim() ? `Plates: ${form.plates.trim()}` : '',
    form.serviceDay && form.serviceDay !== 'either' ? `Day: ${form.serviceDay}` : '',
    form.notes.trim() ? `Notes: ${form.notes.trim()}` : '',
    form.name.trim() ? `Name: ${form.name.trim()}` : '',
    form.phone.trim() ? `Phone: ${form.phone.trim()}` : '',
  ].filter(Boolean).join('\n');
  const waLink = waHref(s?.whatsapp, questMessage);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors((x) => ({ ...x, [k]: '' }));
    };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Please tell us your name.';
    if (normalisePhone(form.phone).length < 11) next.phone = 'Please add a cell number we can reply to.';
    if (form.dish.trim().length < 5) next.dish = 'Tell us what you would like us to cook.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'That email does not look right.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setState('sending');
    try {
      const result = await api.quest({ ...form, plates: Number(form.plates) || 1 });
      setDelivered(result.delivered);
      setState('sent');
      setForm({ name: '', phone: '', email: '', dish: '', serviceDay: 'either', plates: '1', notes: '' });
    } catch (err) {
      setState('idle');
      setErrors({ dish: err instanceof ApiError ? err.errors[0] : 'Something went wrong. Please try again.' });
    }
  };

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-16 text-bone">
        <img src={asset('/img/mogodu.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/90 to-ink/40" />
        <div className="relative mx-auto max-w-7xl px-4">
          <SectionLabel onDark>Customer quest</SectionLabel>
          <h1 className="font-display text-5xl font-semibold md:text-6xl">Ask us to cook it</h1>
          <p className="mt-4 max-w-2xl text-bone/70">
            Is there a dish you wish was on our menu — something from home, a family favourite, or a plate you had
            somewhere and cannot stop thinking about? Look through what the kitchen cooks, then tell us what you are
            after. A person reads every quest and comes back to you.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          {/* ---------------------- Step 1: the reference ---------------------- */}
          <Reveal>
            <div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink font-mono text-sm font-bold text-ochre">1</span>
                <h2 className="font-display text-3xl font-semibold">What the kitchen cooks</h2>
                <Badge tone="ink">Reference only</Badge>
              </div>
              <p className="mt-2 text-sm text-ink/60">
                Both plate menus, and everything you can already choose inside them. It is here so you know what we have
                before you ask for something else.
              </p>

              {/*
                Guard rail: this block is a look, not a menu. It contains no
                anchors, no buttons and no dish photos, and the whole panel is
                marked non-interactive for assistive tech. `data-quest-reference`
                is asserted by the interaction smoke test so a future edit cannot
                quietly turn the reference into a shop.
              */}
              <div
                data-quest-reference
                role="group"
                aria-label="Reference only: what the kitchen cooks. Nothing here opens."
                aria-disabled="true"
                className="mt-5 select-none space-y-4"
              >
                {(catalog?.categories ?? []).map((category) => {
                  const plate = catalog?.plateMenus?.find((p) => p.id === category.id);
                  return (
                    <article key={category.id} className="rounded-3xl border-2 border-ink/10 bg-white p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-display text-xl font-semibold">{category.name}</h3>
                        <p className="font-mono text-xs uppercase tracking-wider text-ochre-deep">{category.tagline}</p>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">{category.blurb}</p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        {(plate?.groups ?? []).map((group) => (
                          <div key={group.id} className="rounded-2xl bg-bone/60 p-3">
                            <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink/45">{groupHeading(group.label)}</p>
                            <p className="mt-1.5 text-[13px] leading-snug text-ink/75">
                              {group.items.map((item) => item.label).join(' · ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>

              <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink/45">
                <span aria-hidden="true" className="mt-px">ℹ</span>
                <span>
                  Nothing in this list opens. There are no dish pages here on purpose — it is a quick look at what the pots
                  already hold, so you can ask for something they do not.
                </span>
              </p>
            </div>
          </Reveal>

          {/* ------------------------ Step 2: the form ------------------------- */}
          {/*
            No Reveal on the form column. The reveal animates in only once the
            block scrolls into view, and the whole point of this page is that the
            form is reachable after the reference — a form that is invisible
            until an IntersectionObserver fires is a form some people never see.
          */}
          <div>
            <div className="rounded-[2rem] border-2 border-ink/10 bg-white p-6 md:p-8">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ochre font-mono text-sm font-bold text-ink">2</span>
                <h2 className="font-display text-3xl font-semibold">Send your quest</h2>
              </div>

              {state === 'sent' ? (
                <div className="mt-6 rounded-3xl border-2 border-ochre bg-ochre/10 p-6 text-center">
                  <p className="text-3xl" aria-hidden="true">✦</p>
                  <h3 className="mt-2 font-display text-2xl font-semibold">{delivered ? 'Quest sent' : 'Quest received'}</h3>
                  <p className="mt-2 text-sm text-ink/65">
                    {delivered
                      ? 'It is in our inbox and a person will come back to you on the number you gave us.'
                      : 'Your quest is saved with us, but our email notification did not go through just now. Please call or WhatsApp us if it is for this week’s window.'}
                  </p>
                  <p className="mt-2 text-[13px] font-medium text-ink/70">
                    This is a request, not an order — nothing has been charged and nothing is booked yet.
                  </p>
                  <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-full border-2 border-ink bg-white px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-bone"
                    >
                      Open WhatsApp
                    </a>
                    <Button variant="outline" onClick={() => setState('idle')}>
                      Send another quest
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
                  <p className="text-sm text-ink/60">
                    Not in the list, or not the way you want it? Tell us here. No deposit, no payment — just the request.
                  </p>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Your name" error={errors.name}>
                      <input className={inputCls} value={form.name} onChange={set('name')} placeholder="Thabo Mahlangu" autoComplete="name" />
                    </Field>
                    <Field label="Cell number" hint="we reply here" error={errors.phone}>
                      <input className={inputCls} value={form.phone} onChange={set('phone')} placeholder="+27 82 000 0000" autoComplete="tel" inputMode="tel" />
                    </Field>
                  </div>

                  <Field label="Email" hint="optional" error={errors.email}>
                    <input className={inputCls} value={form.email} onChange={set('email')} placeholder="you@example.co.za" autoComplete="email" type="email" />
                  </Field>

                  <Field
                    label="What should we cook?"
                    hint="the dish, and how you like it"
                    error={errors.dish}
                  >
                    <textarea
                      className={`${inputCls} min-h-28 resize-y`}
                      value={form.dish}
                      onChange={set('dish')}
                      placeholder="e.g. Dombolo with tshotlo and morogo, the way my grandmother made it for Sunday lunch…"
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Which day suits you?">
                      <select className={inputCls} value={form.serviceDay} onChange={set('serviceDay')}>
                        {SERVICE_DAYS.map((d) => (
                          <option key={d.value} value={d.value}>{d.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="How many plates?" hint="1–60">
                      <input
                        className={inputCls}
                        value={form.plates}
                        onChange={set('plates')}
                        type="number"
                        min={1}
                        max={60}
                        inputMode="numeric"
                      />
                    </Field>
                  </div>

                  <Field label="Anything else?" hint="optional">
                    <textarea
                      className={`${inputCls} min-h-20 resize-y`}
                      value={form.notes}
                      onChange={set('notes')}
                      placeholder="An occasion, a date you need it by, or a note about a larger table…"
                    />
                  </Field>

                  <Button type="submit" size="lg" disabled={state === 'sending'}>
                    {state === 'sending' ? 'Sending…' : 'Send my quest'}
                  </Button>

                  <p className="text-xs leading-relaxed text-ink/40">
                    A quest does not place an order. If we can cook it, we come back to you first with the date and what it
                    costs, and you decide from there. We only use these details to answer you — see our{' '}
                    <Link to="/policies" className="font-semibold text-ink/60 underline">privacy policy</Link>.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>

        <p className="mt-10 text-center text-sm text-ink/55">
          Already know exactly what you want from the menu?{' '}
          <Link to="/menu" className="font-semibold text-ochre-deep underline">Order it here</Link>
          {' '}— or WhatsApp us on{' '}
          <a href={waLink} target="_blank" rel="noreferrer" className="font-semibold text-ochre-deep underline">
            {s?.phoneDisplay ?? '+27 67 013 7587'}
          </a>
          .
        </p>
      </section>

      <HeritageBand className="h-2 w-full" />
    </>
  );
}
