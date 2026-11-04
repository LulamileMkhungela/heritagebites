import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartLine, CartOptionPick, Fulfilment, MenuItem } from '../lib/types';

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

const keyFor = (itemId: string, picks: { optionId: string; choiceId: string }[]) =>
  `${itemId}::${picks
    .map((p) => `${p.optionId}=${p.choiceId}`)
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
      fulfilment: 'collection',
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
      version: 2,
      migrate: (persisted) => {
        const old = persisted as Partial<Pick<CartState, 'lines' | 'fulfilment'>>;
        return {
          lines: old.lines ?? [],
          fulfilment: old.fulfilment === 'delivery' ? 'delivery' : 'collection',
        };
      },
      partialize: (s) => ({ lines: s.lines, fulfilment: s.fulfilment }),
    },
  ),
);

/* --------------------------- Selectors -------------------------------- */

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.qty, 0);
export const cartSubtotal = (lines: CartLine[]) => lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);

/** Builds a stable cart line from a menu item and its chosen options. */
export function buildLine(item: MenuItem, picks: CartOptionPick[], qty: number): CartLine {
  const unitPrice = item.price + picks.reduce((n, p) => n + (p.priceDelta || 0), 0);
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
 * Options are sent as choice *ids* grouped by option id, because the server
 * looks deltas up by id — never by the label a customer happened to see.
 */
export function toApiItems(lines: CartLine[]) {
  const out: unknown[] = [];

  for (const l of lines) {
    if (l.kind === 'plate') {
      const selections: Record<string, string[]> = {};
      for (const p of l.picks) {
        // Plate picks encode "groupId:itemId" in choiceId.
        const [groupId, itemId] = p.choiceId.includes(':') ? p.choiceId.split(':') : [p.optionId, p.choiceId];
        (selections[groupId] ||= []).push(itemId);
      }
      out.push({ kind: 'plate', plateId: l.plateId, qty: l.qty, selections });
      continue;
    }

    const options: Record<string, string | string[]> = {};
    for (const p of l.picks) {
      const prev = options[p.optionId];
      if (prev === undefined) options[p.optionId] = p.choiceId;
      else if (Array.isArray(prev)) prev.push(p.choiceId);
      else options[p.optionId] = [prev, p.choiceId];
    }
    out.push({ itemId: l.itemId, qty: l.qty, options });
  }

  return out;
}
