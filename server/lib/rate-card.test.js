import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTEIN_EXTRA_PRICE,
  SIDE_PORTION_PRICE,
  STARCH_PORTION_PRICE,
  plateMenus,
  settings,
  sides,
} from '../seed.js';
import { portionCost } from '../../shared/service.js';

/*
 * The kitchen's rate card, as sent on 19 Nov 2026:
 *
 *   Starches  R20   pap, samp & beans, mabele, dumpling, garlic bread
 *   Sides     R15   chakalaka, braised cabbage, braised spinach, morogo, green salad
 *   Protein   R30   tshotlo, beef short rib, mogodu, tlhakwana, chicken hardbody
 *
 * Until this arrived the site charged a single R30 placeholder for all three,
 * which overcharged a bowl of pap by R10 and a bowl of chakalaka by R15 — the two
 * cheapest things on it. A customer buying a plate with double pap and double
 * chakalaka was quoted R60 of extras where the kitchen's own card says R35.
 *
 * These tests exist because "one flat rate" was easy and wrong, and because the
 * next person to touch pricing should not have to rediscover which group pays
 * what from three lists of string ids.
 */

const rateFor = (menuId, groupId, choiceId) => {
  const menu = plateMenus.find((m) => m.id === menuId);
  const group = menu.groups.find((g) => g.id === groupId);
  const choice = group.items.find((i) => i.id === choiceId);
  assert.ok(choice, `${menuId}/${groupId}/${choiceId} must exist`);
  return choice.extraPrice;
};

test('a starch portion costs R20', () => {
  assert.equal(STARCH_PORTION_PRICE, 20);
  for (const id of ['pap', 'mabele', 'samp', 'dumpling']) {
    assert.equal(rateFor('traditional', 'starch', id), 20, `${id} is a starch`);
  }
});

test('a vegetable side portion costs R15', () => {
  assert.equal(SIDE_PORTION_PRICE, 15);
  for (const id of ['chakalaka', 'braised-cabbage', 'spinach', 'morogo', 'green-salad']) {
    assert.equal(rateFor('traditional', 'veg', id), 15, `${id} is a vegetable side`);
  }
});

test('the contemporary kitchen uses the same card, not its own numbers', () => {
  /*
   * A second set of rules for the R130 plate is exactly how a kitchen ends up
   * charging two prices for the same bowl of spinach. The rate follows the kind of
   * food, not which menu it sits on.
   */
  assert.equal(rateFor('contemporary', 'starch', 'potato-mash'), STARCH_PORTION_PRICE);
  assert.equal(rateFor('contemporary', 'veg', 'corn-ribs'), SIDE_PORTION_PRICE);
});

test('a second pap is R20, not R30', () => {
  /*
   * The bug this pins: one shared constant meant every extra portion cost R30.
   * Double pap on a R100 plate is R120, not R130.
   */
  const pap = { extraAfter: 1, extraPrice: STARCH_PORTION_PRICE };
  assert.equal(portionCost(pap, 1), 0, 'the first is included');
  assert.equal(portionCost(pap, 2), 20);
  assert.equal(portionCost(pap, 3), 40);
});

test('a second chakalaka is R15, and double pap plus double chakalaka is R35', () => {
  const pap = { extraAfter: 1, extraPrice: STARCH_PORTION_PRICE };
  const chakalaka = { extraAfter: 1, extraPrice: SIDE_PORTION_PRICE };
  assert.equal(portionCost(chakalaka, 2), 15);
  assert.equal(portionCost(pap, 2) + portionCost(chakalaka, 2), 35, 'R20 + R15, not R30 + R30');
});

test('the protein rate is recorded, and is the dearest of the three', () => {
  /*
   * Nothing in the builder charges for a second protein yet — the group is single
   * choice — so `PROTEIN_EXTRA_PRICE` is a recorded rate rather than a live one.
   * It is asserted here so it is not quietly deleted as dead code before the
   * kitchen decides whether a double portion is even allowed.
   */
  assert.equal(PROTEIN_EXTRA_PRICE, 30);
  assert.ok(PROTEIN_EXTRA_PRICE > STARCH_PORTION_PRICE);
  assert.ok(STARCH_PORTION_PRICE > SIDE_PORTION_PRICE);
});

test('a bowl sold on its own costs what the same portion costs inside a plate', () => {
  /*
   * The contradiction the old single-rate model could not have: the sides section
   * sold a bowl of pap for the same R30 as a bowl of chakalaka, so a customer
   * could not tell that a starch costs more than a relish — and the plate charged
   * a second pap at the relish rate.
   */
  const pap = sides.find((s) => s.id === 'side-stywe-pap');
  const chakalaka = sides.find((s) => s.id === 'side-chakalaka');
  assert.ok(pap && chakalaka);
  assert.equal(pap.price, STARCH_PORTION_PRICE, 'pap is a starch');
  assert.equal(chakalaka.price, SIDE_PORTION_PRICE, 'chakalaka is a vegetable side');
  assert.equal(pap.price, portionCost({ extraAfter: 1, extraPrice: STARCH_PORTION_PRICE }, 2));
});

test('the delivery ring is 10 km at a flat R50', () => {
  /*
   * Owner, 19 Nov 2026: "make this 10km radius please at a flat fee of R50. 30km
   * is way too far and will be uneconomical pricing wise".
   */
  assert.equal(settings.maxDeliveryKm, 10);
  assert.equal(settings.outsideFee, 50);
  assert.ok(settings.includedRadiusKm < settings.maxDeliveryKm, 'a fee ring still exists');
});
