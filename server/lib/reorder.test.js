/**
 * "Order it again" — the rules that make a rebuild safe.
 *
 * These are the tests that matter for a feature whose whole job is to put food in
 * a basket without the customer checking every line: that it prices from today's
 * catalogue, that it refuses to invent a choice the menu no longer offers, and
 * that it never quietly drops a plate the customer thinks they re-ordered.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reorderLines, describeOrderItem } from '../../shared/reorder.js';

/* The smallest catalogue that exercises every rule: two plate menus and two dish
 * cards, one of which is sold at its plate's price. */
const catalog = {
  plateMenus: [
    {
      id: 'traditional',
      name: 'Traditional Plate',
      price: 100,
      groups: [
        {
          id: 'protein', label: 'Choose your protein', required: true, max: 1,
          items: [
            { id: 'mogodu', label: 'Mogodu (beef tripe)', price: 100 },
            { id: 'tshotlo', label: 'Tshotlo (pounded beef)', price: 100 },
          ],
        },
        {
          id: 'starch', label: 'Choose your starch', required: true, max: 3,
          items: [
            { id: 'pap', label: 'Pap', price: 100 },
            { id: 'dumpling', label: 'Dumpling', price: 100 },
          ],
        },
        {
          id: 'veg', label: 'Choose your vegetable side', required: true, max: 3,
          items: [
            { id: 'chakalaka', label: 'Chakalaka', price: 100 },
            { id: 'salsa', label: 'Salsa', price: 100 },
          ],
        },
        {
          id: 'drink', label: 'Add a soft drink', max: 4, priced: true,
          items: [{ id: 'ginger', label: 'Ginger gemere', price: 25, max: 4 }],
        },
      ],
    },
  ],
  menu: [
    {
      id: 'tshotlo-plate',
      plateId: 'traditional',
      name: 'Tshotlo Plate',
      price: 100,
      image: '/img/plate-tshotlo.jpg',
      options: [],
    },
    {
      id: 'wings-plate',
      name: 'Chicken Wings Plate',
      price: 130,
      image: '/img/plate-wings.jpg',
      options: [
        {
          id: 'starch', label: 'Choose your starch', required: true, max: 2,
          choices: [
            { id: 'mash', label: 'Potato mash', priceDelta: 0 },
            { id: 'rice', label: 'Savoury rice', priceDelta: 0 },
          ],
        },
        {
          id: 'drink', label: 'Add a soft drink', priced: true,
          choices: [{ id: 'ginger', label: 'Ginger gemere', priceDelta: 25, max: 4 }],
        },
      ],
    },
  ],
};

const plateOrder = (opts = {}) => ({
  itemId: 'plate-traditional',
  qty: 1,
  unitPrice: 100,
  options: [
    { id: 'mogodu', label: 'Mogodu (beef tripe)' },
    { id: 'pap', label: 'Pap' },
    { id: 'chakalaka', label: 'Chakalaka' },
  ],
  ...opts,
});

describe('reorderLines — rebuilding a plate', () => {
  test('puts the same protein, starch and side back, priced from the catalogue', () => {
    const { lines, missing } = reorderLines([plateOrder()], catalog);
    assert.equal(missing.length, 0, 'nothing should be missing from a live plate');
    assert.equal(lines.length, 1);

    const [line] = lines;
    assert.equal(line.kind, 'plate');
    assert.equal(line.plateId, 'traditional');
    assert.equal(line.unitPrice, 100);
    assert.equal(line.qty, 1);
    assert.deepEqual(
      line.picks.map((p) => `${p.optionId}:${p.choiceId}`),
      ['protein:protein:mogodu', 'starch:starch:pap', 'veg:veg:chakalaka'],
      'the group is recovered even though the order only stored the choice id',
    );
    assert.equal(line.key, 'plate::traditional::protein=protein:mogodu|starch=starch:pap|veg=veg:chakalaka');
  });

  test('a priced extra keeps the count the customer actually ordered', () => {
    const order = plateOrder({
      unitPrice: 150,
      options: [
        { id: 'mogodu', label: 'Mogodu (beef tripe)' },
        { id: 'pap', label: 'Pap' },
        { id: 'chakalaka', label: 'Chakalaka' },
        { id: 'ginger', label: '2 × Ginger gemere', qty: 2 },
      ],
    });
    const { lines } = reorderLines([order], catalog);
    assert.equal(lines[0].unitPrice, 150, 'two R25 bottles on a R100 plate is R150');
    const drink = lines[0].picks.find((p) => p.optionId === 'drink');
    assert.equal(drink.qty, 2);
    assert.equal(drink.priceDelta, 50);
  });

  test('an extra over the catalogue cap is clamped, not trusted', () => {
    const order = plateOrder({
      options: [
        { id: 'mogodu', label: 'Mogodu (beef tripe)' },
        { id: 'pap', label: 'Pap' },
        { id: 'chakalaka', label: 'Chakalaka' },
        { id: 'ginger', label: '99 × Ginger gemere', qty: 99 },
      ],
    });
    const { lines } = reorderLines([order], catalog);
    const drink = lines[0].picks.find((p) => p.optionId === 'drink');
    assert.equal(drink.qty, 4, 'the catalogue says four bottles, whatever the receipt claimed');
    assert.equal(lines[0].unitPrice, 100 + 4 * 25);
  });

  test('today’s price wins over the price on the old receipt', () => {
    /* The same order, but the plate now costs R115. */
    const dearer = structuredClone(catalog);
    dearer.plateMenus[0].price = 115;
    const { lines, changed } = reorderLines([plateOrder({ unitPrice: 100 })], dearer);
    assert.equal(lines[0].unitPrice, 115);
    assert.deepEqual(changed, ['Traditional Plate'], 'the screen is told the price moved');
  });

  test('a component that has left the menu is reported, never swapped', () => {
    const order = plateOrder({
      options: [
        { id: 'mogodu', label: 'Mogodu (beef tripe)' },
        { id: 'pap', label: 'Pap' },
        { id: 'morogo', label: 'Morogo' },
      ],
    });
    const { lines, missing } = reorderLines([order], catalog);
    assert.equal(lines.length, 0, 'a plate missing a side is not the plate they ordered');
    assert.match(missing[0], /Traditional Plate \(Morogo is no longer offered\)/);
  });

  test('a plate that gained a required group asks for it instead of guessing', () => {
    const changed = structuredClone(catalog);
    changed.plateMenus[0].groups.push({
      id: 'sauce', label: 'Choose your sauce', required: true, max: 1,
      items: [{ id: 'peri', label: 'Peri-peri', price: 0 }],
    });
    const { lines, missing } = reorderLines([plateOrder()], changed);
    assert.equal(lines.length, 0);
    assert.match(missing[0], /it now asks for choose your sauce/);
  });

  test('a plate menu that no longer exists is reported', () => {
    const { lines, missing } = reorderLines([{ itemId: 'plate-heritage-pots', qty: 1, options: [] }], catalog);
    assert.equal(lines.length, 0);
    assert.match(missing[0], /no longer on the site/);
  });
});

describe('reorderLines — rebuilding a dish card', () => {
  test('a dish linked to a plate is re-priced at the plate price', () => {
    const order = {
      itemId: 'tshotlo-plate',
      qty: 2,
      unitPrice: 100,
      options: [],
    };
    const { lines } = reorderLines([order], catalog);
    assert.equal(lines[0].unitPrice, 100, 'the plate price, not the card price');
    assert.equal(lines[0].qty, 2);
    assert.equal(lines[0].unitPrice * lines[0].qty, 200);
  });

  test('dish options and their counts survive', () => {
    const order = {
      itemId: 'wings-plate',
      qty: 1,
      unitPrice: 180,
      options: [
        { id: 'mash', label: 'Potato mash' },
        { id: 'ginger', label: '2 × Ginger gemere', qty: 2 },
      ],
    };
    const { lines } = reorderLines([order], catalog);
    assert.equal(lines[0].unitPrice, 130 + 50);
    assert.equal(lines[0].picks.find((p) => p.optionId === 'drink').qty, 2);
  });

  test('a dish that has left the menu is named, using the name from the receipt', () => {
    const { lines, missing } = reorderLines(
      [{ itemId: 'kota', name: 'Kota', qty: 1, options: [] }],
      catalog,
    );
    assert.equal(lines.length, 0);
    assert.deepEqual(missing, ['Kota']);
  });
});

describe('reorderLines — whole orders', () => {
  test('an unreadable order is an empty basket, never a crash', () => {
    assert.deepEqual(reorderLines(undefined, catalog), { lines: [], missing: [], changed: [] });
    assert.deepEqual(reorderLines([], {}), { lines: [], missing: [], changed: [] });
    assert.equal(reorderLines([null], catalog).lines.length, 0);
  });

  test('a mixed order rebuilds every line it can and reports the rest', () => {
    const { lines, missing } = reorderLines(
      [
        plateOrder(),
        { itemId: 'kota', name: 'Kota', qty: 1, options: [] },
        { itemId: 'wings-plate', qty: 1, unitPrice: 130, options: [{ id: 'rice', label: 'Savoury rice' }] },
      ],
      catalog,
    );
    assert.equal(lines.length, 2);
    assert.deepEqual(missing, ['Kota']);
  });

  test('quantities are clamped to something a kitchen can cook', () => {
    const { lines } = reorderLines([plateOrder({ qty: 500 })], catalog);
    assert.equal(lines[0].qty, 20);
    const zero = reorderLines([plateOrder({ qty: 0 })], catalog);
    assert.equal(zero.lines[0].qty, 1);
  });
});

describe('describeOrderItem', () => {
  test('reads as the order the customer recognises', () => {
    assert.equal(
      describeOrderItem({
        name: 'Traditional Plate',
        qty: 2,
        options: [{ label: 'Mogodu (beef tripe)' }, { label: 'Pap' }, { label: 'Chakalaka' }],
      }),
      '2 × Traditional Plate — Mogodu (beef tripe) · Pap · Chakalaka',
    );
  });

  test('a plain dish has no dangling separator', () => {
    assert.equal(describeOrderItem({ name: 'Kota', qty: 1, options: [] }), '1 × Kota');
  });
});
