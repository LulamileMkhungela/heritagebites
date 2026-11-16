/**
 * Address suggestions from OpenStreetMap, for the delivery address field.
 *
 * Why this exists: the typed address used to be taken on trust — a customer
 * could select "Sandton" and type a Rosebank street, and the order went through
 * labelled with whichever area matched first. Suggestions fix the root cause:
 * pick the address, and the map's own coordinates come with it, which is what
 * the distance check needs.
 *
 * Scope is the delivery radius, not a suburb list. Delivery is included in
 * Sandton and Rosebank, costs a fee further out, and stops at a fixed radius — so the
 * search reaches the whole radius and the distance decides, not the name of
 * the suburb the customer happened to type.
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
  DELIVERY_ZONES,
  KITCHEN_ORIGIN,
  MIN_QUERY_LENGTH,
  PHOTON_ENDPOINT,
  applyHouseHint,
  expandStreetAbbreviations,
  filterSuggestions,
  mapPhotonResponse,
  radiusBboxParam,
  stripHouseNumber,
} from '../../shared/address.js';

export {
  DELIVERY_AREA_POINTS,
  DELIVERY_BBOX,
  DELIVERY_BBOX_PARAM,
  DELIVERY_RADIUS_BBOX,
  DELIVERY_RADIUS_BBOX_PARAM,
  DELIVERY_ZONES,
  KITCHEN_ORIGIN,
  MIN_QUERY_LENGTH,
  PHOTON_ENDPOINT,
  applyHouseHint,
  areaForPoint,
  deliveryFeeForPoint,
  deliveryZoneFor,
  expandStreetAbbreviations,
  filterSuggestions,
  haversineKm,
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
  /*
   * The address in parts, filled by `mapPhotonFeature` so the three boxes on the
   * checkout can be populated from one tap. `suburb` is the map's locality tag —
   * a postal fact — not the delivery area the order is priced against.
   */
  street?: string;
  suburb?: string;
  city?: string;
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
    /**
     * The catalogue's delivery settings. The radius fields are read here too,
     * because the same numbers decide what the box offers and what the order is
     * charged — a suggestion that ignores them can be offered and then refused.
     */
    settings?: {
      deliveryAreas?: string[];
      includedRadiusKm?: number;
      maxDeliveryKm?: number;
      outsideFee?: number;
      deliveryOrigin?: { lat: number; lng: number };
    } | null;
    /** The area the customer already chose, so only that one is offered. */
    area?: string | null;
    /** Keep everything in the delivery radius, not only the two named suburbs. */
    radius?: boolean;
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
    /* Ask for more than we show: some results are thrown away, and a short
       final list is better than an empty one when a street straddles a boundary. */
    url.searchParams.set('limit', String(Math.max(10, limit)));
    url.searchParams.set('lang', 'en');
    /*
     * The envelope is the DELIVERY RADIUS, not the two suburb names.
     *
     * The kitchen serves anywhere it can reach, with a fee outside Sandton and
     * Rosebank — so answering only inside those two suburbs made the radius
     * unreachable: a Bryanston customer typed a real address and the box offered
     * nothing. The hard limit is enforced afterwards, by distance, from the
     * coordinates this returns.
     */
    /*
     * The envelope is built from the SAME radius the order is priced against,
     * read from the catalogue — never the built-in default.
     *
     * This is the bug the 15 km change would otherwise reintroduce: a hardcoded
     * box is a second copy of the delivery rule, and the moment the two disagree
     * the box offers addresses the checkout then refuses. Deriving it here means
     * changing `maxDeliveryKm` in the settings moves the search, the pricing and
     * the refusal together or not at all.
     */
    url.searchParams.set(
      'bbox',
      radiusBboxParam(
        Number(options.settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm),
        options.settings?.deliveryOrigin ?? KITCHEN_ORIGIN,
      ),
    );
    /* The point bias still helps rank two in-area results sensibly. */
    url.searchParams.set('lat', String(BIAS.lat));
    url.searchParams.set('lon', String(BIAS.lng));

    const res = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
    /* `null` means "stop asking": a refusal or rate-limit is not an invitation to
       fire three more requests at a free service. */
    if (!res.ok) return null;
    /*
     * Radius mode: keep anything the map could place with coordinates. The
     * suburb-tagged filter is kept available (`radius: false`) for callers that
     * genuinely need the two-suburb list, but the checkout is not one of them.
     */
    return filterSuggestions(mapPhotonResponse(await res.json(), options.settings), {
      radius: true,
      rules: {
        includedTo: Number(options.settings?.includedRadiusKm ?? DELIVERY_ZONES.includedTo),
        maxKm: Number(options.settings?.maxDeliveryKm ?? DELIVERY_ZONES.maxKm),
        fee: Number(options.settings?.outsideFee ?? DELIVERY_ZONES.fee),
        origin: options.settings?.deliveryOrigin ?? KITCHEN_ORIGIN,
      },
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
