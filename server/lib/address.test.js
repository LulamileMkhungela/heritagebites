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
import {
  DELIVERY_BBOX,
  DELIVERY_BBOX_PARAM,
  MIN_QUERY_LENGTH,
  PHOTON_ENDPOINT,
  applyHouseHint,
  areaForPoint,
  expandStreetAbbreviations,
  filterSuggestions,
  insideDeliveryBox,
  mapPhotonFeature,
  mapPhotonResponse,
  stripHouseNumber,
} from '../../shared/address.js';

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

/* -------------------------- Suggestion filter --------------------------- */

test('only addresses inside the delivery areas are ever offered', () => {
  const mixed = [
    { id: '1', line: '12 Oxford Road, Sandton', detail: '', area: 'Sandton' },
    { id: '2', line: '15 Oxford Road, Rosebank', detail: '', area: 'Rosebank' },
    { id: '3', line: '1 Church Street, Pretoria', detail: '', area: null },
  ];
  const kept = filterSuggestions(mixed, { areas: ['Rosebank', 'Sandton'] });
  assert.deepEqual(kept.map((s) => s.area), ['Sandton', 'Rosebank']);
});

test('a selected area narrows the list to that area', () => {
  const mixed = [
    { id: '1', line: '12 Oxford Road, Sandton', detail: '', area: 'Sandton' },
    { id: '2', line: '15 Oxford Road, Rosebank', detail: '', area: 'Rosebank' },
  ];
  assert.deepEqual(filterSuggestions(mixed, { areas: ['Rosebank', 'Sandton'], onlyArea: 'Rosebank' }).map((s) => s.line), [
    '15 Oxford Road, Rosebank',
  ]);
  /* An area the business does not deliver to narrows to nothing, not to everything. */
  assert.deepEqual(filterSuggestions(mixed, { areas: ['Rosebank', 'Sandton'], onlyArea: 'Pretoria' }), []);
});

test('the geocoder is bounded to the Rosebank/Sandton envelope', () => {
  const box = DELIVERY_BBOX;
  assert.ok(box.minLat < box.maxLat && box.minLon < box.maxLon);
  /* Rosebank and Sandton themselves must be inside the box. */
  for (const [lat, lon] of [[-26.146, 28.041], [-26.108, 28.056]]) {
    assert.ok(lat > box.minLat && lat < box.maxLat, `latitude ${lat} is outside the bbox`);
    assert.ok(lon > box.minLon && lon < box.maxLon, `longitude ${lon} is outside the bbox`);
  }
  /* Pretoria (-25.75, 28.19) must not be. */
  assert.ok(-25.75 > box.maxLat && 28.19 > box.maxLon);
  assert.equal(DELIVERY_BBOX_PARAM, [box.minLon, box.minLat, box.maxLon, box.maxLat].join(','));
});

/* ------------------- Typing, not pasting: the reported bug ---------------- */

/** A point feature, GeoJSON order: [lon, lat]. */
const at = (lon, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

test('a street result with no suburb tag is still placed by its coordinates', () => {
  /*
   * This is the exact shape Photon returns while the street name is half typed:
   * the street object, no housenumber and — the important part — no `suburb`.
   * Tag-only matching threw it away, which is why typing found nothing while
   * pasting the full address worked.
   */
  const street = at(28.0425, -26.1425, { osm_type: 'W', osm_id: 444, name: 'Oxford Road', city: 'Johannesburg', postcode: '2196' });
  const [mapped] = mapPhotonResponse({ features: [street] }, { deliveryAreas: ['Rosebank', 'Sandton'] });
  assert.equal(mapped.area, null, 'the raw mapping has no tag to go on');
  assert.equal(mapped.lat, -26.1425);
  assert.equal(mapped.lng, 28.0425);

  const shown = filterSuggestions([mapped], { areas: ['Rosebank', 'Sandton'] });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].area, 'Rosebank');
  /* The area goes where a South African address puts it: after the street. */
  assert.equal(shown[0].line, 'Oxford Road, Rosebank, Johannesburg');
  assert.equal(shown[0].detail, 'Rosebank · Johannesburg · 2196');
});

test('an untagged result outside the delivery envelope is dropped', () => {
  const pretoria = at(28.19, -25.75, { osm_type: 'W', osm_id: 555, name: 'Church Street', city: 'Pretoria' });
  const [mapped] = mapPhotonResponse({ features: [pretoria] }, { deliveryAreas: ['Rosebank', 'Sandton'] });
  assert.deepEqual(filterSuggestions([mapped], { areas: ['Rosebank', 'Sandton'] }), []);
});

test('an OpenStreetMap suburb tag beats the coordinates', () => {
  /* Deliberately contradictory: tagged Sandton, sitting on Rosebank's centre. */
  const contradictory = {
    id: 'x',
    line: '1 Somewhere',
    detail: '',
    area: 'Sandton',
    lat: -26.1445,
    lng: 28.043,
  };
  const [kept] = filterSuggestions([contradictory], { areas: ['Rosebank', 'Sandton'] });
  assert.equal(kept.area, 'Sandton');
  /* …and it is still refused when the customer asked for Rosebank only. */
  assert.deepEqual(filterSuggestions([contradictory], { areas: ['Rosebank', 'Sandton'], onlyArea: 'Rosebank' }), []);
});

test('the area centres and their radii agree with reality', () => {
  /* 173 Oxford Road, Rosebank. */
  assert.equal(areaForPoint(-26.1425, 28.0425), 'Rosebank');
  /* Sandton CBD. */
  assert.equal(areaForPoint(-26.1075, 28.055), 'Sandton');
  /* Pretoria, Bryanston and the Joburg CBD are all outside. */
  for (const [lat, lng] of [[-25.75, 28.19], [-26.05, 28.02], [-26.2041, 28.0473]]) {
    assert.equal(areaForPoint(lat, lng), null, `${lat},${lng} should not be in a delivery area`);
  }
  assert.equal(areaForPoint(undefined, 28), null);
  assert.equal(insideDeliveryBox(-26.1425, 28.0425), true);
  assert.equal(insideDeliveryBox(-25.75, 28.19), false);
});

test('the house number typed is put back onto a street-only result', () => {
  const street = { id: 'w444', line: 'Oxford Road, Rosebank, Johannesburg', detail: 'Rosebank · Johannesburg · 2196', area: 'Rosebank' };
  assert.equal(applyHouseHint([street], '173 oxf')[0].line, '173 Oxford Road, Rosebank, Johannesburg');
  /* A real house-number hit already has its own number: it must not be doubled. */
  const real = { ...street, line: '12 Oxford Road, Rosebank, Johannesburg' };
  assert.equal(applyHouseHint([real], '173 oxf')[0].line, '12 Oxford Road, Rosebank, Johannesburg');
  /* No number typed, nothing to restore. */
  assert.equal(applyHouseHint([street], 'oxf')[0].line, 'Oxford Road, Rosebank, Johannesburg');
  assert.equal(applyHouseHint([street], '173 oxf')[0].house, '173');
});

test('the house number can be stripped for a second attempt', () => {
  assert.equal(stripHouseNumber('173 oxf'), 'oxf');
  assert.equal(stripHouseNumber('173b oxford'), 'oxford');
  assert.equal(stripHouseNumber('oxford road'), 'oxford road');
});

test('street abbreviations are expanded, but a leading St stays a saint', () => {
  assert.equal(expandStreetAbbreviations('173 oxford rd'), '173 oxford road');
  assert.equal(expandStreetAbbreviations('12 Oxford Ave, rosebank'), '12 Oxford avenue, rosebank');
  assert.equal(expandStreetAbbreviations('St Andrews Rd'), 'St Andrews road');
  assert.equal(expandStreetAbbreviations('173 oxf'), '173 oxf');
});
