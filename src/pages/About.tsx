import { useCatalog } from '../store/catalog';
import { HeritageBand, LinkButton, Reveal, SectionLabel } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { asset } from '../lib/assets';

export default function About() {
  useDocumentTitle('About Us | Our Story, Vision & Mission');
  const catalog = useCatalog((s) => s.data);
  const s = catalog?.settings;

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-20 text-bone">
        <img src={asset('/img/hero-feast.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/40" />
        <div className="relative mx-auto max-w-4xl px-4">
          <SectionLabel onDark>Our story</SectionLabel>
          <h1 className="font-display text-5xl font-semibold leading-tight md:text-7xl">Every bite tells a story</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-bone/75">
            Heritage Bites shares South African meals and the stories behind them. We bring familiar, much-loved dishes into an easy-to-browse menu and make ordering simple.
          </p>
        </div>
      </header>

      {/* How we started */}
      <section id="story" className="mx-auto max-w-7xl scroll-mt-28 px-4 py-20">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <Reveal>
            <SectionLabel>How we started</SectionLabel>
            <h2 className="font-display text-4xl font-semibold md:text-5xl">It began in a family kitchen, not a boardroom</h2>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-ink/70">
              <p>
                Heritage Bites was officially established in {s?.established ?? 2025}, but the cooking started long before that. It started in family kitchens where the pot went on early, where mogodu was judged by how long it had been given, and where feeding people properly was not a service — it was the whole point.
              </p>
              <p>
                We saw how easily meaningful meals and the stories behind them can be lost in a fast-moving food world. We wanted to make these dishes easier to discover and order, while keeping their names, memories and traditions in view.
              </p>
              <p>
                Heritage Bites began with a clear menu, recipes shared through generations, and a belief that every dish deserves its own story. We’re building a simple way to explore the food, choose a meal and keep your order details close at hand.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton to="/menu">Browse our meals</LinkButton>
              <LinkButton to="/contact" variant="outline">Contact us</LinkButton>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="relative">
              <img src={asset('/img/tshotlo.jpg')} alt="Tshotlo, slow-cooked pounded beef" className="aspect-[4/5] w-full rounded-[2rem] border-2 border-ink object-cover" />
              <div className="absolute -bottom-6 -left-6 hidden rounded-3xl border-2 border-ink bg-ochre p-5 md:block">
                <p className="font-mono text-xs uppercase tracking-[0.2em]">Established</p>
                <p className="font-display text-5xl font-bold">{s?.established ?? 2025}</p>
                <p className="mt-1 text-xs text-ink/60">Our beginning</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <HeritageBand className="h-2 w-full" />

      {/* Vision + Mission */}
      <section className="border-b-2 border-ink/10 bg-ink py-20 text-bone">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 md:grid-cols-2">
          <Reveal>
            <div id="vision" className="scroll-mt-28">
              <SectionLabel onDark>Vision</SectionLabel>
              <h2 className="font-display text-4xl font-semibold md:text-5xl">South African food, taken seriously</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-bone/70">
                We want South African food to be celebrated, understood and easy to enjoy — without losing the care, skill and memories that make each dish special.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-bone/70">
                Our long-term vision is to share regional dishes from across South Africa and keep the food stories behind them alive for the next generation.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-bone/70">
                Today we operate as a shadow kitchen, cooking on Thursdays and Fridays between 12:00 and 13:30, with delivery
                in Rosebank and Sandton.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div id="mission" className="scroll-mt-28">
              <SectionLabel onDark>Mission</SectionLabel>
              <h2 className="font-display text-4xl font-semibold md:text-5xl">Four things we hold to, daily</h2>
              <ul className="mt-5 space-y-4">
                {[
                  { n: '01', t: 'Cook it properly', d: 'Nothing is rushed. Tripe gets four hours. If a dish cannot be made well today, it comes off the counter rather than going out half-done.' },
                  { n: '02', t: 'Share the story', d: 'We honour each dish by sharing its name, language and the story carried with it.' },
                  { n: '03', t: 'Keep it accessible', d: 'Generous portions at prices that work for students, shift workers and families — not just for weekends.' },
                  { n: '04', t: 'Make ordering painless', d: 'Explore the menu, place your order online, and contact us directly to confirm collection or delivery details.' },
                ].map((m) => (
                  <li key={m.n} className="flex gap-4">
                    <span className="font-mono text-sm font-bold text-ochre">{m.n}</span>
                    <span>
                      <span className="block font-semibold">{m.t}</span>
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
      <section className="mx-auto max-w-7xl px-4 py-20">
        <SectionLabel>Why people come back</SectionLabel>
        <h2 className="max-w-2xl font-display text-4xl font-semibold md:text-5xl">More than just a meal</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {[
            { t: 'Authentic flavours', d: 'Recipes that have not been softened for a mainstream palate.', img: '/img/plate-mogodu.jpg' },
            { t: 'Cooked to order', d: 'Two service days a week, cooked in small batches — never held over.', img: '/img/plate-tshotlo.jpg' },
            { t: 'Order your way', d: 'Order online, choose collection or delivery in Rosebank and Sandton, or message us on WhatsApp.', img: '/img/plate-chicken.jpg' },
            { t: 'Real value', d: 'One price a plate — starch, vegetable side and delivery included.', img: '/img/plate-lamb-stew.jpg' },
          ].map((v, i) => (
            <Reveal key={v.t} delay={i * 80}>
              <div className="h-full overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
                <img src={asset(v.img)} alt="" className="h-36 w-full object-cover" loading="lazy" />
                <div className="p-5">
                  <h3 className="font-display text-xl font-semibold">{v.t}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{v.d}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Timeline */}
      <section className="border-t-2 border-ink/10 bg-bone-2 py-20">
        <div className="mx-auto max-w-4xl px-4">
          <SectionLabel>The road so far</SectionLabel>
          <ol className="mt-8 space-y-8 border-l-2 border-ink/15 pl-8">
            {[
              { y: 'Before 2025', t: 'Family kitchens', d: 'Recipes and cooking knowledge passed down through generations and shared around the table.' },
              { y: '2025', t: 'Heritage Bites begins', d: 'We started bringing those meals and the stories behind them together under one name.' },
              { y: 'Today', t: 'Two plate menus', d: 'Choose a traditional plate at R100 or a contemporary plate at R130, Thursdays and Fridays.' },
              { y: 'Next', t: 'More stories to share', d: 'We’ll keep adding dishes and making it easier to enjoy food from across our heritage.' },
            ].map((e) => (
              <li key={e.t} className="relative">
                <span className="absolute -left-[41px] top-1.5 h-3 w-3 rounded-full border-2 border-ink bg-ochre" />
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">{e.y}</p>
                <h3 className="mt-1 font-display text-2xl font-semibold">{e.t}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink/65">{e.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
