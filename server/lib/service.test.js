/**
 * Service-window and delivery-area rules.
 *
 * The kitchen cooks on Thursdays and Fridays between 12:00 and 13:30 (SAST),
 * delivers in Rosebank and Sandton, and accepts pre-orders outside the window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { serviceStatus, deliveryAreaFor, deliveryAreasLabel, serviceWindowFor, sastNow, windowLabel, parseSpecialServiceDays, specialServiceDayFor, mergeSpecialServiceDays, extraCost, extraLabel, maxPerExtra, maxPortions, portionCost, bookableDates, bookableDateFor } from './service.js';
import { plateMenus, menu, sides } from '../seed.js';

const settings = {
  hours: [
    { day: 0, label: 'Sunday', closed: true },
    { day: 1, label: 'Monday', closed: true },
    { day: 2, label: 'Tuesday', closed: true },
    { day: 3, label: 'Wednesday', closed: true },
    { day: 4, label: 'Thursday', open: '12:00', close: '13:30', closed: false },
    { day: 5, label: 'Friday', open: '12:00', close: '13:30', closed: false },
    { day: 6, label: 'Saturday', closed: true },
  ],
  deliveryAreas: ['Rosebank', 'Sandton'],
  serviceWindow: { open: '12:00', close: '13:30' },
};

/** A UTC instant for a given Johannesburg wall-clock time (SAST is UTC+2). */
const sast = (isoDay, hhmm) => new Date(`${isoDay}T${hhmm}:00+02:00`);

describe('service window', () => {
  test('reads Johannesburg wall-clock time regardless of host timezone', () => {
    const at = sastNow(sast('2026-10-29', '12:15'));
    assert.equal(at.day, 4);
    assert.equal(at.dayLabel, 'Thursday');
    assert.equal(at.timeLabel, '12:15');
    assert.equal(at.minutes, 12 * 60 + 15);
  });

  test('is open inside the Thursday window and closed outside it', () => {
    assert.equal(serviceStatus(settings, sast('2026-10-29', '11:59')).open, false);
    assert.equal(serviceStatus(settings, sast('2026-10-29', '12:00')).open, true);
    assert.equal(serviceStatus(settings, sast('2026-10-29', '13:30')).open, true, 'the close time is inclusive');
    assert.equal(serviceStatus(settings, sast('2026-10-29', '13:31')).open, false);
    assert.equal(serviceStatus(settings, sast('2026-10-29', '18:00')).open, false);
  });

  test('is closed on the five non-service days', () => {
    for (const day of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-31', '2026-11-01']) {
      assert.equal(serviceStatus(settings, sast(day, '12:30')).open, false, `${day} should be closed`);
    }
    assert.equal(serviceStatus(settings, sast('2026-10-30', '12:30')).open, true, 'Friday service');
  });

  test('names the next window instead of pretending the kitchen is open', () => {
    // Tuesday lunchtime: the next service is Thursday.
    const tuesday = serviceStatus(settings, sast('2026-10-27', '12:30'));
    assert.equal(tuesday.open, false);
    assert.equal(tuesday.nextWindowLabel, 'Thursday 12:00–13:30');

    // Thursday after close: the window is Friday.
    const thursdayLate = serviceStatus(settings, sast('2026-10-29', '15:00'));
    assert.equal(thursdayLate.nextWindowLabel, 'Friday 12:00–13:30');

    // Friday after close: the window wraps to next Thursday.
    const fridayLate = serviceStatus(settings, sast('2026-10-30', '16:00'));
    assert.equal(fridayLate.nextWindowLabel, 'Thursday 12:00–13:30');

    // Thursday morning: still today's window.
    const thursdayMorning = serviceStatus(settings, sast('2026-10-29', '08:00'));
    assert.equal(thursdayMorning.nextWindowLabel, 'Thursday 12:00–13:30');
  });

  test('a day the kitchen never cooks on is a rest day, not a temporary closure', () => {
    const wednesday = serviceStatus(settings, sast('2026-10-28', '12:30'));
    assert.equal(wednesday.open, false);
    assert.equal(wednesday.isServiceDay, false);
    assert.equal(wednesday.headline, 'Wednesday is a rest day');
    /*
     * Owner, 19 Nov 2026: the rest-day copy must say we are not cooking, that
     * the customer can still schedule any cooking day ahead, and that the
     * kitchen needs a day or two — 24 hours at the floor — plus catering on
     * WhatsApp.
     *
     * The assertions are on those commitments rather than on the previous
     * sentence, so the wording can be rewritten without the test having to pin
     * it word for word. What must not drift is the substance.
     */
    assert.match(wednesday.message, /not cooking today/i);
    assert.match(wednesday.message, /Thursdays and Fridays/);
    assert.match(wednesday.message, /still order|nothing is blocked/i, 'it must say ordering is not blocked');
    assert.match(wednesday.message, /24 hours/i, 'the 24-hour floor must be stated');
    assert.match(wednesday.message, /day or two/i, 'the ask for notice must be stated');
    assert.match(wednesday.message, /catering/i, 'catering is offered');
    assert.match(wednesday.message, /WhatsApp/i);
    assert.match(wednesday.message, /Thursday 12:00–13:30/);
    assert.doesNotMatch(wednesday.message, /closed right now/i);

    /*
     * The strip prints the headline first, so the one-liner must add to it
     * rather than repeat "Rest day" back to the reader — and it must still
     * carry the three things a customer needs without opening anything.
     */
    assert.match(wednesday.shortMessage, /^Not cooking today/, 'the strip gets a one-liner without the full speech');
    assert.doesNotMatch(wednesday.shortMessage, /^Rest day/);
    assert.match(wednesday.shortMessage, /24 hours/);
    assert.match(wednesday.shortMessage, /catering/i);

    // Same behaviour for the other closed days, with that day's own name.
    const monday = serviceStatus(settings, sast('2026-10-26', '09:00'));
    assert.equal(monday.headline, 'Monday is a rest day');
    assert.match(monday.message, /^We are not cooking today/);
  });

  test('a cooking day outside the window reads differently from a rest day', () => {
    const early = serviceStatus(settings, sast('2026-10-29', '08:00'));
    assert.equal(early.isServiceDay, true);
    assert.equal(early.headline, 'Not cooking yet');
    assert.match(early.message, /pots go on at 12:00/);

    const late = serviceStatus(settings, sast('2026-10-29', '15:00'));
    assert.equal(late.isServiceDay, true);
    assert.equal(late.headline, "Today's window has closed");
    assert.match(late.message, /Friday 12:00–13:30/);
  });

  test('an open kitchen states the closing time and the days it trades', () => {
    const open = serviceStatus(settings, sast('2026-10-30', '12:15'));
    assert.equal(open.headline, 'Serving now');
    assert.match(open.message, /until 13:30/);
    assert.deepEqual(open.serviceDays, ['Thursday', 'Friday']);
  });

  test('the window label comes from the configured hours', () => {
    assert.equal(windowLabel(settings), '12:00–13:30');
    assert.equal(windowLabel({ hours: [] , serviceWindow: { open: '11:00', close: '14:00' } }), '11:00–14:00');
  });

  test('a pre-order is labelled with the window it will be cooked in', () => {
    const planned = serviceWindowFor(settings, sast('2026-10-27', '09:00'));
    assert.equal(planned.isPreOrder, true);
    assert.equal(planned.plannedFor, 'Thursday 12:00–13:30');

    const live = serviceWindowFor(settings, sast('2026-10-29', '12:10'));
    assert.equal(live.isPreOrder, false);
    assert.match(live.label, /^Now/);
  });
});

describe('delivery boundary', () => {
  test('matches the two approved areas, case-insensitively', () => {
    assert.equal(deliveryAreaFor('12 Rivonia Road, Sandton', settings), 'Sandton');
    assert.equal(deliveryAreaFor('15 OXFORD ROAD, ROSEBANK', settings), 'Rosebank');
    assert.equal(deliveryAreaFor('Illovo, Sandton 2196', settings), 'Sandton');
  });

  test('refuses addresses outside Rosebank and Sandton', () => {
    assert.equal(deliveryAreaFor('1 Church Street, Pretoria', settings), null);
    assert.equal(deliveryAreaFor('', settings), null);
    assert.equal(deliveryAreaFor('   ', settings), null);
  });

  test('a lookalike suburb is not accepted', () => {
    assert.equal(deliveryAreaFor('1 Main Road, Sandtonville', settings), null, 'whole-word matching only');
    assert.equal(deliveryAreaFor('Rosebank Avenue, Randburg', settings), 'Rosebank');
  });

  test('the label reads naturally in customer copy', () => {
    assert.equal(deliveryAreasLabel(settings), 'Rosebank and Sandton');
    assert.equal(deliveryAreasLabel({ deliveryAreas: ['Rosebank'] }), 'Rosebank');
    assert.equal(deliveryAreasLabel({ deliveryAreas: [] }), '');
  });
});

/* --------------------------------------------------------------------- */
/* One-off service days                                                   */
/*                                                                        */
/* A Saturday market or holiday trading day opens the kitchen once, on a   */
/* calendar date, without touching the weekly Thursday/Friday rhythm.      */
/* --------------------------------------------------------------------- */

const withSpecial = (days) => ({ ...settings, specialServiceDays: days });

describe('special service days', () => {
  test('a Saturday with a special opening trades like a service day, once', () => {
    const s = withSpecial(['2026-10-31']);
    const before = serviceStatus(s, sast('2026-10-31', '09:00'));
    assert.equal(before.isServiceDay, true);
    assert.equal(before.specialToday, true);
    assert.equal(before.open, false);
    assert.equal(before.headline, 'Not cooking yet');
    assert.match(before.message, /special opening/i);

    const during = serviceStatus(s, sast('2026-10-31', '12:30'));
    assert.equal(during.open, true);
    assert.equal(during.specialToday, true);
    assert.match(during.message, /special opening/i);

    // The very next Saturday is a rest day again — the date never repeats.
    const nextWeek = serviceStatus(s, sast('2026-11-07', '12:30'));
    assert.equal(nextWeek.open, false);
    assert.equal(nextWeek.specialToday, false);
    assert.equal(nextWeek.headline, 'Saturday is a rest day');
  });

  test('after the special window the orders gate closes, like a Thursday', () => {
    const s = withSpecial(['2026-10-31']);
    const after = serviceStatus(s, sast('2026-10-31', '14:00'));
    assert.equal(after.open, false);
    assert.equal(after.orderingClosed, true);
    // The next window is named, so the customer has a next step.
    assert.match(after.message, /Thursday 12:00–13:30/);
  });

  test('a special opening can carry its own hours and label', () => {
    const s = withSpecial([{ date: '2026-10-31', open: '10:00', close: '14:00', label: 'Saturday market' }]);
    assert.equal(serviceStatus(s, sast('2026-10-31', '10:30')).open, true);
    assert.equal(serviceStatus(s, sast('2026-10-31', '09:30')).todayLabel, 'Saturday market 10:00–14:00');
    const after = serviceStatus(s, sast('2026-10-31', '13:45'));
    assert.equal(after.open, true, 'close is the special close, not the weekly one');
    assert.equal(serviceStatus(s, sast('2026-10-31', '14:01')).orderingClosed, true);
  });

  test('a special day tomorrow is named as the next window from today', () => {
    // Saturday with only Sunday 2026-11-01 opened: Saturday still takes
    // pre-orders, and the site must point at Sunday, not Thursday.
    const s = withSpecial(['2026-11-01']);
    const st = serviceStatus(s, sast('2026-10-31', '12:30'));
    assert.equal(st.headline, 'Saturday is a rest day');
    assert.match(st.nextWindowLabel, /Sunday 1 Nov \(special opening\) 12:00–13:30/);
  });

  test('pre-orders on a special morning are filed against that day', () => {
    const s = withSpecial(['2026-10-31']);
    const planned = serviceWindowFor(s, sast('2026-10-31', '08:00'));
    assert.equal(planned.isPreOrder, true);
    assert.match(planned.plannedFor, /Saturday 31 Oct \(special opening\) 12:00–13:30/);
  });

  test('an in-window order on a special day is for today', () => {
    const s = withSpecial(['2026-10-31']);
    const planned = serviceWindowFor(s, sast('2026-10-31', '12:15'));
    assert.equal(planned.isPreOrder, false);
    assert.match(planned.plannedFor, /Saturday 31 Oct \(special opening\) 12:00–13:30/);
  });

  test('malformed special-day config never opens the shop', () => {
    for (const bad of ['not-a-date', '2026-13-40', '2026-02-31', '', '31/10/2026']) {
      const s = withSpecial([bad]);
      assert.equal(serviceStatus(s, sast('2026-10-31', '12:30')).open, false, bad);
    }
  });

  test('parseSpecialServiceDays keeps real dates only, and dedupes', () => {
    assert.deepEqual(
      parseSpecialServiceDays(' 2026-11-14, 2026-02-31; 2026-11-14  nonsense | 2026-12-05 '),
      ['2026-11-14', '2026-12-05'],
    );
    assert.deepEqual(parseSpecialServiceDays(undefined), []);
    assert.deepEqual(parseSpecialServiceDays('not bad at all'), []);
  });

  test('the env merge adds dates the catalogue does not name, catalogue wins per date', () => {
    const merged = mergeSpecialServiceDays(
      { specialServiceDays: [{ date: '2026-11-14', open: '10:00', close: '14:00', label: 'Market' }] },
      ['2026-11-14', '2026-11-21'],
    );
    assert.deepEqual(merged.specialServiceDays, [
      { date: '2026-11-14', open: '10:00', close: '14:00', label: 'Market' },
      { date: '2026-11-21' },
    ]);
  });

  test('specialServiceDayFor matches the configured serviceWindow by default', () => {
    const entry = specialServiceDayFor(withSpecial(['2026-10-31']), '2026-10-31', 6);
    assert.equal(entry.open, '12:00');
    assert.equal(entry.close, '13:30');
    assert.equal(entry.special, true);
    assert.equal(specialServiceDayFor(withSpecial(['2026-10-31']), '2026-10-30', 5), null);
    assert.equal(specialServiceDayFor(settings, '2026-10-31', 6), null, 'no special days configured on this settings object');
    assert.equal(specialServiceDayFor(settings, 'garbage', 6), null);
  });
});

/* ------------------- Extras: how many, and what that costs ------------- */

/*
 * Owner, 14 Nov 2026 — "have ability to add extras like how its done on
 * ubereats". The mechanism is a count on a priced extra, so these four helpers
 * are the whole behaviour: cap it, price it, and say it.
 */

test('an extra carries a count, and the count is clamped to the catalogue', () => {
  /* Nothing declared means one — a starch is a choice, not a quantity. */
  assert.equal(maxPerExtra(), 1);
  assert.equal(maxPerExtra(null, null), 1);
  /* The drink declares four. */
  assert.equal(maxPerExtra({ max: 1 }, { max: 4 }), 4);
  /* The choice's own cap beats the group's, which is about selections. */
  assert.equal(maxPerExtra({ max: 1 }, { max: 4 }), 4);
  /* Nothing may exceed the sanity ceiling, however it is asked for. */
  assert.equal(maxPerExtra({ max: 999 }, { max: 999 }), 20);
  /* And nothing may be zero or negative. */
  assert.equal(maxPerExtra({ max: 0 }, { max: -3 }), 1);
});

test('a second bottle costs a second R25, not a second plate', () => {
  assert.equal(extraCost(25, 1), 25);
  assert.equal(extraCost(25, 2), 50, 'two bottles, one plate');
  assert.equal(extraCost(25, 4), 100);
  /* A missing count is one — an older bundle that never sent one is not free. */
  assert.equal(extraCost(25), 25);
  assert.equal(extraCost(25, 0), 25);
  /* The ceiling matches the label ceiling, so price and text cannot disagree. */
  assert.equal(extraCost(25, 999), 500);
});

test('one is silent, more than one is stated', () => {
  assert.equal(extraLabel('Ginger gemere', 1), 'Ginger gemere');
  assert.equal(extraLabel('Ginger gemere'), 'Ginger gemere');
  assert.equal(extraLabel('Ginger gemere', 2), '2 × Ginger gemere');
  assert.equal(extraLabel('Ginger gemere', 999), '20 × Ginger gemere');
});

test('the drink in the seed allows four bottles on one plate', () => {
  /*
   * The catalogue and the helpers have to agree. A seed that says "max: 1" while
   * the UI renders a stepper would let a customer tap a second bottle and watch
   * the server charge for one.
   *
   * The `max` of a group was overloaded when starch and vegetable side became
   * multi-select (owner, 16 Nov 2026): for a *priced* group it still means "how
   * many of one item", but for an included group it now means "how many
   * selections fit". That is why the assertions below split on `priced` rather
   * than assuming every non-drink group is one.
   */
  const group = plateMenus[0].groups.find((g) => g.id === 'drink');
  assert.ok(group?.priced, 'the drink group is priced');
  assert.equal(maxPerExtra(group, group.items[0]), 4);

  /* Protein is still exactly one — a plate carries one protein. */
  const protein = plateMenus[0].groups.find((g) => g.id === 'protein');
  assert.equal(maxPerExtra(protein, protein.items[0]), 1, 'protein must stay a single choice');

  /*
   * Starch and vegetable side take up to three *selections* each, and now also
   * up to four *portions* of any one of them (owner, 19 Nov 2026: "can we have
   * similar functionality like we have on add soft drink so the user can set if
   * they want more than 1 pap, etc but when they add more than 1 pap or any the
   * price goes up").
   *
   * The two caps are different questions and live on different objects. The
   * group's `max` counts how many different choices fit; the item's own `max`
   * counts portions of one choice, and is what turns the row into a stepper. If
   * the item cap were left to fall back to the group's, three helpings of pap
   * would pass for free — the exact bug this asserts against.
   */
  for (const plate of plateMenus) {
    for (const id of ['starch', 'veg']) {
      const g = plate.groups.find((x) => x.id === id);
      assert.equal(g.max, 3, `${plate.id}/${id} allows three selections`);
      assert.equal(g.items[0].max, 4, `${plate.id}/${id} items carry their own portion cap`);
      assert.ok(maxPortions(g.items[0]) > g.max, `${plate.id}/${id} portions are not capped by the selection cap`);
    }
  }
});

test('the first portion of a starch or side is included, the rest are charged', () => {
  /*
   * The rule the owner asked for, stated as arithmetic.
   *
   * One pap is part of the R100 plate — it is what the plate price buys — so it
   * must cost nothing. Two pap is one extra bowl of food the kitchen cooks and
   * packs separately, so it is charged; three is two bowls.
   */
  const pap = plateMenus[0].groups.find((g) => g.id === 'starch').items[0];
  assert.equal(pap.extraAfter, 1, 'one portion is included');
  assert.ok(pap.extraPrice > 0, 'a further portion is charged');

  assert.equal(portionCost(pap, 1), 0, 'one pap is inside the plate price');
  assert.equal(portionCost(pap, 2), pap.extraPrice, 'two pap is one extra portion');
  assert.equal(portionCost(pap, 3), pap.extraPrice * 2, 'three pap is two extra portions');
  assert.equal(portionCost(pap, 4), pap.extraPrice * 3);

  /*
   * Nothing may be charged beyond the cap the UI allows — and the cap is applied
   * by clamping the count first, exactly as every caller does (`Math.min(cap,
   * …)`). `portionCost` itself only enforces the same 1..20 sanity ceiling that
   * `extraCost` does, so a hand-made request cannot run away; it does not know
   * about the catalogue's cap. Asserting the composition is what the customer
   * actually gets.
   */
  const capped = Math.min(maxPortions(pap), 99);
  assert.equal(capped, pap.max, 'four is the ceiling the catalogue sets');
  assert.equal(portionCost(pap, capped), pap.extraPrice * 3, 'four pap is three extra portions');
  /* Even uncapped it stops at the shared ceiling rather than pricing 98 bowls. */
  assert.equal(portionCost(pap, 99), pap.extraPrice * 19);

  /* A protein has no extra-portion rule, so it can never add money however it
     is counted. */
  const protein = plateMenus[0].groups.find((g) => g.id === 'protein').items[0];
  assert.equal(portionCost(protein, 3), 0, 'a protein carries no portion rule');

  /*
   * An extra portion costs the same as the bowl sold on its own. A menu that
   * charged one amount for a bowl of pap and another for the identical second
   * bowl inside a plate would be contradicting itself.
   */
  /* Chakalaka is sold both ways: inside a plate, and by the bowl in Sides &
     Relishes. Both prices come from the same number, in the seed. */
  const chakalaka = plateMenus[0].groups.find((g) => g.id === 'veg').items.find((i) => i.id === 'chakalaka');
  const chakalakaSide = sides.find((x) => x.id === 'side-chakalaka');
  assert.ok(chakalakaSide, 'chakalaka is sold by the bowl');
  assert.equal(chakalaka.extraPrice, chakalakaSide.price, 'an extra portion costs the same as the bowl');
});

test('every starch and every side carries the extra-portion rule', () => {
  /*
   * Both menus, every choice. One forgotten side is a side where a second
   * helping arrives free — and it would be the least-tested one, so the sweep
   * matters more than the spot check above.
   */
  for (const plate of plateMenus) {
    for (const id of ['starch', 'veg']) {
      const g = plate.groups.find((x) => x.id === id);
      assert.ok(g, `${plate.id} has a ${id} group`);
      for (const item of g.items) {
        assert.equal(item.extraAfter, 1, `${plate.id}/${id}/${item.id} includes one portion`);
        assert.ok(item.extraPrice > 0, `${plate.id}/${id}/${item.id} charges for a second`);
        assert.ok(item.max > 1, `${plate.id}/${id}/${item.id} offers a stepper`);
      }
    }
  }
});

test('the dish-card choices carry the same rule as the plate builder', () => {
  /*
   * The same starch is sold two ways — inside the plate builder and on a dish
   * card — and the two must price an extra portion identically. They are
   * different shapes (`groups[].items` vs `options[].choices`), which is exactly
   * how one of them ends up free.
   */
  const card = menu.find((m) => m.plateId);
  const starchOpt = card.options.find((o) => o.id === 'starch');
  assert.ok(starchOpt, 'the dish card offers a starch');
  const pap = starchOpt.choices.find((c) => c.id === 'pap');
  const platePap = plateMenus[0].groups.find((g) => g.id === 'starch').items.find((i) => i.id === 'pap');
  assert.equal(pap.extraPrice, platePap.extraPrice);
  assert.equal(pap.extraAfter, platePap.extraAfter);
  assert.equal(portionCost(pap, 2), portionCost(platePap, 2));
});

test('the multi-select groups are the same shape on both menus', () => {
  /* The traditional and contemporary builders are two records that must answer
     the same question the same way, or the rule would depend on which plate a
     customer picked. */
  for (const plate of plateMenus) {
    const starch = plate.groups.find((g) => g.id === 'starch');
    const veg = plate.groups.find((g) => g.id === 'veg');
    const protein = plate.groups.find((g) => g.id === 'protein');
    assert.equal(starch.max, 3, `${plate.id}: starch holds three`);
    assert.equal(veg.max, 3, `${plate.id}: vegetable side holds three`);
    assert.equal(protein.max, 1, `${plate.id}: protein holds one`);
  }
});

test('a dish card offers the same multi-select starch and side', () => {
  /*
   * The plate builder is not the only way to reach these questions — tapping a
   * single dish opens a card with the same groups. If the card stayed
   * single-choice the rule would change depending on which button was pressed.
   */
  const dish = menu.find((m) => m.id === 'mogodu-plate') ?? menu.find((m) => Array.isArray(m.options) && m.options.length);
  const starch = dish.options.find((o) => o.id === 'starch');
  const veg = dish.options.find((o) => o.id === 'veg');
  assert.equal(starch.multiple, true, 'dish card starch is multi-select');
  assert.equal(starch.max, 3);
  assert.equal(veg.multiple, true, 'dish card vegetable side is multi-select');
  assert.equal(veg.max, 3);
});


describe('booking ahead', () => {
  /* A Saturday, so "today" is not a cooking day and the list must start later. */
  const sabbath = sast('2026-11-14', '09:00');

  test('a rest day offers every Thursday and Friday ahead, not just the next one', () => {
    const days = bookableDates(settings, sabbath);
    assert.ok(days.length >= 8, `expected several weeks of days, got ${days.length}`);
    /* The first two are the coming Thursday and Friday. */
    assert.equal(days[0].date, '2026-11-19');
    assert.equal(days[0].label, 'Thursday 19 Nov');
    assert.equal(days[1].date, '2026-11-20');
    /* And the list keeps going — the whole point of the owner's request. */
    assert.equal(days[2].date, '2026-11-26');
    assert.equal(days[3].date, '2026-11-27');
    assert.equal(days[4].date, '2026-12-03');
  });

  test('every day offered is a Thursday or a Friday, and the window is the kitchen window', () => {
    for (const d of bookableDates(settings, sabbath)) {
      const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
      assert.ok(weekday === 4 || weekday === 5, `${d.date} is neither Thursday nor Friday`);
      assert.equal(d.open, '12:00');
      assert.equal(d.close, '13:30');
    }
  });

  test('today is offered while it is still orderable and dropped once it is not', () => {
    /* Thursday morning: today is a cooking day that has not started. */
    const before = bookableDates(settings, sast('2026-11-19', '08:00'));
    assert.equal(before[0].date, '2026-11-19');
    assert.equal(before[0].isToday, true);

    /* Thursday afternoon, window gone: today must not be on the list. */
    const after = bookableDates(settings, sast('2026-11-19', '15:00'));
    assert.equal(after[0].date, '2026-11-20');
    assert.ok(!after.some((d) => d.date === '2026-11-19'), 'a closed window is not bookable');
  });

  test('the horizon is bounded, so the diary does not stretch to next year', () => {
    const days = bookableDates(settings, sabbath, { limit: 200 });
    const last = days[days.length - 1];
    const spanDays = (new Date(`${last.date}T00:00:00Z`) - new Date('2026-11-14T00:00:00Z')) / 86400000;
    assert.ok(spanDays <= 8 * 7, `the 8-week horizon was exceeded (${spanDays} days)`);
  });

  test('a special opening appears in the list as well as on the calendar', () => {
    const s = withSpecial([{ date: '2026-11-21', open: '10:00', close: '14:00', label: 'Saturday market' }]);
    const days = bookableDates(s, sabbath);
    const market = days.find((d) => d.date === '2026-11-21');
    assert.ok(market, 'the special date is bookable');
    assert.equal(market.label, 'Saturday market');
    assert.equal(market.open, '10:00');
    assert.equal(market.special, true);
  });

  test('an order can name a day, and a day outside the diary is refused', () => {
    const chosen = bookableDateFor(settings, '2026-12-03', sabbath);
    assert.ok(chosen, 'December 3rd is a Thursday, eight weeks inside the horizon from mid-November');
    assert.equal(chosen.label, 'Thursday 3 Dec');
    assert.equal(chosen.open, '12:00');

    /* Not a cooking day, not a real date, and absurdly far out. */
    assert.equal(bookableDateFor(settings, '2026-11-22', sabbath), null, 'a Sunday is not a cooking day');
    assert.equal(bookableDateFor(settings, '2026-02-31', sabbath), null, 'a date that does not exist');
    assert.equal(bookableDateFor(settings, '2031-01-02', sabbath), null, 'past the horizon');
    assert.equal(bookableDateFor(settings, '', sabbath), null);
    assert.equal(bookableDateFor(settings, null, sabbath), null);
  });

  test('a booked order stores the day the customer chose, not the next window', () => {
    const chosen = bookableDateFor(settings, '2026-12-03', sabbath);
    const note = serviceWindowFor(settings, sabbath, chosen);
    assert.equal(note.plannedFor, 'Thursday 3 Dec');
    assert.equal(note.date, '2026-12-03');
    assert.equal(note.isPreOrder, true);
    assert.equal(note.booked, true);

    /* With no booking the old behaviour is unchanged. */
    const implicit = serviceWindowFor(settings, sabbath);
    assert.equal(implicit.plannedFor, 'Thursday 12:00–13:30');
    assert.equal(implicit.booked, false);
  });
});
