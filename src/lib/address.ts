/**
 * Address suggestions from OpenStreetMap, for the delivery address field.
 *
 * Why this exists: the kitchen delivers in Rosebank and Sandton only, and the
 * typed address used to be taken on trust — a customer could select "Sandton"
 * and type a Rosebank street, and the order went through labelled with whichever
 * area matched first. Suggestions fix the root cause: pick the address, and we
 * know from the map data which suburb it is actually in.
 *
 * Why Photon and not Google Maps: Google's Places API needs a billing account and
 * a key shipped to the browser, and its licence forbids caching results. Photon
 * (photon.komoot.io) is a free, keyless, OpenStreetMap-based geocoder designed
 * for type-ahead: CORS-open, no quota to buy, and no account that expires and
 * silently kills the field. OpenStreetMap data is ODbL — attribution is shown
 * next to the results, which is the only obligation.
 *
 * Privacy: only the text the customer is typing in the address box is sent, and
 * only while they type (four characters or more, debounced, and abandoned the
 * moment the box loses focus). Nothing else from the form — no name, no phone, no
 * email — is ever included, and nothing is stored.
 *
 * Offline, on a blocked network, or with the request refused, every function
 * here resolves to "no suggestions". The field stays a plain text box and the
 * checkout still works; suggestions are an assist, never a requirement.
 */
import {
  DELIVERY_BBOX_PARAM,
  MIN_QUERY_LENGTH,
  PHOTON_ENDPOINT,
  applyHouseHint,
  expandStreetAbbreviations,
  filterSuggestions,
  mapPhotonResponse,
  stripHouseNumber,
} from '../../shared/address.js';

export {
  DELIVERY_AREA_POINTS,
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

/** One address the customer can pick. Mirrors the typedef in `shared/address.js`. */
export interface AddressSuggestion {
  id: string;
  line: string;
  detail: string;
  area: string | null;
  /** Coordinates, used to place a result the map did not tag with a suburb. */
  lat?: number | null;
  lng?: number | null;
  /** House number taken from the query when only the street matched. */
  house?: string;
}

/**
 * Johannesburg city centre, used to bias results. Photon sorts by distance to
 * this point first, so "Oxford" answers with Illovo before Oxford, England.
 */
const BIAS = { lat: -26.1076, lng: 28.0567 };

/**
 * Ask Photon for addresses matching what has been typed.
 *
 * Never throws: a refused request, a timeout, an outage or a non-JSON body all
 * come back as an empty list, because a checkout must not fail over a
 * nice-to-have suggestion box.
 */
export async function suggestAddresses(
  query: string,
  options: {
    signal?: AbortSignal;
    settings?: { deliveryAreas?: string[] } | null;
    /** The area the customer already chose, so only that one is offered. */
    area?: string | null;
    limit?: number;
    timeoutMs?: number;
  } = {},
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const limit = options.limit ?? 6;

  /* Its own timeout: fetch has none, and a hanging geocoder must not leave the
     field saying "Searching…" forever. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4500);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  /**
   * One request, already bounded to the delivery envelope and filtered to the
   * delivery areas.
   *
   * @param {string} text
   */
  const ask = async (text: string): Promise<AddressSuggestion[] | null> => {
    const url = new URL(PHOTON_ENDPOINT);
    url.searchParams.set('q', text);
    /* Ask for more than we show: the area filter throws some away, and a short
       final list is better than an empty one when a street straddles two areas. */
    url.searchParams.set('limit', String(Math.max(10, limit)));
    url.searchParams.set('lang', 'en');
    /*
     * Restrict the search to the Rosebank/Sandton envelope rather than biasing
     * towards Johannesburg: the kitchen does not deliver outside it, so a Pretoria
     * address is not a suggestion worth offering and then rejecting.
     */
    url.searchParams.set('bbox', DELIVERY_BBOX_PARAM);
    /* The point bias still helps rank two in-area results sensibly. */
    url.searchParams.set('lat', String(BIAS.lat));
    url.searchParams.set('lon', String(BIAS.lng));

    const res = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
    /* `null` means "stop asking": a refusal or rate-limit is not an invitation to
       fire three more requests at a free service. */
    if (!res.ok) return null;
    return filterSuggestions(mapPhotonResponse(await res.json(), options.settings), {
      areas: options.settings?.deliveryAreas,
      onlyArea: options.area ?? null,
    });
  };

  try {
    /*
     * Searching as you type fails in specific, reproducible ways, so each query
     * is tried in order of how likely it is to answer, and stops at the first
     * attempt that finds anything:
     *
     *   1. exactly what was typed          "173 oxf"
     *   2. without the house number        "oxf"    (Photon answers this one)
     *   3. abbreviations expanded         "173 oxford road"  ("Rd", "Ave")
     *   4. both of the above              "oxford road"
     *
     * The extra requests only happen when an attempt found nothing, so typing
     * normally still costs one call per pause. The house number is put back onto
     * the results afterwards, because it is what the customer typed.
     */
    const streetOnly = stripHouseNumber(q);
    const candidates = [...new Set([q, streetOnly, expandStreetAbbreviations(q), expandStreetAbbreviations(streetOnly)])].filter(
      (candidate) => candidate.length >= Math.min(MIN_QUERY_LENGTH, 3) && candidate.length > 0,
    );

    let found: AddressSuggestion[] = [];
    for (const candidate of candidates) {
      const attempt = await ask(candidate);
      if (attempt === null) break;
      found = attempt;
      if (found.length) break;
    }
    return applyHouseHint(found, q).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
