/**
 * Service-window and delivery-area rules.
 *
 * The kitchen cooks on Thursdays and Fridays between 12:00 and 13:30 (SAST),
 * delivers in Rosebank and Sandton, and accepts pre-orders outside the window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { serviceStatus, deliveryAreaFor, deliveryAreasLabel, serviceWindowFor, sastNow, windowLabel, parseSpecialServiceDays, specialServiceDayFor, mergeSpecialServiceDays } from './service.js';

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
    // Warm and professional, but it still says when the food will be cooked and
    // that daily trading is the plan — without inventing a launch date.
    assert.match(wednesday.message, /pots are resting/i);
    assert.match(wednesday.message, /Thursdays and Fridays/);
    // The strip prints the headline first, so the one-liner must add to it
    // rather than repeat the word "Rest day" back to the reader.
    assert.match(wednesday.shortMessage, /^We cook/, 'the strip gets a one-liner without the full speech');
    assert.doesNotMatch(wednesday.shortMessage, /^Rest day/);
    assert.match(wednesday.message, /every day/i);
    assert.match(wednesday.message, /Thursday 12:00–13:30/);
    assert.doesNotMatch(wednesday.message, /closed right now/i);

    // Same behaviour for the other closed days, with that day's own name.
    const monday = serviceStatus(settings, sast('2026-10-26', '09:00'));
    assert.equal(monday.headline, 'Monday is a rest day');
    assert.match(monday.message, /^The pots are resting today/);
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
