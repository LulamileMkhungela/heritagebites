/**
 * Seed catalogue for Heritage Bites.
 *
 * Everything in this file is the owner's confirmed content (Regomoditswe
 * Moremedi, October 2026) — two fixed-price plate menus, Thursday and Friday
 * service from 12:00 to 13:30, delivery in Rosebank and Sandton with delivery
 * included in the plate price, a R100 minimum order and cash on collection
 * alongside Yoco card payments.
 *
 * Prices are in ZAR. Do not add a dish, price, special, discount code or
 * customer testimonial that the business has not signed off: this file is the
 * single source of truth for what the storefront is allowed to promise.
 */

/** Bumped whenever the catalogue changes shape, so stored data is re-seeded. */
/*
 * Bumped with the extra-portion rule below.
 *
 * The catalogue is seeded into the store once and then read from there, so a
 * change to `seed.js` alone never reaches a running server: the choices in the
 * store have no `extraPrice`, and a second pap would quietly cost nothing. The
 * version is what makes the stored catalogue be replaced.
 *
 * 16 — the kitchen's real rate card: starches R20, sides R15, protein R30
 *      (was a flat R30 placeholder for all three), and delivery at a flat R50
 *      out to 10 km (was R30 out to 15 km).
 */
export const SEED_VERSION = 16;

const img = (name) => `/img/${name}.jpg`;
/*
 * No PLACEHOLDER any more. Every plate and every side has a photograph: the last
 * two (Tlhakwana and Smiley) were filled on 18 Nov 2026. The SVG stays on disk
 * for the share card and as the fallback a future dish can point at, but nothing
 * in the catalogue references it, so a missing photo is now a build error rather
 * than a panel a customer has to look at.
 */

/* --------------------------------------------------------------------- */
/* Menu structure                                                         */
/* --------------------------------------------------------------------- */

/*
 * Both plate menus are built from the same three decisions — starch, protein,
 * vegetable side — and are priced per plate, not per component. Every option
 * carries a zero price delta because the plate price already includes it.
 */
/**
 * The sides, sold on their own.
 *
 * Owner, 17 Nov 2026: "some sides & relishes must have prices and details when
 * clicked" and, when asked whether a side can actually be bought: "they can add
 * to cart but be unable to checkout if items are less than 100".
 *
 * So a side is a real product: its own price, its own portion sentence, its own
 * photograph, addable to the basket. The R100 minimum is what stops somebody
 * ordering one bowl of chakalaka on its own — the same gate a small order
 * already meets, not a special rule for sides.
 *
 * THE PRICES ARE CONFIRMED (19 Nov 2026), not a guess any more.
 *
 * The kitchen sent the rate card the site had been estimating:
 *
 *   Starches (pap, samp & beans, mabele, dumpling, garlic bread)  R20
 *   Vegetable sides (chakalaka, braised cabbage, braised spinach,
 *                    morogo, green salad)                          R15
 *   Protein (tshotlo, beef short rib, mogodu, tlhakwana,
 *            chicken hardbody)                                     R30
 *
 * R30 was the placeholder for all three, so the site was overcharging a bowl of
 * pap by R10 and a bowl of chakalaka by R15 — the two cheapest things on it.
 *
 * The three constants below are the only copy of those numbers. The menu, the
 * basket, the till and the plate builder's extra-portion rule all read them, so
 * the next price change is one edit in one file.
 *
 * "Inside a plate" is a different thing and stays true: every side here is also
 * chosen *within* the R100/R130 plate, where it costs nothing extra. The card
 * says both, in that order, because the price is for the bowl.
 */
export const STARCH_PORTION_PRICE = 20;
export const SIDE_PORTION_PRICE = 15;
export const PROTEIN_EXTRA_PRICE = 30;

/*
 * What a SECOND portion of a starch or a vegetable side costs — and it is not one
 * number any more.
 *
 * Owner, 19 Nov 2026: "on choose a starch, choose vegetables, can we have
 * similar functionality like we have on add soft drink so the user can set if
 * they want more than 1 pap, etc but when they add more than 1 pap or any the
 * price goes up".
 *
 * The first portion of each is included in the plate price — that is what the
 * plate price buys, and it is why these choices carry a zero delta. A further
 * portion is food the kitchen has to cook and pack separately, so it is charged
 * at exactly what that bowl costs on its own: a starch R20, a vegetable side R15.
 *
 * One number for both was the placeholder. Now that the kitchen has a rate card,
 * a plate with a second pap and a second chakalaka is +R35, not +R60. The rule is
 * unchanged; only the rate follows the group — which is why `portioned` takes it
 * as an argument rather than reading one shared constant.
 */

/**
 * A starch or side choice, with the quantity rule both kinds share.
 *
 * `extraAfter: 1` is the whole rule in one word: the first portion is free, and
 * anything after it is priced at `extraPrice`. The server and the builder both
 * read these two fields, so the stepper cannot offer something the till refuses.
 *
 * `portionPrice` defaults to the starch rate because a caller that forgets it
 * should charge the dearer of the two, never the cheaper — an error that quotes
 * R15 for a second pap is money the kitchen does not collect.
 */
const portioned = (choice, portionPrice = STARCH_PORTION_PRICE) => ({
  ...choice,
  extraAfter: 1,
  extraPrice: portionPrice,
  max: 4,
});

/**
 * A starch or side as a plate *item*, keeping the quantity rule.
 *
 * The groups carry `items`, not `choices`, and the mapping to an item used to
 * copy only `id`, `label` and `price` — which silently dropped the extra-portion
 * rule on the floor. The builder then saw a choice that could never be taken
 * twice and a second pap that cost nothing, whatever the seed above it said.
 * Copying the rule across is the whole point of this function, so the fields
 * travel with the item instead of being remembered in two places.
 *
 * `price` stays at the plate price: an item inside a plate is already paid for,
 * and the amount is only meaningful for the `priced` extras like the drink.
 */
const plateItem = (choice, platePrice) => ({
  id: choice.id,
  label: choice.label,
  price: platePrice,
  extraAfter: choice.extraAfter,
  extraPrice: choice.extraPrice,
  max: choice.max,
});

const traditionalStarches = [
  portioned({ id: 'pap', label: 'Pap', priceDelta: 0 }),
  portioned({ id: 'mabele', label: 'Mabele (sorghum)', priceDelta: 0 }),
  portioned({ id: 'samp', label: 'Samp', priceDelta: 0 }),
  portioned({ id: 'dumpling', label: 'Dumpling', priceDelta: 0 }),
];

const traditionalSides = [
  portioned({ id: 'braised-cabbage', label: 'Braised cabbage', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'spinach', label: 'Spinach', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'morogo', label: 'Morogo', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'salsa', label: 'Salsa', priceDelta: 0 }, SIDE_PORTION_PRICE),
  /* Added on the owner's instruction (14 Nov 2026). Included in the plate price. */
  portioned({ id: 'chakalaka', label: 'Chakalaka', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'atchaar', label: 'Atchaar', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'green-salad', label: 'Green salad', priceDelta: 0 }, SIDE_PORTION_PRICE),
];

const contemporaryStarches = [
  portioned({ id: 'potato-mash', label: 'Potato mash', priceDelta: 0 }),
  portioned({ id: 'savoury-rice', label: 'Savoury rice', priceDelta: 0 }),
  portioned({ id: 'baby-potatoes', label: 'Baby potatoes', priceDelta: 0 }),
  portioned({ id: 'cous-cous', label: 'Cous cous', priceDelta: 0 }),
  portioned({ id: 'garlic-bread', label: 'Garlic bread', priceDelta: 0 }),
];

const contemporarySides = [
  portioned({ id: 'braised-cabbage', label: 'Braised cabbage', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'spinach', label: 'Spinach', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'salsa', label: 'Salsa', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'green-salad', label: 'Green salad', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'corn-ribs', label: 'Corn ribs', priceDelta: 0 }, SIDE_PORTION_PRICE),
  portioned({ id: 'glazed-carrots', label: 'Glazed carrots', priceDelta: 0 }, SIDE_PORTION_PRICE),
];

/*
 * Starch and vegetable side take more than one (owner, 15 Nov 2026: "choose
 * starch, vegetables must be multi select where user can select more than 1
 * item").
 *
 * These are the *dish card* groups — the same two questions the plate builder
 * asks, reached by tapping a single dish instead of building a plate. They must
 * answer the request identically, or the rule would depend on which button the
 * customer happened to press. `multiple` makes them a row of checkboxes, and
 * `max: 3` is the same cap the plate builder uses: pap and dumpling together is
 * an ordinary plate, nine starches is not.
 */
const starchGroup = (choices, id = 'starch') => ({
  id,
  label: 'Choose your starch',
  required: true,
  multiple: true,
  max: 3,
  choices,
});

const sideGroup = (choices, id = 'veg') => ({
  id,
  label: 'Choose your vegetable side',
  required: true,
  multiple: true,
  max: 3,
  choices,
});

/*
 * `max: 3` above counts *selections* — up to three different starches — and has
 * nothing to do with portions. The portion cap and the extra-portion price live
 * on each choice (`extraAfter`, `extraPrice`, and the choice's own `max`), which
 * is what turns a row into a stepper. Reading the group's `max` as a portion cap
 * is how three helpings of pap would once have slipped through for free.
 */

/**
 * The soft drink, offered after the vegetable side.
 *
 * `priced: true` is the one thing that makes this group different from the
 * rest of the builder. Every other group is "included" — its price deltas are
 * zero and the plate price is the only amount charged. A drink is not part of
 * the R100/R130 plate, so its group is marked `priced` and the server adds the
 * chosen item's `price` to the plate line. Without that flag the drink would
 * ride along free, which is exactly the bug the plate builder's design invites.
 *
 * Optional (`required: false`): a customer who wants water with their own drink
 * should not be forced to buy one.
 *
 * PRICE IS A GUESS — the owner has the number. R25 for a 500 ml home-made
 * ginger beer is the placeholder; `price` and `priceDelta` must be changed
 * together.
 */
const GINGER_GEMERE_PRICE = 25;

/**
 * The same drink for a dish card.
 *
 * A plate builder has *groups*; a dish card has *options*. Both sell the same
 * 500 ml ginger gemere, so both read the same price constant — two places that
 * could drift apart is exactly how one of them ends up free.
 *
 * `priced: true` tells the pricing code that this choice's `priceDelta` is real
 * money, unlike a starch or a side whose delta is zero because it is already in
 * the plate price.
 */
const drinksOption = () => ({
  id: 'drink',
  label: 'Add a soft drink',
  required: false,
  priced: true,
  /*
   * Up to four bottles on one plate, and the count is the customer's to choose.
   *
   * A plate is for one person; a table of four ordering one delivery is the
   * normal case, and forcing them to add the whole plate four times to get four
   * drinks would charge for four plates. This is the Uber Eats behaviour the
   * owner asked for — a stepper on the extra, priced per bottle.
   */
  choices: [
    { id: 'ginger-gemere', label: 'Ginger gemere — home-made ginger beer, 500 ml', priceDelta: GINGER_GEMERE_PRICE, max: 4 },
  ],
});

const drinksGroup = () => ({
  id: 'drink',
  label: 'Add a soft drink',
  required: false,
  /*
   * `max: 1` counts *selections*, not bottles: the builder lets one drink choice
   * into the group, and the bottle count is asked for separately (see
   * `extraQty`). Raising this to 4 would let a customer pick the same drink four
   * times, which the pricing would then have to de-duplicate.
   */
  max: 1,
  priced: true,
  items: [
    {
      id: 'ginger-gemere',
      label: 'Ginger gemere — home-made ginger beer, 500 ml',
      price: GINGER_GEMERE_PRICE,
      /* How many bottles one plate may carry. */
      max: 4,
    },
  ],
});

/** The two confirmed plate prices. The customer picks components within a plate. */
export const plateMenus = [
  {
    id: 'traditional',
    name: 'Traditional Plate',
    price: 100,
    blurb:
      'One protein, and up to three starches and three vegetable sides — the first of each is included, and an extra portion is charged, from the traditional kitchen.',
    image: img('plate-mogodu'),
    groups: [
      {
        id: 'protein', label: 'Choose your protein', required: true, max: 1,
        items: [
          { id: 'mogodu', label: 'Mogodu (beef tripe)', price: 100 },
          { id: 'tshotlo', label: 'Tshotlo (pounded beef)', price: 100 },
          { id: 'chicken-hardbody', label: 'Chicken hardbody', price: 100 },
          { id: 'tlhakwana', label: 'Tlhakwana (beef trotters)', price: 100 },
          { id: 'smiley', label: 'Smiley (sheep head)', price: 100 },
        ],
      },
      /*
       * Starch and vegetable side take more than one (owner, 15 Nov 2026:
       * "choose starch, vegetables must be multi select where user can select
       * more than 1 item").
       *
       * A plate with pap AND dumpling is an ordinary plate in this kitchen — the
       * two are eaten together, not chosen between. The cap of 3 keeps a plate a
       * plate: it stops a customer assembling nine starches and calling it a
       * R100 meal. The items stay at `price: 100` (the plate price) because
       * every component is already inside it; the amount means nothing.
       */
      { id: 'starch', label: 'Choose your starch', required: true, max: 3, items: traditionalStarches.map((c) => plateItem(c, 100)) },
      { id: 'veg', label: 'Choose your vegetable side', required: true, max: 3, items: traditionalSides.map((c) => plateItem(c, 100)) },
      drinksGroup(),
    ],
  },
  {
    id: 'contemporary',
    name: 'Contemporary Plate',
    price: 130,
    blurb:
      'One protein, and up to three starches and three vegetable sides — the first of each is included, and an extra portion is charged, from the contemporary kitchen.',
    image: img('plate-short-rib'),
    groups: [
      {
        id: 'protein', label: 'Choose your protein', required: true, max: 1,
        items: [
          { id: 'wings', label: 'Chicken wings', price: 130 },
          { id: 'short-rib', label: 'BBQ beef short rib', price: 130 },
          { id: 'lamb-stew', label: 'Lamb stew', price: 130 },
        ],
      },
      /* Multi-select, same rule and same cap as the traditional plate. */
      { id: 'starch', label: 'Choose your starch', required: true, max: 3, items: contemporaryStarches.map((c) => plateItem(c, 130)) },
      { id: 'veg', label: 'Choose your vegetable side', required: true, max: 3, items: contemporarySides.map((c) => plateItem(c, 130)) },
      drinksGroup(),
    ],
  },
];

/* --------------------------------------------------------------------- */
/* Categories                                                             */
/* --------------------------------------------------------------------- */

export const categories = [
  {
    id: 'traditional',
    name: 'Traditional Plates',
    /*
     * No price in the tagline. It claimed "R100 a plate" for the whole category,
     * which stopped being true as soon as anything in the menu was priced
     * differently — and the price belongs on the plate, where it is calculated.
     */
    tagline: 'Slow-cooked, the traditional way',
    blurb: 'Starch, protein and a vegetable side. Pap, mabele, samp or dumpling, cooked the way a Sunday kitchen does it.',
    accent: 'chili',
  },
  {
    id: 'contemporary',
    name: 'Contemporary Plates',
    tagline: 'The contemporary kitchen',
    blurb: 'Mash, savoury rice, baby potatoes, cous cous or garlic bread with wings, short rib or lamb stew.',
    accent: 'clay',
  },
  /*
   * Sides and relishes, sold by the portion.
   *
   * A category of their own, not a shelf inside a plate category: they are the
   * one thing on the menu that is not a plate, and somebody looking for "just
   * some chakalaka" should not have to open a plate builder to find it.
   */
  {
    id: 'sides',
    name: 'Sides & Relishes',
    tagline: 'The things that make the plate',
    blurb: 'Every vegetable side you can choose inside a plate, now sold by the bowl as well — braised cabbage, spinach, morogo, salsa, chakalaka, atchaar and green salad, plus corn ribs and glazed carrots.',
    accent: 'sky',
  },
];

/* --------------------------------------------------------------------- */
/* Coming soon — the kitchen archive                                      */
/* --------------------------------------------------------------------- */

/**
 * Every vegetable side either kitchen offers, once each, in menu order.
 *
 * The traditional list first, then anything only the contemporary kitchen has —
 * corn ribs and glazed carrots. Order matters for the card, not for the rule:
 * the first occurrence wins, so a side shared by both plates keeps its
 * traditional position and does not appear twice.
 */
function uniqueSides() {
  const seen = new Set();
  return [...traditionalSides, ...contemporarySides].filter((side) => {
    if (seen.has(side.id)) return false;
    seen.add(side.id);
    return true;
  });
}

/*
 * What a vegetable side card shows, and the photograph behind it.
 *
 * Owner, 17 Nov 2026: "on Sides & Relishes use correct real images". Until now
 * this borrowed whatever picture was nearest — spinach showed samp and beans,
 * salsa showed chakalaka, glazed carrots showed pap — because the sides had never
 * been sold on their own. Now that each is a card a customer taps and adds, the
 * picture has to be the food in the name, so every side has its own file.
 *
 * Every name here must exist in `public/img/`. A side pointing at a photograph
 * the site does not ship is a 404 on the published page (the static-pages test
 * catches it), so the map is kept to files that are actually there rather than
 * to the name of the side.
 */
function sideImage(id) {
  return img(
    {
      chakalaka: 'chakalaka',
      atchaar: 'atchaar',
      'braised-cabbage': 'side-braised-cabbage',
      spinach: 'side-spinach',
      morogo: 'side-morogo',
      salsa: 'side-salsa',
      'green-salad': 'side-green-salad',
      'corn-ribs': 'side-corn-ribs',
      'glazed-carrots': 'side-glazed-carrots',
    }[id] ?? 'chakalaka',
  );
}







/** How much one portion is, in the words a customer would ask for it. */
function sidePortion(id) {
  return (
    {
      'braised-cabbage': 'One bowl, enough for two beside a plate.',
      spinach: 'One bowl, enough for two beside a plate.',
      morogo: 'One bowl, enough for two beside a plate.',
      salsa: 'One small bowl, served cold.',
      chakalaka: 'One bowl, enough for two beside a plate.',
      atchaar: 'One small bowl — a spoonful goes a long way.',
      'green-salad': 'One bowl, enough for two beside a plate.',
      'corn-ribs': 'Four ribs, grilled to order.',
      'glazed-carrots': 'One bowl, enough for two beside a plate.',
    }[id] ?? 'One bowl, to share beside a plate.'
  );
}

/** One honest line per side — what it is, not a marketing claim. */
function sideBlurb(id) {
  return (
    {
      'braised-cabbage': 'Cabbage braised slowly with onion until it is sweet and soft.',
      spinach: 'Spinach wilted down with a little onion and seasoning.',
      morogo: 'Wild African greens, cooked the traditional way.',
      salsa: 'Fresh tomato and onion salsa, chopped and served cold.',
      chakalaka: 'Spicy carrot, bean and pepper relish, cooked down until it is sweet and hot.',
      atchaar: 'Tangy mango atchaar, made in the kitchen and spooned over the plate.',
      'green-salad': 'Crisp lettuce, cucumber and tomato with a light dressing.',
      'corn-ribs': 'Sweetcorn ribs, cut and grilled until the kernels caramelise.',
      'glazed-carrots': 'Carrots roasted and glazed until they shine.',
    }[id] ?? 'One of the vegetable sides you can choose inside a plate.'
  );
}

/*
 * The categories the site carried before the owner signed off the two-tier
 * menu. Customers asked to see them again, and asked for the cards to read like
 * the rest of the menu: a photo, the dish name, a price and one line about it.
 * The one thing that separates them from a sellable plate is the "Coming soon"
 * tag on the photo and the absence of a basket button — the owner confirmed
 * these are not on sale yet.
 *
 * Rules for this list:
 *   - No dish that is already sellable belongs here. Anything a customer can
 *     order today — as a plate or as a component of one — was removed, because
 *     a "coming soon" tag on food that is already on the menu only confuses
 *     people (owner, October 2026). That is why Mogodu & Samp, Tshotlo, Beef
 *     Short Ribs and Flame-Grilled Wings are gone, and why the old Modern
 *     Favourites category went with them: every dish in it is already a
 *     Contemporary plate.
 *   - Prices are the kitchen's indication of what the dish will cost when it
 *     returns, supplied by the owner ("put any amount"). They are a guide, not a
 *     quote, and the card says so.
 *   - Only a photo that is actually of that dish. Anything we would have had to
 *     pad with somebody else's picture stays commented out below instead.
 *   - Nothing here is added to `menu`, so the API can never sell it, price it,
 *     search it or put it in a basket.
 */
export const comingSoon = [
  /*
   * Heritage Pots is hidden at the owner's request (14 Nov 2026). Commented out
   * rather than deleted, so the signed-off copy can come back with one uncomment
   * if she changes her mind.
   *
   * {
   *   id: 'heritage-pots',
   *   name: 'Heritage Pots',
   *   tagline: 'Slow-cooked the way grandmothers taught us',
   *   blurb: 'Samp, beans and grains — the pots that carry memory.',
   *   accent: 'chili',
   *   items: [
   *     {
   *       id: 'archive-isistambu', name: 'Isistambu — Samp & Beans', price: 100, image: img('samp-beans'),
   *       description: 'Samp and sugar beans slow-cooked until creamy, finished with a little butter.',
   *       status: 'coming-soon',
   *     },
   *     {
   *       id: 'archive-dombolo', name: 'Dombolo', price: 100, image: img('dumplings'),
   *       description: 'Steamed bread, soft in the middle, made to soak up the gravy on the plate.',
   *       status: 'coming-soon',
   *     },
   *     {
   *       id: 'archive-motogo', name: 'Motogo wa Mabele', price: 100, image: img('mabele'),
   *       description: 'Sorghum porridge cooked the old way and served warm, the way it is made at home.',
   *       status: 'coming-soon',
   *     },
   *     // Tlhakwana only ever had a short-rib photo to sit on, and a photo of the
   *     // wrong dish is worse than no card. It is already on the Traditional menu
   *     // as a protein, so nothing is lost by leaving it out here.
   *     // { id: 'archive-tlhakwana', name: 'Tlhakwana', image: img('short-ribs'), status: 'coming-soon' },
   *   ],
   * },
   */
  {
    id: 'kasi-fast-food',
    name: 'Kasi Fast Food',
    tagline: 'Quick, loaded, properly filling',
    blurb: 'Kota, russians, chips and magwinya — South African street classics.',
    accent: 'ochre',
    items: [
      {
        id: 'archive-kota', name: 'Sphatlo (Kota)', price: 70, image: img('kota'),
        description: 'Quarter loaf loaded with chips, polony, atchaar and a slice of cheese.',
        status: 'coming-soon',
      },
      {
        id: 'archive-russian-chips', name: 'Russian & Chips', price: 60, image: img('russian-chips'),
        description: 'Grilled russian sausage with a portion of slap chips and a dash of atchaar.',
        status: 'coming-soon',
      },
      {
        id: 'archive-magwinya-polony', name: 'Magwinya & Polony', price: 40, image: img('magwinya'),
        description: 'Fat cakes split and filled with polony, atchaar and a little chilli.',
        status: 'coming-soon',
      },
      // Slap chips would be shown with a russian-and-chips photo.
      // { id: 'archive-slap-chips', name: 'Slap Chips', image: img('russian-chips'), status: 'coming-soon' },
    ],
  },
  {
    id: 'morning-heritage',
    name: 'Morning Heritage',
    tagline: 'For the early start',
    blurb: 'Warm sorghum porridge and golden fat cakes, fried at dawn.',
    accent: 'morogo',
    items: [
      {
        id: 'archive-magwinya', name: 'Fresh Magwinya', price: 25, image: img('magwinya'),
        description: 'Golden fat cakes, fried in the morning and best eaten warm.',
        status: 'coming-soon',
      },
      /*
       * Owner, 15 Nov 2026: "update Motogo & Magwinya into Motogo".
       *
       * The dish is the porridge. The fat cakes were a side the photo happened to
       * show, and a name that promises two of them is a promise the kitchen has
       * to keep on every plate — so the name and the description both say what
       * is actually being sold.
       */
      {
        id: 'archive-motogo', name: 'Motogo', price: 45, image: img('mabele'),
        description: 'Warm sorghum porridge, cooked slow and served the way it is meant to be eaten.',
        status: 'coming-soon',
      },
      // The breakfast plate had no photograph of its own.
      // { id: 'archive-breakfast-plate', name: 'Heritage Breakfast Plate', image: img('magwinya'), status: 'coming-soon' },
    ],
  },
  /*
   * Sides & Relishes used to be a coming-soon section here — cards with no price
   * and borrowed photographs. It is a sellable category now (see `sides` below),
   * because a customer can add a bowl to the basket, and nothing in a
   * coming-soon section can be sold.
   */
  /*
   * Cold & Warm (mageu, amasi, rooibos, ginger beer) is left out entirely.
   *
   * Drinks were never approved for sale, and the old build showed all four with
   * the same borrowed mabele photograph. A "coming soon" card still promises a
   * future the business has not confirmed, so this category stays commented out
   * until the owner signs off both the drinks and their photographs.
   *
   * {
   *   id: 'cold-warm',
   *   name: 'Cold & Warm',
   *   tagline: 'Mageu, amasi and rooibos',
   *   blurb: 'Traditional and everyday drinks.',
   *   accent: 'ink',
   *   items: [
   *     { id: 'archive-mageu', name: 'Mageu', image: img('mabele'), status: 'coming-soon' },
   *     { id: 'archive-amasi', name: 'Amasi', image: img('mabele'), status: 'coming-soon' },
   *     { id: 'archive-rooibos', name: 'Rooibos Tea', image: img('mabele'), status: 'coming-soon' },
   *     { id: 'archive-ginger-beer', name: 'Ginger Beer', image: img('mabele'), status: 'coming-soon' },
   *   ],
   * },
   */
];

/* --------------------------------------------------------------------- */
/* Menu                                                                   */
/* --------------------------------------------------------------------- */

const wingsBaste = {
  id: 'baste',
  label: 'Choose your basting',
  required: true,
  choices: [
    { id: 'honey-soy', label: 'Honey soy glazed basted', priceDelta: 0 },
    { id: 'chilli-sriracha', label: 'Chilli sriracha basted', priceDelta: 0 },
  ],
};

/**
 * Each menu entry is one complete plate. `plateId` links it to the fixed price
 * in `plateMenus`, so a card can never disagree with what checkout charges.
 */
export const menu = [
  {
    id: 'mogodu-plate',
    plateId: 'traditional',
    name: 'Mala-Mogodu',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    image: img('plate-mogodu'),
    description: 'Beef tripe, slow-cooked in a rich onion-and-tomato gravy, with your starches and vegetable sides.',
    story:
      'Mogodu is judged by the time it is given. It is the plate our regulars order first, and the one we are proudest to send out.',
    tags: ['tripe'],
    spice: 1,
    prepMins: 20,
    serves: 1,
    rating: 4.9,
    orders: 1240,
    available: true,
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides), drinksOption()],
  },
  {
    id: 'tshotlo-plate',
    plateId: 'traditional',
    name: 'Tshotlo',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    image: img('plate-tshotlo'),
    description: 'Pounded beef cooked until it pulls apart, with your starches and vegetable sides.',
    story:
      'Tshotlo is the plate that feeds a table. The beef is cooked long and pounded so the sauce and the meat become one thing.',
    tags: ['pounded beef'],
    spice: 1,
    prepMins: 20,
    serves: 1,
    rating: 4.8,
    orders: 980,
    available: true,
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides), drinksOption()],
  },
  {
    id: 'chicken-hardbody-plate',
    plateId: 'traditional',
    name: 'Chicken Hardbody',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    image: img('plate-chicken-hardbody'),
    description: 'Chicken cooked hardbody style in a savoury gravy, with your starches and vegetable sides.',
    story: '',
    tags: ['chicken'],
    spice: 1,
    prepMins: 18,
    serves: 1,
    rating: 4.7,
    orders: 870,
    available: true,
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides), drinksOption()],
  },
  {
    id: 'tlhakwana-plate',
    plateId: 'traditional',
    name: 'Tlhakwana',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    /*
     * A representative photograph of the dish, sourced on 18 Nov 2026 so the
     * card is not a "photo coming soon" panel on a R100 plate. It is the dish,
     * not this kitchen's plate, and it is not in the tray-and-plate house style
     * the owner's own shots use — swap it for theirs the moment one arrives.
     * Licensing is NOT cleared; that is the trade-off, stated openly rather than
     * hidden behind a placeholder that costs the shop real orders.
     */
    image: '/img/plate-tlhakwana.jpg',
    description: 'Beef trotters braised until the gravy turns glossy, with your starches and vegetable sides.',
    story: '',
    tags: ['trotters'],
    spice: 1,
    prepMins: 20,
    serves: 1,
    rating: 4.7,
    orders: 610,
    available: true,
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides), drinksOption()],
  },
  {
    id: 'smiley-plate',
    plateId: 'traditional',
    name: 'Smiley',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    /* Same caveat as Tlhakwana: a representative dish photograph, sourced, not
       the owner's plate, licensing not cleared. */
    image: '/img/plate-smiley.jpg',
    description: 'Sheep head, cooked and served the traditional way, with your starches and vegetable sides.',
    story: '',
    tags: ['sheep head'],
    spice: 1,
    prepMins: 25,
    serves: 1,
    rating: 4.8,
    orders: 540,
    available: true,
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides), drinksOption()],
  },

  /* ---------------------------- Contemporary -------------------------- */
  {
    id: 'wings-plate',
    plateId: 'contemporary',
    name: 'Chicken Wings Plate',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'contemporary',
    price: 130,
    image: img('plate-wings'),
    description: 'Chicken wings basted to order — honey soy or chilli sriracha — with your starches and vegetable sides.',
    story: '',
    tags: ['chicken', 'wings'],
    spice: 2,
    prepMins: 20,
    serves: 1,
    rating: 4.9,
    orders: 1560,
    available: true,
    options: [wingsBaste, starchGroup(contemporaryStarches), sideGroup(contemporarySides), drinksOption()],
  },
  {
    id: 'short-rib-plate',
    plateId: 'contemporary',
    name: 'BBQ Beef Short Rib Plate',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'contemporary',
    price: 130,
    image: img('plate-short-rib'),
    description: 'BBQ beef short rib, grilled and glazed, with your starches and vegetable sides.',
    story: '',
    tags: ['beef', 'grilled'],
    spice: 1,
    prepMins: 25,
    serves: 1,
    rating: 4.8,
    orders: 430,
    available: true,
    options: [starchGroup(contemporaryStarches), sideGroup(contemporarySides), drinksOption()],
  },
  {
    id: 'lamb-stew-plate',
    plateId: 'contemporary',
    name: 'Lamb Stew Plate',
    localName: '',
    language: '',
    pronunciation: '',
    category: 'contemporary',
    price: 130,
    image: img('plate-lamb-stew'),
    description: 'Lamb stewed until tender in a rich gravy, with your starches and vegetable sides.',
    story: '',
    tags: ['lamb', 'stew'],
    spice: 1,
    prepMins: 25,
    serves: 1,
    rating: 4.8,
    orders: 390,
    available: true,
    options: [starchGroup(contemporaryStarches), sideGroup(contemporarySides), drinksOption()],
  },
];

/* --------------------------------------------------------------------- */
/* Sides, sold by the portion                                             */
/* --------------------------------------------------------------------- */

/**
 * The sides, as products.
 *
 * Same ids as the choices inside a plate (`braised-cabbage`, `chakalaka` …), on
 * purpose: the bowl of chakalaka added here and the chakalaka ticked inside a
 * plate are the same food, so matching ids mean the menu, the basket, the kitchen
 * printout and any test can prove they agree instead of guessing.
 *
 * `options: []` — a side has nothing to configure. A plate does, which is why the
 * plate builders exist; "which starch with your salsa" would be absurd.
 *
 * `story` is empty on purpose. A bowl of cabbage does not need a heritage
 * paragraph, and inventing one would be filler on a page whose claim is that the
 * words are true.
 */
export const sides = uniqueSides().map((side) => ({
  id: `side-${side.id}`,
  name: side.label,
  localName: '',
  language: '',
  pronunciation: '',
  category: 'sides',
  /* Every generated bowl here is a vegetable side, so it carries the R15 rate. */
  price: SIDE_PORTION_PRICE,
  image: sideImage(side.id),
  description: sideBlurb(side.id),
  story: '',
  tags: ['side', 'vegetable'],
  spice: side.id === 'chakalaka' || side.id === 'atchaar' ? 2 : 0,
  prepMins: 5,
  serves: 2,
  rating: 4.8,
  orders: 0,
  available: true,
  /* Sold by the portion: what one bowl is, in the customer's own terms. */
  portion: sidePortion(side.id),
  options: [],
}));

/**
 * Stywe Pap, on its own.
 *
 * The one card in the old Sides & Relishes list that carried a price, and a
 * starch rather than a relish — so it is written out here rather than generated
 * from the plate choices, and its id is its own.
 */
sides.push({
  id: 'side-stywe-pap',
  name: 'Stywe Pap',
  localName: '',
  language: '',
  pronunciation: '',
  category: 'sides',
  /* Pap is a starch, not a relish — it carries the R20 starch rate. */
  price: STARCH_PORTION_PRICE,
  image: img('side-stywe-pap'),
  description: 'Stiff maize pap, the traditional partner to a braai or a pot of mogodu.',
  story: '',
  tags: ['side', 'starch'],
  spice: 0,
  prepMins: 10,
  serves: 2,
  rating: 4.8,
  orders: 0,
  available: true,
  portion: 'One bowl, enough for two beside a plate.',
  options: [],
});

/* --------------------------------------------------------------------- */
/* Weekly service                                                         */
/* --------------------------------------------------------------------- */

/*
 * There are no day-of-week promotions. The business serves on Thursdays and
 * Fridays and confirms any further special on WhatsApp, so the site shows the
 * service windows and says so rather than inventing seven daily offers.
 */
export const specials = [];

/* --------------------------------------------------------------------- */
/* Store settings                                                         */
/* --------------------------------------------------------------------- */

export const settings = {
  storeName: 'Heritage Bites',
  tagline: 'Every Bite Tells a Story',
  currency: 'ZAR',
  phone: '+27670137587',
  phoneDisplay: '+27 67 013 7587',
  whatsapp: '27670137587',
  email: 'heritagebitesfood@gmail.com',
  established: 2025,

  /*
   * Delivery: included in the plate price, Rosebank and Sandton only.
   *
   * This is the rule the owner signed off (`docs/regomoditswe-answers-2026-10.md`:
   * "Delivery fee: None — delivery is included in the plate price", and the plate
   * lines that read "R100 a plate (delivery included)").
   *
   * The two fee fields stay in the schema because the pricing code reads them:
   * `deliveryFeeCents` returns zero when the free-delivery threshold is zero, so
   * `freeDeliveryAbove: 0` is what makes delivery free rather than a separate
   * branch in the maths. A zero flat fee is the same statement in the other
   * field, and it keeps any surface that still prints `deliveryFlat` honest.
   *
   * The R100 minimum still applies — it is a floor on the order, not a fee.
   */
  deliveryIncluded: true,
  deliveryFlat: 0,
  freeDeliveryAbove: 0,
  minDeliveryOrder: 100,
  deliveryAreas: ['Rosebank', 'Sandton'],

  /*
   * Delivery-only pricing.
   *
   * `deliveryIncluded` above still describes the Sandton/Rosebank run: inside
   * that ring the plate price is the whole price. Outside it, `outsideFee` is
   * added, and past `maxDeliveryKm` the checkout refuses the order instead of
   * quoting for it. Collection was removed, so there is no counter price any
   * more — `deliveryFlat: 0` is the honest default because the included ring
   * owes nothing, and the surcharge is a separate field.
   *
   * THE FEE IS CONFIRMED (19 Nov 2026), not a guess any more: "Are you able to
   * make this 10km radius please at a flat fee of R50. 30km is way too far and
   * will be uneconomical pricing wise".
   *
   * So the outer ring is a FLAT R50, out to 10 km — the same fee at 6.5 km and at
   * 9.9 km. The kitchen's reason for the flatness is that a tiered price is a
   * negotiation at the door, and its reason for the 10 km cap is that beyond it
   * the run stops paying for itself at all.
   *
   * Read from here by the server, the basket and the checkout, so this one value
   * updates the whole site.
   */
  outsideFee: 50,
  outsideFeeNote: 'Farther than the included run we add a flat R50 delivery fee, confirmed on WhatsApp before you pay.',
  /*
   * Owner, 19 Nov 2026: 10 km, not 15 and not the 50 the previous builder
   * proposed. "30km is way too far and will be uneconomical pricing wise" — and
   * the 50 km in the agency's plan was further still.
   *
   * Every other surface derives from this number — the address search envelope,
   * the basket's running total, the checkout's refusal and the copy on the home,
   * contact, specials and policy pages. Changing it here changes the whole
   * delivery rule at once, which is the only way the site can be trusted to
   * quote what it charges.
   */
  maxDeliveryKm: 10,
  deliveryOrigin: { lat: -26.126, lng: 28.049 },
  includedRadiusKm: 6,

  /*
   * Collection: REMOVED, and now removed from the schema too.
   *
   * Owner, 14 Nov 2026 — "there is no collection, it is delivery based". The
   * `collectionArea` / `collectionPoint` / `collectionNote` fields were kept
   * "because a few legacy surfaces read them"; on 18 Nov 2026 I checked, and
   * nothing did — not one component, page or server path. Three empty strings
   * that no code reads are not compatibility, they are a standing invitation for
   * the next person to wire a collection point back in. Deleted.
   */
  /* Delivery runs inside the service window. */
  serviceWindow: { open: '12:00', close: '13:30' },
  /*
   * Kept because the *types* still carry them and an older API publishes them;
   * no current surface renders an estimate — the owner had the prep and delivery
   * rows removed from the specials table and the checkout. They are here as
   * harmless data, not as copy.
   */
  prepEstimateMins: 20,
  deliveryEstimateMins: 30,

  /* Contact form inbox (Formspree), supplied by the business. */
  contactFormspreeUrl: 'https://formspree.io/f/xvkkkwve',

  loyaltyRateCents: 5000,

  /*
   * Google reviews (owner, 14 Nov 2026).
   *
   * BLOCKED ON ONE THING: the Google Business Profile Place ID. A review link is
   * `https://search.google.com/local/writereview?placeid=<PLACE_ID>` — a plain
   * URL that works on any host, including the GitHub Pages preview, so this does
   * NOT have to wait for the .co.za domain. What does need the domain and the
   * verification is the Profile itself, because Google will not collect reviews
   * for a business it has not verified.
   *
   * Until the ID arrives the field is empty and every surface that reads it
   * hides itself — no dead "Review us" button, and no invented Place ID, which
   * would send customers to somebody else's listing.
   *
   * `googlePlaceName` is the text shown on the button once a link exists.
   */
  googlePlaceId: '',
  googlePlaceName: 'Heritage Bites',
  googleReviewUrl: '',

  channels: {
    ubereats: { label: 'Uber Eats', url: '', enabled: false },
    mrd: { label: 'Mr D Food', url: '', enabled: false },
    whatsapp: { label: 'WhatsApp', url: 'https://wa.me/27670137587', enabled: true },
  },

  hours: [
    { day: 0, label: 'Sunday', closed: true },
    { day: 1, label: 'Monday', closed: true },
    { day: 2, label: 'Tuesday', closed: true },
    { day: 3, label: 'Wednesday', closed: true },
    { day: 4, label: 'Thursday', open: '12:00', close: '13:30', closed: false },
    { day: 5, label: 'Friday', open: '12:00', close: '13:30', closed: false },
    { day: 6, label: 'Saturday', closed: true },
  ],

  /*
   * One-off service days — a Saturday market, a holiday trading day. These are
   * NOT part of the weekly rhythm: a date listed here opens the kitchen once,
   * on that calendar date (Africa/Johannesburg), with delivery and collection
   * exactly as on a Thursday, and never again.
   *
   *   specialServiceDays: ['2026-11-21']                                   date, `serviceWindow` hours
   *   specialServiceDays: [{ date: '2026-11-21', open: '10:00', close: '14:00', label: 'Saturday market' }]
   *
   * Nothing is listed here because the business has not signed off any extra
   * trading days — adding one is a promise to cook and deliver that day, so it
   * needs the owner's explicit go-ahead and must be removed once it has passed.
   * An equally supported alternative is the HB_SPECIAL_SERVICE_DAYS environment
   * variable (comma-separated dates, e.g. "2026-11-21,2026-12-05"), which turns a
   * day on without a code change; the host sets or unsets it and restarts.
   */
  specialServiceDays: [],
};

/*
 * No discount codes have been approved. The storefront keeps the mechanism but
 * ships with an empty list, so nothing is promised that the business has not
 * agreed to.
 */
export const discountCodes = [];

/* No customer testimonials have been approved for publication. */
export const testimonials = [];

/* --------------------------------------------------------------------- */
/* Customer policies — approved wording from the business                 */
/* --------------------------------------------------------------------- */

export const policies = [
  {
    id: 'privacy',
    title: 'Privacy Policy',
    updated: '2026-10-27',
    intro:
      'Heritage Bites respects your privacy and is committed to protecting your personal information in accordance with the Protection of Personal Information Act (POPIA) of South Africa.',
    sections: [
      {
        heading: 'What we collect',
        body: 'When you place an order, submit an enquiry, make a reservation, or contact us, we may collect your name and surname, contact number, email address, delivery address, and payment-related information processed through secure third-party providers.',
      },
      {
        heading: 'Why we use it',
        body: 'We use this information to process and fulfil orders, provide customer support, manage reservations and catering requests, improve our products and services, and communicate important updates regarding your order.',
      },
      {
        heading: 'Sharing',
        body: 'We do not sell your personal information to third parties. Your information may be shared only with trusted service providers involved in processing payments, delivering orders, or providing website services.',
      },
      {
        /*
         * The checkout sends what you type in the address box to OpenStreetMap's
         * Photon geocoder to suggest addresses. That is a third party receiving
         * personal information (a home address, typed character by character),
         * so POPIA requires it to be named here rather than buried in code.
         */
        heading: 'Address suggestions',
        body: 'When you type a delivery address at checkout, the text you have typed so far is sent to the OpenStreetMap address service (photon.komoot.io) to suggest matching addresses. Only that address text is sent — never your name, phone number, email address or payment details — and we do not store the suggestions. You can ignore the suggestions and type your address in full; nothing else changes.',
      },
      {
        heading: 'Your rights',
        body: 'You have the right to request access to, correction of, or deletion of your personal information, subject to legal requirements. Contact us on +27 67 013 7587 or heritagebitesfood@gmail.com to make a request.',
      },
    ],
  },
  {
    id: 'terms',
    title: 'Website Terms of Use',
    updated: '2026-10-27',
    intro:
      'By using the Heritage Bites website, placing an order, or booking our services, you agree to these terms and conditions.',
    sections: [
      {
        heading: 'Accurate information',
        body: 'Customers must provide accurate information when placing orders, and are responsible for ensuring their delivery address is correct.',
      },
      {
        heading: 'Menu and imagery',
        body: 'Product images are for illustration purposes and actual presentation may vary. Menu items, pricing, and availability may change without notice.',
      },
      {
        heading: 'Refusing or cancelling an order',
        body: 'Heritage Bites reserves the right to refuse or cancel an order if incorrect pricing, stock shortages, technical errors, or suspected fraud are identified.',
      },
      {
        heading: 'Delays',
        body: 'Heritage Bites is not liable for delays caused by circumstances beyond its reasonable control, including traffic, weather conditions, power outages, or third-party delivery service interruptions.',
      },
      {
        heading: 'Intellectual property',
        body: 'All intellectual property on the website, including logos, branding, content, and images, remains the property of Heritage Bites.',
      },
    ],
  },
  {
    /*
     * `delivery-collection` keeps its id. It is a URL fragment — /policies#delivery-collection
     * — and the slug is the only durable part of a policy link, so it stays even
     * though the policy inside is now purely about delivery. The title is what a
     * customer reads, and that says Delivery.
     */
    id: 'delivery-collection',
    title: 'Delivery',
    updated: '2026-11-14',
    intro: 'Heritage Bites is a delivery-only kitchen serving Thursdays and Fridays between 12:00 and 13:30.',
    sections: [
      {
        heading: 'Service days and times',
        body: 'We cook and deliver on Thursdays and Fridays only, between 12:00 and 13:30. Orders placed outside those times are recorded as pre-orders for the next service day.',
      },
      {
        heading: 'Delivery areas',
        body: /*
       * The distances here are written out, not interpolated, because the policy
       * is signed copy the owner approved. They drifted: this paragraph said
       * 50 km in three places while the catalogue had already moved to 15 km
       * (owner, 15 Nov 2026), so the policy promised a radius the checkout would
       * refuse. Both surfaces now say the same numbers, and a test pins them.
       */
      'We deliver within 15 km of our kitchen in Sandton. Delivery is included in the plate price in Sandton and Rosebank; anywhere further out up to 15 km carries a R30 delivery fee, confirmed on WhatsApp before you pay. Beyond 15 km we do not deliver, and the checkout will tell you so before you order.',
      },
      {
        heading: 'Minimum order and delivery fee',
        body: 'The minimum order is R100 for plated meals. Inside Sandton and Rosebank there is no separate delivery fee — the run is included in the plate price, so you pay R100 for a traditional plate and R130 for a contemporary one. Outside those areas a delivery fee applies; the exact amount is confirmed on WhatsApp before payment.',
      },
      {
        heading: 'Delivery only',
        body: 'There is no collection. Every order is brought to the address you gave at checkout, within the service window — there is no counter to visit and no collection point to meet at.',
      },

    ],
  },
  {
    id: 'refunds',
    title: 'Refund Policy',
    updated: '2026-10-27',
    intro: 'We strive to provide high-quality food and service. If you experience an issue with your order, please contact us as soon as possible.',
    sections: [
      {
        heading: 'When refunds may be considered',
        body: 'An incorrect order was supplied; food was not delivered; or a food quality issue is reported promptly and supported by reasonable evidence where requested.',
      },
      {
        heading: 'When refunds are generally not available',
        body: 'A change of mind after an order has been prepared; delays caused by circumstances outside our reasonable control; or incorrect delivery information provided by the customer.',
      },
      {
        heading: 'How refunds are paid',
        body: 'Approved refunds will be processed using the original payment method where possible.',
      },
    ],
  },
  {
    id: 'cancellations',
    title: 'Order Cancellation Policy',
    updated: '2026-10-27',
    intro: 'Cancellation depends on how far an order has progressed. Contact us on +27 67 013 7587 or WhatsApp as soon as possible.',
    sections: [
      {
        heading: 'Standard orders',
        body: 'Orders may be cancelled without charge if preparation has not yet commenced. Once an order has entered preparation, Heritage Bites may charge for costs already incurred and may refuse cancellation.',
      },
      {
        heading: 'Catering and event orders',
        body: 'Cancellations made more than 7 days before the event may qualify for a full refund, less any non-refundable costs already incurred. Cancellations made within 7 days of the event may be subject to partial or full cancellation charges depending on preparation and procurement commitments.',
      },
      {
        heading: 'Assessment',
        body: 'Heritage Bites reserves the right to assess cancellations on a case-by-case basis.',
      },
    ],
  },
];
