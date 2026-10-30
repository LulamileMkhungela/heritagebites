import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCatalog } from '../store/catalog';
import { useCart } from '../store/cart';
import { zar } from '../lib/format';
import { Button, Reveal, SectionLabel, Spinner } from '../components/ui';
import { ItemModal, MealCard } from '../components/MealCard';
import type { ComingSoonItem, MenuItem, PlateMenu } from '../lib/types';
import { menuJsonLd } from '../../shared/seo.js';
import { currentSiteUrl, usePageSeo } from '../lib/seo';
import { asset } from '../lib/assets';

/*
 * Menu sorting.
 *
 * The chips that used to sit here ("Spicy", "R100 or less", "Available today")
 * are gone — the owner did not want the menu filtered down, and with two plate
 * tiers and eight plates a filter hides more than it helps. Price order stays,
 * because "what can I get for the least" is a fair question to ask of a menu,
 * and the ordered sections make the answer the actual first plate on the page.
 */
const SORTS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'quickest', label: 'Quickest first' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

function sortItems(items: MenuItem[], sort: SortId): MenuItem[] {
  const copy = [...items];
  switch (sort) {
    case 'price-asc':
      return copy.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    case 'price-desc':
      return copy.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
    case 'quickest':
      return copy.sort((a, b) => a.prepMins - b.prepMins || a.price - b.price);
    default:
      /* The kitchen's own order: the plates it sells most sit first. */
      return copy.sort((a, b) => (b.orders ?? 0) - (a.orders ?? 0));
  }
}

export default function MenuPage() {
  /*
   * The menu is the page most likely to be found from a search for a dish, so it
   * carries a schema.org Menu built from the same plates the customer sees —
   * prices included, coming-soon dishes excluded.
   */
  const catalog = useCatalog((s) => s.data);
  const loading = useCatalog((s) => s.loading);
  /*
   * The menu is the page most likely to be found from a search for a dish, so it
   * carries a schema.org Menu built from the same plates the customer sees —
   * prices included, coming-soon dishes excluded.
   */
  usePageSeo('/menu', { jsonLd: catalog ? menuJsonLd(currentSiteUrl(), catalog) : null });
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<MenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [sort, setSort] = useState<SortId>('recommended');
  const [q, setQ] = useState('');
  const [builder, setBuilder] = useState<PlateMenu | null>(null);
  /*
   * Category sections fold away. They all start open — nothing is hidden from a
   * customer who has just arrived — but on a phone the full menu is a long
   * scroll, so tapping a heading tucks that category up and brings the next one
   * into view. A chip in the sticky nav always expands the category it jumps to,
   * and a search or filter resets everything to open so no result stays hidden.
   */
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const toggleSection = (id: string) => setClosed((prev) => ({ ...prev, [id]: !prev[id] }));

  /*
   * Deep links from search (/menu?item=mogodu-plate) open that dish directly,
   * and /menu?builder=traditional opens that plate builder.
   *
   * Neither parameter is stripped when the overlay opens. Doing that made the
   * overlay a one-shot: any reload of the same URL — a browser refresh, or the
   * screenshot runner retrying a page for its fonts — landed on the plain menu
   * with the dish silently closed. Both stay derived from the URL, and closing
   * the overlay removes its parameter instead.
   */
  useEffect(() => {
    const id = params.get('item');
    if (!id || !catalog) return;
    const found = catalog.menu.find((m) => m.id === id);
    if (found) setModal(found);
  }, [params, catalog]);

  useEffect(() => {
    const id = params.get('builder');
    if (!id || !catalog) return;
    const plate = catalog.plateMenus.find((p) => p.id === id) ?? catalog.plateMenus[0];
    if (plate) setBuilder(plate);
  }, [params, catalog]);

  /** Closing an overlay also drops its deep-link parameter, so it stays closed. */
  const clearParam = (key: 'item' | 'builder') => {
    if (!params.get(key)) return;
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next, { replace: true });
  };

  const closeDish = () => {
    setModal(null);
    clearParam('item');
  };

  const closeBuilder = () => {
    setBuilder(null);
    clearParam('builder');
  };

  /*
   * One list drives both the sticky category chips and the sections below, so
   * the archive sits exactly where it used to: a chip next to Contemporary
   * Plates, jumping to its own section on click and lighting up on scroll.
   *
   * The difference is what is *inside* an archived section. Its cards are inert
   * (no price, no dish sheet, no basket); the chip itself is navigation only.
   */
  type Section =
    | { id: string; name: string; tagline: string; blurb: string; archived: false; items: MenuItem[] }
    | { id: string; name: string; tagline: string; blurb: string; archived: true; items: ComingSoonItem[] };

  const sections = useMemo<Section[]>(() => {
    if (!catalog) return [];
    const term = q.trim().toLowerCase();

    const live: Section[] = catalog.categories
      .map((category) => {
        let items = catalog.menu.filter((item) => item.category === category.id);
        if (term) {
          items = items.filter((item) =>
            `${item.name} ${item.localName} ${item.language} ${item.description}`.toLowerCase().includes(term),
          );
        }
        return {
          id: category.id,
          name: category.name,
          tagline: category.tagline,
          blurb: category.blurb,
          archived: false as const,
          items: sortItems(items, sort),
        };
      })
      .filter((section) => section.items.length > 0);

    /*
     * The menu is grouped by kitchen, so sorting inside a section alone would
     * put the cheapest traditional plate first and the R130 contemporary plates
     * still below it — "price: high to low" that does not start with the most
     * expensive plate is a broken promise. When a price sort is asked for, the
     * sections themselves are ordered by their cheapest (or dearest) plate, and
     * the items inside them are sorted too.
     */
    if (sort === 'price-asc') {
      live.sort((a, b) => Math.min(...a.items.map((i) => i.price)) - Math.min(...b.items.map((i) => i.price)));
    } else if (sort === 'price-desc') {
      live.sort((a, b) => Math.max(...b.items.map((i) => i.price)) - Math.max(...a.items.map((i) => i.price)));
    }

    /*
     * A search term reaches the archive too — someone typing "kota" should find
     * the card that says it is coming, not an empty page.
     */
    const archive: Section[] = (catalog.comingSoon ?? [])
      .map((category) => {
        let items = category.items;
        if (term) items = items.filter((item) => item.name.toLowerCase().includes(term));
        return { id: category.id, name: category.name, tagline: category.tagline, blurb: category.blurb, archived: true as const, items };
      })
      .filter((section) => section.items.length > 0);

    return [...live, ...archive];
  }, [catalog, sort, q]);

  const lastArchived = [...sections].reverse().find((section) => section.archived);

  useEffect(() => {
    if (sections.length && !sections.some((section) => section.id === activeCategory)) {
      setActiveCategory(sections[0].id);
    }
  }, [sections, activeCategory]);

  /* A search must never land inside a folded section. */
  useEffect(() => {
    setClosed({});
  }, [q]);

  /* Keep the category chip in step with the section passing through the viewport. */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = document.querySelectorAll<HTMLElement>('[data-menu-category]');
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.menuCategory;
            if (id) setActiveCategory(id);
          }
        }
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [sections]);

  if (loading || !catalog) return <Spinner label="Opening the menu…" />;

  /* Expanding a folded section changes the page height, so the scroll waits a
     frame for that layout to settle before measuring where the section is. */
  const scrollToCategory = (id: string) => {
    setActiveCategory(id);
    setClosed((prev) => (prev[id] ? { ...prev, [id]: false } : prev));
    window.setTimeout(() => {
      document.getElementById(`menu-category-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  return (
    <>
      <header className="hb-grain relative overflow-hidden bg-ink py-16 text-bone">
        <img src={asset('/img/plate-mogodu.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
        <div className="relative mx-auto max-w-7xl px-4">
          <SectionLabel onDark>Offering / Meals</SectionLabel>
          <h1 className="max-w-3xl font-display text-5xl font-semibold md:text-6xl">The full menu</h1>
          {/*
            Every price is read from the plate it belongs to. The old copy wrote
            "R100 a plate" and "R130 a plate" as facts about the whole kitchen,
            which stops being true as soon as one plate is priced differently.
          */}
          <p className="mt-4 max-w-2xl text-bone/70">
            Two plate menus, each at a fixed price. Choose a protein, a starch and a vegetable side, and delivery is
            included.
            {catalog.plateMenus.length > 0 && (
              <>
                {' '}
                {catalog.plateMenus.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 ? ' · ' : ''}
                    {p.name} {zar(p.price)}
                  </span>
                ))}
                .
              </>
            )}
          </p>
        </div>
      </header>

      {/* Build a plate — both fixed-price menus, side by side. */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-5 md:grid-cols-2">
          {catalog.plateMenus.map((plate) => (
            <Reveal key={plate.id}>
              {/*
                Photo + words + button in one row only from 24rem up. On a phone
                that row squeezed the name onto three lines and left the eyebrow
                broken in two, so the card stacks instead: picture, then the name
                and price on one line, then the description.
              */}
              <button
                type="button"
                onClick={() => setBuilder(plate)}
                className="group flex w-full items-center gap-4 overflow-hidden rounded-3xl border-2 border-ink/10 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-ink/30 max-sm:flex-wrap"
              >
                <img src={plate.image} alt="" className="h-24 w-24 shrink-0 rounded-2xl object-cover" loading="lazy" />
                <span className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ochre-deep">Build your plate</span>
                  <span className="mt-0.5 block font-display text-xl font-semibold">{plate.name}</span>
                  <span className="mt-1 block text-[13px] leading-snug text-ink/60">{plate.blurb}</span>
                </span>
                <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-lg font-bold text-ink">{zar(plate.price)}</span>
                  <span className="rounded-full border-2 border-ink/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide group-hover:border-ink group-hover:bg-ink group-hover:text-bone">
                    Build
                  </span>
                </span>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Category navigation stays visible and follows the section being read. */}
      <div className="sticky top-[var(--hb-header)] z-30 border-b-2 border-ink/10 bg-bone/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <nav className="no-scrollbar flex gap-2 overflow-x-auto" aria-label="Meal categories">
            {sections.map((section) => (
              <CatChip
                key={section.id}
                active={activeCategory === section.id}
                onClick={() => scrollToCategory(section.id)}
                label={section.name}
                count={section.items.length}
                soon={section.archived}
              />
            ))}
          </nav>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Sort sits on this line beside the search box: it is the only
                control left here now that the filter chips are gone. */}
            <label className="flex min-h-11 items-center gap-2 text-xs text-ink/55">
              <span className="sr-only">Sort meals</span>
              <span aria-hidden="true" className="hidden uppercase tracking-wide sm:inline">Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
                className="min-h-11 rounded-full border-2 border-ink/12 bg-white px-3 py-1.5 text-xs font-semibold text-ink outline-none focus:border-ochre"
                aria-label="Sort meals"
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search meals…"
              className="min-h-11 w-full max-w-xs rounded-full border-2 border-ink/12 px-4 py-2 text-sm outline-none focus:border-ochre sm:w-auto"
              aria-label="Search meals"
            />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-16 px-4 py-12" aria-live="polite">
        {sections.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-ink/20 p-12 text-center">
            <p className="font-display text-2xl">No meals match that search</p>
            <p className="mt-2 text-sm text-ink/55">Try a different word.</p>
            <Button className="mt-5" variant="outline" onClick={() => setQ('')}>Show all meals</Button>
          </div>
        ) : sections.map((section) => {
          const open = !closed[section.id];
          const count = section.items.length;
          const countLabel = section.archived
            ? count === 1 ? 'dish' : 'dishes'
            : count === 1 ? 'plate' : 'plates';
          return (
          <section
            key={section.id}
            id={`menu-category-${section.id}`}
            data-menu-category={section.id}
            {...(section.archived ? {} : { 'data-sellable': '' })}
            className="scroll-mt-40"
            aria-labelledby={`menu-heading-${section.id}`}
          >
            {/*
              The plate count sits on the same line as the category name — on a
              phone it used to wrap onto its own line at the right, which read
              like a separate statistic. The whole row is the fold control, so
              tapping the category name tucks it away.
            */}
            <div className="mb-5">
              {section.tagline && <SectionLabel>{section.tagline}</SectionLabel>}
              <h2 id={`menu-heading-${section.id}`} className="font-display text-2xl font-semibold sm:text-3xl md:text-4xl">
                {/*
                  Name and count sit in one inline flow, so the count belongs to
                  the category's line and can only wrap together with the words
                  around it. As two flex items it was pushed to the far right and
                  on a phone dropped onto a line of its own, away from the name.
                */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={open}
                  aria-controls={`menu-panel-${section.id}`}
                  className="relative flex min-h-11 w-full items-center pr-9 text-left"
                >
                  <span className="min-w-0">
                    {section.name}{' '}
                    <span className="whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-wider text-ink/45 tabular-nums">
                      {count} {countLabel}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 24 24"
                    className={`absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 text-ink/40 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-ink/60">{section.blurb}</p>
              {section.archived && (
                <p className="mt-1 text-[12px] text-ink/50">
                  Not on sale yet, so nothing here can be added to a basket.
                </p>
              )}
            </div>

            <div id={`menu-panel-${section.id}`} hidden={!open}>
              {section.archived ? (
                /* The archive cards read like any other dish card but hold no
                   controls at all: no link, no button, no basket. The "Coming
                   soon" tag on the photo is the only thing that marks them, and
                   the quest link below sits outside this wrapper. */
                <ul data-coming-soon className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <UpcomingCard item={item} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {section.items.map((item, index) => (
                    <Reveal key={item.id} delay={Math.min(index, 5) * 50}>
                      <MealCard item={item} onOpen={() => setModal(item)} />
                    </Reveal>
                  ))}
                </div>
              )}

              {/*
                One route forward that is not a dish: the customer quest, shown
                once after the last archive section. It sits outside the
                `data-coming-soon` card grid because that must hold no links at
                all.
              */}
              {section.id === lastArchived?.id && (
                <p className="mt-6 text-[13px] text-ink/70">
                  Want one of these back on the menu?{' '}
                  <Link to="/quest" className="font-semibold text-ochre-deep underline">Send a customer quest</Link>{' '}
                  and we will come back to you on whether and when we can cook it.
                </p>
              )}
            </div>
          </section>
          );
        })}
        {/*
          The menu is where a customer decides; the two pages that answer "when",
          "where" and "how much" are one tap away, in words rather than only in
          the footer. Both links carry real information, so this is a route to an
          answer, not a keyword.
        */}
        <section className="mx-auto mt-14 max-w-7xl px-4 pb-4">
          <div className="rounded-3xl border-2 border-ink/10 bg-white p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <p className="max-w-2xl text-sm leading-relaxed text-ink/70">
              Every plate is cooked on a Thursday or a Friday between{' '}
              {catalog?.settings?.serviceWindow.open ?? '12:00'} and{' '}
              {catalog?.settings?.serviceWindow.close ?? '13:30'}, with delivery included in{' '}
              {(catalog?.settings?.deliveryAreas ?? ['Rosebank', 'Sandton']).join(' and ')}.{' '}
              <Link to="/specials" className="font-semibold text-ochre-deep underline">
                How delivery and collection work
              </Link>
              .
            </p>
            <p className="mt-3 shrink-0 text-sm text-ink/70 sm:mt-0">
              Questions before you order?{' '}
              <Link to="/contact" className="font-semibold text-ochre-deep underline">
                Talk to us
              </Link>
            </p>
          </div>
        </section>
      </main>

      {modal && <ItemModal item={modal} onClose={closeDish} />}
      {builder && <PlateBuilder plate={builder} onClose={closeBuilder} />}
    </>
  );
}

/**
 * A category chip. The dashed outline is the only thing that separates an
 * archive category from a sellable one here — the words "coming soon" belong to
 * the dish photo, and nowhere else (owner's request: the tag on the card is
 * enough, a "soon" in the nav and a badge beside the heading made the page
 * shout).
 */
function CatChip({ active, onClick, label, count, soon }: { active: boolean; onClick: () => void; label: string; count: number; soon?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${active ? 'bg-ink text-bone' : 'bg-white text-ink/70 hover:bg-white'} ${soon && !active ? 'border border-dashed border-ink/25' : ''}`}
    >
      {label}
      <span className={`font-mono text-xs tabular-nums ${active ? 'text-ochre' : 'text-ink/40'}`}>{count}</span>
    </button>
  );
}

/* -------------------------- Coming-soon card --------------------------- */

/**
 * A card from the kitchen archive. It carries the same information a sellable
 * plate does — photo, name, price and a description — because the owner asked
 * for the archive to read like the rest of the menu. What it deliberately does
 * not have is any control: the photo is not a link, there is no dish sheet and
 * no basket button, so the only way to order one is for the kitchen to put it
 * back on sale.
 */
function UpcomingCard({ item }: { item: ComingSoonItem }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/5">
        <img
          /* Catalogue images already carry the site base (see store/catalog.ts);
             prefixing again doubles it on Pages. */
          src={item.image}
          alt={item.name}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
        <span className="absolute left-3 top-3 rounded-full bg-ink/85 px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-bone">
          Coming soon
        </span>
        <span className="absolute bottom-3 left-3 font-mono text-lg font-bold text-bone">{zar(item.price)}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-lg font-semibold leading-tight">{item.name}</h3>
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink/60">{item.description}</p>
        <p className="mt-auto pt-3 font-mono text-[11px] uppercase tracking-wider text-ink/40">Not on sale yet</p>
      </div>
    </article>
  );
}

/* ---------------------------- Plate builder ---------------------------- */

/**
 * One fixed-price plate menu: pick a protein, a starch and a vegetable side.
 * Every component is included in the plate price, which is why the options
 * carry no price delta and the total never moves while choosing.
 */
function PlateBuilder({ plate, onClose }: { plate: PlateMenu; onClose: () => void }) {
  const addPlate = useCart((s) => s.addPlate);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);

  const toggle = (groupId: string, itemId: string) =>
    setPicked((prev) => ({ ...prev, [groupId]: prev[groupId] === itemId ? '' : itemId }));

  const missing = plate.groups.filter((g) => g.required && !picked[g.id]);
  const missingLabel = missing[0]?.label.replace(/^choose your\s+/i, '') ?? '';
  const total = plate.price;

  const submit = () => {
    if (missing.length) return;
    const picks = plate.groups.flatMap((g) => {
      const id = picked[g.id];
      if (!id) return [];
      const it = g.items.find((i) => i.id === id);
      if (!it) return [];
      return [{ optionId: g.id, choiceId: `${g.id}:${id}`, label: it.label, priceDelta: 0 }];
    });
    addPlate({
      key: `plate::${plate.id}::${picks.map((p) => p.choiceId).sort().join('|')}`,
      itemId: `plate-${plate.id}`,
      plateId: plate.id,
      name: plate.name,
      image: plate.image,
      unitPrice: total,
      qty,
      picks,
      kind: 'plate',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={plate.name}>
      <button type="button" className="absolute inset-0 bg-ink/70 backdrop-blur-sm" onClick={onClose} aria-label="Close builder" />
      <div className="animate-rise relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-bone shadow-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4 bg-ink p-6 text-bone">
          <div>
            <SectionLabel onDark>{zar(plate.price)} a plate · delivery included</SectionLabel>
            <h2 className="font-display text-3xl font-semibold">{plate.name}</h2>
            <p className="mt-2 max-w-xl text-sm text-bone/65">{plate.blurb}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-bone/25 hover:bg-bone hover:text-ink" aria-label="Close builder">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-5">
            {plate.groups.map((g) => (
              <fieldset key={g.id}>
                <legend className="mb-2 text-sm font-semibold">
                  {g.label} {g.required ? <span className="text-ochre-deep">*</span> : null}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.items.map((it) => {
                    const on = picked[g.id] === it.id;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => toggle(g.id, it.id)}
                        aria-pressed={on}
                        className={`flex items-center justify-between rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${on ? 'border-ochre bg-ochre/15 font-semibold' : 'border-ink/12 hover:border-ink/30'}`}
                      >
                        <span>{it.label}</span>
                        <span className="font-mono text-xs text-ink/40">Included</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink/10 bg-bone p-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-ink/45">Plate price, delivery included</p>
            <p className="font-display text-3xl font-bold">{zar(total)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-full border-2 border-ink/12">
              <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink hover:text-bone" aria-label="Fewer plates">−</button>
              <span className="w-8 text-center font-mono text-sm font-semibold">{qty}</span>
              <button type="button" onClick={() => setQty((n) => Math.min(10, n + 1))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink hover:text-bone" aria-label="More plates">+</button>
            </div>
            <Button size="lg" onClick={submit} disabled={missing.length > 0}>
              {missing.length ? `Pick a ${missingLabel}` : `Add plate · ${zar(total * qty)}`}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
