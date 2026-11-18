import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_ACCURACY_M, PRECISE_ACCURACY_M, gradeFor } from '../../src/lib/geolocation.ts';

/*
 * How good a location fix is, from the accuracy the device actually reported.
 *
 * Owner, 18 Nov 2026: "ensure it obtains the precise location". What was wrong
 * was not the request — that always asked for high accuracy — but that the
 * answer was labelled precise because that was the code path that ran. A Wi-Fi
 * or cell-tower fix came back as "Location checked ✓" with a checkmark and
 * priced a delivery fee.
 *
 * These tests pin the grading to the number, which is the only thing about a fix
 * that can be trusted.
 */

test('a GPS-grade fix is precise', () => {
  assert.equal(gradeFor(5), 'precise');
  assert.equal(gradeFor(20), 'precise');
  assert.equal(gradeFor(PRECISE_ACCURACY_M), 'precise', 'the boundary is inclusive');
});

test('a fix between the two thresholds is close, not precise', () => {
  /* Outdoors but not locked on: fine to fill the box, not to settle a fee. */
  assert.equal(gradeFor(PRECISE_ACCURACY_M + 1), 'close');
  assert.equal(gradeFor(120), 'close');
  assert.equal(gradeFor(CLOSE_ACCURACY_M), 'close');
});

test('a Wi-Fi or cell-tower fix is coarse', () => {
  assert.equal(gradeFor(CLOSE_ACCURACY_M + 1), 'coarse');
  assert.equal(gradeFor(800), 'coarse');
  assert.equal(gradeFor(5_000), 'coarse');
});

test('an unknown accuracy is coarse, never precise', () => {
  /*
   * Some browsers report no accuracy at all, which arrives here as Infinity.
   * Treating "we do not know how wrong this is" as evidence of correctness is
   * how a customer gets charged a fee for the centre of the suburb.
   */
  assert.equal(gradeFor(Infinity), 'coarse');
  assert.equal(gradeFor(NaN), 'coarse');
});

test('the thresholds are ordered and cannot be inverted by a future edit', () => {
  assert.ok(PRECISE_ACCURACY_M > 0);
  assert.ok(CLOSE_ACCURACY_M > PRECISE_ACCURACY_M);
});
