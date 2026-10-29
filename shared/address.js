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
 * Keep only suggestions the kitchen can deliver to.
 *
 * A suggestion is kept when the map puts it in one of the approved areas. When
 * the customer has already picked an area, only that one is kept — so
 * choosing "Rosebank" first and typing "Oxford" offers the Rosebank end of
 * Oxford Road, not the Sandton one.
 *
 * Results the map cannot place confidently are dropped rather than guessed at:
 * an address autofilled into the wrong suburb is worse than no suggestion, and
 * the field still accepts anything typed by hand.
 *
 * @param {AddressSuggestion[]} suggestions
 * @param {{ areas?: string[], onlyArea?: string | null }} [options]
 * @returns {AddressSuggestion[]}
 */
export function filterSuggestions(suggestions, options) {
  const areas = (options?.areas ?? []).map((a) => a.toLowerCase());
  const only = String(options?.onlyArea ?? '').toLowerCase();
  const allowed = only ? areas.filter((a) => a === only) : areas;

  const kept = (suggestions ?? []).filter((s) => Boolean(s?.area) && allowed.includes(String(s.area).toLowerCase()));
  /* The selected area first, so the top of the list matches what was chosen. */
  if (only) {
    kept.sort((a, b) => Number(String(b.area).toLowerCase() === only) - Number(String(a.area).toLowerCase() === only));
  }
  return kept;
}

/**
 * @typedef {object} AddressSuggestion
 * @property {string} id      stable key, derived from the OSM object
 * @property {string} line    one-line human label, e.g. "12 Oxford Road, Illovo, Sandton"
 * @property {string} detail  second line: suburb, city, postcode
 * @property {string|null} area approved delivery area the result falls in, if any
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
  const f = /** @type {{ properties?: Record<string, unknown> } | null} */ (feature);
  const props = f?.properties ?? null;
  if (!props) return null;

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
