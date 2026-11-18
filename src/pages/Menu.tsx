import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCatalog } from '../store/catalog';
import { useCart } from '../store/cart';
import { zar } from '../lib/format';
import { FALLBACK_WHATSAPP } from '../lib/whatsapp';
import { Button, LoadError, Reveal, SectionLabel, Spinner } from '../components/ui';
import { ItemModal, MealCard } from '../components/MealCard';
import type { ComingSoonItem, MenuItem, PlateGroup, PlateMenu } from '../lib/types';
import { menuJsonLd } from '../../shared/seo.js';
import { DELIVERY_ZONES } from '../../shared/address.js';
import { extraCost, maxPerExtra, maxPortions, portionCost } from '../../shared/service.js';
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
  /*
   * "Quickest first" sorted on a per-plate prep time the page no longer shows —
   * the number behind it read "20′" on a card, which the owner called out as
   * confusing, and the kitchen cooks in batches on two days a week, so a
   * per-plate minute count was never a real answer about when food arrives.
   * A sort option with no visible number behind it would be a control that
   * silently reorders the menu for no reason the customer can see.
   */
] as const;

type SortId = (typeof SORTS)[number]['id'];

function sortItems(items: MenuItem[], sort: SortId): MenuItem[] {
  const copy = [...items];
  switch (sort) {
    case 'price-asc':
      return copy.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
    case 'price-desc':
      return copy.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
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
  const error = useCatalog((s) => s.error);
  const load = useCatalog((s) => s.load);
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
  /*
   * List or grid.
   *
   * Owner, 17 Nov 2026: "the meals listview must have a listview and gridview …
   * next to sort to have the view which is listview/gridview". Grid is the
   * default because it is what the page has always been; list is the mode for
   * somebody comparing prices, where four cards across a desk phone is one word
   * of description each and no way to read two dishes against each other.
   *
   * Remembered in localStorage so a customer who prefers list gets list next
   * time. Keyed to the browser, not the account — there is no account.
   */
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return window.localStorage.getItem('hb.menuView') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const chooseView = (next: 'grid' | 'list') => {
    setView(next);
    try {
      window.localStorage.setItem('hb.menuView', next);
    } catch {
      /* Private mode can refuse storage; the choice still holds for this visit. */
    }
  };
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

    /*
     * Which list a category's dishes come from.
     *
     * Sides are their own products (see `sides` in the seed) rather than cards
     * inside `menu`, so a category id has to say where to look. Everything else
     * is a plate.
     */
    const poolFor = (categoryId: string) =>
      (categoryId === 'sides' ? catalog.sides ?? [] : catalog.menu);

    const live: Section[] = catalog.categories
      .map((category) => {
        let items = poolFor(category.id).filter((item) => item.category === category.id);
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

  /*
   * The failure branch comes first, and it is not a spinner: a request that has
   * already failed will not finish on its own, so the only honest thing on
   * screen is what went wrong and a way to try again.
   */
  if (error && !catalog) return <LoadError what="the menu" message={error} onRetry={() => void load({ force: true })} whatsapp={FALLBACK_WHATSAPP} />;
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
            Two plate menus, each at a fixed price. Choose a protein, then as many starches and vegetable sides as you
            like, and delivery is included.
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
                className="group flex w-full items-center gap-4 overflow-hidden rounded-3xl border-2 border-theme/10 bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-theme/30 max-sm:flex-wrap"
              >
                <img src={plate.image} alt="" className="h-24 w-24 shrink-0 rounded-2xl object-cover" loading="lazy" />
                <span className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Build your plate</span>
                  <span className="mt-0.5 block font-display text-xl font-semibold">{plate.name}</span>
                  <span className="mt-1 block text-[13px] leading-snug text-theme-soft">{plate.blurb}</span>
                </span>
                <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-lg font-bold text-theme">{zar(plate.price)}</span>
                  <span className="rounded-full border-2 border-theme/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide group-hover:border-theme group-hover:bg-ink group-hover:text-bone">
                    Build
                  </span>
                </span>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Category navigation stays visible and follows the section being read. */}
      <div className="sticky top-[var(--hb-header)] z-30 border-b-2 border-theme/10 bg-canvas/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3">
          {/*
            One line, and the order on it is the owner's (17 Nov 2026): "the sort
            must be far to the right whilst inline with food categories and next
            to sort to have the view which is listview/gridview".

            So the categories scroll on the left, and the two view controls are
            pinned to the right end of the same row. They were on a second row
            under the chips, which on a phone put the only two controls on the
            page below the fold of the sticky bar.

            On a phone the controls stay in the row and the chips keep their own
            horizontal scroll, so neither pushes the other off screen.
          */}
          <div className="flex items-center gap-3">
            <nav className="no-scrollbar -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1" aria-label="Meal categories">
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
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <label className="flex min-h-11 items-center gap-2 text-xs text-theme-soft">
                <span className="sr-only">Sort meals</span>
                <span aria-hidden="true" className="hidden uppercase tracking-wide lg:inline">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortId)}
                  className="min-h-11 max-w-[9.5rem] rounded-full border-2 border-theme/12 bg-surface px-3 py-1.5 text-xs font-semibold text-theme outline-none focus:border-ochre"
                  aria-label="Sort meals"
                >
                  {SORTS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <ViewToggle value={view} onChange={chooseView} />
            </div>
          </div>
          <div className="mt-2">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search meals…"
              className="min-h-11 w-full max-w-xs rounded-full border-2 border-theme/12 px-4 py-2 text-sm outline-none focus:border-ochre"
              aria-label="Search meals"
            />
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-16 px-4 py-12" aria-live="polite">
        {sections.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-theme/20 p-12 text-center">
            <p className="font-display text-2xl">No meals match that search</p>
            <p className="mt-2 text-sm text-theme-soft">Try a different word.</p>
            <Button className="mt-5" variant="outline" onClick={() => setQ('')}>Show all meals</Button>
          </div>
        ) : sections.map((section) => {
          const open = !closed[section.id];
          const count = section.items.length;
          /*
           * The word follows the section. A bowl of salsa is not a plate, and
           * "Sides & Relishes · 10 plates" would be the page miscounting itself.
           */
          const countLabel = section.archived
            ? count === 1 ? 'dish' : 'dishes'
            : section.id === 'sides'
              ? count === 1 ? 'side' : 'sides'
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
                    <span className="whitespace-nowrap font-mono text-[11px] font-semibold uppercase tracking-wider text-theme-muted tabular-nums">
                      {count} {countLabel}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 24 24"
                    className={`absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 text-theme-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
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
              <p className="mt-2 max-w-2xl text-sm text-theme-soft">{section.blurb}</p>
              {section.archived && (
                <p className="mt-1 text-[12px] text-theme-soft">
                  Not on sale yet, so nothing here can be added to a basket.
                </p>
              )}
            </div>

            <div id={`menu-panel-${section.id}`} hidden={!open}>
              {section.archived ? (
                /* The archive cards read like any other dish card but hold no
                   controls at all: no link, no button, no basket. The "Coming
                   soon" tag on the photo is the only thing that marks them, and
                   the quest link below sits outside this wrapper.
                   Like the selling sections, these follow the list/grid choice:
                   it used to be a hardcoded grid, so the Kasi Fast Food and
                   Morning Heritage sections stayed four-up while every other
                   section obeyed the toggle. */
                <ul
                  data-coming-soon
                  data-view={view}
                  className={
                    view === 'grid'
                      ? 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                      : 'grid gap-4'
                  }
                >
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <UpcomingCard item={item} layout={view} />
                    </li>
                  ))}
                </ul>
              ) : (
                /*
                 * One list, two shapes. `view` is the customer's choice and the
                 * same card component renders either way, so a dish can never
                 * show one price in the grid and another in the list.
                 */
                <div
                  data-view={view}
                  className={
                    view === 'grid'
                      ? 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                      : 'grid gap-4'
                  }
                >
                  {section.items.map((item, index) => (
                    <Reveal key={item.id} delay={Math.min(index, 5) * 50}>
                      <MealCard item={item} onOpen={() => setModal(item)} layout={view} />
                    </Reveal>
                  ))}
                </div>
              )}

              {/*
                One route forward that is not a dish: the customer request, shown
                once after the last archive section. It sits outside the
                `data-coming-soon` card grid because that must hold no links at
                all.
              */}
              {section.id === lastArchived?.id && (
                <p className="mt-6 text-[13px] text-theme-soft">
                  Want one of these back on the menu?{' '}
                  <Link to="/quest" className="font-semibold text-accent underline">Send a customer request</Link>{' '}
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
          <div className="rounded-3xl border-2 border-theme/10 bg-surface p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <p className="max-w-2xl text-sm leading-relaxed text-theme-soft">
              Every plate is cooked on a Thursday or a Friday, and any cooking day ahead can be booked. Delivery is
              included in {(catalog?.settings?.deliveryAreas ?? ['Rosebank', 'Sandton']).join(' and ')} and up to{' '}
              {catalog?.settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm} km from the kitchen.{' '}
              {/*
                "and collection" was wrong: collection was removed on 14 Nov
                2026 and the specials page it links to now says so outright
                ("We are a delivery-only kitchen"). Owner, 18 Nov 2026: "no
                collection" — a link promising a policy the next page denies is
                worse than no link.
              */}
              <Link to="/specials" className="font-semibold text-accent underline">
                How delivery works
              </Link>
              .
            </p>
            <p className="mt-3 shrink-0 text-sm text-theme-soft sm:mt-0">
              Questions before you order?{' '}
              <Link to="/contact" className="font-semibold text-accent underline">
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
 * Grid or list.
 *
 * Two icon buttons in a pill, not a select: there are two states, both are
 * always visible, and the pressed one is filled — so what the page is currently
 * doing is legible without opening anything. `aria-pressed` carries the state for
 * a screen reader, and each button names the view it switches *to*, which is what
 * a customer is choosing.
 *
 * Owner, 17 Nov 2026: "next to sort to have the view which is listview/gridview".
 */
function ViewToggle({ value, onChange }: { value: 'grid' | 'list'; onChange: (next: 'grid' | 'list') => void }) {
  const icon = (kind: 'grid' | 'list') =>
    kind === 'grid' ? (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      </svg>
    ) : (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <rect x="3" y="4" width="4.5" height="4.5" rx="1" />
        <rect x="9.5" y="4" width="11.5" height="4.5" rx="1" />
        <rect x="3" y="11" width="4.5" height="4.5" rx="1" />
        <rect x="9.5" y="11" width="11.5" height="4.5" rx="1" />
        <rect x="3" y="18" width="4.5" height="3" rx="1" />
        <rect x="9.5" y="18" width="11.5" height="3" rx="1" />
      </svg>
    );

  return (
    <div className="inline-flex items-center rounded-full border-2 border-theme/12 bg-surface p-0.5" role="group" aria-label="View meals as">
      {(['grid', 'list'] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onChange(kind)}
          aria-pressed={value === kind}
          aria-label={kind === 'grid' ? 'Show meals as a grid' : 'Show meals as a list'}
          /* 44px, not 40: this is a thumb control on a phone, and the mobile
             audit treats anything under 44 as a miss. */
          className={`grid h-11 w-11 place-items-center rounded-full transition-colors ${value === kind ? 'bg-ink text-bone' : 'text-theme-soft hover:text-theme'}`}
        >
          {icon(kind)}
        </button>
      ))}
    </div>
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
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${active ? 'bg-ink text-bone' : 'bg-surface text-theme-soft hover:bg-surface'} ${soon && !active ? 'border border-dashed border-theme/25' : ''}`}
    >
      {label}
      <span className={`font-mono text-xs tabular-nums ${active ? 'text-accent' : 'text-theme-muted'}`}>{count}</span>
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
/*
 * An unreleased dish. It has to follow the same list/grid switch as the selling
 * cards — a section that ignored the toggle looked broken next to the ones that
 * obeyed it — so it takes the same `layout` prop and swaps to a row shape in
 * list view: photo on the left at a fixed width, words beside it.
 */
function UpcomingCard({ item, layout = 'grid' }: { item: ComingSoonItem; layout?: 'grid' | 'list' }) {
  const list = layout === 'list';
  return (
    <article
      data-layout={layout}
      className={`flex h-full overflow-hidden rounded-3xl border-2 border-theme/10 bg-surface ${
        list ? 'flex-row items-stretch' : 'flex-col'
      }`}
    >
      <div
        className={`relative shrink-0 overflow-hidden bg-ink/5 ${
          list ? 'w-32 self-stretch sm:w-44' : 'aspect-[4/3] w-full'
        }`}
      >
        <img
          /* Catalogue images already carry the site base (see store/catalog.ts);
             prefixing again doubles it on Pages. */
          src={item.image}
          alt={item.name}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent" />
        <span className="absolute left-3 top-3 rounded-full bg-[#001938] px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[#f8f4ec]">
          Coming soon
        </span>
        {/*
          Only when there is a price. A vegetable side has none of its own — it
          is included *inside* the plate — and "R0,00" would be a price, wrongly
          stated. The line under the description says where it comes from
          instead, as a short uppercase label so it reads at a glance.
        */}
        {item.price > 0 && (
          <span className="absolute bottom-3 left-3 rounded-md bg-[#001938]/90 px-1.5 font-mono text-lg font-bold text-[#f8f4ec]">{zar(item.price)}</span>
        )}
      </div>
      <div className={`flex flex-1 flex-col ${list ? 'justify-center p-4' : 'p-4'}`}>
        <h3 className="font-display text-lg font-semibold leading-tight">{item.name}</h3>
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-theme-soft">{item.description}</p>
        <p className="mt-auto pt-3 font-mono text-[11px] uppercase tracking-wider text-theme-muted">
          {item.price > 0 ? 'Not on sale yet' : 'Included in a plate'}
        </p>
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
  /*
   * `picked` holds a *list* per group, not one id.
   *
   * Owner, 15 Nov 2026: "choose starch, vegetables must be multi select where
   * user can select more than 1 item". A plate with pap and dumpling is an
   * ordinary plate here, so a group has to be able to hold two answers — and the
   * single-value map could not, whatever the visible control looked like.
   */
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  /*
   * How many portions of a choice, keyed by "groupId:itemId".
   *
   * Kept apart from `picked` because `picked` is a map of *which* choice fills a
   * slot, and a slot holds one. The portion count is a second question — how
   * many of the thing in the slot — and mixing the two would mean a protein
   * could claim a count it has no business having.
   *
   * Two different things end up in here: the soft drink (a `priced` extra,
   * charged from the first bottle) and the starch and vegetable sides (which
   * include their first portion and charge only the portions after it). The
   * arithmetic differs, so which rule applies is a property of the choice, not
   * of this map.
   */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [qty, setQty] = useState(1);

  /**
   * Tap an item: add it if it is not there, remove it if it is.
   *
   * The difference between a group that holds several and one that holds a
   * single answer is the group's own `max`:
   *
   *   - `max > 1` (starch, vegetable side) — ticking a second adds it. Tapping a
   *     ticked one removes it, unless it is the last one in a required group,
   *     where removing it would leave the plate incomplete.
   *   - `max === 1` (protein, the drink) — a new choice REPLACES the old one,
   *     and tapping the chosen one clears it, which is how an optional single is
   *     declined.
   */
  const toggle = (group: PlateGroup, itemId: string) =>
    setPicked((prev) => {
      const current = prev[group.id] ?? [];
      const on = current.includes(itemId);
      const several = Number(group.max) > 1;

      if (!several) {
        if (on) return { ...prev, [group.id]: group.required ? current : [] };
        return { ...prev, [group.id]: [itemId] };
      }

      if (on) {
        /* Never leave a required group empty by unticking its last item. */
        if (group.required && current.length === 1) return prev;
        return { ...prev, [group.id]: current.filter((id) => id !== itemId) };
      }
      if (current.length >= Number(group.max)) return prev;
      return { ...prev, [group.id]: [...current, itemId] };
    });

  /*
   * What one extra portion of anything in this group costs.
   *
   * Read off the choices rather than a constant, so the label above the group
   * and the amount the till charges can never drift apart. Zero means the group
   * has no extra-portion rule and every choice in it is simply included.
   */
  const extraPortionPrice = (g: PlateGroup) => {
    const priced = g.items.map((i) => Number((i as { extraPrice?: number }).extraPrice) || 0);
    return Math.max(0, ...priced);
  };

  const missing = plate.groups.filter((g) => g.required && (picked[g.id]?.length ?? 0) === 0);
  const missingLabel = missing[0]?.label.replace(/^choose your\s+/i, '') ?? '';

  /*
   * What the plate costs, and what has been added to it.
   *
   * Two rules, priced per choice so a group can no longer be described by a
   * single flag:
   *
   *   - a `priced` extra — the soft drink — is sold *alongside* the plate, so
   *     every bottle is charged at its own price;
   *   - a starch or a vegetable side includes its first portion in the plate
   *     price, and only the portions past the first are charged. Owner,
   *     19 Nov 2026: "when they add more than 1 pap or any the price goes up."
   *     Two pap is one extra portion; three pap is two.
   *
   * `portionCost` returns 0 for a choice with no extra-portion rule, so a
   * protein contributes nothing here whatever its count.
   */
  const extras = plate.groups.reduce((sum, g) => {
    return sum + (picked[g.id] ?? []).reduce((groupSum, id) => {
      const it = g.items.find((i) => i.id === id);
      if (!it) return groupSum;
      /* The clamp is the catalogue's, so the buttons cannot add a portion the
         server would refuse. */
      const cap = g.priced ? maxPerExtra(g, it) : maxPortions(it);
      const count = Math.min(cap, Math.max(1, counts[`${g.id}:${it.id}`] ?? 1));
      return groupSum + (g.priced ? extraCost(Number(it.price) || 0, count) : portionCost(it, count));
    }, 0);
  }, 0);
  const total = Math.round((plate.price + extras) * 100) / 100;

  const submit = () => {
    if (missing.length) return;
    const picks = plate.groups.flatMap((g) => {
      /*
       * Every ticked item in the group. A multi-select group contributes two or
       * three picks and the kitchen is told all of them — "Pap · Dumpling ·
       * Chakalaka" — rather than one being silently dropped by the basket.
       */
      return (picked[g.id] ?? []).flatMap((id) => {
        const it = g.items.find((i) => i.id === id);
        if (!it) return [];
        /*
         * A choice that adds money carries its amount, so the cart line
         * explains the difference between the plate price and what is being
         * charged. The same rule as the running total above — two pap shows
         * `2 × Pap` against R30, so the customer can see what the second bowl
         * cost without doing the subtraction themselves.
         */
        const cap = g.priced ? maxPerExtra(g, it) : maxPortions(it);
        const count = Math.min(cap, Math.max(1, counts[`${g.id}:${it.id}`] ?? 1));
        return [{
          optionId: g.id,
          choiceId: `${g.id}:${id}`,
          label: it.label,
          priceDelta: g.priced ? extraCost(Number(it.price) || 0, count) : portionCost(it, count),
          ...(count > 1 ? { qty: count } : {}),
        }];
      });
    });
    addPlate({
      /* The count is part of the identity: one plate with one beer and one plate
         with three are different orders at different prices. */
      key: `plate::${plate.id}::${picks.map((p) => `${p.choiceId}${p.qty && p.qty > 1 ? `x${p.qty}` : ''}`).sort().join('|')}`,
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
      <div className="animate-rise relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-canvas shadow-2xl sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4 bg-ink p-6 text-bone">
          <div>
            <SectionLabel onDark>{zar(plate.price)} a plate · delivered</SectionLabel>
            <h2 className="font-display text-3xl font-semibold">{plate.name}</h2>
            <p className="mt-2 max-w-xl text-sm text-bone/65">{plate.blurb}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-bone/25 hover:bg-canvas hover:text-theme" aria-label="Close builder">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-5">
            {plate.groups.map((g) => (
              <fieldset key={g.id}>
                <legend className="mb-2 text-sm font-semibold">
                  {g.label} {g.required ? <span className="text-accent">*</span> : null}
                  {/*
                    Say that more than one is allowed. The rule has always been
                    there — `max` is 3 for starch and vegetable side — but a group
                    of rows that look like radio buttons is read as "pick one"
                    whatever the code does, so the owner reasonably reported that
                    multi-select could not be seen. This is the label that makes
                    the rule visible before anything is tapped.
                  */}
                  {!g.priced && Number(g.max) > 1 && (
                    <span className="ml-2 text-xs font-normal text-theme-muted">
                      pick up to {Number(g.max)}
                      {/*
                        Say what a second portion costs *here*, before it is
                        tapped. A stepper that only reveals the price after the
                        customer has pressed + is a price they agreed to without
                        reading it; the owner's rule is that the price goes up
                        when you ask for more, so that has to be legible first.
                      */}
                      {extraPortionPrice(g) > 0 && <> · extra portion + {zar(extraPortionPrice(g))}</>}
                    </span>
                  )}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {g.items.map((it) => {
                    const on = (picked[g.id] ?? []).includes(it.id);
                    /*
                     * A priced extra gets a stepper once added — the same control
                     * the dish card uses, so the drink behaves identically
                     * whichever way a customer reaches it. Everything else stays a
                     * plain toggle. Starch and vegetable side now hold several, so a
                     * second tick adds rather than replaces.
                     */
                    const cap = g.priced ? maxPerExtra(g, it) : maxPortions(it);
                    const count = Math.min(cap, Math.max(1, counts[`${g.id}:${it.id}`] ?? 1));
                    const setCount = (next: number) =>
                      setCounts((prev) => ({ ...prev, [`${g.id}:${it.id}`]: Math.min(cap, Math.max(1, next)) }));
                    /* Removing the last choice from a required group would leave
                       the plate incomplete, so the minus button sits dead at 1
                       instead of quietly doing nothing when pressed. */
                    const canRemove = !g.required || (picked[g.id] ?? []).length > 1;
                    const delta = g.priced ? extraCost(Number(it.price) || 0, count) : portionCost(it, count);

                    if (cap > 1 && on) {
                      return (
                        <div
                          key={it.id}
                          className="flex items-center justify-between gap-2 rounded-xl border-2 border-ochre bg-ochre/15 px-3 py-2 text-left text-sm"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{it.label}</span>
                            <span className="font-mono text-xs text-theme-soft">
                              {count === 1 ? (
                                /* The first portion is inside the plate price,
                                   so R0 would be a strange thing to print. */
                                g.priced ? `+ ${zar(0)}` : 'Included'
                              ) : (
                                <>
                                  + {zar(delta)}
                                  <span className="text-theme-muted">
                                    {' '}· {zar(g.priced ? Number(it.price) || 0 : extraPortionPrice(g))} each
                                  </span>
                                </>
                              )}
                            </span>
                          </span>
                          <span className="inline-flex shrink-0 items-center rounded-full border-2 border-theme/20 bg-surface">
                            <button
                              type="button"
                              onClick={() => (count <= 1 ? toggle(g, it.id) : setCount(count - 1))}
                              disabled={count <= 1 && !canRemove}
                              className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink hover:text-bone disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-inherit"
                              aria-label={count <= 1 ? `Remove ${it.label}` : `One fewer ${it.label}`}
                            >
                              −
                            </button>
                            <span className="w-6 text-center font-mono text-sm font-bold" aria-live="polite">{count}</span>
                            <button
                              type="button"
                              onClick={() => setCount(count + 1)}
                              disabled={count >= cap}
                              className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink hover:text-bone disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-inherit"
                              aria-label={`One more ${it.label}`}
                            >
                              +
                            </button>
                          </span>
                        </div>
                      );
                    }

                    /*
                     * Starch and vegetable side take more than one (owner, 15 Nov
                     * 2026), so they are a group of checkboxes, not a radio pair:
                     * "Pap · Dumpling" and "Chakalaka · Atchaar" are both ordinary
                     * requests. Only a group that holds a single answer stays a
                     * radio — the protein, where picking another replaces the
                     * first. The soft drink is a checkbox too: unticked by
                     * default, tick to take it, tick again to put it back.
                     */
                    const isChoice = !g.priced && Number(g.max) <= 1;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        role={isChoice ? 'radio' : 'checkbox'}
                        aria-checked={on}
                        onClick={() => toggle(g, it.id)}
                        className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${on ? 'border-ochre bg-ochre/15 font-semibold' : 'border-theme/12 hover:border-theme/30'}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`grid h-4 w-4 shrink-0 place-items-center border-2 ${isChoice ? 'rounded-full' : 'rounded-[4px]'} ${on ? 'border-ochre bg-ochre' : 'border-theme/30 bg-surface'}`}
                          >
                            {on && (isChoice
                              ? <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                              : <svg viewBox="0 0 12 12" className="h-3 w-3 text-theme" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 6.5 2.5 2.5L10 3.5" /></svg>)}
                          </span>
                          <span className="min-w-0">{it.label}</span>
                        </span>
                        <span className={`shrink-0 font-mono text-xs ${g.priced ? 'font-semibold text-theme-soft' : 'text-theme-muted'}`}>
                          {g.priced ? `+ ${zar(Number(it.price) || 0)}` : 'Included'}
                          {/*
                            A second one costs money, so "Included" on its own
                            would read as "all of it is free". The + shows what
                            the tap that follows will cost.
                          */}
                          {!g.priced && extraPortionPrice(g) > 0 && (
                            <span className="text-theme-muted"> · 2nd + {zar(extraPortionPrice(g))}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-theme/10 bg-canvas p-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-theme-muted">Plate price · delivery included in Sandton &amp; Rosebank</p>
            <p className="font-display text-3xl font-bold">{zar(total)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-full border-2 border-theme/12">
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
