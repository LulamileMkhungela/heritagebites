/* Shared public-storefront and API types. */

export type CategoryId = 'traditional' | 'contemporary';

export interface OptionChoice {
  id: string;
  label: string;
  priceDelta: number;
}

export interface MenuOption {
  id: string;
  label: string;
  required?: boolean;
  multiple?: boolean;
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
  items: { id: string; label: string; price: number }[];
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

export type Fulfilment = 'collection' | 'delivery';

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
