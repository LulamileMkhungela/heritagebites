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

/**
 * The same service, asked the other way round: coordinates in, address out.
 *
 * This is what turns "the customer allowed their location" into a filled-in
 * delivery address. Without it the button could only ever answer "how far is
 * it" — which is the bug the owner hit on her phone: she allowed the location,
 * the checkout correctly worked out 9.3 km and added the fee, and the address
 * box she would actually be delivered to stayed empty.
 *
 * Photon's reverse endpoint takes the same bbox and lang parameters and returns
 * the same GeoJSON shape, so the feature can be read by the same mapper.
 */
export const PHOTON_REVERSE_ENDPOINT = 'https://photon.komoot.io/reverse';

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
 * Sandton and Rosebank; outside that ring a fee is added; past the limit the order
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
  /**
   * Beyond the included ring, up to the hard limit, a fee applies.
   *
   * Owner, 19 Nov 2026: 10 km, not 15 — and emphatically not the 30 km the agency
   * proposed, nor the 50 km before that. "30km is way too far and will be
   * uneconomical pricing wise." The kitchen cooks one service and drives every
   * order itself, so the boundary is where a plate still arrives hot AND the run
   * still pays for itself.
   */
  maxKm: 10,
  /**
   * CONFIRMED FEE (19 Nov 2026): a FLAT R50 for the outer ring.
   *
   * Flat, not tiered: the owner chose one price for the whole 6–10 km band rather
   * than a rate that climbs with distance. An address at 9.9 km pays the same as
   * one at 6.5 km, and nobody has to explain a tier at the door.
   *
   * Every surface that prints it reads `settings.outsideFee`, so this is the
   * default and the seed is the source of truth.
   */
  fee: 50,
};

/**
 * The envelope the geocoder may answer from, derived from the radius itself.
 *
 * It is a square around the kitchen, and the sides are `KM_PER_DEGREE` generous
 * on purpose: a square barely contains its circle, and an address on the edge
 * must still be findable so the distance check can say yes or no to it. Too
 * tight and the box silently refuses people the kitchen would have delivered to
 * — the exact bug that made the radius unreachable when the box was the two
 * suburb names.
 *
 * Derived rather than written down because the two numbers drifted apart once
 * already: the limit changed, the box did not, and the search answered with
 * places the checkout then refused. One `maxKm`, one envelope.
 */
export function radiusBbox(maxKm = DELIVERY_ZONES.maxKm, origin = KITCHEN_ORIGIN) {
  /*
   * 1° of latitude is 111.32 km everywhere; 1° of longitude is that times
   * cos(latitude), so at Johannesburg's −26.1° a degree of longitude is about
   * 100 km. A 10 km radius therefore needs ~0.09° of latitude and ~0.10° of
   * longitude — the margin covers the square-versus-circle corner.
   */
  const latDeg = Math.abs(Number(maxKm) || 0) / 111.32;
  const lngDeg = latDeg / Math.cos((Number(origin?.lat ?? KITCHEN_ORIGIN.lat) * Math.PI) / 180);
  const pad = 1.1;
  return {
    minLon: Number((Number(origin?.lng ?? KITCHEN_ORIGIN.lng) - lngDeg * pad).toFixed(4)),
    minLat: Number((Number(origin?.lat ?? KITCHEN_ORIGIN.lat) - latDeg * pad).toFixed(4)),
    maxLon: Number((Number(origin?.lng ?? KITCHEN_ORIGIN.lng) + lngDeg * pad).toFixed(4)),
    maxLat: Number((Number(origin?.lat ?? KITCHEN_ORIGIN.lat) + latDeg * pad).toFixed(4)),
  };
}

/** `bbox` query value for a radius envelope — `minLon,minLat,maxLon,maxLat`. */
export function radiusBboxParam(maxKm = DELIVERY_ZONES.maxKm, origin = KITCHEN_ORIGIN) {
  const b = radiusBbox(maxKm, origin);
  return [b.minLon, b.minLat, b.maxLon, b.maxLat].join(',');
}

/** The envelope for the default radius, kept as a value for older callers. */
export const DELIVERY_RADIUS_BBOX = radiusBbox();

/** The matching `bbox` query value. */
export const DELIVERY_RADIUS_BBOX_PARAM = radiusBboxParam();

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
   *   - The owner's rule is a fixed radius with a fee outside Sandton/Rosebank,
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
    /* The typed house number belongs in the structured part too, not only in
       the sentence — otherwise picking a street would blank the field the
       customer had already filled in. */
    return { ...suggestion, house: suggestion.house || house, line: `${house} ${suggestion.line}` };
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
    /*
     * The address in its three parts, so the checkout can fill the house number,
     * the street and the suburb into the boxes the owner asked for instead of
     * making the customer re-split a sentence the map already understands.
     *
     * `suburb` is the map's own locality tag (not the delivery area): it is what
     * goes in a postal address, and it is the field a courier actually reads.
     */
    house: str(props.housenumber),
    street: str(props.street) || (str(props.name) !== str(props.city) ? str(props.name) : ''),
    suburb: str(props.suburb) || str(props.district) || str(props.locality) || str(props.city) || str(props.town) || str(props.village),
    city: str(props.city) || str(props.town) || str(props.village),
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

/**
 * The address at a pair of coordinates — what "use my location" puts in the box.
 *
 * Reverse geocoding does not always return a street number, and it sometimes
 * returns the nearest named thing rather than a house (a school, a park, a
 * shopping centre). Both are handled honestly:
 *
 *   - a street with no number still makes a usable delivery line, because the
 *     customer typed nothing and the alternative is an empty box; it is marked in
 *     the returned `line` exactly as the map gave it, so what they see is what
 *     was found;
 *   - anything without a street at all is refused, because "Sandton" is not an
 *     address a driver can deliver to, and silently filling "Sandton" into a box
 *     the customer believes holds their location is worse than leaving it empty
 *     and telling them to type it.
 *
 * Coordinates come back unchanged and are the ones the distance was measured
 * from, so the address and the fee always describe the same place.
 *
 * @param {unknown} body  A Photon `/reverse` response body.
 * @param {{ deliveryAreas?: string[] } | null} [settings]
 * @returns {AddressSuggestion | null}
 */
export function mapPhotonReverse(body, settings) {
  const features = /** @type {{ features?: unknown[] } | null} */ (body)?.features;
  if (!Array.isArray(features)) return null;

  /*
   * The first feature with a street wins. Photon ranks by proximity, so the
   * first is the best answer; a later one is only used when the nearest result
   * is the thing *beside* the location rather than the location itself.
   */
  for (const feature of features) {
    const suggestion = mapPhotonFeature(feature, settings);
    if (!suggestion) continue;
    /*
     * A house number is not required, but a street line is. `streetLine()`
     * already refuses anything with no road or house number — this second check
     * exists because a named place ("Rosebank Mall") can produce a line that
     * reads like an address without being one.
     */
    if (!/\d|street|road|avenue|drive|lane|close|crescent|way|boulevard/i.test(suggestion.line)) continue;
    return suggestion;
  }
  return null;
}

/**
 * A real Rosebank address, used as the reference point for "far".
 *
 * Owner, 15 Nov 2026: "use 33 Baker Street in Rosebank as reference-far". It is
 * the far end of the included run — the address the delivery rule is checked
 * against in tests and in the smoke suite, so "inside the area" means a place a
 * customer actually lives, not a pair of coordinates somebody typed.
 *
 * It is a *fixture*, never a delivery origin. The order is still measured from
 * `KITCHEN_ORIGIN`; this only proves that the edge of Rosebank is comfortably
 * inside the free ring and well inside the limit.
 */
export const REFERENCE_FAR_ADDRESS = {
  line: '33 Baker Street, Rosebank, Johannesburg',
  suburb: 'Rosebank',
  /* Approximate OpenStreetMap position for Baker Street, Rosebank. */
  lat: -26.1403,
  lng: 28.0443,
};
