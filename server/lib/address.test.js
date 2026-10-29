/**
 * The delivery-area rules and the OpenStreetMap address mapping.
 *
 * These are the two places where a wrong answer costs money: a mismatched area
 * sends a driver outside the boundary, and a broken mapping would autofill the
 * wrong street into a paid order. Both are pure functions, so they are tested
 * here rather than through a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { areasNamedIn, deliveryAddressProblem, deliveryAreaFor } from '../../shared/service.js';
import { mapPhotonFeature, mapPhotonResponse, MIN_QUERY_LENGTH, PHOTON_ENDPOINT } from '../../shared/address.js';

const settings = { deliveryAreas: ['Rosebank', 'Sandton'] };

/* ----------------------------- Area matching ---------------------------- */

test('areasNamedIn finds every approved area in a line of text', () => {
  assert.deepEqual(areasNamedIn('Corner of Rosebank Road and Sandton Drive', settings), ['Rosebank', 'Sandton']);
  assert.deepEqual(areasNamedIn('12 Oxford Road, Illovo', settings), []);
  assert.deepEqual(areasNamedIn('', settings), []);
});

test('an address that names the selected area passes', () => {
  assert.equal(deliveryAddressProblem('14 Oxford Road, Sandton', 'Sandton', settings), null);
  assert.equal(deliveryAddressProblem('Corner Bolton and Jan Smuts, Rosebank', 'Rosebank', settings), null);
});

test('an address that names a different area is an error that names both', () => {
  const problem = deliveryAddressProblem('14 Oxford Road, Rosebank', 'Sandton', settings);
  assert.equal(problem?.level, 'error');
  assert.match(problem?.message ?? '', /Rosebank/);
  assert.match(problem?.message ?? '', /Sandton/);
});

test('an address with no suburb only warns — it must never block a real order', () => {
  const problem = deliveryAddressProblem('12 Oxford Road', 'Sandton', settings);
  assert.equal(problem?.level, 'warn');
  assert.match(problem?.message ?? '', /Rosebank and Sandton/);
});

test('an empty address is left to the required-field check', () => {
  assert.equal(deliveryAddressProblem('', 'Sandton', settings), null);
  assert.equal(deliveryAddressProblem('12 Oxford Road', '', settings), null);
});

test('what the map says about a picked address outranks the typed text', () => {
  /* A street line that never repeats its suburb: the geocoder is the evidence. */
  assert.equal(deliveryAddressProblem('12 Oxford Road', 'Sandton', settings, 'Sandton'), null);
  const problem = deliveryAddressProblem('12 Oxford Road', 'Sandton', settings, 'Rosebank');
  assert.equal(problem?.level, 'error');
  assert.match(problem?.message ?? '', /Rosebank/);
});

test('"Sandtonville" is not Sandton', () => {
  assert.equal(deliveryAreaFor('12 Main Road, Sandtonville', settings), null);
  assert.equal(deliveryAddressProblem('12 Main Road, Sandtonville', 'Sandton', settings)?.level, 'warn');
});

/* --------------------------- Photon mapping ----------------------------- */

/** One Photon GeoJSON feature, shaped like the real response. */
function feature(props) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [28.05, -26.1] },
    properties: { osm_type: 'N', osm_id: 123, ...props },
  };
}

test('a street address becomes one readable line plus its suburb', () => {
  const mapped = mapPhotonFeature(
    feature({ housenumber: '12', street: 'Oxford Road', suburb: 'Illovo', city: 'Sandton', postcode: '2196' }),
    settings,
  );
  assert.equal(mapped?.line, '12 Oxford Road, Illovo, Sandton');
  assert.equal(mapped?.area, 'Sandton');
  assert.equal(mapped?.detail, 'Illovo · Sandton · 2196');
});

test('the suburb is not repeated when Photon sends it twice', () => {
  const mapped = mapPhotonFeature(feature({ name: 'Rosebank', suburb: 'Rosebank', city: 'Rosebank' }), settings);
  assert.equal(mapped?.line, 'Rosebank');
});

test('a result outside the delivery areas has no area attached', () => {
  const mapped = mapPhotonFeature(feature({ street: 'Church Street', suburb: 'Pretoria Central', city: 'Pretoria' }), settings);
  assert.equal(mapped?.area, null);
});

test('non-address results and empty payloads are dropped', () => {
  assert.equal(mapPhotonFeature(feature({ country: 'South Africa' }), settings), null);
  assert.equal(mapPhotonFeature(null, settings), null);
  assert.deepEqual(mapPhotonResponse({ features: [] }, settings), []);
  assert.deepEqual(mapPhotonResponse(null, settings), []);
});

test('duplicate lines collapse, so the list never repeats itself', () => {
  const body = {
    features: [
      feature({ housenumber: '12', street: 'Oxford Road', suburb: 'Illovo', city: 'Sandton' }),
      feature({ osm_id: 999, housenumber: '12', street: 'Oxford Road', suburb: 'Illovo', city: 'Sandton' }),
    ],
  };
  assert.equal(mapPhotonResponse(body, settings).length, 1);
});

test('the geocoder is keyless OpenStreetMap, not Google', () => {
  assert.match(PHOTON_ENDPOINT, /^https:\/\/photon\.komoot\.io\//);
  assert.ok(!/google/i.test(PHOTON_ENDPOINT));
  /* Short queries are not sent at all — every keystroke is somebody's bandwidth. */
  assert.ok(MIN_QUERY_LENGTH >= 3);
});
