import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_FULFILMENT, type CartLine, type CartOptionPick, type Fulfilment, type MenuItem } from '../lib/types';
import { extraCost } from '../../shared/service.js';

interface CartState {
  lines: CartLine[];
  fulfilment: Fulfilment;
  open: boolean;
  add: (line: CartLine) => void;
  addPlate: (line: CartLine) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  setFulfilment: (f: Fulfilment) => void;
  setOpen: (open: boolean) => void;
}

/**
 * The line's identity: the item, its choices, and how many of each extra.
 *
 * The quantity belongs in the key. Two mogodu plates are one line with qty 2;
 * "one plate with one beer" and "one plate with two beers" are two different
 * orders at two different prices, and merging them would silently rewrite one
 * of them.
 */
const keyFor = (itemId: string, picks: { optionId: string; choiceId: string; qty?: number }[]) =>
  `${itemId}::${picks
    .map((p) => `${p.optionId}=${p.choiceId}${p.qty && p.qty > 1 ? `x${p.qty}` : ''}`)
    .sort()
    .join('|')}`;

/**
 * Cart lives in localStorage so a refresh mid-checkout never loses the basket —
 * the single most common complaint on restaurant sites that hold state in memory.
 */
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      fulfilment: DEFAULT_FULFILMENT,
      open: false,

      /*
       * Adding never opens the drawer.
       *
       * It used to: every "Add to basket" slid a panel over the menu, so a
       * customer ordering three plates was interrupted three times and had to
       * close the basket to get back to the food. The basket bar at the bottom
       * of the screen now carries the running total instead, and the drawer is
       * opened deliberately — from that bar, or the header.
       */
      add: (line) =>
        set((s) => {
          const existing = s.lines.find((l) => l.key === line.key);
          const lines = existing
            ? s.lines.map((l) => (l.key === line.key ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l))
            : [...s.lines, line];
          return { lines };
        }),

      addPlate: (line) => set((s) => ({ lines: [...s.lines, line] })),

      setQty: (key, qty) =>
        set((s) => ({
          lines: qty <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l)),
        })),

      remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),

      clear: () => set({ lines: [] }),

      setFulfilment: (fulfilment) => set({ fulfilment }),
      setOpen: (open) => set({ open }),
    }),
    {
      name: 'hb.cart',
      version: 3,
      /*
       * Version 3 is the collection removal.
       *
       * A basket saved before it still says `collection`, and there is no
       * collection to offer that customer any more — so the saved value is
       * rewritten to delivery rather than left to render a screen of copy about
       * a collection point that no longer exists. The lines are kept: food in
       * the basket is the customer's, whatever changed about delivery.
       */
      migrate: (persisted) => {
        const old = persisted as Partial<Pick<CartState, 'lines' | 'fulfilment'>>;
        return {
          lines: old.lines ?? [],
          fulfilment: DEFAULT_FULFILMENT,
        };
      },
      partialize: (s) => ({ lines: s.lines, fulfilment: s.fulfilment }),
    },
  ),
);

/* --------------------------- Selectors -------------------------------- */

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.qty, 0);
export const cartSubtotal = (lines: CartLine[]) => lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);

/**
 * Builds a stable cart line from a menu item and its chosen options.
 *
 * The extra count multiplies the extra's own price, never the item: two ginger
 * beers beside one plate is R100 + (2 × R25), not 2 × R125. That distinction is
 * the whole point of a quantity on an add-on, and it is the one thing a
 * "add the plate again" workaround gets wrong.
 */
export function buildLine(item: MenuItem, picks: CartOptionPick[], qty: number): CartLine {
  const unitPrice = item.price + picks.reduce((n, p) => n + extraCost(p.priceDelta || 0, p.qty), 0);
  return {
    key: keyFor(item.id, picks),
    itemId: item.id,
    name: item.name,
    image: item.image,
    unitPrice: Math.round(unitPrice * 100) / 100,
    qty,
    picks,
    kind: 'menu',
  };
}

/**
 * Shape the /api/quote and /api/orders endpoints expect.
 *
 * Options are sent as choice *ids* grouped by option id, because the server
 * looks deltas up by id — never by the label a customer happened to see.
 *
 * An extra the customer took more than one of is sent as `{ id, qty }` in an
 * `extraQty` map rather than by repeating the id, because the id list answers
 * "which choice" and the map answers "how many". The server clamps the number
 * against its own catalogue; sending it is a request, not an instruction.
 */
export function toApiItems(lines: CartLine[]) {
  const out: unknown[] = [];

  for (const l of lines) {
    if (l.kind === 'plate') {
      const selections: Record<string, string[]> = {};
      const extraQty: Record<string, number> = {};
      for (const p of l.picks) {
        // Plate picks encode "groupId:itemId" in choiceId.
        const [groupId, itemId] = p.choiceId.includes(':') ? p.choiceId.split(':') : [p.optionId, p.choiceId];
        (selections[groupId] ||= []).push(itemId);
        if (p.qty && p.qty > 1) extraQty[`${groupId}:${itemId}`] = p.qty;
      }
      out.push({ kind: 'plate', plateId: l.plateId, qty: l.qty, selections, ...(Object.keys(extraQty).length ? { extraQty } : {}) });
      continue;
    }

    const options: Record<string, string | string[]> = {};
    const extraQty: Record<string, number> = {};
    for (const p of l.picks) {
      const prev = options[p.optionId];
      if (prev === undefined) options[p.optionId] = p.choiceId;
      else if (Array.isArray(prev)) prev.push(p.choiceId);
      else options[p.optionId] = [prev, p.choiceId];
      if (p.qty && p.qty > 1) extraQty[`${p.optionId}:${p.choiceId}`] = p.qty;
    }
    out.push({
      itemId: l.itemId,
      qty: l.qty,
      options,
      ...(Object.keys(extraQty).length ? { extraQty } : {}),
    });
  }

  return out;
}
