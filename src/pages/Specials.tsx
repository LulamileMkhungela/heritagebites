import { useCatalog } from '../store/catalog';
import { zar } from '../lib/format';
import { LinkButton, Reveal, SectionLabel, Spinner } from '../components/ui';
import { usePageSeo } from '../lib/seo';
import { waHref } from '../lib/whatsapp';
import { asset } from '../lib/assets';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Weekly service page.
 *
 * Heritage Bites publishes no day-of-week promotions: the business serves on
 * Thursdays and Fridays and confirms any special directly on WhatsApp. Rather
 * than invent seven daily offers, this page states the real service windows,
 * the two confirmed plate prices and the delivery rules.
 */
export default function Specials() {
  usePageSeo('/specials');
  const catalog = useCatalog((s) => s.data);

  if (!catalog) return <Spinner label="Loading this week…" />;

  const { settings, service, plateMenus } = catalog;
  const openDays = settings.hours.filter((h) => !h.closed);
  const areas = settings.deliveryAreas.join(' & ');
  const waLink = waHref(settings.whatsapp, 'Hi Heritage Bites! What is on special this week?');

  return (
    <>
      <header className="hb-grain hb-painted-dark relative overflow-hidden bg-ink py-16 text-bone">
        <img src={asset('/img/plate-short-rib.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-7xl px-4">
          <SectionLabel onDark>This week</SectionLabel>
          <h1 className="max-w-3xl font-display text-5xl font-semibold md:text-6xl">Cooked Thursdays &amp; Fridays</h1>
          <p className="mt-4 max-w-2xl text-bone/70">
            We cook two days a week, serving delivery and collection between {settings.serviceWindow.open} and{' '}
            {settings.serviceWindow.close}. Weekly specials are announced on WhatsApp — ask us what is on this week.
          </p>
        </div>
      </header>

      {/* Today's status is read from the API, not guessed in the browser. */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className={`rounded-3xl border-2 p-6 ${service.open ? 'border-ochre bg-ochre/10' : 'border-ink/10 bg-white'}`}>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">{service.headline}</p>
          <p className="mt-2 font-display text-2xl font-semibold">{service.message}</p>
          <p className="mt-2 text-sm text-ink/60">
            {service.open
              ? `Delivery and collection until ${settings.serviceWindow.close}.`
              : `Orders placed now are pre-orders${service.nextWindowLabel ? ` for ${service.nextWindowLabel}` : ''}.`}
          </p>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {openDays.map((day) => (
            <Reveal key={day.day}>
              <div className="flex items-center justify-between rounded-3xl border-2 border-ink/10 bg-white p-6">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Service day</p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">{DAY_NAMES[day.day]}</h2>
                </div>
                <p className="font-mono text-lg font-bold">{day.open}–{day.close}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* The two confirmed menus. */}
      <section className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6">
          <SectionLabel>The plates</SectionLabel>
          <h2 className="font-display text-3xl font-semibold md:text-4xl">Two menus, two prices</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">
            Every plate includes a starch and a vegetable side, and the price includes delivery in {areas}.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
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
                  <ul className="mt-4 space-y-2 text-[13px] text-ink/70">
                    {plate.groups.map((group) => (
                      <li key={group.id} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ochre" />
                        <span>
                          <strong className="font-semibold">{group.label.replace('Choose your ', '')}:</strong>{' '}
                          {group.items.map((item) => item.label).join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto flex flex-wrap gap-2 pt-6">
                    <LinkButton to={`/menu?builder=${plate.id}`} variant="dark" size="sm">Build this plate</LinkButton>
                    <LinkButton to="/menu" variant="outline" size="sm">See the menu</LinkButton>
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Delivery rules, stated once and clearly. */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="rounded-[2rem] border-2 border-ink/10 bg-bone-2 p-8 md:p-12">
          <div className="grid gap-8 md:grid-cols-[1.3fr_1fr] md:items-center">
            <div>
              <SectionLabel>Delivery &amp; collection</SectionLabel>
              <h2 className="font-display text-3xl font-semibold md:text-4xl">How the week works</h2>
              <dl className="mt-5 space-y-3 text-sm">
                {[
                  ['Service days', openDays.map((d) => DAY_NAMES[d.day]).join(' and ')],
                  ['Service window', `${settings.serviceWindow.open}–${settings.serviceWindow.close}`],
                  ['Delivery areas', areas],
                  ['Minimum order', `${zar(settings.minDeliveryOrder)} for plated meals`],
                  ['Delivery fee', 'Included in the plate price'],
                  ['Collection', settings.collectionPoint],
                  ['Preparation', `About ${settings.prepEstimateMins} minutes, cooked to order`],
                  ['Delivery time', `About ${settings.deliveryEstimateMins} minutes inside the window`],
                ].map(([term, value]) => (
                  <div key={term} className="grid gap-1 border-b border-ink/10 pb-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
                    <dt className="font-semibold text-ink">{term}</dt>
                    <dd className="text-ink/65">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-3xl bg-ink p-8 text-bone">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre">Ask about this week</p>
              <p className="mt-3 text-sm leading-relaxed text-bone/75">
                Specials change week to week and are confirmed on WhatsApp. Send us a message and we will tell you what
                is in the pots.
              </p>
              <LinkButton href={waLink} variant="whatsapp" size="lg" className="mt-5">
                WhatsApp us
              </LinkButton>
              <p className="mt-4 text-xs leading-relaxed text-bone/45">
                No delivery-partner links are published yet. Order online, or collect in {areas}.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
