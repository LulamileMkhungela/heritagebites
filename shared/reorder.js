/**
 * Putting a past order back in the basket.
 *
 * The single strongest reason somebody orders from the same kitchen twice is
 * that they ordered the same thing last time. Every delivery app knows this;
 * this site did not — after an order was placed, the only way back to that plate
 * was to find the dish and re-pick the protein, the starches and the sides from
 * memory.
 *
 * This module turns the *server's* order lines back into basket lines. It is
 * shared, not client-only, for two reasons:
 *
 *   1. it is pure — an order's items and the catalogue in, basket lines out — so
 *      it can be tested in Node without a browser;
 *   2. the browser and any future surface must agree about what "the same order"
 *      means, and the only way to guarantee that is one implementation.
 *
 * What it deliberately does NOT do:
 *
 *   - **It does not trust the old price.** Every amount is read from the current
 *     catalogue, because prices change and a basket that quietly reorders at last
 *     month's price is a basket the checkout will refuse. The customer sees today's
 *     price before paying.
 *   - **It does not invent a choice.** If a plate's protein or a dish's starch is
 *     no longer on the menu, that line is skipped and reported back in `missing`
 *     rather than silently swapped for something else. "We could not put the
 *     tshotlo plate back — it is not on the menu today" is a sentence a customer
 *     can act on; a basket with a different plate in it is not.
 *
 * The order lines it reads are the ones `publicOrder()` publishes:
 *
 *   { itemId: 'plate-traditional', qty: 2, options: [{ id, label, priceDelta, qty }] }
 *   { itemId: 'tshotlo-plate',     qty: 1, options: [{ id: 'pap', label: 'Pap' }] }
 *
 * Note what an option id is: for a *plate* line it is the choice inside a group
 * ("mogodu", "pap"), because the plate's groups are what the server iterated; for
 * a *menu* line it is also the bare choice id ("pap"). Neither carries the group,
 * so the group is recovered from the catalogue — which is the same catalogue the
 * customer is looking at, so a plate that gained a group since the order was
 * placed still resolves.
 */
import { extraCost, maxPerExtra, maxPortions, portionCost } from './service.js';

/** The stable line key the basket uses, so a reorder merges with a matching line. */
const lineKey = (prefix, picks) =>
  `${prefix}::${picks
    .map((p) => `${p.optionId}=${p.choiceId}${p.qty && p.qty > 1 ? `x${p.qty}` : ''}`)
    .sort()
    .join('|')}`;

/**
 * Which group a choice id belongs to, for a score of options that do not say.
 *
 * A choice id is unique *within* a plate or dish, which is what makes this
 * unambiguous in practice: "pap" appears once in the traditional plate, "salsa"
 * once in each. If a catalogue ever repeats an id across groups the first match
 * wins, and that is the same group the server prices from.
 */
const groupOfChoice = (groups, choiceId) =>
  groups.find((group) => (group.items ?? group.choices ?? []).some((item) => item.id === choiceId)) ?? null;

const priceOf = (item) => Number(item?.price) || 0;

/**
 * Rebuild the basket lines for a past order.
 *
 * @param {Array<{ itemId: string, qty: number, options?: Array<{ id: string, qty?: number }> }>} orderItems
 * @param {{ menu?: Array<any>, plateMenus?: Array<any> }} catalog
 * @returns {{ lines: Array<any>, missing: string[], changed: string[] }}
 *   `missing` names what could not be put back; `changed` names what is now a
 *   different price, so the screen can say so before the customer pays.
 */
export function reorderLines(orderItems, catalog) {
  const menu = catalog?.menu ?? [];
  const plateMenus = catalog?.plateMenus ?? [];
  const lines = [];
  const missing = [];
  const changed = [];

  for (const raw of orderItems ?? []) {
    const qty = Math.max(1, Math.min(20, Math.floor(Number(raw?.qty) || 1)));
    const options = raw?.options ?? [];

    /* ---------------------------- Plate builder ---------------------------- */
    if (String(raw?.itemId ?? '').startsWith('plate-')) {
      const plateId = String(raw.itemId).slice('plate-'.length);
      const plate = plateMenus.find((p) => p.id === plateId);
      if (!plate) {
        missing.push('a plate menu that is no longer on the site');
        continue;
      }

      const picks = [];
      let lost = null;
      for (const option of options) {
        const group = groupOfChoice(plate.groups ?? [], option.id);
        const item = group ? (group.items ?? []).find((i) => i.id === option.id) : null;
        if (!group || !item) {
          /* A component that has left the menu. The line cannot be rebuilt
             faithfully, so it is reported instead of being improvised. */
          lost = option.label || option.id;
          break;
        }
        /*
         * How many, and what that costs — the same two rules the builder uses,
         * so re-ordering a plate with double pap charges for the second pap
         * exactly as building it by hand would. A priced extra is charged per
         * unit; a starch or a side includes its first portion and charges the
         * rest.
         */
        const cap = group.priced ? maxPerExtra(group, item) : maxPortions(item);
        const count = Math.min(cap, Math.max(1, Math.floor(Number(option.qty) || 1)));
        picks.push({
          optionId: group.id,
          choiceId: `${group.id}:${item.id}`,
          label: item.label,
          priceDelta: group.priced ? extraCost(priceOf(item), count) : portionCost(item, count),
          ...(count > 1 ? { qty: count } : {}),
        });
      }
      if (lost) {
        missing.push(`${plate.name} (${lost} is no longer offered)`);
        continue;
      }
      /* A required group with nothing picked would be refused at checkout with a
         message about a plate the customer thought they had re-ordered. */
      const requiredMissing = (plate.groups ?? []).filter(
        (group) => group.required && !picks.some((p) => p.optionId === group.id),
      );
      if (requiredMissing.length) {
        missing.push(`${plate.name} (it now asks for ${requiredMissing.map((g) => g.label.toLowerCase()).join(' and ')})`);
        continue;
      }

      const extras = picks.reduce((sum, p) => sum + (p.priceDelta || 0), 0);
      const unitPrice = Math.round((priceOf(plate) + extras) * 100) / 100;
      const wasPrice = Math.round((Number(raw.unitPrice ?? 0)) * 100) / 100;
      if (raw.unitPrice != null && wasPrice !== unitPrice) changed.push(plate.name);

      lines.push({
        key: lineKey(`plate::${plate.id}`, picks),
        itemId: `plate-${plate.id}`,
        plateId: plate.id,
        name: plate.name,
        image: plate.image,
        unitPrice,
        qty,
        picks,
        kind: 'plate',
      });
      continue;
    }

    /* ------------------------------ Dish card ------------------------------ */
    const item = menu.find((m) => m.id === raw?.itemId);
    if (!item) {
      missing.push(raw?.name || raw?.itemId || 'a dish');
      continue;
    }

    const picks = [];
    let lost = null;
    for (const option of options) {
      const group = groupOfChoice(item.options ?? [], option.id);
      const choice = group ? (group.choices ?? group.items ?? []).find((c) => c.id === option.id) : null;
      if (!group || !choice) {
        lost = option.label || option.id;
        break;
      }
      const cap = group.priced ? maxPerExtra(group, choice) : maxPortions(choice);
      const count = Math.min(cap, Math.max(1, Math.floor(Number(option.qty) || 1)));
      picks.push({
        optionId: group.id,
        choiceId: choice.id,
        label: choice.label,
        priceDelta: group.priced
          ? extraCost(Number(choice.priceDelta) || 0, count)
          : portionCost(choice, count),
        ...(count > 1 ? { qty: count } : {}),
      });
    }
    if (lost) {
      missing.push(`${item.name} (${lost} is no longer offered)`);
      continue;
    }

    const extras = picks.reduce((sum, p) => sum + (p.priceDelta || 0), 0);
    /* A dish that is linked to a plate menu is sold at the plate price, exactly
       as the server prices it — see `priceLines` on the API. */
    const plate = item.plateId ? plateMenus.find((p) => p.id === item.plateId) : null;
    const base = plate ? priceOf(plate) : priceOf(item);
    const unitPrice = Math.round((base + extras) * 100) / 100;

    lines.push({
      key: lineKey(item.id, picks),
      itemId: item.id,
      name: item.name,
      image: item.image,
      unitPrice,
      qty,
      picks,
      kind: 'menu',
    });
  }

  return { lines, missing, changed };
}

/**
 * What a customer sees on a past order before deciding to reorder.
 *
 * "2 × Tshotlo Plate · Pap · Chakalaka" — the plate and the choices, which is the
 * whole order as far as the customer is concerned. Kept here rather than in a
 * component so the receipt, the passport card and any future summary read it the
 * same way.
 */
export function describeOrderItem(item) {
  const name = item?.name ?? 'A dish';
  const qty = Math.max(1, Math.floor(Number(item?.qty) || 1));
  const picks = (item?.options ?? []).map((o) => o.label).filter(Boolean).join(' · ');
  return picks ? `${qty} × ${name} — ${picks}` : `${qty} × ${name}`;
}
