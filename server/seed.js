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
export const SEED_VERSION = 5;

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

/** The two confirmed plate prices. The customer picks components within a plate. */
export const plateMenus = [
  {
    id: 'traditional',
    name: 'Traditional Plate',
    price: 100,
    blurb:
      'One protein, one starch and one vegetable side, from the traditional kitchen. Delivery is included in the plate price.',
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
    ],
  },
  {
    id: 'contemporary',
    name: 'Contemporary Plate',
    price: 130,
    blurb:
      'One protein, one starch and one vegetable side, from the contemporary kitchen. Delivery is included in the plate price.',
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
    blurb: 'Starch, protein and a vegetable side. Pap, mabele, samp or dumpling with the pots that carry memory.',
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
  {
    id: 'heritage-pots',
    name: 'Heritage Pots',
    tagline: 'Slow-cooked the way grandmothers taught us',
    blurb: 'Samp, beans and grains — the pots that carry memory.',
    accent: 'chili',
    items: [
      {
        id: 'archive-isistambu', name: 'Isistambu — Samp & Beans', price: 100, image: img('samp-beans'),
        description: 'Samp and sugar beans slow-cooked until creamy, finished with a little butter.',
        status: 'coming-soon',
      },
      {
        id: 'archive-dombolo', name: 'Dombolo', price: 100, image: img('dumplings'),
        description: 'Steamed bread, soft in the middle, made to soak up the gravy on the plate.',
        status: 'coming-soon',
      },
      {
        id: 'archive-motogo', name: 'Motogo wa Mabele', price: 100, image: img('mabele'),
        description: 'Sorghum porridge cooked the old way and served warm, the way it is made at home.',
        status: 'coming-soon',
      },
      // Tlhakwana only ever had a short-rib photo to sit on, and a photo of the
      // wrong dish is worse than no card. It is already on the Traditional menu
      // as a protein, so nothing is lost by leaving it out here.
      // { id: 'archive-tlhakwana', name: 'Tlhakwana', image: img('short-ribs'), status: 'coming-soon' },
    ],
  },
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
    blurb: 'Warm porridge and fresh fat cakes, made the way they are made at home.',
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
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides)],
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
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides)],
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
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides)],
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
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides)],
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
    options: [starchGroup(traditionalStarches), sideGroup(traditionalSides)],
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
    options: [wingsBaste, starchGroup(contemporaryStarches), sideGroup(contemporarySides)],
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
    options: [starchGroup(contemporaryStarches), sideGroup(contemporarySides)],
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
    options: [starchGroup(contemporaryStarches), sideGroup(contemporarySides)],
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

  /* Delivery: included in the plate price, Rosebank and Sandton only. */
  deliveryIncluded: true,
  deliveryFlat: 0,
  freeDeliveryAbove: 0,
  minDeliveryOrder: 100,
  deliveryAreas: ['Rosebank', 'Sandton'],

  /* Collection: a shadow kitchen, so no public street address is published. */
  collectionArea: 'Rosebank & Sandton',
  collectionPoint: 'Standard Bank, Rosebank and Sandton — exact collection point to be confirmed',
  collectionNote: 'We will confirm the exact collection point by WhatsApp when your order is placed.',

  /* Both delivery and collection run inside the service window. */
  serviceWindow: { open: '12:00', close: '13:30' },
  prepEstimateMins: 20,
  deliveryEstimateMins: 30,

  /* Contact form inbox (Formspree), supplied by the business. */
  contactFormspreeUrl: 'https://formspree.io/f/xvkkkwve',

  loyaltyRateCents: 5000,

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
    id: 'delivery-collection',
    title: 'Delivery & Collection',
    updated: '2026-10-27',
    intro: 'Heritage Bites is a shadow kitchen serving Thursdays and Fridays between 12:00 and 13:30.',
    sections: [
      {
        heading: 'Service days and times',
        body: 'We cook and deliver on Thursdays and Fridays only. Delivery and collection both run between 12:00 and 13:30. Orders placed outside those times are recorded as pre-orders for the next service day.',
      },
      {
        heading: 'Delivery areas',
        body: 'We deliver in Rosebank and Sandton only. If your address falls outside those areas we will contact you to arrange collection instead.',
      },
      {
        heading: 'Minimum order and delivery fee',
        body: 'The minimum order is R100 for plated meals. Delivery is included in the plate price — Traditional plates are R100 and Contemporary plates are R130 — so no separate delivery fee is added at checkout.',
      },
      {
        heading: 'Collection',
        body: 'Collection is from our kitchen point at Standard Bank, Rosebank and Sandton. No public street address is published because we operate as a shadow kitchen; we confirm the exact collection point by WhatsApp when your order is placed.',
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
