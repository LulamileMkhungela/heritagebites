import { useCatalog } from '../store/catalog';
import { HeritageBand, LinkButton, Reveal, SectionLabel } from '../components/ui';
import { usePageSeo } from '../lib/seo';
import { asset } from '../lib/assets';

export default function About() {
  usePageSeo('/about');
  const catalog = useCatalog((s) => s.data);
  const s = catalog?.settings;

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-20 text-bone">
        <img src={asset('/img/hero-feast.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/40" />
        <div className="relative mx-auto max-w-4xl px-4">
          <SectionLabel onDark>Our Story</SectionLabel>
          <h1 className="font-display text-5xl font-semibold leading-tight md:text-7xl">Every bite tells a story</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone/75">
            Every great meal begins with love. For us, it started around the Sunday table and in the lunch boxes packed
            with care, because food has always been how we bring people together.
          </p>
        </div>
      </header>

      {/* How we started */}
      <section id="story" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <Reveal>
            <SectionLabel>How we started</SectionLabel>
            <h2 className="font-display text-4xl font-semibold md:text-5xl">A mother, a daughter, and a Sunday table</h2>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-theme-soft">
              <p>
                Heritage Bites is the dream of a mother and daughter, Keneilwe and Regomoditswe Moremedi. Together they
                bring years of experience in catering and running a food and pub business, along with a deep love of
                cooking and an instinct for how ingredients come together. That combination is the heart of everything we do.
              </p>
              <p>
                We want to share the taste of traditional Setswana food with you, served alongside modern, contemporary
                dishes. It’s the food of our heritage, made for the way you live today.
              </p>
              <div id="why-we-began" className="scroll-mt-28 space-y-4">
                <h3 className="font-display text-xl font-semibold text-theme">Why We Began</h3>
                <p>
                  Heritage Bites officially opened its doors in 2025. We started because we love to cook, and because
                  we saw people who needed us: busy professionals with little time to cook, and a growing weariness
                  with the same old canteen meals. We wanted to offer something better, a home-cooked meal that tastes
                  like it was made just for you.
                </p>
                <p>Heritage Bites is a proudly registered private company (CIPC).</p>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton to="/menu">Browse our meals</LinkButton>
              <LinkButton to="/contact" variant="outline">Contact us</LinkButton>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="relative">
              <img src={asset('/img/tshotlo.jpg')} alt="Tshotlo, slow-cooked pounded beef" className="aspect-[4/5] w-full rounded-[2rem] border-2 border-theme object-cover" />
              {/*
                A gold card: its text has to be literally ink in both themes,
                because the surface does not change. Theme text went paper-on-
                gold in dark mode at 3:1 — the audit caught it.
              */}
              <div className="absolute -bottom-6 -left-6 hidden rounded-3xl border-2 border-theme bg-ochre p-5 text-[#001938] md:block">
                <p className="font-mono text-xs uppercase tracking-[0.2em]">Established</p>
                <p className="font-display text-5xl font-bold">{s?.established ?? 2025}</p>
                <p className="mt-1 text-xs text-[#001938]">Our beginning</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <HeritageBand className="h-5 w-full" width={1440} />

      {/* Vision + Mission */}
      <section className="border-b-2 border-theme/10 bg-ink py-20 text-bone">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 md:grid-cols-2">
          <Reveal>
            <div id="vision" className="scroll-mt-28">
              <SectionLabel onDark>Our Vision</SectionLabel>
              <h2 className="font-display text-4xl font-semibold md:text-5xl">South Africa’s most loved traditional kitchen</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-bone/70">
                To become South Africa’s most loved brand in traditional cuisine.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-bone/70">
                Today we cook on Thursdays and Fridays from a shadow kitchen, with delivery in Rosebank and Sandton and
                up to {s?.maxDeliveryKm ?? 10} km from the kitchen. Any cooking day ahead can be booked in advance.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div id="mission" className="scroll-mt-28">
              <SectionLabel onDark>Our Mission</SectionLabel>
              <h2 className="font-display text-4xl font-semibold md:text-5xl">Three things we hold to</h2>
              <ul className="mt-5 space-y-4">
                {[
                  { n: '01', t: 'Preserve and share our heritage:', d: 'to bring authentic, high-quality traditional African meals to your table, fresh or frozen, in a way that is convenient and easy to enjoy.' },
                  { n: '02', t: 'Celebrate African cuisine:', d: 'to serve meals rich in culture, flavour and story.' },
                  { n: '03', t: 'Grow with our community:', d: 'to create jobs and build lasting partnerships with local suppliers.' },
                ].map((m) => (
                  <li key={m.n} className="flex gap-4">
                    <span aria-hidden="true" className="font-mono text-sm font-bold text-accent-on-ink">{m.n}</span>
                    <span>
                      <span className="block font-semibold">{m.t}</span>{' '}
                      <span className="block text-sm leading-relaxed text-bone/60">{m.d}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Values / why us */}
      <section id="about-values" className="mx-auto max-w-7xl px-4 py-20">
        <SectionLabel>Why people come back</SectionLabel>
        <h2 className="max-w-2xl font-display text-4xl font-semibold md:text-5xl">More than just a meal</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {[
            { t: 'Authentic flavours', d: 'Recipes that have not been softened for a mainstream palate.', img: '/img/plate-mogodu.jpg' },
            { t: 'Cooked to order', d: 'Two service days a week, cooked in small batches — never held over.', img: '/img/plate-tshotlo.jpg' },
            { t: 'Order your way', d: 'Order online for delivery in Sandton and Rosebank and beyond, or message us on WhatsApp.', img: '/img/plate-chicken.jpg' },
            { t: 'Real value', d: 'One honest price a plate — protein, starch and vegetable side, nothing padded on.', img: '/img/plate-lamb-stew.jpg' },
          ].map((v, i) => (
            <Reveal key={v.t} delay={i * 80}>
              <div className="h-full overflow-hidden rounded-3xl border-2 border-theme/10 bg-surface">
                <img src={asset(v.img)} alt="" className="h-36 w-full object-cover" loading="lazy" />
                <div className="p-5">
                  <h3 className="font-display text-xl font-semibold">{v.t}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-theme-soft">{v.d}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section id="about-timeline" className="border-t-2 border-theme/10 bg-surface-2 py-20">
        <div className="mx-auto max-w-4xl px-4">
          <SectionLabel>The road so far</SectionLabel>
          <ol className="mt-8 space-y-8 border-l-2 border-theme/15 pl-8">
            {[
              { y: 'Before 2025', t: 'Family kitchens', d: 'Recipes and cooking knowledge passed down through generations and shared around the table.' },
              { y: '2025', t: 'Heritage Bites begins', d: 'We started bringing those meals and the stories behind them together under one name.' },
              { y: 'Today', t: 'Two plate menus', d: 'Choose a traditional plate at R100 or a contemporary plate at R130, Thursdays and Fridays.' },
              {
                id: 'whats-next', y: 'Next', t: 'What’s Next',
                d: 'We’re looking for a place to call home, a stable location where you can always find us. From there, we’ll ' +
                  'introduce our frozen Tshotlo and Mogodu to homes across the country, while continuing to serve daily ' +
                  'traditional meals to everyone who needs a good plate of food, from the office to the worksite.',
              },
            ].map((e) => (
              <li key={e.t} id={e.id} className="relative scroll-mt-28">
                <span className="absolute -left-[41px] top-1.5 h-3 w-3 rounded-full border-2 border-theme bg-ochre" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">{e.y}</p>
                <h3 className="mt-1 font-display text-2xl font-semibold">{e.t}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-theme-soft">{e.d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 font-display text-2xl font-semibold">Come hungry. Leave feeling at home.</p>
        </div>
      </section>
    </>
  );
}
