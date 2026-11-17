import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { zar, clockTime } from '../lib/format';
import { Button } from './ui';
import { useCart } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { reorderLines, describeOrderItem } from '../../shared/reorder.js';
import type { PastOrder } from '../lib/types';

/**
 * "Order it again" — a past order put back in the basket in one tap.
 *
 * Every delivery app has this and it is the single biggest reason a customer
 * comes back to the same kitchen: they do not want to browse, they want the
 * thing they had last time. This site could show an order once, on its own
 * tracking page, and then forgetting the link meant forgetting the order.
 *
 * Two honest things happen here rather than one convenient one:
 *
 *   1. **The basket is replaced, and said so.** Adding a reorder to a basket that
 *      already holds food would produce a larger order than the customer asked
 *      for. The button says "Replace my basket" when that is what it does, and
 *      nothing is cleared until it is pressed.
 *   2. **What cannot be put back is named.** Prices change and dishes come off the
 *      menu; `reorderLines` returns the parts it could not rebuild, and this shows
 *      them instead of quietly handing over a different order.
 *
 * Prices come from the live catalogue at the moment of the tap, never from the
 * old receipt — see `shared/reorder.js`.
 */
export function OrderAgain({
  orders,
  /** Where the customer lands after their basket is rebuilt. */
  to = '/checkout',
  heading = 'Order it again',
  intro = 'One tap puts the same plates, starches and sides back in your basket at today’s prices.',
}: {
  orders: PastOrder[];
  to?: string;
  heading?: string;
  intro?: string;
}) {
  const nav = useNavigate();
  const catalog = useCatalog((s) => s.data);
  const clear = useCart((s) => s.clear);
  const add = useCart((s) => s.add);
  const addPlate = useCart((s) => s.addPlate);
  const basketCount = useCart((s) => s.lines.length);

  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!orders.length) return null;

  const again = (order: PastOrder) => {
    if (!catalog) {
      setNotice({ kind: 'error', text: 'The menu has not loaded yet — try again in a moment.' });
      return;
    }
    setBusy(order.code);
    /* Nothing is rebuilt or cleared until the catalogue has answered, so a slow
       connection cannot empty a basket and then fail to fill it. */
    const { lines, missing } = reorderLines(order.items, catalog);

    if (!lines.length) {
      setBusy(null);
      setNotice({
        kind: 'error',
        text: `We could not put ${order.code} back: ${missing.join('; ')}. The menu it came from has changed — pick what you would like from the menu instead.`,
      });
      return;
    }

    clear();
    for (const line of lines) {
      if (line.kind === 'plate') addPlate(line);
      else add(line);
    }
    setBusy(null);

    if (missing.length) {
      /* The basket is real and usable — the customer is told what is missing
         before they pay for a partly-different order. */
      setNotice({
        kind: 'error',
        text: `Most of ${order.code} is back in your basket, but we could not add: ${missing.join('; ')}.`,
      });
      return;
    }

    setNotice({ kind: 'ok', text: `${order.code} is back in your basket at today’s prices.` });
    nav(to);
  };

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold">{heading}</h2>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink/60">{intro}</p>

      <ul className="mt-4 grid gap-3">
        {orders.map((order) => {
          const when = new Date(order.createdAt);
          const date = Number.isNaN(when.getTime())
            ? ''
            : when.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
          return (
            <li
              key={order.code}
              className="rounded-3xl border-2 border-ink/10 bg-white p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/45">
                  {order.code} · {date}
                  {clockTime(order.createdAt) ? ` · ${clockTime(order.createdAt)}` : ''}
                </p>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ochre-deep">
                  {order.statusLabel}
                </p>
              </div>

              <ul className="mt-2 grid gap-1">
                {order.items.map((item, index) => (
                  <li key={`${item.itemId}-${index}`} className="text-[14px] leading-snug text-ink/80">
                    {describeOrderItem(item)}
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-lg font-bold">{zar(order.total)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/order/${order.code}`}
                    className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ochre-deep hover:underline"
                  >
                    View order
                  </Link>
                  <Button
                    onClick={() => again(order)}
                    disabled={busy !== null}
                    aria-label={`Order ${order.code} again`}
                  >
                    {busy === order.code
                      ? 'Putting it back…'
                      : basketCount > 0
                        ? 'Replace my basket with this'
                        : 'Order this again'}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {notice && (
        <p
          role="status"
          className={`mt-3 rounded-xl border-2 p-3 text-[13px] ${
            notice.kind === 'error'
              ? 'border-ochre bg-ochre/10 text-ink'
              : 'border-morogo/40 bg-morogo/10 text-ink'
          }`}
        >
          {notice.text}
        </p>
      )}

      {/*
        Linking an old order to its own page only works for the device that placed
        it: the tracking page needs a token, and the card lookup deliberately does
        not publish one. That is said plainly rather than left as a dead link that
        404s on a second device.
      */}
      <p className="mt-3 text-[12px] leading-relaxed text-ink/45">
        “View order” opens the full receipt and tracking on the device that placed the order. On a new phone,
        ask us on WhatsApp and we will resend the link.
      </p>
    </div>
  );
}
