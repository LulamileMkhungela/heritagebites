/* Shared public-storefront and API types. */

export type CategoryId = 'traditional' | 'contemporary';

export interface OptionChoice {
  id: string;
  label: string;
  priceDelta: number;
  /**
   * How many of this extra the customer may take. Absent means one.
   *
   * This is the difference between a choice and an extra. A starch is a choice:
   * one, and picking another replaces it. Two ginger beers is an extra, and on a
   * delivery order it is the single most common thing a customer wants to say —
   * Uber Eats puts a stepper on every add-on for exactly that reason. Before
   * this, "2 ginger beers" meant adding the whole plate twice.
   */
  max?: number;
}

export interface MenuOption {
  id: string;
  label: string;
  required?: boolean;
  /** True when the option holds several answers (a starch and a side, both). */
  multiple?: boolean;
  /** How many answers a `multiple` option may hold. One when absent. */
  max?: number;
  /**
   * True when this option is an add-on sold *alongside* the dish rather than
   * included in its price — the soft drink. Only a priced option may charge for
   * itself, and only a priced option carries a count; everything else is part of
   * the plate and its `priceDelta` is zero.
   */
  priced?: boolean;
  choices: OptionChoice[];
}

export interface MenuItem {
  id: string;
  /** Fixed-price plate this dish belongs to (`traditional` or `contemporary`). */
  plateId?: string;
  name: string;
  localName: string;
  language: string;
  pronunciation: string;
  category: CategoryId;
  price: number;
  image: string;
  /** True while the business has not supplied a photo of the dish. */
  imagePending?: boolean;
  description: string;
  story: string;
  tags: string[];
  spice: number;
  prepMins: number;
  serves: number;
  rating: number;
  orders: number;
  available: boolean;
  options: MenuOption[];
}

export interface Category {
  id: CategoryId;
  name: string;
  tagline: string;
  blurb: string;
  accent: string;
}

/* ------------------------------ Archive ------------------------------- */

/**
 * A dish from the kitchen archive. It reads like a normal menu card — photo,
 * name, price and a description — but there is no option list, no add-to-basket
 * control and nothing in `menu`, so the only way to buy one is for the kitchen
 * to put it back on sale.
 */
export interface ComingSoonItem {
  id: string;
  name: string;
  /** Indicative price for when the dish returns; a guide, not a quote. */
  price: number;
  description: string;
  image: string;
  status: 'coming-soon';
}

export interface ComingSoonCategory {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  accent: string;
  items: ComingSoonItem[];
}

export interface PlateGroup {
  id: string;
  label: string;
  required: boolean;
  max: number;
  items: {
    id: string;
    label: string;
    price: number;
    /** How many of this item one plate may carry. One when absent. */
    max?: number;
  }[];
  /**
   * True for the one group sold *alongside* the plate rather than included in
   * it — the soft drink. Its item prices are charged on top of the plate price;
   * every other group's items are included and their amounts are ignored.
   */
  priced?: boolean;
}

export interface PlateMenu {
  id: string;
  name: string;
  price: number;
  blurb: string;
  image: string;
  groups: PlateGroup[];
}

export interface Settings {
  storeName: string;
  tagline: string;
  currency: string;
  phone: string;
  phoneDisplay: string;
  whatsapp: string;
  email: string;
  established: number;
  deliveryIncluded: boolean;
  deliveryFlat: number;
  freeDeliveryAbove: number;
  minDeliveryOrder: number;
  deliveryAreas: string[];
  /**
   * Delivery is free inside `includedRadiusKm` of the kitchen, charged
   * `outsideFee` outside it, and refused past `maxDeliveryKm`.
   *
   * Optional because a catalogue served by an older API build has no such
   * fields; every reader falls back to the shared defaults in
   * `shared/address.js`, so an old server degrades to "everything is included"
   * rather than to a crash.
   */
  outsideFee?: number;
  outsideFeeNote?: string;
  maxDeliveryKm?: number;
  deliveryOrigin?: { lat: number; lng: number };
  includedRadiusKm?: number;
  /**
   * Google reviews. `googleReviewUrl` is the link the button uses; when it is
   * empty the whole review surface hides, because a "Review us" button with no
   * destination is worse than no button.
   */
  googlePlaceId?: string;
  googlePlaceName?: string;
  googleReviewUrl?: string;
  /** Retired with collection; empty, and no surface reads it as an address. */
  collectionArea: string;
  collectionPoint: string;
  collectionNote: string;
  serviceWindow: { open: string; close: string };
  prepEstimateMins: number;
  deliveryEstimateMins: number;
  contactFormspreeUrl: string;
  loyaltyRateCents: number;
  channels: Record<string, { label: string; url: string; enabled: boolean }>;
  hours: { day: number; label: string; open?: string; close?: string; closed?: boolean }[];
  /**
   * One-off trading days beyond the weekly rhythm — a Saturday market, a holiday
   * trading day. ISO dates ("2026-11-21") or richer objects with their own
   * window. Empty unless the business has signed one off; see server/seed.js.
   */
  specialServiceDays?: (string | { date: string; open?: string; close?: string; label?: string; note?: string })[];
}

/** Where the kitchen is in its weekly Thursday/Friday rhythm. */
export interface ServiceStatus {
  open: boolean;
  /**
   * True only once today's window has already closed — the one state where the
   * checkout refuses an order outright. Before opening and on rest days the
   * site takes a pre-order for the next window instead.
   */
  orderingClosed: boolean;
  /** True when today is one of the days the kitchen cooks at all. */
  isServiceDay: boolean;
  /** True when today's opening comes from `specialServiceDays`, not the weekly rhythm. */
  specialToday?: boolean;
  /** Short, human status: "Serving now", "Wednesday is a rest day", … */
  headline: string;
  /** One-liner for the site-wide status strip. */
  shortMessage: string;
  timeZone: string;
  dayLabel: string;
  timeLabel: string;
  windowLabel: string;
  todayLabel: string;
  nextWindowLabel: string | null;
  message: string;
  serviceDays: string[];
}

/** One cooking day a customer can order for, from `bookableDates()`. */
export interface BookableDate {
  /** "YYYY-MM-DD", the value sent with the order. */
  date: string;
  /** "Friday 4 Dec" — what the customer reads. */
  label: string;
  shortLabel?: string;
  dayLabel: string;
  open: string;
  close: string;
  isToday?: boolean;
  special?: boolean;
}

/**
 * What the server says about taking money.
 *
 * `online` is the only field the checkout should trust to decide whether to show
 * a "pay online" option: it is false until the business has supplied a Yoco
 * payment link or keys, and offering the option before then would cost the
 * customer the whole form.
 */
export interface PaymentConfig {
  provider: 'yoco';
  online: boolean;
  mode: 'api' | 'link' | 'off';
  /** True when the server creates the checkout, so the amount cannot be edited. */
  exactAmount: boolean;
  cashOnCollection: boolean;
  cashOnDelivery: boolean;
}

export interface PolicySection {
  heading: string;
  body: string;
}

export interface Policy {
  id: string;
  title: string;
  updated: string;
  intro: string;
  sections: PolicySection[];
}

export interface Catalog {
  categories: Category[];
  /** Categories from before the two-tier menu, shown view only. */
  comingSoon: ComingSoonCategory[];
  menu: MenuItem[];
  plateMenus: PlateMenu[];
  policies: Policy[];
  settings: Settings;
  service: ServiceStatus;
  /**
   * The cooking days a customer can book ahead, nearest first. Served by the
   * API from the same shared rule it validates an order against, so the day the
   * checkout offers is always a day the kitchen will accept.
   */
  bookableDates?: BookableDate[];
  payments: PaymentConfig;
  contact: { inboxConfigured: boolean };
  /**
   * Which automatic channels are live. Push is the only one now; email alerts
   * were removed because they needed SMTP configured on the host.
   */
  notifications?: { push: boolean };
  today: number;
}

/* ------------------------------- Cart --------------------------------- */

export interface CartOptionPick {
  /** The option group id, e.g. "starch". */
  optionId: string;
  /** The choice id inside that group, e.g. "pap" — this is what the API expects. */
  choiceId: string;
  label: string;
  priceDelta: number;
  /**
   * How many of this extra, on a line that already exists. Absent means one.
   *
   * Stored per line rather than folded into the price so the basket can explain
   * itself: "2 × Ginger gemere · R50" is information, and a silent R50 on the
   * plate price is not. It also keeps the customer's own quantity intact when
   * the server re-prices the line.
   */
  qty?: number;
}

export interface CartLine {
  /** Stable key for the line — item id plus its chosen options. */
  key: string;
  itemId: string;
  name: string;
  image: string;
  unitPrice: number;
  qty: number;
  picks: CartOptionPick[];
  /** 'menu' lines are a dish card; 'plate' lines come from the plate builder. */
  kind: 'menu' | 'plate';
  /** Which fixed-price plate menu a 'plate' line belongs to. */
  plateId?: string;
}

/**
 * Delivery only (owner, 14 Nov 2026 — "there is no collection, it is delivery
 * based").
 *
 * `'collection'` stays in the union because orders and carts created before
 * the change still carry it: a stored order's tracking page and a returning
 * customer's saved basket both need to keep rendering instead of throwing. No
 * surface offers it any more, and `store/cart.ts` migrates a saved cart to
 * delivery on load.
 */
export type Fulfilment = 'delivery' | 'collection';

/** The only fulfilment a new order can have. */
export const DEFAULT_FULFILMENT: Fulfilment = 'delivery';

export interface Totals {
  subtotal: number;
  delivery: number;
  discount: number;
  total: number;
  currency: string;
}

/* ------------------------------ Orders -------------------------------- */

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out-for-delivery'
  | 'completed'
  | 'cancelled';

export interface TimelineStep {
  status: OrderStatus;
  label: string;
  note: string;
  at: string | null;
  done: boolean;
  current: boolean;
}

export interface ServiceWindow {
  plannedFor: string | null;
  isPreOrder: boolean;
  label: string;
}

/**
 * One past order, as the loyalty card may show it.
 *
 * Its shape is decided by what the lookup is allowed to publish: a receipt a
 * customer could hold in their hand — the code, the date, the food, the money and
 * where the order got to. No tracking token (that is the key to the order page)
 * and no address (that is where they live), because the card is opened with a
 * cell number alone.
 */
export interface PastOrder {
  code: string;
  createdAt: string;
  status: OrderStatus;
  statusLabel: string;
  items: {
    itemId: string;
    name: string;
    qty: number;
    unitPrice: number;
    options: { id: string; label: string; qty: number }[];
  }[];
  total: number;
  paymentMethod: string;
  paymentStatus: string;
}

export interface Order {
  id: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  statusMeta: { label: string; short: string; tone: string; note: string };
  channel: string;
  fulfilment: Fulfilment;
  fulfilmentLabel: string;
  customer: { name: string; phone: string };
  /**
   * Always null. Kept so an older cached client reading this payload cannot
   * claim a receipt was emailed — no receipt email exists any more.
   */
  receiptEmail: string | null;
  /** Always 'none', for the same reason as `receiptEmail`. */
  receiptState: 'none' | 'queued' | 'sent' | 'failed';
  items: { itemId: string; name: string; unitPrice: number; qty: number; options: { label: string }[]; lineTotal: number }[];
  totals: Totals;
  payment: {
    method: string;
    /** 'pending' | 'awaiting_payment' | 'approved' | … — only a webhook approves. */
    status: string;
    reference: string | null;
    last4: string | null;
    brand: string | null;
    /** Yoco's payment page, kept so an unpaid order can be resumed. */
    redirectUrl?: string | null;
  };
  timeline: TimelineStep[];
  whatsapp: string;
  phone: string;
  serviceWindow: ServiceWindow | null;
  deliveryArea: string | null;
  loyalty: { pointsEarned: number; pointsRedeemed: number };
  canCancel: boolean;
}
