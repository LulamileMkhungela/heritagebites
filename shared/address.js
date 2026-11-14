/**
 * Address suggestions from OpenStreetMap (Photon) — the mapping, without the
 * network call.
 *
 * Why this file is in `shared/`: turning a Photon GeoJSON feature into the
 * one-line address a customer sees is the part that can be wrong in a way that
 * costs money — autofilling the wrong street into a paid order — so it is
 * covered by the Node test suite as well as bundled into the browser. The fetch
 * client lives in `src/lib/address.ts`, because only the browser needs it.
 *
 * Photon (photon.komoot.io) is free, keyless and CORS-open, built on
 * OpenStreetMap data. See `src/lib/address.ts` for why it is used instead of
 * Google Places.
 */

/** Photon's public endpoint. Keyless by design. */
export const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/';

/** Fewer than this is too vague to geocode and wastes a request per keystroke. */
export const MIN_QUERY_LENGTH = 4;

/**
 * The envelope the geocoder is allowed to answer from: Rosebank and Sandton,
 * with a little margin so a road on the edge of either is not cut in half.
 *
 * Photon takes `bbox=minLon,minLat,maxLon,maxLat`. Restricting the search this
 * way means the customer is never offered a Pretoria address in the first place,
 * instead of being offered one and then told it is out of area — and it keeps the
 * free service answering a much smaller, faster query.
 *
 * Values: Rosebank is about -26.146, 28.041 and Sandton about -26.108, 28.056.
 * The box deliberately stops short of Bryanston, Randburg and the Johannesburg
 * CBD, which the kitchen does not deliver to.
 */
export const DELIVERY_BBOX = {
  minLon: 28.0,
  minLat: -26.185,
  maxLon: 28.085,
  maxLat: -26.075,
};

/**
 * The envelope the geocoder may answer from on the LIVE checkout.
 *
 * This is the 50 km delivery radius, not the two-suburb area list.
 *
 * It used to be `DELIVERY_BBOX` — Rosebank and Sandton only — which quietly made
 * the radius unreachable: a customer in Bryanston, 9 km from the kitchen and
 * squarely inside the paid-delivery ring, typed their address and the suggestion
 * box answered with nothing. The owner's rule is "outside Sandton/Rosebank a fee
 * applies, past 50 km we refuse" — a rule that can only be applied to someone
 * whose address the box will accept.
 *
 * Roughly ±0.5° around the kitchen, which is comfortably wider than 50 km in
 * every direction (0.45° of latitude is 50 km; at this longitude 0.5° is about
 * 50 km east–west). The hard limit is still enforced by distance, not by this
 * box: the box only decides what the geocoder is *asked* about.
 */
export const DELIVERY_RADIUS_BBOX = {
  minLon: 27.55,
  minLat: -26.58,
  maxLon: 28.55,
  maxLat: -25.68,
};

/** `bbox` query value for the radius envelope. */
export const DELIVERY_RADIUS_BBOX_PARAM = [
  DELIVERY_RADIUS_BBOX.minLon,
  DELIVERY_RADIUS_BBOX.minLat,
  DELIVERY_RADIUS_BBOX.maxLon,
  DELIVERY_RADIUS_BBOX.maxLat,
].join(',');

/** `bbox` query value in the order Photon expects. */
export const DELIVERY_BBOX_PARAM = [DELIVERY_BBOX.minLon, DELIVERY_BBOX.minLat, DELIVERY_BBOX.maxLon, DELIVERY_BBOX.maxLat].join(',');

/**
 * Where each delivery area is, roughly, and how far from that centre still
 * counts as inside it.
 *
 * This exists because of a real bug: type "173 oxf" and Photon answers with the
 * *street* (Oxford Road), which has no `suburb` tag — so tagging alone said
 * "not in any delivery area" and the suggestion was hidden. Paste the whole
 * address and Photon answers with the *house number*, which is tagged, and it
 * appeared. The result was a field that only worked when you pasted.
 *
 * Coordinates do not disappear when a tag does, so they decide. The radii are
 * deliberately tight and only ever *add* an area to a result the map left blank;
 * a tag from OpenStreetMap always wins, and the server's own area rules remain
 * the final word. Sandton's centre is the CBD, Rosebank's is the station.
 *
 * @type {{ area: string, lat: number, lng: number, radiusKm: number }[]}
 */
export const DELIVERY_AREA_POINTS = [
  { area: 'Rosebank', lat: -26.1445, lng: 28.043, radiusKm: 1.8 },
  { area: 'Sandton', lat: -26.1075, lng: 28.055, radiusKm: 2.2 },
];

/**
 * Where the kitchen cooks from, and the two rings drawn around it.
 *
 * The owner's rule (14 Nov 2026): the plate price includes delivery inside
 * Sandton and Rosebank; outside that ring a fee is added; past 50 km the order
 * is refused outright rather than quoted. Collection no longer exists, so every
 * order is measured from here.
 *
 * The origin is the Sandton side of the Rosebank/Sandton run — the midpoint of
 * the two area centres above — because the kitchen is a shadow kitchen with no
 * public street address. It is the only honest centre available, and it puts
 * both named suburbs well inside the included ring. Replace it with the real
 * kitchen coordinates the moment the owner has them; nothing else changes.
 */
export const KITCHEN_ORIGIN = { lat: -26.126, lng: 28.049 };

/**
 * The fee rings, in km from the kitchen.
 *
 * `includedTo` is the edge of the Sandton/Rosebank run. It is generous on
 * purpose: the two suburbs' own centres are about 4 km apart, so a customer in
 * the far corner of either is still comfortably inside.
 */
export const DELIVERY_ZONES = {
  /** Free: delivery is already in the plate price. */
  includedTo: 6,
  /** Beyond the included ring, up to the hard limit, a fee applies. */
  maxKm: 50,
  /**
   * GUESSED FEE — the owner has not given a number yet.
   *
   * R30 is the one amount the codebase already carried as a default delivery
   * flat fee (`deliveryFeeCents` falls back to 35), and it is a plausible
   * per-run charge for a 6–50 km trip. It is NOT confirmed. Every surface that
   * prints it reads `settings.outsideFee`, so changing the seed value changes
   * the whole site at once.
   */
  fee: 30,
};

/** Great-circle distance in km. Exported so the checkout can measure a point. */
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The approved area a point falls in, by distance to the area centres, or null
 * when it is not convincingly inside one.
 *
 * @param {number | null | undefined} lat
 * @param {number | null | undefined} lng
 * @returns {string | null}
 */
export function areaForPoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  for (const point of DELIVERY_AREA_POINTS) {
    const distance = haversineKm(Number(lat), Number(lng), point.lat, point.lng);
    if (distance <= point.radiusKm && (!best || distance < best.distance)) best = { area: point.area, distance };
  }
  return best?.area ?? null;
}

/** Is the point inside the envelope the geocoder was asked about? */
export function insideDeliveryBox(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const b = DELIVERY_BBOX;
  return Number(lat) >= b.minLat && Number(lat) <= b.maxLat && Number(lng) >= b.minLon && Number(lng) <= b.maxLon;
}

/**
 * Which fee ring a point falls in — the single decision every delivery surface
 * asks.
 *
 * Returns one of three answers, never a bare boolean, because "too far" and
 * "far enough to cost more" are different conversations with the customer:
 *
 *   `{ zone: 'included' }`  — inside Sandton/Rosebank; delivery is in the price
 *   `{ zone: 'surcharge', fee, distanceKm }` — outside the ring, still served
 *   `{ zone: 'refused', distanceKm }` — past the hard limit, cannot be ordered
 *   `{ zone: 'unknown' }` — no usable coordinates; caller must ask for an address
 *
 * The hard limit is absolute: there is no fee that buys a 60 km delivery.
 *
 * @param {number | null | undefined} lat
 * @param {number | null | undefined} lng
 * @param {{ includedTo?: number, maxKm?: number, fee?: number, origin?: {lat: number, lng: number} }} [rules]
 */
export function deliveryZoneFor(lat, lng, rules = {}) {
  const to = Number(rules.includedTo ?? DELIVERY_ZONES.includedTo);
  const max = Number(rules.maxKm ?? DELIVERY_ZONES.maxKm);
  const fee = Number(rules.fee ?? DELIVERY_ZONES.fee);
  const origin = rules.origin ?? KITCHEN_ORIGIN;

  if (lat === null || lat === undefined || lng === null || lng === undefined) return { zone: 'unknown' };
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return { zone: 'unknown' };

  const distanceKm = Math.round(haversineKm(nLat, nLng, origin.lat, origin.lng) * 10) / 10;
  if (distanceKm > max) return { zone: 'refused', distanceKm };
  if (distanceKm <= to) return { zone: 'included', distanceKm };
  return { zone: 'surcharge', fee, distanceKm };
}

/** The delivery fee in rand for a distance, or -1 when the address is refused. */
export function deliveryFeeForPoint(lat, lng, rules = {}) {
  const result = deliveryZoneFor(lat, lng, rules);
  if (result.zone === 'refused') return -1;
  if (result.zone === 'surcharge') return Number(result.fee);
  return 0;
}

/**
 * Keep only suggestions the kitchen can deliver to, and label the ones the map
 * left untagged.
 *
 * A result is kept only when it can be *placed*: its tags name an approved area,
 * or its coordinates fall near that area's centre. Anything that cannot be
 * placed is dropped, even if it sits inside the search envelope — that is how
 * "12 Oxford Road, Johannesburg · 2001" (the CBD, seven kilometres from
 * Rosebank) used to appear under a Sandton search: the map gave no suburb, so it
 * survived on the envelope alone. Envelope membership is not evidence of an
 * address the kitchen can reach.
 *
 * When the customer has already picked an area, only that area is offered, so
 * "Rosebank" + "Oxford" gives the Rosebank end of Oxford Road.
 *
 * @param {AddressSuggestion[]} suggestions
 * @param {{ areas?: string[], onlyArea?: string | null, radius?: boolean, rules?: { includedTo?: number, maxKm?: number, fee?: number, origin?: {lat: number, lng: number} } }} [options]
 * @returns {AddressSuggestion[]}
 */
export function filterSuggestions(suggestions, options) {
  const areas = (options?.areas ?? []).map((a) => a.toLowerCase());
  const only = String(options?.onlyArea ?? '').toLowerCase();
  const allowed = only ? areas.filter((a) => a === only) : areas;

  /*
   * `radius` switches this from "only the two approved suburbs" to "anywhere we
   * can reach". That is the mode the checkout uses now:
   *
   *   - The owner's rule is a 50 km radius with a fee outside Sandton/Rosebank,
   *     NOT a two-suburb list. Filtering suggestions down to the two suburbs
   *     meant a Bryanston address produced no suggestion at all, so the radius
   *     could never be applied to the people it exists for.
   *   - When the radius mode is on, a result is kept if it is inside the
   *     envelope — its coordinates are what decide, and an unknown suburb is
   *     fine, because the distance check is the authority.
   */
  const radiusMode = Boolean(options?.radius);

  /** @type {AddressSuggestion[]} */
  const kept = [];
  for (const suggestion of suggestions ?? []) {
    if (!suggestion) continue;
    const tagged = suggestion.area ? String(suggestion.area) : null;

    if (radiusMode) {
      if (!Number.isFinite(Number(suggestion.lat)) || !Number.isFinite(Number(suggestion.lng))) continue;
      /*
       * The radius is a circle, not the search box. The box is a square drawn
       * generously around the kitchen, so its corners reach ~65 km — offering a
       * Polokwane address and then refusing it at submit is exactly the bait the
       * old filter avoided. Anything the kitchen will not drive to is not offered.
       */
      if (deliveryZoneFor(suggestion.lat, suggestion.lng, options?.rules).zone === 'refused') continue;
      const resolved = tagged ?? areaForPoint(suggestion.lat, suggestion.lng);
      kept.push({
        ...suggestion,
        /* Keep the area when the map or the coordinates can place it; leave it
           null rather than inventing a suburb for somewhere like Bryanston. */
        area: resolved ?? null,
        line: resolved ? lineWithArea(suggestion.line, resolved) : suggestion.line,
        detail: resolved ? detailWithArea(suggestion.detail, resolved) : suggestion.detail,
      });
      continue;
    }

    /* Tags beat coordinates; a result neither of them can place is not offered. */
    const resolved = tagged ?? areaForPoint(suggestion.lat, suggestion.lng);
    if (!resolved) continue;
    if (!allowed.includes(resolved.toLowerCase())) continue;

    kept.push({
      ...suggestion,
      area: resolved,
      /* Put the area where a South African address puts it — after the street,
         before the city — when the map left the suburb out. */
      line: lineWithArea(suggestion.line, resolved),
      detail: detailWithArea(suggestion.detail, resolved),
    });
  }

  /* The chosen area first, so the top of the list matches what was picked. */
  if (only) {
    kept.sort((a, b) => Number(String(b.area ?? '').toLowerCase() === only) - Number(String(a.area ?? '').toLowerCase() === only));
  }
  return kept;
}

/**
 * `"Oxford Road, Johannesburg"` + Rosebank → `"Oxford Road, Rosebank, Johannesburg"`.
 *
 * Straight insertion after the street, because appending would give
 * "Oxford Road, Johannesburg, Rosebank", which reads like a different address.
 *
 * @param {string} line
 * @param {string} area
 */
function lineWithArea(line, area) {
  const text = String(line ?? '').trim();
  if (!text) return area;
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === area.toLowerCase())) return text;
  parts.splice(Math.min(1, parts.length), 0, area);
  return parts.join(', ');
}

/**
 * The second line leads with the suburb, so the area goes first:
 * `"Johannesburg · 2196"` + Rosebank → `"Rosebank · Johannesburg · 2196"`.
 *
 * @param {string} detail
 * @param {string} area
 */
function detailWithArea(detail, area) {
  const parts = String(detail ?? '')
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === area.toLowerCase())) return parts.join(' · ');
  return [area, ...parts].join(' · ');
}

/**
 * Put the house number the customer typed back onto results that matched only
 * the street.
 *
 * Type "173 oxf" and the map may answer with Oxford Road as a whole — correct,
 * but "Oxford Road, Rosebank" would quietly drop the 173 the customer just
 * typed. The number is theirs, so it is restored unless the result already has
 * one of its own (a real house-number hit).
 *
 * @param {AddressSuggestion[]} suggestions
 * @param {string} query
 * @returns {AddressSuggestion[]}
 */
export function applyHouseHint(suggestions, query) {
  const match = /^(\d+[a-zA-Z]?)\s+(.+)$/.exec(String(query ?? '').trim());
  if (!match) return suggestions ?? [];
  const house = match[1];
  return (suggestions ?? []).map((suggestion) => {
    if (/^\d/.test(suggestion.line)) return suggestion;
    return { ...suggestion, house, line: `${house} ${suggestion.line}` };
  });
}

/**
 * "173 oxf" → "oxf", for a second attempt when the first returns nothing.
 *
 * @param {string} query
 */
export function stripHouseNumber(query) {
  const text = String(query ?? '').trim();
  return /^\d+[a-zA-Z]?\s+/.test(text) ? text.replace(/^\d+[a-zA-Z]?\s+/, '').trim() : text;
}

/**
 * Street-type abbreviations people actually type, expanded to what the map
 * stores. OpenStreetMap has "Oxford Road"; nobody types that.
 *
 * Only tokens *after* the first are expanded, because a leading "St" is "Saint"
 * far more often than "Street" — "St Andrews Road" must not become
 * "Street Andrews Road".
 */
const STREET_WORDS = {
  rd: 'road',
  st: 'street',
  str: 'street',
  ave: 'avenue',
  av: 'avenue',
  dr: 'drive',
  blvd: 'boulevard',
  bvd: 'boulevard',
  ln: 'lane',
  ct: 'court',
  pl: 'place',
  cres: 'crescent',
  hwy: 'highway',
  pde: 'parade',
  sq: 'square',
  ter: 'terrace',
};

/**
 * "173 oxford rd, rosebank" → "173 oxford road, rosebank".
 *
 * A third attempt only, used when the literal query and the house-number-free
 * query both found nothing: expanding costs a request, so it is not done
 * speculatively on every keystroke.
 *
 * @param {string} query
 */
export function expandStreetAbbreviations(query) {
  const text = String(query ?? '').trim();
  if (!text) return text;
  const tokens = text.split(/\s+/);
  return tokens
    .map((token, index) => {
      if (index === 0) return token;
      /* Keep the customer's punctuation but replace the word itself. */
      const match = /^([^\w]*)(\w+)([^\w]*)$/.exec(token);
      if (!match) return token;
      const expansion = STREET_WORDS[match[2].toLowerCase()];
      return expansion ? `${match[1]}${expansion}${match[3]}` : token;
    })
    .join(' ');
}

/**
 * @typedef {object} AddressSuggestion
 * @property {string} id      stable key, derived from the OSM object
 * @property {string} line    one-line human label, e.g. "12 Oxford Road, Illovo, Sandton"
 * @property {string} detail  second line: suburb, city, postcode
 * @property {string|null} area approved delivery area the result falls in, if any
 * @property {number|null} [lat] latitude from the map, used when tags are missing
 * @property {number|null} [lng] longitude from the map, used when tags are missing
 * @property {string} [house] house number taken from the query, when the map
 *   matched a street rather than a specific building
 */

/** @param {unknown} value */
const str = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A street line built from the parts a person would actually write.
 *
 * House number and street first, then the suburb, then the city — in that order,
 * because that is how a South African address reads and how a courier looks for
 * it. Duplicates are dropped: Photon often repeats the suburb as both `suburb`
 * and `district`.
 *
 * @param {Record<string, unknown>} props
 */
function streetLine(props) {
  const house = str(props.housenumber);
  const street = str(props.street) || str(props.name);
  const head = [house, street].filter(Boolean).join(' ');
  const locality = [str(props.suburb), str(props.city) || str(props.town) || str(props.village)].filter(Boolean);
  const parts = [head, ...locality].filter(Boolean);
  const seen = new Set();
  return parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
}

/**
 * Turn one Photon GeoJSON feature into a suggestion, or null when it is not an
 * address a person can be delivered to (a country, a province, a shop).
 *
 * @param {unknown} feature
 * @param {{ deliveryAreas?: string[] } | null} [settings]
 * @returns {AddressSuggestion | null}
 */
export function mapPhotonFeature(feature, settings) {
  const f = /** @type {{ properties?: Record<string, unknown>, geometry?: { coordinates?: unknown[] } } | null} */ (feature);
  const props = f?.properties ?? null;
  if (!props) return null;
  /* GeoJSON is [longitude, latitude] — the reverse of how it is spoken. */
  const coordinates = f?.geometry?.coordinates;
  const lng = Array.isArray(coordinates) ? Number(coordinates[0]) : null;
  const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : null;

  const osmType = str(props.osm_type) || 'x';
  const osmId = String(props.osm_id ?? '');
  const line = streetLine(props);
  if (!line) return null;

  /*
   * Which approved area does the map say this is in? Photon puts the suburb in
   * `suburb`, `district`, `locality` or sometimes only the city — so every
   * candidate is checked against the business's own list rather than assuming a
   * field name.
   */
  const candidates = [
    props.suburb,
    props.district,
    props.locality,
    props.city,
    props.town,
    props.village,
    props.county,
    props.name,
    props.street,
  ]
    .map(str)
    .filter(Boolean);
  /*
   * Only the two *included* suburbs are tagged here, and that is deliberate: the
   * tag is what makes a result read "Sandton delivery" and moves the area select.
   * A Bryanston result keeps a null area and is priced — and offered — by its
   * distance instead. The tag was never a whitelist; see `filterSuggestions`.
   */
  const areas = settings?.deliveryAreas ?? [];
  const area = areas.find((approved) => candidates.some((c) => c.toLowerCase().includes(approved.toLowerCase()))) ?? null;

  const detailParts = [str(props.suburb), str(props.city) || str(props.town), str(props.postcode)].filter(Boolean);
  const detail = [...new Set(detailParts)].join(' · ');

  return {
    id: `${osmType}${osmId || line}`,
    line,
    detail,
    area,
    lat: Number.isFinite(lat) && lat !== null && Math.abs(lat) <= 90 ? lat : null,
    lng: Number.isFinite(lng) && lng !== null && Math.abs(lng) <= 180 ? lng : null,
  };
}

/**
 * Map a whole Photon response body, dropping duplicates.
 *
 * @param {unknown} body
 * @param {{ deliveryAreas?: string[] } | null} [settings]
 * @returns {AddressSuggestion[]}
 */
export function mapPhotonResponse(body, settings) {
  const features = /** @type {{ features?: unknown[] } | null} */ (body)?.features;
  if (!Array.isArray(features)) return [];
  /** @type {AddressSuggestion[]} */
  const out = [];
  const seen = new Set();
  for (const feature of features) {
    const suggestion = mapPhotonFeature(feature, settings);
    if (!suggestion) continue;
    if (seen.has(suggestion.line.toLowerCase())) continue;
    seen.add(suggestion.line.toLowerCase());
    out.push(suggestion);
  }
  return out;
}
