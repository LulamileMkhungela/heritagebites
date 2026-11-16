import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart, toApiItems, cartSubtotal } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { api, ApiError, STATIC_PREVIEW } from '../lib/api';
import { normalisePhone, zar } from '../lib/format';
import { Button, ContactText, Field, HeritageMark, LinkButton, SectionLabel, WovenRule, inputCls } from '../components/ui';
import { asset } from '../lib/assets';
import { usePageSeo } from '../lib/seo';
import { basketHref } from '../lib/whatsapp';
import { AddressField } from '../components/AddressField';
import { OUTSIDE_AREA, areasNamedIn, defaultDeliveryArea, deliveryAddressProblem, deliveryAreaOptions } from '../../shared/service.js';
import { DELIVERY_ZONES, KITCHEN_ORIGIN, deliveryZoneFor, type AddressSuggestion } from '../lib/address';
import { deniedMessage, requestLocation } from '../lib/geolocation';

/*
 * `cash` is the stored value, and it means cash to the driver.
 *
 * It was `cash-on-collection`, from when collection existed. Collection has
 * been removed, so the value was renamed with it — the server still accepts the
 * old name from a cached client and normalises it, which is why a returning
 * customer with an old bundle is not refused over a string.
 */
type PayMethod = 'card' | 'cash';

type CheckoutCustomer = { name: string; phone: string; email: string; address: string; suburb: string; notes: string };

/**
 * The one rule for "is this order placeable?".
 *
 * Both submit paths ask this — the paid order and the WhatsApp hand-off — so a
 * basket can never reach the kitchen by one route while the other says it is
 * incomplete. It returns the first thing missing in the customer's own words,
 * or `null` when the order is ready.
 *
 * Kept outside the component because it is pure: same input, same answer, which
 * is what makes it testable and what stops the two buttons drifting apart.
 */
export function waValidationProblem(
  customer: CheckoutCustomer,
  fulfilment: 'collection' | 'delivery',
  settings: { deliveryAreas?: string[]; minDeliveryOrder?: number } | undefined,
  addressArea: string | null,
): string | null {
  if (!customer.name.trim()) return 'Add your full name first';
  if (!customer.phone.trim()) return 'Add your cell number first';
  if (normalisePhone(customer.phone).length < 11) return 'That cell number looks too short — check it';
  if (customer.email.trim() && !/^\S+@\S+\.\S+$/.test(customer.email.trim())) {
    return 'That email address does not look right';
  }
  if (fulfilment === 'delivery') {
    if (!customer.suburb.trim()) return 'Choose a delivery area first';
    if (!customer.address.trim()) return 'Add a delivery address first';
    /*
     * A picked suggestion may fill the address without a suburb name the map
     * recognises — Bryanston is a real place with no entry in `deliveryAreas`.
     * That is fine: the area select already says "outside Sandton & Rosebank",
     * and `deliveryAddressProblem` returns null for it.
     */
    /*
     * The address has to belong to the area the customer picked, and the order
     * has to clear the delivery minimum. Both are rules the server enforces on
     * a paid order, so they are checked here too rather than letting WhatsApp
     * carry an order the kitchen would have to refuse.
     */
    const problem = deliveryAddressProblem(customer.address, customer.suburb, settings, addressArea);
    if (problem?.level === 'error') return problem.message;
  }
  return null;
}

/**
 * The delivery rules WhatsApp must not slip past.
 *
 * The paid checkout prices through the server, which enforces the minimum order
 * and the radius. The WhatsApp button does not — it is a link, not a request —
 * so an order could leave the form below the minimum, or from an address nobody
 * ever located, and only be caught by a person reading the chat.
 *
 * Two things are checked here:
 *
 * 1. **Minimum order.** The same R100 the server enforces.
 * 2. **A located address.** "Not in Sandton" is no longer a refusal — the
 *    radius decides — but a radius cannot be checked without coordinates. So the
 *    customer must either pick their address from the list (which carries the
 *    map's own coordinates) or share their location. Without that, the honest
 *    answer is that we cannot confirm we deliver to them, and the order waits.
 *
 * `zone` is the already-computed distance verdict, so the radius rule itself
 * lives in one place (`shared/address.js`) rather than being re-derived here.
 */
export function deliveryGateProblem(
  subtotal: number,
  settings: { minDeliveryOrder?: number; maxDeliveryKm?: number } | undefined,
  zone: { zone: string; distanceKm?: number },
): string | null {
  const min = Number(settings?.minDeliveryOrder ?? 100);
  if (subtotal < min) {
    return `Delivery orders start at ${zar(min)} — add a little more, or message us on WhatsApp about a smaller order.`;
  }
  if (zone.zone === 'refused') {
    return `That address is ${zone.distanceKm} km away — we deliver within ${settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm} km.`;
  }
  if (zone.zone === 'unknown') {
    return 'Pick your address from the list as you type, or tap "Use my current location" — we need one of them to check we can deliver to you.';
  }
  return null;
}

/**
 * Where the tracking token for an order is parked before the customer leaves for
 * Yoco.
 *
 * The return URL Yoco sends them back to has no token of its own, and asking a
 * customer to copy a credential out of an email before they can see their own
 * order is a step they will not take. Kept per order code, and only ever read
 * back on that order's page.
 */
function rememberTracking(code: string, token: string) {
  try {
    window.localStorage.setItem(`hb.track.${code}`, token);
  } catch {
    /* Private mode can refuse storage; the link in the panel still works. */
  }
}

function LiveCheckout() {
  /*
   * A checkout is a form, not a page worth indexing: there is nothing in it to
   * find until somebody has a basket.
   */
  usePageSeo('/checkout', { title: 'Checkout' });
  const nav = useNavigate();
  const catalog = useCatalog((s) => s.data);
  const lines = useCart((s) => s.lines);
  const fulfilment = useCart((s) => s.fulfilment);
  const clear = useCart((s) => s.clear);
  const setQty = useCart((s) => s.setQty);

  const settings = catalog?.settings;
  const payments = catalog?.payments;
  const service = catalog?.service;
  /**
   * Whether the customer can actually reach a Yoco payment page right now.
   * Driven by the server, which knows if the business has supplied a link or
   * keys — never assumed by the page.
   */
  const online = Boolean(payments?.online);
  const [method, setMethodRaw] = useState<PayMethod>('card');
  /*
   * Which cooking day this order is for.
   *
   * Empty means "the next one", which is what an order sent on the day has
   * always meant. A date means the customer booked ahead — the owner's request
   * of 16 Nov 2026 was precisely that nobody should have to wait for the *next*
   * Thursday when a later one suits them better. The list itself comes from the
   * server, so it is the same list the kitchen validates the order against.
   */
  const bookable = catalog?.bookableDates ?? [];
  const [plannedDate, setPlannedDate] = useState('');
  const planned = bookable.find((d) => d.date === plannedDate) ?? null;
  const [customer, setCustomerRaw] = useState({ name: '', phone: '', email: '', address: '', suburb: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  /*
   * Rosebank is where most orders go, so it is the area the checkout opens on.
   *
   * The business asked for it explicitly: "Choose an area" made the customer take
   * a decision before they could place an order at all, and the shop delivers to
   * two areas that sit four kilometres apart. It stays a select — a Sandton
   * customer changes it in one tap, and a typed address that names the other area
   * moves it on its own (see `onAddressChange`).
   */
  const defaultArea = defaultDeliveryArea(settings);
  /*
   * Which delivery area the *picked* address belongs to, according to the map
   * data behind the address suggestions. It is the one piece of evidence the
   * typed text cannot give us: a street line rarely repeats its suburb, so this
   * is what lets the checkout catch "Sandton selected, Rosebank street typed".
   */
  const [addressArea, setAddressArea] = useState<string | null>(null);
  /*
   * Where the address is, and what that means for delivery (owner, 14 Nov 2026).
   *
   * `point` is the map's answer for the address the customer picked — the same
   * coordinates the server will price from. `geo` is the device's own location,
   * which the customer may grant: it is the more honest number when it exists,
   * because it is where the person is standing rather than where the map thinks
   * a house number is. Either can be null, and a null point is never treated as
   * "too far" — an unmeasurable address must not block an order.
   */
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<
    | { status: 'idle' }
    | { status: 'asking' }
    | { status: 'ok'; lat: number; lng: number; accuracyM: number; precise: boolean }
    | { status: 'denied'; reason: 'insecure' | 'blocked' | 'unavailable' | 'timeout' | 'unsupported' }
  >({ status: 'idle' });
  const [quote, setQuote] = useState<{ subtotal: number; delivery: number; total: number } | null>(null);
  const [state, setState] = useState<'idle' | 'quoting' | 'paying'>('idle');
  const [fatal, setFatal] = useState<string | null>(null);
  /*
   * Set once the order exists and Yoco has handed back a payment page. The
   * customer is redirected, but the panel stays on screen with a link: a phone
   * browser with a pop-up blocker, or a Yoco redirect that never fires, would
   * otherwise leave a paid-for cart looking like nothing happened.
   */
  const [redirect, setRedirect] = useState<{ orderCode: string; url: string } | null>(null);

  /* Restore details parked before a trip to WhatsApp. */
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem('hb.checkout.details');
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<typeof customer>;
      setCustomerRaw((current) => ({ ...current, ...parsed }));
    } catch {
      /* Unreadable or absent; the empty form is still usable. */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Card and cash are both accepted on collection *and* on delivery.
   *
   * The kitchen takes card either way — there is a Yoco card machine at the
   * collection point, and the driver brings one to a delivery — so restricting
   * cash to collection only forced a delivery customer into an online payment
   * they may not have been able to make. The choice on screen is now simply the
   * customer's, and it is honoured.
   */
  const method2: PayMethod = method;

  /*
   * What the WhatsApp order message says about payment, in the customer's own
   * terms. Cash orders say cash; card orders ask for the Yoco link, which is how
   * the kitchen takes a card payment when the order came in through the chat.
   */
  const waPayment = method2 === 'cash' ? 'cash' : 'yoco';

  /*
   * Is the kitchen taking automated orders right now? The window comes from the
   * server clock, not the browser's, so a laptop set to the wrong time cannot
   * open the shop.
   *
   * Only *today's window having gone by* stops the shop. Early in the morning
   * and on a rest day the site takes pre-orders for the next window on purpose
   * — the copy above promises exactly that — so those are not `closed`.
   */
  /*
   * Closed *for today* only. A customer who has booked a later cooking day is
   * not asking for today, so the gate must not stop them — the server makes the
   * same distinction, and a page that refuses an order the API would accept is
   * the worst kind of bug: it loses the sale and reports nothing.
   */
  const closedToday = Boolean(service?.orderingClosed);
  /** Closed for *today* and no later day booked — the only state that gates. */
  const closed = closedToday && !planned;


  /*
   * The message is built from the same state the form edits, so what is typed
   * above is exactly what arrives in the chat.
   */
  /*
   * While the window is closed the same basket link has to stop being an order
   * and become a question. The message body still carries the basket, so the
   * kitchen can answer without asking the customer to repeat themselves.
   */
  const waOrderHref = basketHref(settings?.whatsapp, lines, {
    fulfilment,
    customer,
    payment: waPayment,
    ...(planned ? { booking: { label: planned.label, isToday: planned.isToday } } : {}),
    ...(closed && !planned ? { intro: 'Hi Heritage Bites! The ordering window has closed — could you still prepare this for me?' } : {}),
  });

  /*
   * The WhatsApp order is gated on exactly the same rules as the paid one.
   *
   * It used to be possible to tap straight through to WhatsApp with an empty
   * form, which produced a message with no name, no number and — on a delivery —
   * no address, i.e. an order the kitchen had to interrogate before it could
   * cook. The button is now disabled with a reason, and the fields it needs are
   * marked, until the order is actually placeable. Validation lives in one
   * place so the two buttons can never disagree about what "complete" means.
   */
  /*
   * Distance, and what it costs.
   *
   * The rules come from the catalogue so the browser and the server agree; the
   * fallback is the shared default, which means an older server degrades to
   * "delivery is included" rather than to a page that cannot price anything.
   */
  const rules = {
    includedTo: Number(settings?.includedRadiusKm ?? DELIVERY_ZONES.includedTo),
    maxKm: Number(settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm),
    fee: Number(settings?.outsideFee ?? DELIVERY_ZONES.fee),
    origin: settings?.deliveryOrigin ?? KITCHEN_ORIGIN,
  };
  /* The device location wins: it is the customer's own answer to "where are
     you", not the map's guess about a house number. */
  /* The basket's own total, before any delivery fee — what the minimum applies to. */
  const localSubtotal = useMemo(() => lines.reduce((n, l) => n + l.unitPrice * l.qty, 0), [lines]);
  const measured = geo.status === 'ok' ? { lat: geo.lat, lng: geo.lng } : point;
  const zone = deliveryZoneFor(measured?.lat, measured?.lng, rules);
  const tooFar = zone.zone === 'refused';
  const surcharge = zone.zone === 'surcharge' ? Number(zone.fee) : 0;

  const waBlockedBase = waValidationProblem(customer, fulfilment, settings, addressArea);
  /*
   * The order gate sits after the field checks, so the customer is told about the
   * empty box first and the delivery rule second — a radius complaint about a
   * form with no address in it is noise.
   */
  const gate = waBlockedBase ? null : deliveryGateProblem(localSubtotal, settings, zone);
  const waBlocked = waBlockedBase ?? gate;
  const waReady = waBlocked === null;
  /* Point at the fields themselves, not only the message under the button. */
  const waProblems = (() => {
    const e: Record<string, string> = {};
    if (!customer.name.trim()) e.name = 'We need a name for the order.';
    if (!customer.phone.trim()) e.phone = 'We need a number to reach you on.';
    else if (normalisePhone(customer.phone).length < 11) e.phone = 'Please enter a valid South African cell number.';
    if (customer.email.trim() && !/^\S+@\S+\.\S+$/.test(customer.email.trim())) e.email = 'That email does not look right.';
    if (fulfilment === 'delivery') {
      if (!customer.suburb.trim()) e.suburb = 'Which delivery area are you in?';
      if (!customer.address.trim()) e.address = 'Where should we deliver?';
    }
    return e;
  })();

  /*
   * Nothing on the page persists the form, so a customer who taps through to
   * WhatsApp, changes their mind and comes back would find an empty form. The
   * details are parked on the device so the second attempt starts where the
   * first one stopped.
   */
  const rememberWhatsAppDetails = () => {
    try {
      window.sessionStorage.setItem('hb.checkout.details', JSON.stringify(customer));
    } catch {
      /* Private mode can refuse storage; the order itself is unaffected. */
    }
  };

  const setMethod = (next: PayMethod) => {
    setMethodRaw(next);
    setFatal(null);
  };

  /*
   * A declined payment must be recoverable. Editing any field clears the
   * failure banner — otherwise the submit button stays disabled and the
   * customer cannot retry with a different card.
   */
  const setCustomer = (next: typeof customer) => {
    setCustomerRaw(next);
    setFatal(null);
    setErrors((e) => ({ ...e, form: '' }));
  };

  /*
   * Preselect the default area as soon as there is a catalogue to read it from,
   * and again if the customer switches back to delivery after clearing it. It only
   * ever fills a blank: a customer who has chosen Sandton keeps Sandton.
   */
  useEffect(() => {
    if (fulfilment !== 'delivery' || !defaultArea) return;
    if (customer.suburb.trim()) return;
    setCustomerRaw((current) => (current.suburb.trim() ? current : { ...current, suburb: defaultArea }));
  }, [fulfilment, defaultArea, customer.suburb]);

  /* Live, server-authoritative totals. The server re-prices every line from its
     own catalogue, so what is displayed is what will actually be charged. */
  useEffect(() => {
    if (!lines.length) {
      setQuote(null);
      return;
    }
    const t = setTimeout(async () => {
      setState('quoting');
      try {
        /* Coordinates go with the quote so the running total carries the
           surcharge the moment an out-of-area address is picked, instead of
           surprising the customer at the end. */
        const r = await api.quote({
          items: toApiItems(lines),
          fulfilment,
          customer: { lat: measured?.lat ?? null, lng: measured?.lng ?? null },
        });
        setQuote({ subtotal: r.totals.subtotal, delivery: r.totals.delivery, total: r.totals.total });
        setFatal(null);
      } catch (e) {
        setFatal(e instanceof ApiError ? e.errors.join(' ') : 'Could not price your basket.');
      } finally {
        setState('idle');
      }
    }, 320);
    return () => clearTimeout(t);
  }, [lines, fulfilment, measured?.lat, measured?.lng]);

  const shown = quote ?? { subtotal: localSubtotal, delivery: 0, total: localSubtotal };

  /*
   * An order that is already waiting on Yoco keeps its payment page on screen
   * even if the customer edits the basket: the order is fixed, and quietly
   * changing the total would make the page disagree with what Yoco charged.
   */
  const validate = () => {
    const e: Record<string, string> = {};
    if (!customer.name.trim()) e.name = 'We need a name for the order.';
    if (!customer.phone.trim()) e.phone = 'We need a number to reach you on.';
    else if (normalisePhone(customer.phone).length < 11) e.phone = 'Please enter a valid South African cell number.';
    const emailGiven = customer.email.trim();
    if (emailGiven && !/^\S+@\S+\.\S+$/.test(emailGiven)) e.email = 'That email does not look right.';
    if (fulfilment === 'delivery') {
      if (!customer.suburb.trim()) e.suburb = 'Which delivery area are you in?';
      if (!customer.address.trim()) e.address = 'Where should we deliver?';
      /*
       * The address has to belong to the area the customer chose. A hard
       * mismatch is refused here as well as on the server, so the customer is
       * told before paying rather than after the order is rejected.
       */
      if (customer.suburb.trim() && customer.address.trim()) {
        const problem = deliveryAddressProblem(customer.address, customer.suburb, settings, addressArea);
        if (problem?.level === 'error') e.address = problem.message;
      }
      /*
       * The location gate, on the paid path too.
       *
       * The server cannot measure an address it has no coordinates for, and it
       * must not invent a distance — so if nobody located the customer, the
       * order would go through with the radius unchecked. Refusing here is the
       * only way the distance rule means anything: pick the address from the list,
       * or share your location, and the rule can be applied.
       */
      if (zone.zone === 'refused') {
        e.form = `That address is ${zone.distanceKm} km away — we deliver within ${rules.maxKm} km.`;
      } else if (zone.zone === 'unknown' && customer.address.trim()) {
        e.form = 'We could not work out where that address is. Pick it from the list as you type, or tap "Use my current location" — we need one of them to check we can reach you.';
      }
    }
    /* Nothing to check about a card: it is entered on Yoco's page, not here. */
    if (method2 === 'card' && !online) {
      e.form = 'Online payment is not switched on yet — order on WhatsApp instead.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setState('paying');
    setFatal(null);
    try {
      const { order, trackingToken, payment } = await api.placeOrder({
        channel: method2 === 'card' ? 'card' : 'cash',
        fulfilment,
        /* The coordinates are what the server prices the delivery from and what
           it refuses an out-of-range order on. Without them it can only price
           the address as "somewhere in the area", which is how a 40 km order
           used to slip through as included. */
        customer: { ...customer, lat: measured?.lat ?? null, lng: measured?.lng ?? null },
        items: toApiItems(lines),
        payment: { method: method2 },
        /* The day the customer picked. Absent means "the next window", which is
           what the server has always assumed. */
        ...(planned ? { serviceWindow: { date: planned.date } } : {}),
      });

      /* The basket is only emptied once the order exists on the server. */
      clear();
      rememberTracking(order.code, trackingToken);

      if (payment?.redirectUrl) {
        setRedirect({ orderCode: order.code, url: payment.redirectUrl });
        setState('idle');
        /*
         * The customer is usually two screens down the form when this happens.
         * Leaving them there would show the footer of a page whose content has
         * been replaced, and the payment link would be above the fold, unseen.
         */
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        /*
         * Leave for Yoco in the same task as the click, so mobile browsers treat
         * it as part of the gesture. The panel below is the fallback when that
         * redirect is blocked.
         */
        window.location.assign(payment.redirectUrl);
        return;
      }

      nav(`/order/${order.code}?token=${encodeURIComponent(trackingToken)}`);
    } catch (err) {
      setState('idle');
      if (err instanceof ApiError) {
        if (err.code) setFatal(err.errors.join(' '));
        else setErrors({ form: err.errors[0] });
      } else {
        setFatal('Something went wrong. Please try again.');
      }
    }
  };

  /*
   * The hand-off screen, shown after the order exists and before the customer
   * pays. It has to come *before* the empty-basket screen: placing an online
   * order clears the basket, and the empty state would otherwise replace this
   * page and take the payment link with it — exactly when a blocked redirect
   * leaves the customer needing that link.
   */
  if (redirect) {
    return (
      <section className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="text-4xl">🧾</p>
        <h1 className="mt-4 font-display text-3xl font-semibold">Order {redirect.orderCode} is saved</h1>
        <p className="mt-3 text-ink/65">
          The last step is the payment, on Yoco&apos;s secure page. Nothing is cooked until it is paid, and the order
          stays reserved while you pay.
        </p>
        <a
          href={redirect.url}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ochre px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink shadow-[0_2px_0_0_var(--color-ink)] hover:bg-ochre-deep hover:text-bone"
        >
          Continue to Yoco payment
        </a>
        <Link
          to={`/order/${redirect.orderCode}`}
          className="mt-3 inline-flex min-h-11 items-center justify-center text-sm font-semibold text-ochre-deep underline"
        >
          I have paid — show my order
        </Link>
        <p className="mt-4 text-xs leading-relaxed text-ink/50">
          Yoco confirms the payment to us directly, so this page will show it as paid even if you close the tab now.
        </p>
      </section>
    );
  }

  if (!lines.length) {
    return (
      <section className="mx-auto max-w-lg px-4 py-24 text-center">
        {/* The empty state used to be an emoji; the badge is the shop's own mark. */}
        <img
          src={asset('/img/logo-badge-ink.png')}
          alt=""
          width={96}
          height={96}
          className="mx-auto h-24 w-24 object-contain opacity-85"
        />
        <h1 className="mt-4 font-display text-4xl font-semibold">Your basket is empty</h1>
        <p className="mt-3 text-ink/60">Add a plate or two from the menu and come back here to check out.</p>
        <Link to="/menu" className="mt-6 inline-block rounded-full bg-ochre px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink shadow-[0_2px_0_0_var(--color-ink)] hover:bg-ochre-deep hover:text-bone">
          Browse the menu
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex items-center justify-between gap-4">
        <SectionLabel>Checkout</SectionLabel>
        <HeritageMark className="h-7 w-7 text-ink/70" />
      </div>
      <h1 className="font-display text-4xl font-semibold md:text-5xl">Almost there</h1>

      {/*
        Outside the service window the checkout stops taking orders. It used to
        say "you can still place the order now", which contradicted the banner
        directly above it and left the kitchen taking orders at 15:00 for a
        window that had closed at 13:30.

        The way out is a person, not a dead end: the kitchen may still cook for
        you, but that is a conversation. The button carries the basket, so the
        customer does not have to retype what the site already knows.
      */}
      {closed && service && (
        <div className="mt-4 rounded-2xl border-2 border-ochre bg-ochre/10 p-4">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ochre-deep">{service.headline}</p>
          <p className="mt-1 text-[13px] font-medium text-ink">{service.message}</p>
          {/*
            The panel only appears when nothing later is booked, so it never has
            to explain a booking — the day picker below is the way out, and it
            is the honest one: the kitchen cannot cook today, but it can cook
            next Thursday and will say so.
          */}
          <p className="mt-2 text-[13px] leading-relaxed text-ink/70">
            We have stopped taking orders for today, but you can book any cooking day below and check out normally. If
            you need food sooner, message us — the kitchen will tell you whether it can prepare it anyway.
          </p>
          <a
            href={waOrderHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-bold uppercase tracking-wide text-bone hover:bg-ink-2"
          >
            Ask on WhatsApp if we can cook it
          </a>
        </div>
      )}

      <form onSubmit={submit} className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]" noValidate>
        <div className="space-y-8">
          {/*
            Which cooking day.

            The owner's request (16 Nov 2026): "users are not limited in waiting
            for Thursday… they can order in advance for any Thursday/Friday".
            Before this the site only ever named *the next* window, so a
            customer planning a family lunch two weeks out had no way to say so.

            A day, not a date picker: the kitchen cooks two days a week, and a
            free calendar would offer a hundred days it cannot cook on. The
            first choice is "the next cooking day", which is what an order
            placed today means when the customer does not think about it.
          */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Which day?</legend>
            <p className="mt-1 text-xs leading-snug text-ink/55">
              We cook on{' '}
              {bookable.length > 1
                ? `${settings?.hours.filter((h) => !h.closed).map((h) => h.label).join(' and ') ?? 'Thursdays and Fridays'}`
                : 'Thursdays and Fridays'}
              , {settings?.serviceWindow.open}–{settings?.serviceWindow.close}. Book any of them — today is not the
              only option.
            </p>
            {bookable.length === 0 ? (
              <p className="mt-3 text-sm text-ink/60">
                The kitchen has not opened its diary yet. Add the basket and send it on WhatsApp — we will confirm a day
                with you.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {bookable.map((d) => {
                  const on = plannedDate === d.date;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => setPlannedDate(on ? '' : d.date)}
                      aria-pressed={on}
                      className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${on ? 'border-ochre bg-ochre/15 font-semibold' : 'border-ink/12 hover:border-ink/30'}`}
                    >
                      <span className="min-w-0">
                        <span className="block">{d.label}</span>
                        <span className="font-mono text-[11px] text-ink/50">
                          {d.open}–{d.close}
                          {d.isToday && <span className="text-ochre-deep"> · today</span>}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-ochre bg-ochre' : 'border-ink/30 bg-white'}`}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[12px] leading-relaxed text-ink/50">
              {planned
                ? `Booked for ${planned.label}. The order leaves today and the kitchen cooks it on that day — the WhatsApp message says so in as many words.`
                : 'Leave this alone and the kitchen cooks it on the next cooking day, the same way an order placed on the day always has.'}
            </p>
          </fieldset>

          {/* Fulfilment */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Delivery</legend>
            {/*
              There is no collection any more (owner, 14 Nov 2026 — "there is no
              collection, it is delivery based"). It was a pair of radio cards
              with Collect first; with only one option left a card would be a
              button that cannot change anything, so the section states the
              arrangement and lets the customer check their distance instead.
            */}
            <div className="mt-3 rounded-2xl border-2 border-ochre bg-ochre/10 p-4">
              <p className="text-sm font-semibold">Every order is delivered.</p>
              <p className="mt-1 text-xs leading-snug text-ink/60">
                Delivery is included in the plate price in{' '}
                {settings?.deliveryAreas?.join(' and ') ?? 'Sandton and Rosebank'}. Elsewhere a{' '}
                {zar(rules.fee)} delivery fee applies, and we deliver up to {rules.maxKm} km from the kitchen.
              </p>
            </div>
            {/*
              The customer's own location, offered rather than demanded.
              The browser only reveals it with permission, so the button is the
              whole prompt — and the address they pick is still what the food
              goes to. This only answers "how far is it", which is the question
              that decides the fee and whether we can serve them at all.
            */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (geo.status === 'asking') return;
                  setGeo({ status: 'asking' });
                  /* Precise first, then a fallback — see lib/geolocation.ts for
                     why a coarse fix cannot decide a distance boundary honestly. */
                  requestLocation().then((r) => setGeo(r));
                }}
                disabled={geo.status === 'asking'}
              >
                {geo.status === 'asking' ? 'Checking…' : geo.status === 'ok' ? 'Location checked ✓' : 'Use my current location'}
              </Button>
              {zone.zone !== 'unknown' && (
                <span className={`text-xs font-semibold ${tooFar ? 'text-red-700' : zone.zone === 'surcharge' ? 'text-ochre-deep' : 'text-emerald-700'}`} role="status">
                  {tooFar
                    ? `${zone.distanceKm} km away — outside our ${rules.maxKm} km delivery area`
                    : zone.zone === 'surcharge'
                      ? `${zone.distanceKm} km away — ${zar(rules.fee)} delivery fee added`
                      : `${zone.distanceKm} km away — delivery included`}
                </span>
              )}
              {/*
                Shown whenever the button failed, not only when the address is
                still unlocated: a customer who tapped it deserves to be told what
                happened even if they had already picked an address that works.
                Silence reads as a broken button.
              */}
              {geo.status === 'denied' && (
                <span className="text-xs leading-relaxed text-ink/50">{deniedMessage(geo.reason)}</span>
              )}
              {geo.status === 'ok' && !geo.precise && (
                <span className="text-xs text-ink/45">
                  Approximate fix (±{Math.round(geo.accuracyM / 100) / 10} km) — pick your address below for an exact check.
                </span>
              )}
            </div>
            {tooFar && (
              <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-800" role="alert">
                We cannot deliver {zone.distanceKm} km. We would rather tell you now than take your money for food we
                cannot bring you — message us on WhatsApp if you think this is wrong.
              </p>
            )}
            {/*
              No "get the collection point" button here. The order now finishes
              on WhatsApp, and the collection address is sent in that same chat,
              so a button that opens a second conversation only loses the one
              message the kitchen needs.
            */}
            {/*
              Payment belongs to the same question — how the food arrives and how
              it is paid for is one decision, made together at the top of the
              form rather than in its own section at the bottom.
            */}
            <div className="mt-6 border-t-2 border-ink/10 pt-5">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">How do you want to pay?</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {([
                  {
                    id: 'card' as PayMethod,
                    label: 'Card',
                    /*
                     * Card is always offered, because the business can always
                     * take it: on collection there is a Yoco card machine at the
                     * counter, and on delivery the kitchen brings one. When the
                     * online checkout is wired up the customer pays before the
                     * food is cooked instead; that is a difference in *when*, not
                     * in whether card is accepted.
                     */
                    /*
                     * The card blurb follows the fulfilment. Saying "at your
                     * door" to someone collecting is simply wrong, and it was
                     * doing exactly that: the copy was written once for delivery
                     * and never branched.
                     */
                    blurb: online ? "Card or instant EFT on Yoco's secure page" : 'Pay the driver by card at the door',
                    show: true,
                  },
                  {
                    id: 'cash' as PayMethod,
                    label: 'Cash',
                    blurb: 'Pay the driver on delivery',
                    show: true,
                  },
                ]).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    aria-pressed={method2 === m.id}
                    className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all ${method2 === m.id ? 'border-ochre bg-ochre/10' : 'border-ink/12 hover:border-ink/30'}`}
                  >
                    <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${method2 === m.id ? 'border-ochre bg-ochre' : 'border-ink/25'}`}>
                      {method2 === m.id && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{m.label}</span>
                      <span className="block text-xs text-ink/55">{m.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>

              {/*
                One short line, whatever the payment state. The order finishes on
                WhatsApp either way, so that chat is where the Yoco link arrives —
                and card works for delivery too, because the kitchen carries a
                Yoco card machine. No paragraph about what is not connected.
              */}
              {method2 === 'card' && online && (
                <p className="mt-3 text-xs leading-relaxed text-ink/55">
                  You&apos;ll pay on Yoco&apos;s secure page. We send the payment link on WhatsApp.
                </p>
              )}
              {!online && (
                <p className="mt-3 text-xs leading-relaxed text-ink/55">
                  Secure Yoco payment — card or instant EFT — is sent as a link in your WhatsApp chat.
                </p>
              )}
              {/*
                The payment blurbs above already say how card works for the
                chosen fulfilment, so this line only needs to exist when online
                checkout is off and the customer must be told a link is coming.
              */}
            </div>

            {/*
              The rules follow the fulfilment. The minimum order is a DELIVERY
              rule (server/index.js only applies it when fee < 0 for delivery),
              so quoting a minimum to someone collecting invents a restriction
              the kitchen does not actually impose.
            */}
            <p className="mt-4 text-xs leading-relaxed text-ink/50">
              {fulfilment === 'delivery' ? (
                <>
                  Minimum order {zar(settings?.minDeliveryOrder ?? 100)}. Delivery included in
                  {' '}{settings?.deliveryAreas?.join(' & ') ?? 'Sandton & Rosebank'}
                  {surcharge > 0 ? ` — ${zar(surcharge)} added for your address` : ''}.
                </>
              ) : (
                <>No minimum order and no delivery fee — you pay the plate price only.</>
              )}{' '}
              Thursdays and Fridays, {settings?.serviceWindow.open}–{settings?.serviceWindow.close}.
            </p>
          </fieldset>

          {/* Details */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Your details</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors.name}>
                <input className={inputCls} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="name" placeholder="Thabo Mahlangu" />
              </Field>
              <Field label="Cell number" hint="so we can contact you" error={errors.phone}>
                <input className={inputCls} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} autoComplete="tel" placeholder="+27 82 000 0000" />
              </Field>
              <Field label="Email" hint="optional — for a written reply" error={errors.email}>
                <input className={inputCls} value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} autoComplete="email" type="email" placeholder="you@example.co.za" />
              </Field>
              {fulfilment === 'delivery' && (
                <Field label="Delivery area" hint={defaultArea ? `${defaultArea} preselected` : undefined} error={errors.suburb}>
                  {/*
                    The two included suburbs, and "Other — outside Sandton &
                    Rosebank".
                    
                    The third option is not a nicety: the rules are distance-based
                    (inside the two suburbs delivery is included, outside them a
                    fee applies, past the limit we refuse). A customer in Bryanston
                    had no honest answer here — only two suburbs that were both
                    wrong — which is how a radius became a two-suburb list.
                    
                    No empty "Choose an area" row: that turned this into a
                    required decision before anyone could order.
                  */}
                  <select className={inputCls} value={customer.suburb} onChange={(e) => setCustomer({ ...customer, suburb: e.target.value })}>
                    {deliveryAreaOptions(settings).map((area) => (
                      <option key={area} value={area}>{area}</option>
                    ))}
                  </select>
                </Field>
              )}
              {fulfilment === 'delivery' && (
                <div className="sm:col-span-2">
                  {/*
                    Suggestions come from OpenStreetMap (free, keyless) and fill
                    the street line; picking one also knows its suburb, which is
                    what makes the area check trustworthy rather than a guess at
                    the spelling of a street name.
                  */}
                  <AddressField
                    address={customer.address}
                    area={customer.suburb}
                    settings={settings}
                    hintArea={addressArea}
                    error={errors.address}
                    onChange={(value) => {
                      /*
                       * The area follows the address when the address names one.
                       *
                       * With Rosebank preselected, a Sandton customer who types
                       * "12 Oxford Road, Sandton" would otherwise be told they
                       * picked the wrong area — a decision they never made. Moving
                       * the select to the area the address actually names is the
                       * honest reading of it: the address decides where the food
                       * goes, and the select is there to break a tie.
                       *
                       * Only one unambiguous name moves it. "Corner Rosebank Road
                       * and Sandton Drive" leaves the choice alone, and the
                       * contradiction check below still catches a customer who
                       * deliberately switches the area afterwards.
                       */
                      const named = areasNamedIn(value, settings);
                      const followed = named.length === 1 ? named[0] : customer.suburb;
                      setCustomer({ ...customer, address: value, suburb: followed });
                      /* Typing over a picked address drops its map evidence. */
                      setAddressArea(null);
                      setPoint(null);
                      setErrors((e) => ({ ...e, address: '', suburb: '' }));
                    }}
                    onPick={(suggestion: AddressSuggestion) => {
                      setCustomer({
                        ...customer,
                        address: suggestion.line,
                        /*
                         * Autofill the area the kitchen actually delivers to —
                         * or "Other" when the picked address is outside the two
                         * included suburbs. Leaving the old value would keep the
                         * select on Sandton for a Bryanston house and bring back
                         * the contradiction this whole change removes.
                         */
                        suburb: suggestion.area ?? OUTSIDE_AREA,
                      });
                      setAddressArea(suggestion.area);
                      /*
                       * Keep the map's own coordinates. They are the evidence
                       * the distance gate runs on, and the server prices from
                       * the same pair — which is what stops the basket saying
                       * "included" for an address the server charges a fee for.
                       */
                      setPoint(
                        Number.isFinite(suggestion.lat) && Number.isFinite(suggestion.lng)
                          ? { lat: Number(suggestion.lat), lng: Number(suggestion.lng) }
                          : null,
                      );
                      setErrors((e) => ({ ...e, address: '', suburb: '' }));
                    }}
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <Field label="Notes for the kitchen" hint="optional">
                  <input className={inputCls} value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} placeholder="Extra hot, no salsa, ring on arrival…" />
                </Field>
              </div>
            </div>
            {/*
              One line. Email receipts needed SMTP configured on the host before
              a single message could go out, and telling a customer about that
              machinery was noise in the middle of a checkout. The order finishes
              on WhatsApp, so the record they actually get is that chat.
            */}
            <p className="mt-3 text-xs leading-relaxed text-ink/50">
              No email receipts — your WhatsApp chat is the record of this order, and we send updates there.
            </p>
          </fieldset>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
            <div className="border-b-2 border-ink/10 px-5 py-4">
              <h2 className="font-display text-xl font-semibold">Order summary</h2>
              <p className="text-xs text-ink/50">
                {lines.reduce((n, l) => n + l.qty, 0)} {lines.reduce((n, l) => n + l.qty, 0) === 1 ? 'item' : 'items'} · {fulfilment}
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto px-5 py-3">
              {lines.map((l) => (
                <div key={l.key} className="flex items-start gap-3 border-b border-ink/8 py-3 last:border-0">
                  <img src={l.image} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-tight">{l.name}</p>
                    {l.picks.length > 0 && <p className="text-xs leading-snug text-ink/50">{l.picks.map((p) => p.label).join(' · ')}</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <button type="button" onClick={() => setQty(l.key, l.qty - 1)} className="grid h-11 w-11 place-items-center rounded-full border border-ink/20 text-sm hover:bg-ink hover:text-bone" aria-label="Decrease">−</button>
                      <span className="font-mono text-xs">{l.qty}</span>
                      <button type="button" onClick={() => setQty(l.key, l.qty + 1)} className="grid h-11 w-11 place-items-center rounded-full border border-ink/20 text-sm hover:bg-ink hover:text-bone" aria-label="Increase">+</button>
                    </div>
                  </div>
                  <span className="font-mono text-[13px] font-semibold">{zar(l.unitPrice * l.qty)}</span>
                </div>
              ))}
            </div>

            <div className="border-t-2 border-ink/10 px-5 py-4">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-ink/60">
                  <span>Subtotal {state === 'quoting' && <span className="text-ink/30">· updating…</span>}</span>
                  <span className="font-mono">{zar(shown.subtotal)}</span>
                </div>
                {fulfilment === 'delivery' && (
                  <div className="flex justify-between text-ink/60">
                    <span>Delivery</span>
                    <span className="font-mono">
                      {shown.delivery > 0 ? zar(shown.delivery) : 'Free'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-ink/10 pt-2 text-lg font-bold">
                  <span>Total</span>
                  <span className="font-mono">{zar(shown.total)}</span>
                </div>
              </div>

                {fatal && (
                  <p className="mt-3 rounded-xl border-2 border-chili bg-chili/10 p-3 text-[12px] font-medium text-chili" role="alert">
                    <ContactText>{fatal}</ContactText>
                  </p>
                )}
                {errors.form && <p className="mt-3 text-[12px] font-medium text-chili">{errors.form}</p>}

              {/*
                Only disabled while a request is in flight. Keeping it disabled
                after a decline would leave the customer staring at an error and
                a dead button — retrying must stay possible, and the server
                re-validates and re-charges on every attempt anyway.
              */}
              {/*
                One primary action, and a second way out that always works.
                The order finishes on WhatsApp, so the second button is not a
                fallback bolted on afterwards — it is the same order, sent to the
                chat where the Yoco link and the collection address arrive.
              */}
              <Button
                type="submit"
                size="lg"
                block
                className="mt-4"
                disabled={state === 'paying' || (method2 === 'card' && !online) || closed}
              >
                {closed
                  ? 'Ordering closed for today'
                  : state === 'paying'
                    ? 'Saving your order…'
                    : method2 === 'card' && !online
                      ? 'Online payment coming soon'
                      : `Place order · ${zar(shown.total)}`}
              </Button>

              {waReady ? (
                <a
                  href={waOrderHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={rememberWhatsAppDetails}
                  className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border-2 border-ink bg-white px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-bone"
                >
                  {closed ? 'Ask on WhatsApp if we can cook it' : 'Complete order on WhatsApp'}
                </a>
              ) : (
                /*
                 * A disabled anchor cannot be a link at all: pointing it at
                 * wa.me would still let a click through, so it renders as a
                 * button that refuses and says what is missing.
                 */
                <button
                  type="button"
                  onClick={() => setErrors(waProblems)}
                  aria-disabled="true"
                  className="mt-2 inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border-2 border-ink/25 bg-ink/5 px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink/40"
                >
                  Complete order on WhatsApp
                </button>
              )}

              <p className={`mt-3 text-xs leading-relaxed ${waReady ? 'text-ink/55' : 'font-medium text-chili'}`}>
                {closed
                  ? 'The window has closed, so this sends your basket as a question rather than an order. If the kitchen can still prepare it, someone will reply and arrange payment with you.'
                  : waReady
                    ? `Your order goes to WhatsApp with every detail already filled in — name, number, the basket, the delivery address, and your notes. Send it and we confirm, then pay ${method2 === 'cash' ? 'cash to the driver' : 'by secure Yoco link or card'}.`
                    : `${waBlocked}. Fill that in above and this button opens WhatsApp with the whole order.`}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink/45">
                By ordering you agree to our{' '}
                <Link to="/policies" className="font-semibold text-ochre-deep underline">terms, delivery and refund policies</Link>.
              </p>
              <WovenRule className="mt-4 h-1.5 w-24 text-ink/60" />
            </div>
          </div>

          {/*
            The dark "Rather order on WhatsApp?" card used to sit here, holding a
            second copy of the same basket link. The order now finishes on
            WhatsApp from a button under the primary one, so this card only
            duplicated it and made the page read as if WhatsApp were somewhere
            else to go and shop.
          */}
        </aside>
      </form>
    </section>
  );
}


/* --------------------------- Static preview ---------------------------- */

/**
 * The GitHub Pages build has no API, so there is no server to price an order,
 * take a payment or store a tracking token.
 *
 * It must still do the job a customer came for, though: choose the payment
 * method, give their details, say where they are, and arrive at WhatsApp with
 * all of it already written out. That is the whole ordering journey minus the
 * parts that need a server — and an earlier version of this page skipped the
 * form entirely, so the only thing a customer could send was a basket with no
 * name, no address and no idea how they wanted to pay.
 *
 * What is genuinely absent here, and is said plainly rather than hidden:
 *
 *  - **Online card payment.** Yoco needs the API (a server-side secret and a
 *    webhook), so on the static build there is no card option at all — the
 *    kitchen sends a payment link in the chat instead. This is the honest
 *    answer to "can I pay online right now": not through this page.
 *  - **A server-checked total.** The basket is priced from the published plate
 *    prices and the kitchen confirms the total in the chat.
 *
 * Everything the customer typed still travels: the message that opens WhatsApp
 * is the same `basketMessage` the live site uses, so the two paths cannot
 * describe an order differently.
 */
function PreviewCheckout() {
  const catalog = useCatalog((s) => s.data);
  const lines = useCart((s) => s.lines);
  const fulfilment = useCart((s) => s.fulfilment);
  const settings = catalog?.settings;

  const [customer, setCustomer] = useState({ name: '', phone: '', address: '', suburb: '', notes: '' });
  const [method, setMethod] = useState<'link' | 'cash'>('link');
  /*
   * The same day choice the live checkout offers. On the static build the
   * kitchen reads it in the WhatsApp message, which is the only record there is
   * — so it matters more here, not less.
   */
  const bookable = catalog?.bookableDates ?? [];
  const [plannedDate, setPlannedDate] = useState('');
  const planned = bookable.find((d) => d.date === plannedDate) ?? null;
  /*
   * The coordinates of the address the customer *picked*, as opposed to the ones
   * their device reported. The published site needs both: the address box is the
   * route for anyone who will not share a location, and the distance rule is the
   * whole point of asking.
   */
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  /* Area the picked suggestion belongs to, so the check uses the map's answer. */
  const [addressArea, setAddressArea] = useState<string | null>(null);
  const [geo, setGeo] = useState<
    | { status: 'idle' }
    | { status: 'asking' }
    | { status: 'ok'; lat: number; lng: number; accuracyM: number; precise: boolean }
    | { status: 'denied'; reason: 'insecure' | 'blocked' | 'unavailable' | 'timeout' | 'unsupported' }
  >({ status: 'idle' });

  const rules = {
    includedTo: Number(settings?.includedRadiusKm ?? DELIVERY_ZONES.includedTo),
    maxKm: Number(settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm),
    fee: Number(settings?.outsideFee ?? DELIVERY_ZONES.fee),
    origin: settings?.deliveryOrigin ?? KITCHEN_ORIGIN,
  };
  /* The device fix wins; the picked address is the fallback — same order as the
     live checkout, so the two pages can never price the same order differently. */
  const measured = geo.status === 'ok' ? { lat: geo.lat, lng: geo.lng } : point;
  const zone = deliveryZoneFor(measured?.lat, measured?.lng, rules);
  const tooFar = zone.zone === 'refused';
  const subtotal = cartSubtotal(lines);

  /*
   * The same rule the live checkout applies, and the same reason for it: the
   * radius cannot be checked without coordinates, so the order may not
   * leave until the customer has given them.
   */
  const problem =
    !lines.length
      ? 'Your basket is empty.'
      : !customer.name.trim()
        ? 'Add your full name first'
        : !customer.phone.trim()
          ? 'Add your cell number first'
          : normalisePhone(customer.phone).length < 11
            ? 'That cell number looks too short — check it'
            : !customer.address.trim()
              ? 'Add a delivery address first'
              : !customer.suburb.trim()
                ? 'Choose a delivery area first'
                : tooFar
                  ? `That address is ${zone.distanceKm} km away — we deliver within ${rules.maxKm} km.`
                  : zone.zone === 'unknown'
                    ? 'Pick your address from the list as you type, or tap "Use my current location" — we need one of them to check we can deliver to you.'
                    : null;

  const wa = basketHref(settings?.whatsapp, lines, {
    fulfilment,
    payment: method === 'cash' ? 'cash' : 'yoco',
    customer,
    ...(planned ? { booking: { label: planned.label, isToday: planned.isToday } } : {}),
  });

  return (
    <section className="mx-auto max-w-5xl px-4 py-14">
      <SectionLabel>Checkout</SectionLabel>
      <h1 className="font-display text-4xl font-semibold md:text-5xl">Finish your order</h1>
      <p className="mt-3 max-w-2xl text-ink/65">
        Give us your details and where to deliver, then send the order on WhatsApp. The kitchen confirms the total and
        the cooking day before anything is paid.
      </p>

      <form onSubmit={(e) => e.preventDefault()} className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {/* Which cooking day — the same choices the live checkout offers. */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Which day?</legend>
            <p className="mt-1 text-xs leading-snug text-ink/55">
              We cook Thursdays and Fridays, {settings?.serviceWindow.open}–{settings?.serviceWindow.close}. Book any of
              them — today is not the only option.
            </p>
            {bookable.length === 0 ? (
              <p className="mt-3 text-sm text-ink/60">
                The diary is not open for booking on this build. Add the basket and send it on WhatsApp — we will confirm
                a day with you.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {bookable.map((d) => {
                  const on = plannedDate === d.date;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => setPlannedDate(on ? '' : d.date)}
                      aria-pressed={on}
                      className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-all ${on ? 'border-ochre bg-ochre/15 font-semibold' : 'border-ink/12 hover:border-ink/30'}`}
                    >
                      <span className="min-w-0">
                        <span className="block">{d.label}</span>
                        <span className="font-mono text-[11px] text-ink/50">
                          {d.open}–{d.close}
                          {d.isToday && <span className="text-ochre-deep"> · today</span>}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-ochre bg-ochre' : 'border-ink/30 bg-white'}`}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {planned && (
              <p className="mt-3 text-[12px] leading-relaxed text-ink/50">
                Your WhatsApp message will open with “order placed today, for {planned.label}”, so the kitchen knows
                which day to cook it for.
              </p>
            )}
          </fieldset>

          {/* Payment */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">How do you want to pay?</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                { id: 'link' as const, label: 'Payment link', blurb: 'We send a Yoco link in the chat' },
                { id: 'cash' as const, label: 'Cash', blurb: 'Pay the driver on delivery' },
              ]).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  aria-pressed={method === m.id}
                  className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all ${method === m.id ? 'border-ochre bg-ochre/10' : 'border-ink/12 hover:border-ink/30'}`}
                >
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${method === m.id ? 'border-ochre bg-ochre' : 'border-ink/25'}`}>
                    {method === m.id && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block text-xs text-ink/55">{m.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            {/*
              The honest answer to "can I pay online": not on this page. Card
              payment needs the live site, because Yoco needs a server to start
              the payment and a webhook to confirm it. Saying so beats a greyed
              out button nobody explains.
            */}
            <p className="mt-3 text-xs leading-relaxed text-ink/50">
              No card is taken on this page. Online card payment switches on with the live site; until then we send you a
              secure Yoco link in the chat, and you pay there.
            </p>
          </fieldset>

          {/* Details */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">Your details</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <input className={inputCls} value={customer.name} autoComplete="name" placeholder="Thabo Mahlangu" onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              </Field>
              <Field label="Cell number" hint="so we can contact you">
                <input className={inputCls} value={customer.phone} autoComplete="tel" placeholder="+27 82 000 0000" onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
              </Field>
              <Field label="Delivery area">
                <select className={inputCls} value={customer.suburb} onChange={(e) => setCustomer({ ...customer, suburb: e.target.value })}>
                  <option value="">Choose an area</option>
                  {deliveryAreaOptions(settings).map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                {/*
                  The same address box as the live checkout, on purpose.
                  The owner's complaint — "house number, street and suburb it must
                  be pulled from when u capture address" — was about this page too:
                  the published site had a plain text input, so no address carried
                  coordinates and the radius could not be checked at all. Picking a
                  suggestion here fetches the map's coordinates, which is what makes
                  the delivery check below mean something.
                */}
                <AddressField
                  address={customer.address}
                  area={customer.suburb}
                  settings={settings}
                  hintArea={addressArea}
                  onChange={(value) => {
                    setCustomer({ ...customer, address: value });
                    /* Typing over a picked address drops its map evidence. */
                    setAddressArea(null);
                    setPoint(null);
                  }}
                  onPick={(suggestion: AddressSuggestion) => {
                    setCustomer({ ...customer, address: suggestion.line, suburb: suggestion.area ?? OUTSIDE_AREA });
                    setAddressArea(suggestion.area);
                    setPoint(
                      Number.isFinite(suggestion.lat) && Number.isFinite(suggestion.lng)
                        ? { lat: Number(suggestion.lat), lng: Number(suggestion.lng) }
                        : null,
                    );
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <Field label="Notes for the kitchen" hint="optional">
                  <input className={inputCls} value={customer.notes} placeholder="Extra hot, no salsa, ring on arrival…" onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
                </Field>
              </div>
            </div>

            {/* Location: the same gate as the live checkout. */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={geo.status === 'asking'}
                onClick={() => {
                  setGeo({ status: 'asking' });
                  requestLocation().then((r) => setGeo(r));
                }}
              >
                {geo.status === 'asking' ? 'Checking…' : geo.status === 'ok' ? 'Location checked ✓' : 'Use my current location'}
              </Button>
              {zone.zone !== 'unknown' && (
                <span className={`text-xs font-semibold ${tooFar ? 'text-red-700' : zone.zone === 'surcharge' ? 'text-ochre-deep' : 'text-emerald-700'}`} role="status">
                  {tooFar
                    ? `${zone.distanceKm} km away — outside our ${rules.maxKm} km delivery area`
                    : zone.zone === 'surcharge'
                      ? `${zone.distanceKm} km away — ${zar(rules.fee)} delivery fee added`
                      : `${zone.distanceKm} km away — delivery included`}
                </span>
              )}
              {/* Same two notes as the live checkout: a refused button must say
                  why, and a coarse fix must be labelled as coarse. */}
              {geo.status === 'denied' && (
                <span className="text-xs leading-relaxed text-ink/50">{deniedMessage(geo.reason)}</span>
              )}
              {geo.status === 'ok' && !geo.precise && (
                <span className="text-xs text-ink/45">
                  Approximate fix (±{Math.round(geo.accuracyM / 100) / 10} km) — pick your address below for an exact check.
                </span>
              )}
            </div>
            {tooFar && (
              <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-800" role="alert">
                We cannot deliver {zone.distanceKm} km. We would rather tell you now than take your money for food we cannot
                bring you.
              </p>
            )}
          </fieldset>
        </div>

        {/* Basket */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <h2 className="font-display text-2xl font-semibold">Your basket</h2>
            {lines.length === 0 ? (
              <p className="mt-3 text-sm text-ink/60">Nothing in the basket yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-ink/10">
                {lines.map((l) => (
                  <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{l.qty} × {l.name}</span>
                      {l.picks.length > 0 && (
                        <span className="mt-0.5 block text-[12px] text-ink/50">{l.picks.map((p) => p.label).join(' · ')}</span>
                      )}
                    </span>
                    <span className="font-mono text-sm tabular-nums">{zar(l.unitPrice * l.qty)}</span>
                  </li>
                ))}
              </ul>
            )}

            {lines.length > 0 && (
              <p className="mt-4 flex items-baseline justify-between border-t-2 border-ink/10 pt-4">
                <span className="text-sm font-semibold">Subtotal · delivery</span>
                <span className="font-display text-2xl font-bold text-ochre-deep">{zar(subtotal)}</span>
              </p>
            )}

            <p className="mt-3 text-xs leading-relaxed text-ink/45">
              Delivery is included in Sandton and Rosebank; outside them a fee applies, and we deliver up to{' '}
              {rules.maxKm} km. The kitchen confirms the total with you before anything is charged.
            </p>

            <div className="mt-5 flex flex-col gap-3">
              {problem ? (
                <span className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-full border-2 border-ink/25 bg-ink/5 px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink/40">
                  Order on WhatsApp
                </span>
              ) : (
                <LinkButton href={wa} variant="primary">Order on WhatsApp</LinkButton>
              )}
              <p className={`text-xs leading-relaxed ${problem ? 'font-medium text-chili' : 'text-ink/55'}`}>{problem ?? 'Opens WhatsApp with your order, details and payment choice already written out.'}</p>
              <LinkButton to="/menu" variant="outline">Back to the menu</LinkButton>
            </div>
          </div>
        </aside>
      </form>
    </section>
  );
}

export default function Checkout() {
  /*
   * A checkout is a form, not a page worth indexing: there is nothing in it to
   * find until somebody has a basket.
   */
  usePageSeo('/checkout', { title: 'Checkout' });
  return STATIC_PREVIEW ? <PreviewCheckout /> : <LiveCheckout />;
}
