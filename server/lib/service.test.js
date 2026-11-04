/**
 * Service-window and delivery-area rules.
 *
 * The kitchen cooks on Thursdays and Fridays between 12:00 and 13:30 (SAST),
 * delivers in Rosebank and Sandton, and accepts pre-orders outside the window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { serviceStatus, deliveryAreaFor, deliveryAreasLabel, serviceWindowFor, sastNow, windowLabel } from './service.js';

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
    assert.match(wednesday.shortMessage, /^Rest day/, 'the strip gets a one-liner without the full speech');
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
