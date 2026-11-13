import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart, toApiItems, cartSubtotal } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { api, ApiError, STATIC_PREVIEW } from '../lib/api';
import { normalisePhone, zar } from '../lib/format';
import { Button, ContactText, Field, HeritageMark, LinkButton, SectionLabel, WovenRule, inputCls } from '../components/ui';
import { asset } from '../lib/assets';
import { usePageSeo } from '../lib/seo';
import { basketHref, waChatHref } from '../lib/whatsapp';
import { AddressField } from '../components/AddressField';
import { areasNamedIn, defaultDeliveryArea, deliveryAddressProblem } from '../../shared/service.js';
import type { AddressSuggestion } from '../lib/address';

type PayMethod = 'card' | 'cash-on-collection';

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
  const setFulfilment = useCart((s) => s.setFulfilment);
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
  const waPayment = method2 === 'cash-on-collection' ? 'cash' : 'yoco';

  /*
   * The message is built from the same state the form edits, so what is typed
   * above is exactly what arrives in the chat.
   */
  const waOrderHref = basketHref(settings?.whatsapp, lines, { fulfilment, customer, payment: waPayment });

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
  const waBlocked = waValidationProblem(customer, fulfilment, settings, addressArea);
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

  /* How the delivery fee reads on the card and in the footer. */
  const deliveryFee = Number(settings?.deliveryFlat ?? 0);
  const freeAbove = Number(settings?.freeDeliveryAbove ?? 0);
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
        const r = await api.quote({ items: toApiItems(lines), fulfilment });
        setQuote({ subtotal: r.totals.subtotal, delivery: r.totals.delivery, total: r.totals.total });
        setFatal(null);
      } catch (e) {
        setFatal(e instanceof ApiError ? e.errors.join(' ') : 'Could not price your basket.');
      } finally {
        setState('idle');
      }
    }, 320);
    return () => clearTimeout(t);
  }, [lines, fulfilment]);

  const localSubtotal = useMemo(() => lines.reduce((n, l) => n + l.unitPrice * l.qty, 0), [lines]);
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
        customer,
        items: toApiItems(lines),
        payment: { method: method2 },
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
        <HeritageMark className="h-8 w-8" />
      </div>
      <h1 className="font-display text-4xl font-semibold md:text-5xl">Almost there</h1>

      {service && !service.open && (
        <div className="mt-4 rounded-2xl border-2 border-ochre bg-ochre/10 p-4">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ochre-deep">{service.headline}</p>
          <p className="mt-1 text-[13px] font-medium text-ink">{service.message}</p>
          <p className="mt-1 text-[12px] text-ink/60">
            You can still place the order now — we just cannot cook or deliver it until then.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]" noValidate>
        <div className="space-y-8">
          {/* Fulfilment */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-xs uppercase tracking-[0.2em] text-ochre-deep">How do you want it?</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                {
                  id: 'collection',
                  t: 'Collect',
                  d: `Pay the plate price only — nothing added. We send the exact collection point on WhatsApp with your order.`,
                },
                {
                  id: 'delivery',
                  t: 'Deliver',
                  d: `${settings?.deliveryAreas.join(' & ') ?? 'Rosebank & Sandton'} only. ${deliveryFee > 0 ? `Flat ${zar(deliveryFee)}${freeAbove > 0 ? `, free from ${zar(freeAbove)}` : ''}` : 'Included'}.`,
                },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFulfilment(f.id)}
                  aria-pressed={fulfilment === f.id}
                  className={`rounded-2xl border-2 p-4 text-left transition-all ${fulfilment === f.id ? 'border-ochre bg-ochre/10' : 'border-ink/12 hover:border-ink/30'}`}
                >
                  <span className="block font-semibold">{f.t}</span>
                  <span className="mt-1 block text-xs leading-snug text-ink/55">{f.d}</span>
                </button>
              ))}
            </div>
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
                    blurb: online
                      ? "Card or instant EFT on Yoco's secure page"
                      : 'Pay by card — machine at collection, or at your door',
                    show: true,
                  },
                  {
                    id: 'cash-on-collection' as PayMethod,
                    label: 'Cash',
                    blurb: fulfilment === 'delivery' ? 'Pay the driver on delivery' : 'Pay when you collect',
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
              {fulfilment === 'delivery' && (
                <p className="mt-1.5 text-xs leading-relaxed text-ink/55">
                  Delivery can be paid by card (we bring a Yoco card machine) or in cash.
                </p>
              )}
            </div>

            <p className="mt-4 text-xs leading-relaxed text-ink/50">
              Minimum order {zar(settings?.minDeliveryOrder ?? 100)}. Delivery {deliveryFee > 0 ? zar(deliveryFee) : 'included'} in
              {' '}{settings?.deliveryAreas?.join(' & ') ?? 'Rosebank & Sandton'}{freeAbove > 0 && deliveryFee > 0 ? `, free from ${zar(freeAbove)}` : ''}.
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
                    No empty "Choose an area" row: it turned a two-option select
                    into a required decision, and every order in the shop is in one
                    of these two areas. A typed address that belongs to the other
                    one moves this on its own.
                  */}
                  <select className={inputCls} value={customer.suburb} onChange={(e) => setCustomer({ ...customer, suburb: e.target.value })}>
                    {(settings?.deliveryAreas ?? []).map((area) => (
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
                      setErrors((e) => ({ ...e, address: '', suburb: '' }));
                    }}
                    onPick={(suggestion: AddressSuggestion) => {
                      setCustomer({
                        ...customer,
                        address: suggestion.line,
                        /* Autofill the area the kitchen actually delivers to. */
                        suburb: suggestion.area ?? customer.suburb,
                      });
                      setAddressArea(suggestion.area);
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
                disabled={state === 'paying' || (method2 === 'card' && !online)}
              >
                {state === 'paying'
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
                  Complete order on WhatsApp
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
                {waReady
                  ? 'Your order goes to WhatsApp with every detail already filled in — name, number, the basket, the delivery address if you chose delivery, and your notes. Send it and we confirm, then pay by secure Yoco link or cash.'
                  : `${waBlocked}. Fill that in above and this button opens WhatsApp with the whole order.`}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink/45">
                By ordering you agree to our{' '}
                <Link to="/policies" className="font-semibold text-ochre-deep underline">terms, delivery and refund policies</Link>.
              </p>
              <WovenRule className="mt-4 h-2 w-28" />
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
 * The GitHub Pages build has no API, so a live checkout would show a basket,
 * quote nothing and fail at the last step. Rather than a broken form, a preview
 * shows the basket honestly: what is in it, what it comes to at the published
 * plate prices, and how to order for real today.
 */
function PreviewCheckout() {
  const catalog = useCatalog((s) => s.data);
  const lines = useCart((s) => s.lines);
  const fulfilment = useCart((s) => s.fulfilment);
  /* The whole basket, not just the shop's number: this button is the only way
     to order from the preview, so it has to arrive pre-filled. */
  const wa = lines.length
    ? basketHref(catalog?.settings?.whatsapp, lines, { fulfilment })
    : waChatHref(catalog?.settings?.whatsapp);

  return (
    <section className="mx-auto max-w-3xl px-4 py-14">
      <SectionLabel>Checkout</SectionLabel>
      <h1 className="font-display text-4xl font-semibold md:text-5xl">Preview checkout</h1>
      <p className="mt-3 max-w-2xl text-ink/65">
        This is a preview build of the site, so no payment is taken and no order is created here.
        Your basket is still real — send it to us on WhatsApp and we will cook it.
      </p>

      <div className="mt-8 rounded-[2rem] border-2 border-ink/10 bg-white p-6">
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
            <span className="text-sm font-semibold">Subtotal · {fulfilment === 'delivery' ? 'delivery' : 'collection'}</span>
            <span className="font-display text-2xl font-bold text-ochre-deep">{zar(cartSubtotal(lines))}</span>
          </p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-ink/45">
          Prices are the published plate prices. Delivery in Rosebank and Sandton is included; the minimum order is R100.
          The live site will confirm the total with the kitchen before anything is charged.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <LinkButton href={wa} variant="primary">
            {lines.length ? 'Order this on WhatsApp' : 'Chat to us on WhatsApp'}
          </LinkButton>
          <LinkButton to="/menu" variant="outline">Back to the menu</LinkButton>
        </div>
      </div>
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
