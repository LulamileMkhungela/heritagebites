import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart, toApiItems, cartSubtotal } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { api, ApiError, STATIC_PREVIEW } from '../lib/api';
import { detectCardBrand, formatCardNumber, formatExpiry, luhnValid, normalisePhone, zar } from '../lib/format';
import { Button, Field, LinkButton, Reveal, SectionLabel, inputCls } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type PayMethod = 'card' | 'cash-on-collection';

const TEST_CARDS = [
  { label: 'Approved (Visa)', number: '4242 4242 4242 4242' },
  { label: 'Approved (Mastercard)', number: '5555 5555 5555 4444' },
  { label: 'Declined', number: '4000 0000 0000 0002' },
  { label: 'Needs 3-D Secure', number: '4000 0000 0000 3220' },
];

const YOCO_SDK_SRC = 'https://js.yoco.com/sdk/v1/yoco-sdk-web.js';

/** Load Yoco's hosted-checkout SDK once, in the browser, only when it is needed. */
function loadYocoSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser'));
  if ((window as unknown as { YocoSDK?: unknown }).YocoSDK) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${YOCO_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Yoco SDK failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = YOCO_SDK_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Yoco SDK failed to load'));
    document.head.appendChild(script);
  });
}

interface YocoPayment {
  id: string;
  amountCents: number;
}

function LiveCheckout() {
  useDocumentTitle('Checkout');
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
  const liveCards = Boolean(payments?.hostedCheckout && payments.publicKey);

  const [method, setMethodRaw] = useState<PayMethod>('card');
  const [customer, setCustomerRaw] = useState({ name: '', phone: '', email: '', address: '', suburb: '', notes: '' });
  const [card, setCardRaw] = useState({ number: '', expiry: '', cvc: '', holder: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<{ subtotal: number; delivery: number; total: number } | null>(null);
  const [state, setState] = useState<'idle' | 'quoting' | 'paying'>('idle');
  const [fatal, setFatal] = useState<string | null>(null);
  // A card that needs 3-D Secure is not a decline. It gets its own state so the
  // customer is told what to do rather than shown a red error and a dead end.
  const [needsAction, setNeedsAction] = useState<string | null>(null);
  const [yoco, setYoco] = useState<YocoPayment | null>(null);
  const [yocoError, setYocoError] = useState<string | null>(null);
  const [openingYoco, setOpeningYoco] = useState(false);

  /*
   * Cash is only accepted on collection (the business confirmed cash on
   * collection, not cash on delivery), so switching to delivery moves the
   * payment method back to card rather than letting the choice linger.
   */
  const cashAllowed = fulfilment === 'collection' && payments?.cashOnCollection !== false;
  const method2: PayMethod = method === 'cash-on-collection' && !cashAllowed ? 'card' : method;
  const setMethod = (next: PayMethod) => {
    setMethodRaw(next);
    setFatal(null);
    setNeedsAction(null);
    setYocoError(null);
  };

  /*
   * A declined payment must be recoverable. Editing any field clears the
   * failure banner — otherwise the submit button stays disabled and the
   * customer cannot retry with a different card.
   */
  const setCustomer = (next: typeof customer) => {
    setCustomerRaw(next);
    setFatal(null);
    setNeedsAction(null);
    setErrors((e) => ({ ...e, form: '' }));
  };
  const setCard = (next: typeof card) => {
    setCardRaw(next);
    setFatal(null);
    setNeedsAction(null);
    setErrors((e) => ({ ...e, form: '' }));
  };

  const needsCard = method2 === 'card' && !liveCards;

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

  const brand = detectCardBrand(card.number);
  const cardNumberOk = luhnValid(card.number);

  /*
   * A Yoco payment is tied to the amount it was taken for. If the basket or
   * fulfilment changes afterwards the authorisation no longer matches, so it is
   * cleared and the customer is asked to pay again rather than posting a
   * checkout id for a different total.
   */
  useEffect(() => {
    if (!yoco) return;
    if (yoco.amountCents !== Math.round(shown.total * 100)) {
      setYoco(null);
      setYocoError('Your total changed, so the card payment needs to be taken again.');
    }
  }, [shown.total, yoco]);

  const openYoco = async () => {
    setYocoError(null);
    setFatal(null);
    setOpeningYoco(true);
    const amountCents = Math.round(shown.total * 100);
    try {
      await loadYocoSdk();
      const Sdk = (window as unknown as { YocoSDK: new (o: { publicKey: string }) => { showPopup: (o: Record<string, unknown>) => void } }).YocoSDK;
      const sdk = new Sdk({ publicKey: payments?.publicKey ?? '' });
      sdk.showPopup({
        amountInCents: amountCents,
        currency: 'ZAR',
        name: 'Heritage Bites',
        description: `${lines.reduce((n, l) => n + l.qty, 0)} plate(s) · ${fulfilment}`,
        callback: (result: { error?: { message?: string }; id?: string }) => {
          setOpeningYoco(false);
          if (result?.error) {
            setYocoError(result.error.message ?? 'That card payment was not completed.');
            return;
          }
          if (result?.id) setYoco({ id: result.id, amountCents });
        },
      });
    } catch {
      setOpeningYoco(false);
      setYocoError(
        'We could not open the secure card window. Try again, or choose cash on collection and pay when you collect.',
      );
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!customer.name.trim()) e.name = 'We need a name for the order.';
    if (!customer.phone.trim()) e.phone = 'We need a number to reach you on.';
    else if (normalisePhone(customer.phone).length < 11) e.phone = 'Please enter a valid South African cell number.';
    if (customer.email && !/^\\S+@\\S+\\.\\S+$/.test(customer.email)) e.email = 'That email does not look right.';
    if (fulfilment === 'delivery') {
      if (!customer.suburb.trim()) e.suburb = 'Which delivery area are you in?';
      if (!customer.address.trim()) e.address = 'Where should we deliver?';
    }
    if (needsCard) {
      if (!cardNumberOk) e.number = 'That card number is not valid.';
      if (!/^\d{2}\/\d{2}$/.test(card.expiry)) e.expiry = 'Use MM/YY.';
      if (!/^\d{3,4}$/.test(card.cvc)) e.cvc = '3 or 4 digits.';
      if (!card.holder.trim()) e.holder = 'Name as printed on the card.';
    }
    if (method2 === 'card' && liveCards && !yoco) {
      e.form = 'Please complete the card payment in the secure Yoco window first.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setState('paying');
    setFatal(null);
    setNeedsAction(null);
    try {
      const payment =
        method2 === 'card'
          ? liveCards
            ? { method: 'card', checkoutId: yoco?.id }
            : { method: 'card', card }
          : { method: method2 };

      const { order, trackingToken } = await api.placeOrder({
        channel: method2 === 'card' ? 'card' : 'cash',
        fulfilment,
        customer,
        items: toApiItems(lines),
        payment,
      });
      clear();
      nav(`/order/${order.code}?token=${encodeURIComponent(trackingToken)}`);
    } catch (err) {
      setState('idle');
      if (err instanceof ApiError) {
        if (err.requiresAction) {
          setNeedsAction(err.errors.join(' '));
        } else if (err.code) setFatal(err.errors.join(' '));
        else setErrors({ form: err.errors[0] });
      } else {
        setFatal('Something went wrong. Please try again.');
      }
    }
  };

  if (!lines.length) {
    return (
      <section className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-4xl">🧺</p>
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
      <SectionLabel>Checkout</SectionLabel>
      <h1 className="font-display text-4xl font-semibold md:text-5xl">Almost there</h1>

      {service && !service.open && (
        <div className="mt-4 rounded-2xl border-2 border-ochre bg-ochre/10 p-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ochre-deep">{service.headline}</p>
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
            <legend className="px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ochre-deep">How do you want it?</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                {
                  id: 'collection',
                  t: 'Collect',
                  d: `From ${settings?.collectionPoint ?? 'our Standard Bank Rosebank kitchen'}. We confirm the exact point by WhatsApp.`,
                },
                {
                  id: 'delivery',
                  t: 'Deliver',
                  d: `${settings?.deliveryAreas.join(' & ') ?? 'Rosebank & Sandton'} only. Delivery is included in the plate price.`,
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
                  <span className="mt-1 block text-[11px] leading-snug text-ink/55">{f.d}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink/50">
              Minimum order {zar(settings?.minDeliveryOrder ?? 100)}. Service window {settings?.serviceWindow.open}–
              {settings?.serviceWindow.close} on Thursdays and Fridays.
            </p>
          </fieldset>

          {/* Details */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ochre-deep">Your details</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors.name}>
                <input className={inputCls} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="name" placeholder="Thabo Mahlangu" />
              </Field>
              <Field label="Cell number" hint="so we can contact you" error={errors.phone}>
                <input className={inputCls} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} autoComplete="tel" placeholder="+27 82 000 0000" />
              </Field>
              <Field label="Email" hint="for your receipt" error={errors.email}>
                <input className={inputCls} value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} autoComplete="email" type="email" placeholder="you@example.co.za" />
              </Field>
              {fulfilment === 'delivery' && (
                <Field label="Delivery area" error={errors.suburb}>
                  <select className={inputCls} value={customer.suburb} onChange={(e) => setCustomer({ ...customer, suburb: e.target.value })}>
                    <option value="">Choose an area</option>
                    {(settings?.deliveryAreas ?? []).map((area) => (
                      <option key={area} value={area}>{area}</option>
                    ))}
                  </select>
                </Field>
              )}
              {fulfilment === 'delivery' && (
                <div className="sm:col-span-2">
                  <Field label="Delivery address" error={errors.address} hint="house number, street and suburb">
                    <input className={inputCls} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} autoComplete="street-address" placeholder="12 Oxford Road, Illovo" />
                  </Field>
                </div>
              )}
              <div className="sm:col-span-2">
                <Field label="Notes for the kitchen" hint="optional">
                  <input className={inputCls} value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} placeholder="Extra hot, no salsa, ring on arrival…" />
                </Field>
              </div>
            </div>
            {/*
              Both free channels explained where the customer is actually
              entering an address, rather than buried in a policy page: email is
              automatic, WhatsApp is a tap. No promise of an automated WhatsApp
              message is made, because one cannot be sent for free.
            */}
            <p className="mt-3 text-[11px] leading-relaxed text-ink/50">
              {customer.email.trim()
                ? 'We email your receipt and a private tracking link to that address as soon as the order is placed. '
                : 'Add an email and we will send your receipt and a private tracking link. '}
              The kitchen gets the order the moment you place it; WhatsApp replies come from a person, so they are not instant.
            </p>
          </fieldset>

          {/* Payment */}
          <fieldset className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <legend className="px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ochre-deep">Payment</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                {
                  id: 'card' as PayMethod,
                  label: 'Card',
                  blurb: liveCards ? 'Visa & Mastercard, secured by Yoco' : 'Visa & Mastercard (test mode)',
                  show: true,
                },
                {
                  id: 'cash-on-collection' as PayMethod,
                  label: 'Cash on collection',
                  blurb: 'Pay when you collect',
                  show: cashAllowed,
                },
              ].filter((m) => m.show)).map((m) => (
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
                    <span className="block text-[11px] text-ink/55">{m.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            {fulfilment === 'delivery' && (
              <p className="mt-2 text-[11px] text-ink/50">Delivery orders are paid by card. Cash is accepted on collection only.</p>
            )}

            {method2 === 'card' && liveCards && (
              <div className="animate-rise mt-5 rounded-2xl border-2 border-ink/10 bg-bone/70 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-ink/50">Secure card payment</span>
                  <span className="flex items-center gap-2 text-[11px] text-ink/50">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                    Secured by Yoco
                  </span>
                </div>
                {yoco ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-morogo bg-morogo/10 p-3">
                    <p className="text-[13px] font-semibold text-ink">Card authorised · {zar(yoco.amountCents / 100)}</p>
                    <button type="button" onClick={() => setYoco(null)} className="text-[11px] font-semibold uppercase tracking-wide text-ink/60 underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <Button type="button" onClick={openYoco} disabled={openingYoco} block>
                    {openingYoco ? 'Opening Yoco…' : `Pay ${zar(shown.total)} by card`}
                  </Button>
                )}
                {yocoError && <p className="mt-2 text-[12px] font-medium text-chili">{yocoError}</p>}
                <p className="mt-3 text-[11px] leading-relaxed text-ink/55">
                  Card details are entered in Yoco&apos;s secure window. Heritage Bites never sees or stores your card number.
                  Place your order after the card is authorised.
                </p>
              </div>
            )}

            {needsCard && (
              <div className="animate-rise mt-5 rounded-2xl border-2 border-ink/10 bg-bone/70 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-ink/50">Card details</span>
                  <span className="flex items-center gap-2 text-[11px] text-ink/50">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                    Test mode
                  </span>
                </div>

                <div className="grid gap-4">
                  <Field label="Card number" error={errors.number} hint={brand ? brand.toUpperCase() : ''}>
                    <div className="relative">
                      <input
                        className={`${inputCls} pr-16 font-mono tracking-wider`}
                        value={card.number}
                        onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })}
                        inputMode="numeric"
                        autoComplete="cc-number"
                        placeholder="4242 4242 4242 4242"
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold uppercase text-ink/40">{brand || '····'}</span>
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Expiry" error={errors.expiry}>
                      <input className={`${inputCls} font-mono`} value={card.expiry} onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" />
                    </Field>
                    <Field label="CVC" error={errors.cvc}>
                      <input className={`${inputCls} font-mono`} value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" autoComplete="cc-csc" placeholder="123" />
                    </Field>
                  </div>
                  <Field label="Name on card" error={errors.holder}>
                    <input className={inputCls} value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} autoComplete="cc-name" placeholder="T MAHLANGU" />
                  </Field>
                </div>

                <div className="mt-4 rounded-xl border border-ink/10 bg-ochre/10 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ochre-deep">Sandbox mode — test cards</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {TEST_CARDS.map((t) => (
                      <button
                        key={t.number}
                        type="button"
                        onClick={() => setCard({ ...card, number: formatCardNumber(t.number), expiry: '12/32', cvc: '123', holder: card.holder || 'Test User' })}
                        className="rounded-full border border-ink/15 bg-bone px-2.5 py-1 text-[11px] font-medium hover:border-ochre"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink/55">
                    Live card payments are off on this build, so no real charge is made. Once Yoco live keys are set on the
                    host, this form is replaced by Yoco&apos;s secure payment window.
                  </p>
                </div>
              </div>
            )}
          </fieldset>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="overflow-hidden rounded-3xl border-2 border-ink/10 bg-white">
            <div className="border-b-2 border-ink/10 px-5 py-4">
              <h2 className="font-display text-xl font-semibold">Order summary</h2>
              <p className="text-[11px] text-ink/50">
                {lines.reduce((n, l) => n + l.qty, 0)} {lines.reduce((n, l) => n + l.qty, 0) === 1 ? 'item' : 'items'} · {fulfilment}
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto px-5 py-3">
              {lines.map((l) => (
                <div key={l.key} className="flex items-start gap-3 border-b border-ink/8 py-3 last:border-0">
                  <img src={l.image} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-tight">{l.name}</p>
                    {l.picks.length > 0 && <p className="text-[10px] leading-snug text-ink/50">{l.picks.map((p) => p.label).join(' · ')}</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <button type="button" onClick={() => setQty(l.key, l.qty - 1)} className="grid h-5 w-5 place-items-center rounded-full border border-ink/20 text-[10px] hover:bg-ink hover:text-bone" aria-label="Decrease">−</button>
                      <span className="font-mono text-[11px]">{l.qty}</span>
                      <button type="button" onClick={() => setQty(l.key, l.qty + 1)} className="grid h-5 w-5 place-items-center rounded-full border border-ink/20 text-[10px] hover:bg-ink hover:text-bone" aria-label="Increase">+</button>
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
                    <span className="font-mono">Included</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-ink/10 pt-2 text-lg font-bold">
                  <span>Total</span>
                  <span className="font-mono">{zar(shown.total)}</span>
                </div>
              </div>

                {fatal && (
                  <p className="mt-3 rounded-xl border-2 border-chili bg-chili/10 p-3 text-[12px] font-medium text-chili" role="alert">
                    {fatal}
                  </p>
                )}
                {needsAction && (
                  <div className="mt-3 rounded-xl border-2 border-ochre-deep bg-ochre/15 p-3" role="alert">
                    <p className="text-[12px] font-bold text-ink">{needsAction}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink/70">
                      Your bank needs you to approve this payment. Try another card, or choose cash on collection instead.
                    </p>
                  </div>
                )}
                {errors.form && <p className="mt-3 text-[12px] font-medium text-chili">{errors.form}</p>}

              {/*
                Only disabled while a request is in flight. Keeping it disabled
                after a decline would leave the customer staring at an error and
                a dead button — retrying must stay possible, and the server
                re-validates and re-charges on every attempt anyway.
              */}
              <Button type="submit" size="lg" block className="mt-4" disabled={state === 'paying'}>
                {state === 'paying' ? 'Processing payment…' : `Place order · ${zar(shown.total)}`}
              </Button>

              <p className="mt-3 text-[11px] leading-relaxed text-ink/60">
                By placing this order you agree to our{' '}
                <Link to="/policies" className="font-semibold text-ochre-deep underline">terms, delivery and refund policies</Link>.
              </p>
            </div>
          </div>

          <Reveal delay={100}>
            <div className="mt-4 rounded-3xl border-2 border-ink/10 bg-ink p-5 text-bone">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ochre">Prefer not to pay online?</p>
              <p className="mt-2 text-sm text-bone/70">Send the same basket to us on WhatsApp and pay cash when you collect.</p>
              <a
                href={`https://wa.me/${settings?.whatsapp ?? '27670137587'}?text=${encodeURIComponent('Hi Heritage Bites! I would like to order:\n' + lines.map((l) => `• ${l.qty} × ${l.name}`).join('\n'))}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-ochre px-4 py-2 text-xs font-semibold text-ink hover:bg-ochre-deep hover:text-bone"
              >
                Order on WhatsApp
              </a>
            </div>
          </Reveal>
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
  const wa = `https://wa.me/${catalog?.settings?.whatsapp ?? '27670137587'}`;

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

        <p className="mt-3 text-[11px] leading-relaxed text-ink/45">
          Prices are the published plate prices. Delivery in Rosebank and Sandton is included; the minimum order is R100.
          The live site will confirm the total with the kitchen before anything is charged.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <LinkButton href={wa} variant="primary">Send the basket on WhatsApp</LinkButton>
          <LinkButton to="/menu" variant="outline">Back to the menu</LinkButton>
        </div>
      </div>
    </section>
  );
}

export default function Checkout() {
  useDocumentTitle('Checkout');
  return STATIC_PREVIEW ? <PreviewCheckout /> : <LiveCheckout />;
}
