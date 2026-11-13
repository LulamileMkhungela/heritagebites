import { useState } from 'react';
import { api, STATIC_PREVIEW } from '../lib/api';
import { zar } from '../lib/format';
import { Button, ContactText, Field, LinkButton, Reveal, SectionLabel, inputCls } from '../components/ui';
import { normalisePhone } from '../lib/format';
import { usePageSeo } from '../lib/seo';
import { useCatalog } from '../store/catalog';
import { waHref, loyaltyEnquiry } from '../lib/whatsapp';

const CARD_SIZE = 10;

export default function Passport() {
  usePageSeo('/passport');
  const catalog = useCatalog((s) => s.data);
  const settings = catalog?.settings;
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.passport>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.passport(phone);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look that up.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

    const stamps = result?.found ? result.stamps : 0;
    const remainder = stamps % CARD_SIZE;
    /*
     * A card that completes at exactly ten stamps must read as full, not empty:
     * `stamps % 10` is zero there, so the grid drew an empty card and "until
     * free" jumped back to ten — the stamp that earned the reward was the one
     * that hid it. The full card now shows as full, and the copy says where the
     * reward is applied by the restaurant when the customer places an order.
     */
    const cardFull = stamps > 0 && remainder === 0;
    const filled = cardFull ? CARD_SIZE : remainder;
    // Read the earning rate from settings rather than asserting a fixed rule.
    // The server banks loyaltyPointsFor(total, loyaltyRateCents), so hardcoding
    // "one stamp per order" here would describe a scheme the store does not run.
    const perRand = catalog?.settings?.loyaltyRateCents ?? 5000;
    const earnCopy =
      perRand > 0
        ? `One stamp for every ${zar(perRand / 100)} you spend`
        : 'One stamp per order';

    return (
      <section className="mx-auto max-w-4xl px-4 py-14">
        <SectionLabel>Loyalty card</SectionLabel>
        <h1 className="font-display text-4xl font-semibold md:text-5xl">Your loyalty card</h1>
        <p className="mt-3 max-w-2xl text-ink/65">
          {earnCopy}. Enter your cell number to see your stamps. Collect ten stamps for a meal on us — no app or account needed.
        </p>

      {/*
        The card lookup is a server query, so it cannot work on the static
        preview. Saying so beats a form that appears to search and then fails.
      */}
      {STATIC_PREVIEW && (
        <div className="mt-8 rounded-3xl border-2 border-ochre bg-ochre/10 p-5">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ochre-deep">Preview build</p>
          <p className="mt-1.5 text-sm text-ink/70">
            Stamp lookups need the live site. In the meantime, WhatsApp us on{' '}
            <a href={waHref(settings?.whatsapp, loyaltyEnquiry(phone))} target="_blank" rel="noreferrer" className="font-semibold text-ochre-deep underline">
              {settings?.phoneDisplay ?? '+27 67 013 7587'}
            </a>{' '}
            and we will check your card for you.
          </p>
        </div>
      )}

      <form onSubmit={lookup} className={`mt-8 flex-wrap items-end gap-3 ${STATIC_PREVIEW ? 'hidden' : 'flex'}`}>
        <div className="min-w-64 flex-1">
          <Field label="Your cell number">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 82 000 0000" inputMode="tel" />
          </Field>
        </div>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Looking up…' : 'Find my card'}
        </Button>
      </form>

      {error && (
        <p className="mt-4 rounded-xl border-2 border-chili bg-chili/10 p-3 text-sm text-chili">
          <ContactText>{error}</ContactText>
        </p>
      )}

      {result && (
        <Reveal>
          <div className="hb-painted-dark mt-8 overflow-hidden rounded-[2rem] border-2 border-ink bg-ink text-bone">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bone/15 px-6 py-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre">Heritage Bites</p>
                <p className="font-display text-xl font-semibold">{result.found ? result.name : 'No stamps yet'}</p>
              </div>
              <p className="font-mono text-xs text-bone/50">{normalisePhone(phone)}</p>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-5 gap-3 sm:grid-cols-10">
                {[...Array(CARD_SIZE)].map((_, i) => (
                  <div
                    key={i}
                    className={`grid aspect-square place-items-center rounded-2xl border-2 text-xl transition-all ${
                      i < filled ? 'border-ochre bg-ochre text-ink' : i === filled ? 'border-dashed border-ochre/60 text-ochre/60' : 'border-bone/15 text-bone/15'
                    }`}
                    aria-label={i < filled ? 'Stamp collected' : i === filled ? 'Next stamp' : 'Empty'}
                  >
                    {i === 9 ? '🎁' : i < filled ? '✦' : '·'}
                  </div>
                ))}
              </div>

              {result.found ? (
                <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ['Stamps collected', String(result.stamps)],
                    ['Orders placed', String(result.orders)],
                    ['Total spent', zar(result.lifetime ?? 0)],
                    ['Next free meal', cardFull ? 'Ready now' : `${result.untilFree} stamps away`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl border border-bone/15 p-3">
                      <dt className="font-mono text-xs uppercase tracking-wider text-bone/45">{k}</dt>
                      <dd className="mt-1 font-display text-2xl font-bold text-ochre">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-6 text-sm text-bone/65">
                  No orders against this number yet. Place your first one and your card starts filling up automatically.
                </p>
              )}

              {cardFull && (
                <div className="mt-6 rounded-2xl border-2 border-ochre bg-ochre p-4 text-ink">
                  <p className="font-display text-lg font-semibold">Your card is full</p>
                  <p className="mt-1 text-[13px] text-ink/75">
                    {(result.cardsCompleted ?? 1) > 1
                      ? `${result.cardsCompleted} rewards earned. Show this screen when you place your next order so the team can apply one.`
                      : 'Show this screen when you place your next order so the team can apply your meal reward. Stamps keep counting after that.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Reveal>
      )}

      {/*
        Customer quest: the loyalty card answers "what have I earned?"; a quest
        answers "can you cook this?". They are adjacent needs for the same
        person, so the invitation to ask for a specific meal sits on this page
        instead of hiding in the footer.
      */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-5 rounded-3xl border-2 border-ink/10 bg-white p-6">
        <div className="max-w-xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Customer quest</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Craving something that is not on the menu?</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60">
            Look through what the kitchen cooks, then ask us for the dish you actually want. A person reads it and replies
            — no payment, no order placed.
          </p>
        </div>
        <LinkButton to="/quest">Start a quest</LinkButton>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-2xl font-semibold">How your loyalty card works</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: 'No sign-up', d: 'Your cell number is the card. Nothing to install or remember.' },
            { t: 'No expiry', d: 'Stamps stay on your card for as long as we are trading.' },
            { t: 'Family friendly', d: 'One number can cover the whole household — stamps pool together.' },
            { t: 'Claim your reward', d: 'When your card is full, show the screen when you place your next order so the team can apply your free meal.' }
          ].map((c) => (
            <div key={c.t} className="rounded-3xl border-2 border-ink/10 bg-white p-5">
              <h3 className="font-display text-lg font-semibold">{c.t}</h3>
              <p className="mt-1.5 text-[13px] text-ink/60">{c.d}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <LinkButton to="/menu">Start earning</LinkButton>
        <LinkButton to="/specials" variant="outline">See this week&apos;s service</LinkButton>
      </div>
    </section>
  );
}
