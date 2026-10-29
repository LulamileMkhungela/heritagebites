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

/** Great-circle distance in km. */
function haversineKm(aLat, aLng, bLat, bLng) {
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
 * Keep only suggestions the kitchen can deliver to, and label the ones the map
 * left untagged.
 *
 * A result is dropped when it is *provably* outside: a tag naming another area,
 * or a point outside the delivery envelope. It is kept when its tags name an
 * approved area, or when its coordinates do, or when it is inside the envelope
 * and the map simply did not say — that last case is what makes typing work as
 * well as pasting.
 *
 * When the customer has already picked an area, only that area is offered, so
 * "Rosebank" + "Oxford" gives the Rosebank end of Oxford Road.
 *
 * @param {AddressSuggestion[]} suggestions
 * @param {{ areas?: string[], onlyArea?: string | null }} [options]
 * @returns {AddressSuggestion[]}
 */
export function filterSuggestions(suggestions, options) {
  const areas = (options?.areas ?? []).map((a) => a.toLowerCase());
  const only = String(options?.onlyArea ?? '').toLowerCase();
  const allowed = only ? areas.filter((a) => a === only) : areas;

  /** @type {AddressSuggestion[]} */
  const kept = [];
  for (const suggestion of suggestions ?? []) {
    if (!suggestion) continue;
    const tagged = suggestion.area ? String(suggestion.area) : null;
    const inBox = insideDeliveryBox(suggestion.lat, suggestion.lng);
    /* Tags beat coordinates; coordinates beat nothing; nothing is only allowed
       while the point is still inside the envelope. */
    const resolved = tagged ?? areaForPoint(suggestion.lat, suggestion.lng);
    if (resolved) {
      if (!allowed.includes(resolved.toLowerCase())) continue;
    } else if (!inBox) {
      continue;
    }

    kept.push(
      resolved
        ? {
            ...suggestion,
            area: resolved,
            /* Put the area where a South African address puts it — after the
               street, before the city — when the map left the suburb out. */
            line: lineWithArea(suggestion.line, resolved),
            detail: detailWithArea(suggestion.detail, resolved),
          }
        : { ...suggestion, area: null },
    );
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
