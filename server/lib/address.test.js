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
import { settings as seedSettings } from '../seed.js';
import { areasNamedIn, defaultDeliveryArea, deliveryAddressProblem, deliveryAreaFor, deliveryAreaOptions, isOutsideAreaChoice } from '../../shared/service.js';
import {
  DELIVERY_BBOX,
  DELIVERY_BBOX_PARAM,
  MIN_QUERY_LENGTH,
  PHOTON_ENDPOINT,
  applyHouseHint,
  areaForPoint,
  expandStreetAbbreviations,
  filterSuggestions,
  DELIVERY_RADIUS_BBOX,
  DELIVERY_ZONES,
  KITCHEN_ORIGIN,
  REFERENCE_FAR_ADDRESS,
  radiusBbox,
  radiusBboxParam,
  deliveryFeeForPoint,
  deliveryZoneFor,
  haversineKm,
  mapPhotonReverse,
  insideDeliveryBox,
  mapPhotonFeature,
  mapPhotonResponse,
  stripHouseNumber,
} from '../../shared/address.js';

const settings = { deliveryAreas: ['Rosebank', 'Sandton'] };

/** Is a point inside an envelope? Used by the envelope tests below. */
const inBox14 = (b, lat, lng) => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLon && lng <= b.maxLon;
/*
 * The third option, spelled the way the site now shows it (owner, 16 Nov 2026:
 * "remove Outside Sandton & Rosebank"). The old long label is still recognised,
 * which the last test in this group checks, so a cached bundle keeps working.
 */
const OUTSIDE = 'Another area — within 15 km';
const OUTSIDE_LEGACY = 'Other — outside Sandton & Rosebank';

/* ------------------------- The delivery radius -------------------------- */

/*
 * The owner's rule (14 Nov 2026): delivery is in the plate price inside
 * Sandton/Rosebank, a fee applies outside that ring, and past 50 km the order is
 * refused. These are the three answers every delivery surface depends on, and
 * the numbers are the ones that decide whether the business makes or loses money
 * on a trip.
 */

test('a point inside the Sandton/Rosebank ring is delivered at the plate price', () => {
  /* Sandton CBD and Rosebank station: the two centres the kitchen serves. */
  for (const [label, lat, lng] of [
    ['Sandton CBD', -26.1075, 28.055],
    ['Rosebank', -26.1445, 28.043],
  ]) {
    const zone = deliveryZoneFor(lat, lng);
    assert.equal(zone.zone, 'included', `${label} is inside the included ring`);
    assert.equal(deliveryFeeForPoint(lat, lng), 0, `${label} pays no delivery fee`);
  }
});

test('a point outside the ring is served at a fee, not refused', () => {
  /* Bryanston: about 9 km out — past the ring, well inside the 50 km limit. */
  const zone = deliveryZoneFor(-26.0515, 28.0207, { fee: 45 });
  assert.equal(zone.zone, 'surcharge');
  assert.equal(zone.fee, 45, 'the configured fee is used, not a hard-coded one');
  assert.equal(deliveryFeeForPoint(-26.0515, 28.0207, { fee: 45 }), 45);
  assert.ok(zone.distanceKm > 6 && zone.distanceKm < 20, `distance reads ${zone.distanceKm} km`);
});

test('past the hard limit the order is refused, and the distance is reported', () => {
  /* Heidelberg: 52 km from the kitchen — over the 50 km limit. */
  const zone = deliveryZoneFor(-26.5047, 28.3586);
  assert.equal(zone.zone, 'refused');
  assert.ok(zone.distanceKm > 50, `reported ${zone.distanceKm} km`);
  assert.equal(deliveryFeeForPoint(-26.5047, 28.3586), -1, 'no fee buys a delivery this far out');
});

test('an unmeasurable address is never treated as too far', () => {
  /*
   * A hand-typed address has no coordinates. Refusing it would block a real
   * Sandton customer whose street the map does not know, so "unknown" is its
   * own answer and every caller has to decide what to do with it.
   */
  assert.equal(deliveryZoneFor(null, null).zone, 'unknown');
  assert.equal(deliveryZoneFor(undefined, undefined).zone, 'unknown');
  assert.equal(deliveryZoneFor(Number.NaN, 28.05).zone, 'unknown');
  assert.equal(deliveryFeeForPoint(null, null), 0, 'an unknown point is priced as included, never refused');
});

test('the radius rules are configurable, so the owner can change the fee', () => {
  /* The values live in settings; the maths must follow them, not constants. */
  const tight = deliveryZoneFor(-26.0515, 28.0207, { includedTo: 2, maxKm: 8, fee: 99 });
  assert.equal(tight.zone, 'refused', 'a tighter limit refuses Bryanston');

  const wide = deliveryZoneFor(-26.5047, 28.3586, { maxKm: 80, fee: 120 });
  assert.equal(wide.zone, 'surcharge', 'a wider limit serves Heidelberg, at a fee');
  assert.equal(wide.fee, 120);
});

test('distance is a real great-circle distance, not a bounding box', () => {
  /* Sandton to Rosebank is about 4.2 km on the ground. */
  const d = haversineKm(-26.1075, 28.055, -26.1445, 28.043);
  assert.ok(d > 3.9 && d < 4.6, `Sandton–Rosebank measures ${d.toFixed(2)} km`);
  assert.equal(haversineKm(-26.1, 28.05, -26.1, 28.05), 0);
});

/* --------------------------- The default area --------------------------- */

test('the checkout opens on Rosebank', () => {
  /*
   * The owner's instruction: "rosebank must be selected by default and remove
   * choose an area". Rosebank is preferred by name, not by position, so a
   * reordered catalogue cannot quietly change which area a customer orders for.
   */
  assert.equal(defaultDeliveryArea({ deliveryAreas: ['Rosebank', 'Sandton'] }), 'Rosebank');
  assert.equal(defaultDeliveryArea({ deliveryAreas: ['Sandton', 'Rosebank'] }), 'Rosebank');
  assert.equal(defaultDeliveryArea({ deliveryAreas: ['sandton', 'ROSEBANK'] }), 'ROSEBANK');
});

test('a catalogue without Rosebank still preselects something in-area', () => {
  assert.equal(defaultDeliveryArea({ deliveryAreas: ['Sandton'] }), 'Sandton');
  assert.equal(defaultDeliveryArea({ deliveryAreas: [] }), '');
  assert.equal(defaultDeliveryArea(null), '');
});

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
  /*
   * The warning used to tell the customer to "choose collection" if they were
   * outside the two suburbs. Collection is gone, and a customer 20 km out is a
   * paying delivery rather than an error, so the advice is about the address
   * itself — which is the only thing the customer can still act on.
   */
  assert.match(problem?.message ?? '', /suburb and city/);
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

test('an untagged result inside the envelope but outside both areas is dropped', () => {
  /*
   * "12 Oxford Road, Johannesburg · 2001" — the CBD. Inside the search envelope,
   * seven kilometres from Rosebank, and with no suburb tag to say otherwise.
   * Showing it under a Sandton search was the owner's complaint; being inside the
   * envelope is not evidence that the kitchen can reach it.
   */
  const cbd = at(28.0455, -26.2035, { osm_type: 'W', osm_id: 777, name: 'Oxford Road', city: 'Johannesburg', postcode: '2001' });
  const [mapped] = mapPhotonResponse({ features: [cbd] }, { deliveryAreas: ['Rosebank', 'Sandton'] });
  assert.equal(mapped.area, null);
  assert.equal(insideDeliveryBox(mapped.lat, mapped.lng), false);
  assert.deepEqual(filterSuggestions([mapped], { areas: ['Rosebank', 'Sandton'] }), []);

  /* Still dropped when it sits just inside the envelope but near no area. */
  const edge = { ...mapped, lat: -26.18, lng: 28.05 };
  assert.equal(insideDeliveryBox(edge.lat, edge.lng), true);
  assert.deepEqual(filterSuggestions([edge], { areas: ['Rosebank', 'Sandton'] }), []);
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


/* ------------------- Anywhere inside the radius is served ----------------- */

/*
 * These cover the bug the owner hit: the address box was bolted to the two
 * suburb names, so a customer in Bryanston — 9 km out, inside the fee ring —
 * typed a real address and got no suggestion at all. The radius could never
 * be applied to the people it exists for.
 */

test('the geocoder envelope reaches the whole delivery radius, not two suburbs', () => {
  /*
   * The envelope is derived from `maxKm`, so it has to be tested against the
   * radius it belongs to rather than against a number written down in a test.
   *
   * Owner, 15 Nov 2026: 15 km, down from 50. That is why the list below is
   * short — Bryanston (8.8 km) is inside, Midrand (16.1 km) is not, and a box
   * that still reached Roodepoort would be promising addresses the checkout
   * refuses.
   */
  const reachable = [
    ['Bryanston', -26.0515, 28.0207],
    ['Sandton CBD', -26.1075, 28.055],
    ['Rosebank', -26.1438, 28.0436],
    ['Randburg', -26.0936, 28.0064],
  ];
  const tooFar = [
    ['Midrand', -25.9992, 28.1263],
    ['Roodepoort', -26.1625, 27.8725],
    ['Soweto', -26.2678, 27.8585],
    ['Centurion', -25.8603, 28.1894],
  ];

  const inBox = (b, lat, lng) =>
    lat >= b.minLat && lat <= b.maxLat && lng >= b.minLon && lng <= b.maxLon;

  for (const [name, lat, lng] of reachable) {
    assert.equal(
      deliveryZoneFor(lat, lng).zone !== 'refused',
      true,
      `${name} is inside 15 km, so the premise of this test is wrong`,
    );
    assert.equal(inBox(DELIVERY_RADIUS_BBOX, lat, lng), true, `${name} must be inside the search envelope`);
  }
  for (const [name, lat, lng] of tooFar) {
    assert.equal(deliveryZoneFor(lat, lng).zone, 'refused', `${name} is past 15 km`);
  }
  /*
   * The box is a square, so it reaches slightly past the circle at its corners —
   * Midrand at 16.1 km still falls inside it. That is fine and deliberate: the
   * box only decides what the geocoder is *asked* about, and the distance check
   * is what refuses the order. What must never happen is the reverse — a
   * deliverable address missing from the box. The corners are covered by the
   * derived-envelope test below.
   */
});

test('the search envelope is derived from the radius, never written down', () => {
  /*
   * The failure this prevents has already happened once: the limit changed and
   * the box did not, so the search answered with addresses the checkout then
   * refused. A 15 km box and a 15 km rule must be the same 15.
   */
  const b15 = radiusBbox(15);
  const b30 = radiusBbox(30);
  assert.notDeepEqual(b15, b30, 'a wider radius must widen the box');
  /* Wider in every direction, not merely different. */
  assert.ok(b30.minLat < b15.minLat && b30.maxLat > b15.maxLat);
  assert.ok(b30.minLon < b15.minLon && b30.maxLon > b15.maxLon);

  /* The box always contains its circle: every point at the limit falls inside. */
  const origin = { lat: -26.126, lng: 28.049 };
  for (const bearing of [0, 90, 180, 270]) {
    const rad = (bearing * Math.PI) / 180;
    const lat = origin.lat + (15 / 111.32) * Math.cos(rad);
    const lng = origin.lng + (15 / (111.32 * Math.cos((origin.lat * Math.PI) / 180))) * Math.sin(rad);
    assert.ok(
      lat >= b15.minLat && lat <= b15.maxLat && lng >= b15.minLon && lng <= b15.maxLon,
      `a point 15 km ${bearing}° out fell outside the box`,
    );
    assert.equal(deliveryZoneFor(lat, lng).zone !== 'refused', true, 'and it is deliverable');
  }

  /* The query parameter is the same box, in Photon's order. */
  assert.equal(radiusBboxParam(15), [b15.minLon, b15.minLat, b15.maxLon, b15.maxLat].join(','));
});

test('an address outside the two suburbs is no longer a contradiction', () => {
  /*
   * The select has a third option, and picking it must silence the "you chose
   * Sandton but typed Bryanston" error. That error was correct when the shop
   * only served two suburbs; with a radius it refuses paying customers.
   */
  assert.equal(deliveryAddressProblem('1 Bryanston Drive, Bryanston', OUTSIDE, settings), null);
  assert.equal(deliveryAddressProblem('1 Rivonia Road, Midrand', OUTSIDE, settings), null);
  /* And the two-suburb checks still work when one of them is chosen. */
  const wrong = deliveryAddressProblem('14 Oxford Road, Rosebank', 'Sandton', settings);
  assert.equal(wrong?.level, 'error');
});

test('the area select offers the two suburbs and "another area"', () => {
  const options = deliveryAreaOptions(settings);
  assert.deepEqual(options.slice(0, 2), ['Rosebank', 'Sandton']);
  assert.equal(options.length, 3);
  assert.equal(options[2], OUTSIDE);
  /*
   * The label no longer restates the two-suburb boundary. The owner asked for
   * "Outside Sandton & Rosebank" gone, and a select that repeats two suburb names
   * as a wall is the closed-list reading the radius replaced.
   */
  assert.doesNotMatch(options[2], /outside/i);
  assert.match(options[2], /15 km/);
  assert.equal(isOutsideAreaChoice(options[2]), true, 'the third option is the elsewhere choice');
  /* The old long label still counts as it, so a cached client is not stranded. */
  assert.equal(isOutsideAreaChoice(OUTSIDE_LEGACY), true);
  assert.equal(isOutsideAreaChoice('Rosebank'), false);
  assert.equal(isOutsideAreaChoice('Sandton'), false);
});

test('radius mode keeps a suggestion the suburb list would have thrown away', () => {
  /*
   * In radius mode the coordinates are what decide. A Bryanston result carries no
   * "Rosebank"/"Sandton" tag, so the old filter dropped it — and the customer saw
   * an empty list for a real address inside the delivery area.
   */
  const bryanston = {
    id: 'b1',
    line: '1 Bryanston Drive',
    detail: 'Johannesburg · 2191',
    area: null,
    lat: -26.0515,
    lng: 28.0207,
  };
  const strict = filterSuggestions([bryanston], { areas: ['Rosebank', 'Sandton'] });
  assert.equal(strict.length, 0, 'the old two-suburb filter drops it');

  const radial = filterSuggestions([bryanston], { radius: true });
  assert.equal(radial.length, 1, 'the radius filter keeps it');
  assert.equal(radial[0].lat, -26.0515, 'and keeps its coordinates, which are what price it');
});

/* ------------- No surface may write the radius down as prose ------------ */

test('the settings carry the 15 km limit, and the seeds agree with the default', () => {
  /*
   * Owner, 15 Nov 2026: 15 km, not 50.
   *
   * This is the test that would have caught the last drift: the rule changed,
   * the copy did not, and the site spent a release telling customers it would
   * drive 50 km while the checkout refused anything past 15.
   */
  assert.equal(seedSettings.maxDeliveryKm, 15);
  assert.equal(seedSettings.maxDeliveryKm, DELIVERY_ZONES.maxKm, 'the seed and the shared default must be the same number');
  /* The included ring sits inside the limit, or the fee ring would not exist. */
  assert.ok(seedSettings.includedRadiusKm < seedSettings.maxDeliveryKm);
  /* And the limit is still measured from the same kitchen the fee is. */
  assert.deepEqual(seedSettings.deliveryOrigin, KITCHEN_ORIGIN);
});

test('a 15 km radius still serves the two included suburbs outright', () => {
  /* Shrinking the radius must not quietly start charging for Sandton or
     Rosebank — those are the plates the price already covers. */
  for (const [name, lat, lng] of [
    ['Sandton CBD', -26.1075, 28.055],
    ['Rosebank', -26.1438, 28.0436],
  ]) {
    const zone = deliveryZoneFor(lat, lng, { includedTo: 6, maxKm: 15, fee: 30 });
    assert.equal(zone.zone, 'included', `${name} must stay inside the included ring`);
  }
  /* Bryanston is the nearest real place outside it, and now also the furthest
     comfortably-inside-the-limit one. */
  assert.equal(deliveryZoneFor(-26.0515, 28.0207, { includedTo: 6, maxKm: 15, fee: 30 }).zone, 'surcharge');
});

/* --------------- The reference address the owner named ----------------- */

test('33 Baker Street, Rosebank is inside the free ring, at 1.7 km', () => {
  /*
   * Owner, 15 Nov 2026: "use 33 Baker Street in Rosebank as reference-far".
   *
   * Rosebank's far edge is the address that decides whether "inside Sandton and
   * Rosebank" is a promise the site keeps. At 1.7 km it is well inside both the
   * 6 km included ring and the 15 km limit — there is no reading of the rule in
   * which this address pays a fee or is refused.
   */
  const zone = deliveryZoneFor(REFERENCE_FAR_ADDRESS.lat, REFERENCE_FAR_ADDRESS.lng);
  assert.equal(zone.zone, 'included');
  assert.ok(zone.distanceKm < 6, `expected under the 6 km included ring, saw ${zone.distanceKm}`);
  assert.ok(zone.distanceKm < DELIVERY_ZONES.maxKm, 'and far inside the 15 km limit');

  /* It must also be findable in the address box — the ring is no use if the
     search will not answer for the street. */
  assert.equal(inBox14(DELIVERY_RADIUS_BBOX, REFERENCE_FAR_ADDRESS.lat, REFERENCE_FAR_ADDRESS.lng), true);

  /* And the named suburb in the line is the one deliveryAreaFor reports, so a
     customer who types it is not told they contradicted themselves. */
  assert.equal(deliveryAddressProblem(REFERENCE_FAR_ADDRESS.line, 'Rosebank', settings), null);
});

/*
 * Reverse geocoding — the other half of "Use my current location".
 *
 * Owner, 18 Nov 2026, from her phone: she allowed the location, the checkout
 * correctly said "9.3 km away — R30,00 delivery fee added", and the delivery
 * address box stayed empty. The permission had been granted and the distance was
 * right; the address — the one thing the kitchen is actually sent — was not.
 *
 * These tests are about what may be put in that box. The failure that matters is
 * not "no address" (the customer can type one, and is told to); it is a *wrong*
 * address, silently filled from the nearest thing the map happened to name.
 */
test('a coordinate with a street and number reverse-geocodes to a deliverable line', () => {
  const body = {
    features: [
      {
        properties: { street: 'Oxford Road', housenumber: '12', suburb: 'Illovo', city: 'Sandton', osm_type: 'W', osm_id: 1 },
        geometry: { coordinates: [28.05, -26.13] },
      },
    ],
  };
  const found = mapPhotonReverse(body, seedSettings);
  assert.ok(found, 'a full address must be found');
  assert.equal(found.line, '12 Oxford Road, Illovo, Sandton');
  assert.equal(found.area, 'Sandton', 'the area select follows the address');
});

test('a street with no number is still usable — the customer typed nothing', () => {
  /*
   * Reverse geocoding frequently omits the house number. Refusing the result
   * would leave the box empty — the exact bug — while offering it gives the
   * customer a line to correct rather than a blank field to fill from scratch.
   */
  const body = {
    features: [
      {
        properties: { street: 'Oxford Road', suburb: 'Illovo', city: 'Sandton', osm_type: 'W', osm_id: 2 },
        geometry: { coordinates: [28.05, -26.13] },
      },
    ],
  };
  const found = mapPhotonReverse(body, seedSettings);
  assert.ok(found);
  assert.equal(found.line, 'Oxford Road, Illovo, Sandton');
});

test('a name without a street is refused, not filled in', () => {
  /*
   * Standing on a park or in a shopping centre, the nearest named thing is the
   * park or the centre. "Sandton" or "Zoo Lake Park" in a delivery box is an
   * address a driver cannot use, and silently putting it there is worse than
   * leaving the box empty and saying so.
   */
  for (const properties of [
    { name: 'Sandton', city: 'Sandton', osm_type: 'R', osm_id: 3 },
    { name: 'Zoo Lake Park', leisure: 'park', osm_type: 'W', osm_id: 4 },
  ]) {
    const found = mapPhotonReverse({ features: [{ properties, geometry: { coordinates: [28.05, -26.13] } }] }, seedSettings);
    assert.equal(found, null, `${properties.name} is not a deliverable address`);
  }
});

test('an empty or malformed response resolves to nothing rather than throwing', () => {
  for (const body of [{ features: [] }, null, undefined, {}, { features: 'nope' }]) {
    assert.equal(mapPhotonReverse(body, seedSettings), null);
  }
});
