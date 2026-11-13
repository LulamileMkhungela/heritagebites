import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCatalog } from '../store/catalog';
import { useCart } from '../store/cart';

import { zar } from '../lib/format';
import { Button, DiamondMark, HeritageBand, HeritageFrieze, LinkButton, NdebelePanel, PotMark, Reveal, SectionLabel, ShweshwePanel, WovenRule } from '../components/ui';
import { ItemModal, MealCard } from '../components/MealCard';
import type { MenuItem, Settings } from '../lib/types';
import { usePageSeo } from '../lib/seo';
import { basketHref, waUrlWithText, CHANNEL_ENQUIRY } from '../lib/whatsapp';
import { asset } from '../lib/assets';

export default function Home() {
  /*
   * The site-level page: its own title, description and canonical, plus the
   * business's structured data (built from the live catalogue settings).
   */
  usePageSeo('/');
  const catalog = useCatalog((s) => s.data);
  const [modal, setModal] = useState<MenuItem | null>(null);

  const featured = useMemo(() => (catalog?.menu ?? []).filter((m) => m.available).slice(0, 4), [catalog]);

  return (
    <>
      <Hero onOrder={() => document.getElementById('menu-preview')?.scrollIntoView({ behavior: 'smooth' })} />
      <Ticker />
      <ThisWeek />
      <PlateMenuCTA />

      {/* Menu preview */}
      <section id="menu-preview" className="mx-auto max-w-7xl px-4 py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionLabel>What's on the pot</SectionLabel>
            <h2 className="font-display text-4xl font-semibold md:text-5xl">This week's plates</h2>
          </div>
          <LinkButton to="/menu" variant="outline">Full menu</LinkButton>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((item, i) => (
            <Reveal key={item.id} delay={i * 70}>
              <MealCard item={item} onOpen={() => setModal(item)} />
            </Reveal>
          ))}
        </div>
      </section>

      <HowItWorks />
      <ServiceRules />
      <Channels settings={catalog?.settings} />
      <PassportCTA />

      {modal && <ItemModal item={modal} onClose={() => setModal(null)} />}
    </>
  );
}

/* --------------------------------- Hero -------------------------------- */

function Hero({ onOrder }: { onOrder: () => void }) {
  const catalog = useCatalog((s) => s.data);
  const lines = useCart((s) => s.lines);
  const fulfilment = useCart((s) => s.fulfilment);
  const s = catalog?.settings;
  const service = catalog?.service;
  const traditional = catalog?.plateMenus.find((p) => p.id === 'traditional');
  /*
   * Every WhatsApp link opens a written message. If a customer already has a
   * basket, this row sends it; otherwise it opens as an order enquiry rather
   * than a blank chat box.
   */
  const waHrefOrder = basketHref(s?.whatsapp, lines, { fulfilment });

  return (
    <section className="hb-grain hb-painted-dark relative overflow-hidden bg-ink text-bone">
      <img src={asset('/img/hero-feast.jpg')} alt="A traditional South African feast spread at Heritage Bites" className="absolute inset-0 h-full w-full object-cover opacity-55" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/30" />

      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-20 md:grid-cols-[1.15fr_.85fr] md:py-28 lg:py-32">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-bone/25 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-ochre">
            <PotMark className="h-4 w-4" />
            Est. {s?.established ?? 2025} · Every Bite Tells a Story
          </div>

          {/*
            The h1 names the food and the place, not just the mood: it is the
            strongest signal a search engine has about what this page sells, and
            "a taste of heritage" alone could be anything.
          */}
          <h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-tight md:text-7xl">
            A taste of South African heritage,
            <br />
            <span className="text-ochre">made with love.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-bone/75">
            Mogodu, tshotlo, tlhakwana, wings and short rib — cooked in small batches the way family kitchens have for
            generations. Thursdays and Fridays, {s?.serviceWindow.open ?? '12:00'}–{s?.serviceWindow.close ?? '13:30'},
            delivered in {s?.deliveryAreas.join(' & ') ?? 'Rosebank & Sandton'}.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={onOrder}>Order online</Button>
            <LinkButton to="/menu" variant="onDark" size="lg">
              View the menu
            </LinkButton>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-bone/15 pt-6">
            {[
              [zar(traditional?.price ?? 100), 'traditional plate'],
              [`${s?.serviceWindow.open ?? '12:00'}–${s?.serviceWindow.close ?? '13:30'}`, 'service window'],
              ['2', 'service days a week'],
            ].map(([v, k]) => (
              <div key={k}>
                <dt className="font-display text-3xl font-bold text-ochre">{v}</dt>
                <dd className="text-xs uppercase tracking-wider text-bone/50">{k}</dd>
              </div>
            ))}
          </dl>
          <WovenRule className="mt-6 h-2 w-40 text-bone" />
        </div>

        <Reveal delay={150}>
          <div className="rounded-3xl border border-bone/20 bg-bone/5 p-6 backdrop-blur">
            {/*
              The painted panel, not a strip: a triptych of chevron fans around a
              column of echoed diamonds, framed in ink with a gold kerb. This is
              the one place on the site with room for the full composition, so it
              is where the reference is stated most plainly.
            */}
            <NdebelePanel className="mb-5 aspect-[4/1] w-full rounded-xl ring-2 ring-ink/40" />
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre">
              {service?.headline ?? 'Order your way'}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-bone/70">{service?.message}</p>
            <ul className="mt-5 space-y-3">
              {[
                { t: 'Order online', d: 'Card through Yoco, or cash on collection', to: '/checkout' },
                { t: 'WhatsApp', d: 'Message us to place an order', href: waHrefOrder },
                { t: 'Uber Eats', d: s?.channels?.ubereats?.url ? 'Order through the app' : 'Direct ordering link coming soon', href: s?.channels?.ubereats?.url },
                { t: 'Mr D Food', d: s?.channels?.mrd?.url ? 'Order through the app' : 'Direct ordering link coming soon', href: s?.channels?.mrd?.url },
              ].map((row) => (
                <li key={row.t}>
                  {row.to ? (
                    <Link to={row.to} className="group flex items-center justify-between gap-3 rounded-2xl border border-bone/15 px-4 py-3 transition-colors hover:border-ochre hover:bg-bone/10">
                      <span>
                        <span className="block text-sm font-semibold">{row.t}</span>
                        <span className="block text-xs text-bone/55">{row.d}</span>
                      </span>
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-ochre transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </Link>
                  ) : row.href ? (
                    <a href={row.href} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-3 rounded-2xl border border-bone/15 px-4 py-3 transition-colors hover:border-ochre hover:bg-bone/10">
                      <span>
                        <span className="block text-sm font-semibold">{row.t}</span>
                        <span className="block text-xs text-bone/55">{row.d}</span>
                      </span>
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-ochre transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 17 17 7M8 7h9v9" />
                      </svg>
                    </a>
                  ) : (
                    <div aria-disabled="true" className="flex items-center justify-between gap-3 rounded-2xl border border-bone/10 px-4 py-3 text-bone/55">
                      <span>
                        <span className="block text-sm font-semibold text-bone/75">{row.t}</span>
                        <span className="block text-xs">{row.d}</span>
                      </span>
                      <span className="font-mono text-xs uppercase tracking-wider">Soon</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-bone/45">
              Collect and you pay the plate price. Delivery adds a flat fee in Rosebank and Sandton.
            </p>
          </div>
        </Reveal>
      </div>
      <HeritageBand className="relative h-3 w-full" on="ink" />
    </section>
  );
}

/* -------------------------------- Ticker ------------------------------- */

function Ticker() {
  const catalog = useCatalog((s) => s.data);
  const items = catalog?.menu ?? [];
  if (!items.length) return null;
  const row = items.slice(0, 10);
  const line = (
    <div className="flex shrink-0 items-center gap-8 pr-8">
      {row.map((m) => (
        <span key={m.id} className="flex items-center gap-3 whitespace-nowrap font-display text-lg">
          <DiamondMark className="h-3 w-3 shrink-0" pigment="gold" />
          {m.name}
        </span>
      ))}
    </div>
  );

  return (
    <div className="overflow-hidden bg-ink text-bone">
      {/* A shweshwe rail above and below the ticker: the cloth print, at a
          height where its three registers still read as cloth. */}
      <ShweshwePanel className="h-10 w-full" />
      <div className="hb-mask-fade py-3">
        <div className="animate-marquee flex w-max">
          {line}
          {line}
        </div>
      </div>
      <ShweshwePanel className="h-10 w-full" />
    </div>
  );
}

/* ------------------------------ This week ------------------------------ */

function ThisWeek() {
  const catalog = useCatalog((s) => s.data);
  const nav = useNavigate();
  if (!catalog) return null;
  const { settings, service, plateMenus } = catalog;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>This week</SectionLabel>
          <h2 className="font-display text-4xl font-semibold md:text-5xl">Cooked Thursdays &amp; Fridays</h2>
          <p className="mt-3 max-w-2xl text-sm text-ink/60">
            Service window {settings.serviceWindow.open}–{settings.serviceWindow.close}. {service.message}
          </p>
        </div>
        <LinkButton to="/specials" variant="outline">Delivery &amp; service details</LinkButton>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {plateMenus.map((plate, i) => (
          <Reveal key={plate.id} delay={i * 70}>
            <article className="flex h-full flex-col overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
              <img src={plate.image} alt="" className="h-44 w-full object-cover" loading="lazy" />
              <div className="flex flex-1 flex-col p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-2xl font-semibold">{plate.name}</h3>
                  <span className="font-display text-3xl font-bold">{zar(plate.price)}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{plate.blurb}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  <Button size="sm" variant="dark" onClick={() => nav(`/menu?builder=${plate.id}`)}>Build this plate</Button>
                  <LinkButton to="/menu" variant="outline" size="sm">See the menu</LinkButton>
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- Plate builder CTA ------------------------ */

function PlateMenuCTA() {
  const catalog = useCatalog((s) => s.data);
  const nav = useNavigate();
  if (!catalog) return null;
  const traditional = catalog.plateMenus.find((p) => p.id === 'traditional');
  const contemporary = catalog.plateMenus.find((p) => p.id === 'contemporary');

  return (
    <section className="hb-painted border-y-2 border-ink/10 bg-bone-2 py-16">
      <div className="mx-auto max-w-7xl px-4">
        <SectionLabel>Build it yourself</SectionLabel>
        <h2 className="max-w-2xl font-display text-4xl font-semibold md:text-5xl">One protein, one starch, one side</h2>
        <p className="mt-3 max-w-2xl text-ink/65">
          Choose from the traditional kitchen at {zar(traditional?.price ?? 100)} a plate, or the contemporary kitchen at{' '}
          {zar(contemporary?.price ?? 130)}. Starch and vegetable side are included; delivery is the only extra, and it is
          priced at checkout.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {catalog.plateMenus.map((plate) => (
            <Reveal key={plate.id}>
              <div className="h-full overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
                {/* Painted crown: the same frieze as a meal card, so the two card
                    kinds read as one family rather than two styles. */}
                <HeritageFrieze className="h-11 w-full" />
                <div className="flex items-baseline justify-between gap-3 px-6 pt-5">
                  <h3 className="font-display text-2xl font-semibold">{plate.name}</h3>
                  <span className="rounded-lg border-2 border-ink bg-ochre px-2.5 py-1 font-mono text-lg font-bold leading-none">{zar(plate.price)}</span>
                </div>
                <ul className="mt-4 space-y-2 px-6 pb-1 text-sm text-ink/70">
                  {plate.groups.map((g) => (
                    <li key={g.id} className="flex items-start gap-2">
                      <DiamondMark className="mt-1 h-3 w-3 shrink-0" pigment="ochre" />
                      <span>
                        <strong className="font-semibold">{g.label.replace('Choose your ', '')}</strong> — {g.items.map((i) => i.label).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 px-6 pb-6">
                  <Button size="sm" onClick={() => nav(`/menu?builder=${plate.id}`)}>
                    Build my plate
                  </Button>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ How it works --------------------------- */

function HowItWorks() {
  const catalog = useCatalog((s) => s.data);
  const perRand = catalog?.settings?.loyaltyRateCents ?? 5000;
  const rate = perRand > 0 ? zar(perRand / 100) : null;

  const steps = [
    { n: '01', t: 'Pick your plate', d: 'Choose a protein, then a starch and a vegetable side. The plate price includes everything.' },
    { n: '02', t: 'Pay your way', d: 'Pay by card through Yoco, or pay cash when you collect. Delivery is paid by card.' },
    { n: '03', t: 'Choose collection or delivery', d: 'Collect at the plate price, or have it delivered in Rosebank and Sandton for a flat fee.' },
    {
      n: '04',
      t: 'Use your loyalty card',
      /*
       * The earning rate is read from settings rather than described by hand,
       * so the copy cannot drift from what the server actually banks.
       */
      d: rate
        ? `Your loyalty card gets one stamp for every ${rate} you spend. Collect ten stamps for a meal on us.`
        : 'Your loyalty card earns stamps as you order. Collect ten stamps for a meal on us.',
    },
  ];

  return (
    <section className="hb-painted border-y-2 border-ink/10 bg-bone-2 py-16">
      <div className="mx-auto max-w-7xl px-4">
        <SectionLabel>How it works</SectionLabel>
        <h2 className="max-w-2xl font-display text-4xl font-semibold md:text-5xl">From craving to confirmation in four steps</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 80}>
              <div className="h-full overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
                {/* Each step keeps the painting's atom, in its own pigment. */}
                <div className="flex items-center gap-2 border-b-2 border-ink/10 px-5 py-2.5">
                  <DiamondMark className="h-3.5 w-3.5" pigment={(['red', 'blue', 'green', 'gold'] as const)[i % 4]} />
                  <span className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-ochre-deep">Step {s.n}</span>
                </div>
                <div className="p-5">
                  <h3 className="font-display text-xl font-semibold">{s.t}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{s.d}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Service rules --------------------------- */

function ServiceRules() {
  const catalog = useCatalog((s) => s.data);
  if (!catalog) return null;
  const { settings, service } = catalog;

  const rows = [
    ['Service days', settings.hours.filter((h) => !h.closed).map((h) => h.label).join(' and ')],
    ['Service window', `${settings.serviceWindow.open}–${settings.serviceWindow.close}`],
    ['Delivery areas', settings.deliveryAreas.join(' and ')],
    ['Minimum order', `${zar(settings.minDeliveryOrder)} for delivery`],
    [
      'Delivery fee',
      settings.deliveryIncluded
        ? 'Included in the plate price'
        : settings.freeDeliveryAbove > 0
          ? `${zar(settings.deliveryFlat)}, free over ${zar(settings.freeDeliveryAbove)}`
          : zar(settings.deliveryFlat),
    ],
    ['Collection', 'Price excludes delivery — confirm the point on WhatsApp'],
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <div className="grid gap-8 overflow-hidden rounded-[2rem] border-2 border-ink/10 bg-white md:grid-cols-[1fr_1.1fr]">
        <HeritageFrieze className="h-12 w-full md:col-span-2" />
        <div className="px-8 pb-8 md:pt-2 md:pl-12">
          <SectionLabel>The rules, plainly</SectionLabel>
          <h2 className="font-display text-4xl font-semibold">When and where we cook</h2>
          <p className="mt-3 text-ink/65">{service.message}</p>
          <p className="mt-3 text-sm text-ink/55">
            Collection is from our shadow kitchen — {settings.collectionNote}
          </p>
          <LinkButton to="/policies" variant="outline" size="sm" className="mt-5">
            Read our policies
          </LinkButton>
        </div>
        <dl className="space-y-3 px-8 pb-8 text-sm md:pr-12 md:pt-2">
          {rows.map(([term, value]) => (
            <div key={term} className="grid gap-1 border-b border-ink/10 pb-2 sm:grid-cols-[9rem_1fr] sm:gap-3">
              <dt className="font-semibold text-ink">{term}</dt>
              <dd className="text-ink/65">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------- Channels ------------------------------ */

function Channels({ settings }: { settings: Settings | undefined }) {
  const rows = [
    { key: 'ubereats', name: 'Uber Eats', icon: 'UE' },
    { key: 'mrd', name: 'Mr D Food', icon: 'MD' },
    { key: 'whatsapp', name: 'WhatsApp', icon: 'WA' },
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <div className="mb-8">
        <SectionLabel>Choose how to order</SectionLabel>
        <h2 className="font-display text-4xl font-semibold md:text-5xl">Order through your preferred app</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {rows.map((r, i) => {
          /* The configured WhatsApp URL is a bare wa.me link, which opens an
             empty chat: give it the message here, and leave any non-WhatsApp
             channel URL exactly as the owner set it. */
          const url = r.key === 'whatsapp'
            ? waUrlWithText(settings?.channels?.whatsapp?.url, settings?.whatsapp, CHANNEL_ENQUIRY)
            : settings?.channels?.[r.key]?.url;
          const description = r.key === 'whatsapp'
            ? 'Message us to place an order.'
            : url
              ? 'Order directly through the app.'
              : 'Direct ordering link coming soon.';
          const content = (
            <>
              <span className="grid h-12 w-12 place-items-center rounded-xl border-2 border-ink bg-ochre font-mono text-sm font-bold text-ink">{r.icon}</span>
              <h3 className="mt-4 font-display text-xl font-semibold">{r.name}</h3>
              <p className="mt-1 text-[13px] text-ink/60">{description}</p>
              <span className="mt-auto pt-4 text-sm font-semibold text-ochre-deep">
                {url ? 'Open app' : 'Link coming soon'}
              </span>
            </>
          );
          const cardClass = `group flex h-full flex-col rounded-3xl border-2 p-6 transition-all ${url ? 'border-ink/10 bg-white hover:-translate-y-1 hover:border-ink/30' : 'border-ink/10 bg-white/40 text-ink/60'}`;
          return (
            <Reveal key={r.key} delay={i * 80}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className={cardClass}>{content}</a>
              ) : (
                <div aria-disabled="true" className={cardClass}>{content}</div>
              )}
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------ Passport CTA --------------------------- */

function PassportCTA() {
  const nav = useNavigate();
  const catalog = useCatalog((s) => s.data);
  const perRand = catalog?.settings?.loyaltyRateCents ?? 5000;
  const rate = perRand > 0 ? zar(perRand / 100) : null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <Reveal>
        <div className="hb-painted-dark relative overflow-hidden rounded-[2rem] border-2 border-bone/15 bg-ink p-8 text-bone md:p-12">
          <div className="hb-dots pointer-events-none absolute inset-0 opacity-[0.07]" />
          <div className="relative grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-center">
            <div>
              <SectionLabel onDark>Loyalty card</SectionLabel>
              <h2 className="font-display text-4xl font-semibold md:text-5xl">Collect stamps. Get a meal on us.</h2>
              <p className="mt-3 max-w-xl text-bone/70">
                {rate
                  ? `Earn one stamp for every ${rate} you spend. Ten stamps earn a meal — your cell number is your card.`
                  : 'Earn stamps as you order. Ten stamps earn a meal — your cell number is your card.'}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
              <Button size="lg" onClick={() => nav('/passport')}>View my loyalty card</Button>
              {/*
                The quest sits directly underneath the loyalty card: same
                audience, different need. Someone who has just looked at their
                stamps is often thinking about what they want to eat next, so
                the ask for a dish they miss is one tap away rather than buried
                in a footer.
              */}
              <LinkButton to="/quest" variant="onDark">Customer quest</LinkButton>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
