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
export const SEED_VERSION = 9;

const img = (name) => `/img/${name}.jpg`;
const PLACEHOLDER = '/img/plate-placeholder.svg';

/* --------------------------------------------------------------------- */
/* Menu structure                                                         */
/* --------------------------------------------------------------------- */

/*
 * Both plate menus are built from the same three decisions — starch, protein,
 * vegetable side — and are priced per plate, not per component. Every option
 * carries a zero price delta because the plate price already includes it.
 */
const traditionalStarches = [
  { id: 'pap', label: 'Pap', priceDelta: 0 },
  { id: 'mabele', label: 'Mabele (sorghum)', priceDelta: 0 },
  { id: 'samp', label: 'Samp', priceDelta: 0 },
  { id: 'dumpling', label: 'Dumpling', priceDelta: 0 },
];

const traditionalSides = [
  { id: 'braised-cabbage', label: 'Braised cabbage', priceDelta: 0 },
  { id: 'spinach', label: 'Spinach', priceDelta: 0 },
  { id: 'morogo', label: 'Morogo', priceDelta: 0 },
  { id: 'salsa', label: 'Salsa', priceDelta: 0 },
  /* Added on the owner's instruction (14 Nov 2026). Included in the plate price. */
  { id: 'chakalaka', label: 'Chakalaka', priceDelta: 0 },
  { id: 'atchaar', label: 'Atchaar', priceDelta: 0 },
  { id: 'green-salad', label: 'Green salad', priceDelta: 0 },
];

const contemporaryStarches = [
  { id: 'potato-mash', label: 'Potato mash', priceDelta: 0 },
  { id: 'savoury-rice', label: 'Savoury rice', priceDelta: 0 },
  { id: 'baby-potatoes', label: 'Baby potatoes', priceDelta: 0 },
  { id: 'cous-cous', label: 'Cous cous', priceDelta: 0 },
  { id: 'garlic-bread', label: 'Garlic bread', priceDelta: 0 },
];

const contemporarySides = [
  { id: 'braised-cabbage', label: 'Braised cabbage', priceDelta: 0 },
  { id: 'spinach', label: 'Spinach', priceDelta: 0 },
  { id: 'salsa', label: 'Salsa', priceDelta: 0 },
  { id: 'green-salad', label: 'Green salad', priceDelta: 0 },
  { id: 'corn-ribs', label: 'Corn ribs', priceDelta: 0 },
  { id: 'glazed-carrots', label: 'Glazed carrots', priceDelta: 0 },
];

const starchGroup = (choices, id = 'starch') => ({
  id,
  label: 'Choose your starch',
  required: true,
  choices,
});

const sideGroup = (choices, id = 'veg') => ({
  id,
  label: 'Choose your vegetable side',
  required: true,
  choices,
});

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
      'One protein, one starch and one vegetable side, from the traditional kitchen.',
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
      { id: 'starch', label: 'Choose your starch', required: true, max: 1, items: traditionalStarches.map((c) => ({ id: c.id, label: c.label, price: 100 })) },
      { id: 'veg', label: 'Choose your vegetable side', required: true, max: 1, items: traditionalSides.map((c) => ({ id: c.id, label: c.label, price: 100 })) },
      drinksGroup(),
    ],
  },
  {
    id: 'contemporary',
    name: 'Contemporary Plate',
    price: 130,
    blurb:
      'One protein, one starch and one vegetable side, from the contemporary kitchen.',
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
      { id: 'starch', label: 'Choose your starch', required: true, max: 1, items: contemporaryStarches.map((c) => ({ id: c.id, label: c.label, price: 130 })) },
      { id: 'veg', label: 'Choose your vegetable side', required: true, max: 1, items: contemporarySides.map((c) => ({ id: c.id, label: c.label, price: 130 })) },
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
];

/* --------------------------------------------------------------------- */
/* Coming soon — the kitchen archive                                      */
/* --------------------------------------------------------------------- */

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
      {
        id: 'archive-motogo-magwinya', name: 'Motogo & Magwinya', price: 45, image: img('mabele'),
        description: 'Warm sorghum porridge with two fat cakes on the side.',
        status: 'coming-soon',
      },
      // The breakfast plate had no photograph of its own.
      // { id: 'archive-breakfast-plate', name: 'Heritage Breakfast Plate', image: img('magwinya'), status: 'coming-soon' },
    ],
  },
  {
    id: 'sides-relishes',
    name: 'Sides & Relishes',
    tagline: 'The things that make the plate',
    blurb: 'Chakalaka, atchaar and stywe pap — the supporting cast that steals the show.',
    accent: 'sky',
    items: [
      {
        id: 'archive-chakalaka', name: 'Chakalaka', price: 35, image: img('chakalaka'),
        description: 'Spicy carrot, bean and pepper relish, cooked down until it is sweet and hot.',
        status: 'coming-soon',
      },
      {
        id: 'archive-atchaar', name: 'Atchaar', price: 30, image: img('atchaar'),
        description: 'Tangy mango atchaar, made in the kitchen and spooned over the plate.',
        status: 'coming-soon',
      },
      {
        id: 'archive-stywe-pap', name: 'Stywe Pap', price: 30, image: img('pap-cabbage'),
        description: 'Stiff maize pap, the traditional partner to a braai or a pot of mogodu.',
        status: 'coming-soon',
      },
      // Braised cabbage was photographed as chakalaka, so it waits for a photo.
      // { id: 'archive-braised-cabbage', name: 'Braised Cabbage', image: img('chakalaka'), status: 'coming-soon' },
    ],
  },
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
    name: 'Mogodu Plate',
    localName: 'Mogodu',
    language: 'Setswana / Sepedi',
    pronunciation: 'mo-GOH-doo',
    category: 'traditional',
    price: 100,
    image: img('plate-mogodu'),
    description: 'Beef tripe, slow-cooked in a rich onion-and-tomato gravy, with one starch and one vegetable side.',
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
    name: 'Tshotlo Plate',
    localName: 'Tshotlo',
    language: 'Setswana',
    pronunciation: 'CHOH-tloh',
    category: 'traditional',
    price: 100,
    image: img('plate-tshotlo'),
    description: 'Pounded beef cooked until it pulls apart, with one starch and one vegetable side.',
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
    name: 'Chicken Hardbody Plate',
    localName: 'Hardbody',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    image: img('plate-chicken-hardbody'),
    description: 'Chicken cooked hardbody style in a savoury gravy, with one starch and one vegetable side.',
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
    name: 'Tlhakwana Plate',
    localName: 'Tlhakwana',
    language: 'Setswana',
    pronunciation: 'tla-KWAH-na',
    category: 'traditional',
    price: 100,
    image: PLACEHOLDER,
    imagePending: true,
    description: 'Beef trotters braised until the gravy turns glossy, with one starch and one vegetable side.',
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
    name: 'Smiley Plate',
    localName: 'Smiley',
    language: '',
    pronunciation: '',
    category: 'traditional',
    price: 100,
    image: PLACEHOLDER,
    imagePending: true,
    description: 'Sheep head, cooked and served the traditional way, with one starch and one vegetable side.',
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
    description: 'Chicken wings basted to order — honey soy or chilli sriracha — with one starch and one vegetable side.',
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
    description: 'BBQ beef short rib, grilled and glazed, with one starch and one vegetable side.',
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
    description: 'Lamb stewed until tender in a rich gravy, with one starch and one vegetable side.',
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
   * Delivery-only pricing, on the owner's instruction (14 Nov 2026).
   *
   * `deliveryIncluded` above still describes the Sandton/Rosebank run: inside
   * that ring the plate price is the whole price. Outside it, `outsideFee` is
   * added, and past `maxDeliveryKm` the checkout refuses the order instead of
   * quoting for it. Collection was removed at the same time, so there is no
   * counter price any more — `deliveryFlat: 0` is the honest default because
   * the included ring owes nothing, and the surcharge is a separate field.
   *
   * THE FEE IS A GUESS. The owner has the number; R30 is placeholder. It is
   * read from here by the server, the basket and the checkout, so replacing
   * this one value updates the entire site.
   */
  outsideFee: 30,
  outsideFeeNote: 'Outside Sandton and Rosebank we add a delivery fee, confirmed on WhatsApp before you pay.',
  maxDeliveryKm: 50,
  deliveryOrigin: { lat: -26.126, lng: 28.049 },
  includedRadiusKm: 6,

  /*
   * Collection: REMOVED (owner, 14 Nov 2026 — "there is no collection, it is
   * delivery based"). The three fields stay in the schema because the type and
   * a few legacy surfaces read them, but nothing in the customer's path offers
   * collection any more. They are cleared rather than left pointing at a
   * collection point that no longer exists.
   */
  collectionArea: '',
  collectionPoint: '',
  collectionNote: '',

  /* Both delivery and collection run inside the service window. */
  serviceWindow: { open: '12:00', close: '13:30' },
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
        body: 'When you place an order, submit an enquiry, make a reservation, or contact us, we may collect your name and surname, contact number, email address, delivery or collection address, and payment-related information processed through secure third-party providers.',
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
        body: 'Customers must provide accurate information when placing orders, and are responsible for ensuring delivery or collection details are correct.',
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
    /* The id is stable on purpose: it is a URL fragment, and renaming it breaks
       every saved link to this policy and the test that pins the list. */
    id: 'delivery-collection',
    title: 'Delivery',
    updated: '2026-11-14',
    intro: 'Heritage Bites is a delivery-only kitchen serving Thursdays and Fridays between 12:00 and 13:30.',
    sections: [
      {
        heading: 'Service days and times',
        body: 'We cook and deliver on Thursdays and Fridays only. Delivery and collection both run between 12:00 and 13:30. Orders placed outside those times are recorded as pre-orders for the next service day.',
      },
      {
        heading: 'Delivery areas',
        body: 'We deliver everywhere within 50 km of our kitchen in Sandton. Delivery is included in the plate price in Sandton and Rosebank; anywhere further out up to 50 km carries a delivery fee, confirmed on WhatsApp before you pay. Beyond 50 km we do not deliver, and the checkout will tell you so before you order.',
      },
      {
        heading: 'Minimum order and delivery fee',
        body: 'The minimum order is R100 for plated meals. Inside Sandton and Rosebank there is no separate delivery fee — the run is included in the plate price, so you pay R100 for a traditional plate and R130 for a contemporary one. Outside those areas a delivery fee applies; the exact amount is confirmed on WhatsApp before payment.',
      },
      {
        heading: 'No collection',
        body: 'We are a delivery-only kitchen. There is no counter to collect from and no collection point; every order is brought to the address you gave at checkout, within the service window.',
      },
      {
        heading: 'Preparation and delivery estimates',
        body: 'Plated meals are prepared to order and typically need about 20 minutes. Delivery in Rosebank and Sandton usually takes about 30 minutes from dispatch, within the 12:00 to 13:30 service window.',
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
