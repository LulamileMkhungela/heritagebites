/**
 * Order lifecycle descriptions and legal transitions. No status transitions
 * are automated; a future order-management integration must make updates.
 */

export const ORDER_FLOW = ['pending', 'accepted', 'preparing', 'ready', 'out-for-delivery', 'completed'];

export const STATUS_META = {
  pending: { label: 'Order received', short: 'Received', tone: 'ochre', note: 'This site has recorded your order. Contact us to confirm preparation and fulfilment.' },
  accepted: { label: 'Kitchen accepted', short: 'Accepted', tone: 'sky', note: 'The chef has your ticket and is firing it up.' },
  preparing: { label: 'On the pot', short: 'Cooking', tone: 'clay', note: 'Your meal is being cooked fresh right now.' },
  ready: { label: 'Ready for collection', short: 'Ready', tone: 'morogo', note: 'Packed, sealed and waiting at the pass.' },
  'out-for-delivery': { label: 'Out for delivery', short: 'On the way', tone: 'chili', note: 'Your rider has left the restaurant.' },
  completed: { label: 'Completed', short: 'Done', tone: 'ink', note: 'Enjoyed. Siyabonga — thank you!' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', tone: 'ink', note: 'This order was cancelled.' },
};

/** Legal next statuses. `cancelled` is reachable from any pre-completion state. */
const TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out-for-delivery', 'completed', 'cancelled'],
  'out-for-delivery': ['completed'],
  completed: [],
  cancelled: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Customers may self-cancel only before preparation has begun. Paid orders
 * have an additional refund constraint enforced by the API route. */
export function customerCanCancel(status) {
  return status === 'pending' || status === 'accepted';
}

export function nextStatuses(from) {
  return TRANSITIONS[from] ?? [];
}

/** Builds the customer-facing timeline, marking steps already passed. */
export function buildTimeline(order) {
  const history = new Map((order.timeline ?? []).map((t) => [t.status, t]));
  const isCancelled = order.status === 'cancelled';
  const steps = isCancelled
    ? ['pending', 'cancelled']
    : ORDER_FLOW.filter((s) => s !== 'out-for-delivery' || order.fulfilment === 'delivery');

  const reached = new Set();
  const currentIdx = ORDER_FLOW.indexOf(order.status);
  ORDER_FLOW.forEach((s, i) => {
    if (currentIdx >= 0 && i <= currentIdx) reached.add(s);
  });

  return steps
    .filter((s) => isCancelled || (currentIdx >= 0 && ORDER_FLOW.indexOf(s) <= currentIdx))
    .map((s) => ({
      status: s,
      label: STATUS_META[s]?.label ?? s,
      note: STATUS_META[s]?.note ?? '',
      at: history.get(s)?.at ?? null,
      done: reached.has(s) || s === order.status || (isCancelled && s === 'pending'),
      current: s === order.status,
    }));
}
