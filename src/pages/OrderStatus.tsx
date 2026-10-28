import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { clockTime, timeAgo, zar } from '../lib/format';
import { Badge, Button, LinkButton, SectionLabel, Spinner } from '../components/ui';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useCatalog } from '../store/catalog';
import type { Order } from '../lib/types';
import {
  checkPush,
  hasLocalSubscription,
  subscribeToOrder,
  unsubscribeThisDevice,
  type PushState,
} from '../lib/push';

export default function OrderStatus() {
  const { code = '' } = useParams();
  const [searchParams] = useSearchParams();
  const trackingToken = searchParams.get('token') ?? '';
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const settings = useCatalog((s) => s.data?.settings);

  /* The order code in the tab title means two tracking tabs stay tellable
     apart, which matters when someone has ordered for more than one table. */
  useDocumentTitle(order ? `Order ${order.code}` : `Order ${code || 'tracking'}`);

  const refresh = useCallback(async () => {
    try {
      const r = await api.trackOrder(code, trackingToken);
      setOrder(r.order);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that order.');
    }
  }, [code, trackingToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Alerts are per device, so the state is asked for on mount rather than assumed:
   * another tab may have turned them on, or the browser may have thrown the
   * subscription away, and the button must say what is actually true.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const state = await checkPush();
      if (!alive) return;
      const already = state.status === 'idle' ? await hasLocalSubscription() : false;
      if (!alive) return;
      setPush(already
        ? { status: 'subscribed', message: 'Alerts are on for this device. We will tell you when this order changes.' }
        : state);
    })();
    return () => { alive = false; };
  }, []);

  const enableAlerts = async () => {
    if (!order) return;
    setPushBusy(true);
    try {
      setPush(await subscribeToOrder(order.code, trackingToken));
    } catch (error) {
      setPush({ status: 'blocked', message: error instanceof Error ? error.message : 'We could not turn alerts on.' });
    } finally {
      setPushBusy(false);
    }
  };

  const disableAlerts = async () => {
    setPushBusy(true);
    try {
      await unsubscribeThisDevice();
      setPush({ status: 'idle', message: 'Alerts are off for this device.' });
    } finally {
      setPushBusy(false);
    }
  };

  const cancel = async () => {
    if (!order || !window.confirm('Cancel this order? This cannot be undone.')) return;
    setCancelling(true);
    try {
      const r = await api.cancelOrder(order.code, trackingToken);
      setOrder(r.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel.');
    } finally {
      setCancelling(false);
    }
  };

  if (error && !order) {
    return (
      <section className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-4xl">🔍</p>
        <h1 className="mt-4 font-display text-3xl font-semibold">We could not find that order</h1>
        <p className="mt-3 text-ink/60">{error}</p>
        <LinkButton to="/menu" className="mt-6">Back to the menu</LinkButton>
      </section>
    );
  }

  if (!order) return <Spinner label="Fetching your order…" />;

  const updateMessage = encodeURIComponent(`Hi Heritage Bites, please send me WhatsApp updates for order ${order.code}.`);
  const updateRequest = `https://wa.me/${(settings?.whatsapp ?? '27670137587').replace(/\D/g, '')}?text=${updateMessage}`;

  /*
   * WhatsApp without the Cloud API: the customer presses a link and *their own*
   * WhatsApp sends the message. Opening wa.me with no number lets them keep a
   * copy of this receipt in a chat — with themselves, or whoever is collecting.
   */
  const keepReceiptMessage = encodeURIComponent(
    `Heritage Bites order ${order.code} — ${zar(order.totals.total)}\n${order.statusMeta.label}\n${typeof window === 'undefined' ? '' : window.location.href}`,
  );
  const keepReceiptLink = `https://wa.me/?text=${keepReceiptMessage}`;
  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionLabel>Order tracking</SectionLabel>
          <h1 className="font-display text-4xl font-semibold md:text-5xl">{order.code}</h1>
          <p className="mt-2 text-sm text-ink/55">
            Placed {timeAgo(order.createdAt)} · {order.fulfilmentLabel} · {order.items.reduce((n, i) => n + i.qty, 0)} items
          </p>
          {order.receiptEmail && order.receiptState !== 'none' && (
            <p className="mt-1 text-[12px] text-ink/45">
              {order.receiptState === 'sent'
                ? 'Receipt emailed to '
                : order.receiptState === 'queued'
                  ? 'Receipt on its way to '
                  : 'We could not email your receipt to '}
              <span className="font-mono">{order.receiptEmail}</span>
              {order.receiptState === 'failed' && ' — call or WhatsApp us and we will resend it.'}
            </p>
          )}
          {order.serviceWindow && (
            <p className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px] font-medium text-ink/70">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ochre-deep">
                {order.serviceWindow.isPreOrder ? 'Pre-order' : 'Service window'}
              </span>
              {order.serviceWindow.label}
            </p>
          )}
        </div>
        <div className="text-right">
          <Badge tone={order.status === 'cancelled' ? 'chili' : order.status === 'completed' ? 'ink' : 'ochre'}>{order.statusMeta.label}</Badge>
          <p className="mt-2 font-display text-3xl font-bold">{zar(order.totals.total)}</p>
          <p className="text-[11px] text-ink/50">
            {order.payment.status === 'approved' ? `Paid · ${order.payment.brand?.toUpperCase()} ****${order.payment.last4}` : 'Payment on collection/delivery'}
          </p>
        </div>
      </div>

      {/* Order journey: the status is not advanced automatically in this build. */}
      <div className="mt-8 rounded-3xl border-2 border-ink/10 bg-white p-6">
        <h2 className="mb-3 font-display text-2xl font-semibold">Order journey</h2>
        <p className="mb-6 text-sm text-ink/65" aria-live="polite">{order.statusMeta.note}</p>

        <ol className="relative space-y-6 border-l-2 border-ink/12 pl-8">
          {order.timeline.map((t) => (
            <li key={t.status} className="relative">
              <span
                className={`absolute -left-[41px] top-1 grid h-6 w-6 place-items-center rounded-full border-2 ${
                  t.current ? 'animate-pulse-ring border-ochre bg-ochre' : t.done ? 'border-ink bg-ink' : 'border-ink/20 bg-bone'
                }`}
              >
                {t.done && !t.current && <span className="text-[10px] font-bold text-bone">✓</span>}
                {t.current && <span className="h-2 w-2 rounded-full bg-ink" />}
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={`font-semibold ${t.done ? '' : 'text-ink/40'}`}>{t.label}</p>
                {t.at && <span className="font-mono text-[11px] text-ink/45">{clockTime(t.at)}</span>}
              </div>
              <p className={`text-[13px] ${t.done ? 'text-ink/60' : 'text-ink/35'}`}>{t.note}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.3fr_1fr]">
        {/* Items */}
        <div className="rounded-3xl border-2 border-ink/10 bg-white p-6">
          <h2 className="font-display text-xl font-semibold">What you ordered</h2>
          <ul className="mt-4 divide-y divide-ink/8">
            {order.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-3">
                <span>
                  <span className="block text-sm font-semibold">{it.qty} × {it.name}</span>
                  {it.options.length > 0 && <span className="block text-[11px] text-ink/50">{it.options.map((o) => o.label).join(' · ')}</span>}
                </span>
                <span className="font-mono text-sm">{zar(it.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-ink/10 pt-3 text-sm">
            <div className="flex justify-between text-ink/60"><dt>Subtotal</dt><dd className="font-mono">{zar(order.totals.subtotal)}</dd></div>
            {order.totals.delivery > 0 && <div className="flex justify-between text-ink/60"><dt>Delivery</dt><dd className="font-mono">{zar(order.totals.delivery)}</dd></div>}
            {order.totals.discount > 0 && <div className="flex justify-between text-ochre-deep"><dt>Discount</dt><dd className="font-mono">−{zar(order.totals.discount)}</dd></div>}
            <div className="flex justify-between border-t border-ink/10 pt-2 text-base font-bold"><dt>Total</dt><dd className="font-mono">{zar(order.totals.total)}</dd></div>
          </dl>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <div className="rounded-3xl border-2 border-ink/10 bg-white p-6">
            <h2 className="font-display text-xl font-semibold">{order.fulfilment === 'delivery' ? 'Delivery details' : 'Collection details'}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/70">
              {order.fulfilment === 'delivery'
                ? `Delivery to ${order.deliveryArea ?? 'your area'} — the address you entered at checkout. Delivery is included in the plate price.`
                : 'Collection is from our shadow kitchen at Standard Bank, Rosebank and Sandton. We confirm the exact collection point by WhatsApp.'}
            </p>
            <p className="mt-3 text-sm text-ink/70">
              <strong>{order.customer.name}</strong>
              <br />
              <a href={`tel:${order.customer.phone}`} className="font-mono text-xs hover:text-ochre-deep">{order.customer.phone}</a>
            </p>
          </div>

          {/*
            Web Push: the only free channel that reaches a phone by itself, with no
            app and no message fee. It is opt-in per device, so it is offered here —
            on the order the customer already has open — rather than buried in a
            settings page.
          */}
          {push && push.status !== 'unsupported' && push.status !== 'unconfigured' && (
            <div className="rounded-3xl border-2 border-ochre bg-ochre/10 p-5" aria-live="polite">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ochre-deep">Alerts on this device</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink/75">{push.message}</p>
              {push.status === 'subscribed' ? (
                <button
                  type="button"
                  onClick={disableAlerts}
                  disabled={pushBusy}
                  className="mt-3 w-full rounded-full border-2 border-ink/25 px-4 py-2 text-xs font-semibold uppercase tracking-wide hover:border-ink disabled:opacity-50"
                >
                  {pushBusy ? 'Turning off…' : 'Turn alerts off'}
                </button>
              ) : push.status === 'idle' ? (
                <button
                  type="button"
                  onClick={enableAlerts}
                  disabled={pushBusy}
                  className="mt-3 w-full rounded-full bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-wide text-bone hover:bg-ink-3 disabled:opacity-50"
                >
                  {pushBusy ? 'Turning on…' : 'Alert me on this device'}
                </button>
              ) : null}
            </div>
          )}

          <div className="rounded-3xl border-2 border-ink/10 bg-ink p-6 text-bone">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ochre">Need an update?</p>
            <p className="mt-2 text-sm text-bone/70">
              The kitchen was notified the moment you placed this order, and this page always shows the latest state.
              WhatsApp messages are not automatic: replies are written by a person during kitchen hours, so they are not instant —
              message or call us for an update.
            </p>
            <a
              href={updateRequest}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ochre px-4 py-2.5 text-xs font-semibold text-ink hover:bg-ochre-deep hover:text-bone"
            >
              Request WhatsApp updates
            </a>
            <a
              href={order.whatsapp}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full border border-bone/25 px-4 py-2.5 text-xs font-semibold hover:border-ochre hover:text-ochre"
            >
              Message us about {order.code}
            </a>
            <a
              href={keepReceiptLink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full border border-bone/25 px-4 py-2.5 text-xs font-semibold hover:border-ochre hover:text-ochre"
            >
              Keep this receipt on WhatsApp
            </a>
            <a href={`tel:${order.phone.replace(/\s/g, '')}`} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full border border-bone/25 px-4 py-2.5 text-xs font-semibold hover:border-ochre hover:text-ochre">
              Call {order.phone}
            </a>
          </div>

          {order.canCancel && (
            <Button variant="outline" block onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel this order'}
            </Button>
          )}
          {order.payment.status === 'approved' && order.status !== 'cancelled' && (
            <p className="rounded-2xl border border-ochre/50 bg-ochre/10 p-4 text-sm text-ink/75">
              This order has been paid. To discuss a cancellation or refund, contact us by phone or WhatsApp; refunds are not processed automatically here.
            </p>
          )}
          {order.loyalty.pointsEarned > 0 && (
            <div className="rounded-3xl border-2 border-ochre bg-ochre/10 p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ochre-deep">Loyalty card</p>
              <p className="mt-2 text-sm text-ink/70">
                This order earned <strong>{order.loyalty.pointsEarned} stamp{order.loyalty.pointsEarned === 1 ? '' : 's'}</strong>.
              </p>
              <Link to="/passport" className="mt-2 inline-block text-sm font-semibold text-ochre-deep hover:underline">View your loyalty card</Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
