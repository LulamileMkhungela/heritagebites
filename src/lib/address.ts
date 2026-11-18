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
  PHOTON_REVERSE_ENDPOINT,
  applyHouseHint,
  expandStreetAbbreviations,
  filterSuggestions,
  mapPhotonResponse,
  mapPhotonReverse,
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
  PHOTON_REVERSE_ENDPOINT,
  applyHouseHint,
  areaForPoint,
  deliveryFeeForPoint,
  deliveryZoneFor,
  expandStreetAbbreviations,
  filterSuggestions,
  haversineKm,
  mapPhotonFeature,
  mapPhotonResponse,
  mapPhotonReverse,
  stripHouseNumber,
} from '../../shared/address.js';

/** One address the customer can pick. Mirrors the typedef in `shared/address.js`. */
/**
 * Turn a set of coordinates into an address the customer can read and correct.
 *
 * Owner, 17 Nov 2026, on the "Use my current location" button: "if i select use my
 * current location does it fill the address inputfield- if not it must be".
 *
 * It did not. The button collected a precise fix, checked the distance against it
 * and left the address box empty — so the customer could submit an order whose
 * price came from one place and whose delivery instruction was blank, and the
 * WhatsApp handoff carried neither. Filling the box closes that gap: the fix
 * decides the distance *and* writes down where it thinks you are, which the
 * customer can then read, correct, or overwrite by typing.
 *
 * Two lookups, because Photon's reverse endpoint does not always carry a house
 * number: the first asks for the address at the point, the second asks for the
 * nearest house on the street the first one named. The first result that names a
 * street wins; the house number is used when the map has one, and omitted rather
 * than invented when it does not.
 *
 * Never throws. No network, a refusal or a timeout resolves to `null`, and the
 * caller keeps whatever the customer had already typed.
 */
export async function describePoint(
  lat: number,
  lng: number,
  options: { settings?: { deliveryAreas?: string[] } | null; timeoutMs?: number } = {},
): Promise<AddressSuggestion | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
  try {
    /*
     * Photon's REVERSE endpoint, not its search endpoint.
     *
     * This used to call `/api/?q=${lat},${lng}` — a *text search* for the
     * characters "-26.13,28.05". A text search cannot answer "what is at this
     * point": it looks for that string in street names and returns nothing. So
     * the lookup always came back empty, the address box was never filled, and
     * "Use my current location" looked broken even though the permission had
     * been granted and the distance was correct.
     *
     * `/reverse?lat=&lon=` is the endpoint that actually answers the question,
     * and it returns the same GeoJSON shape, so the same mapper reads it.
     */
    const url = new URL(PHOTON_REVERSE_ENDPOINT);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('lang', 'en');
    url.searchParams.set('limit', '5');
    /*
     * Deliberately NO bbox. A bbox means "only answer if the address is inside
     * this box", and the interesting customer is the one standing *outside* it:
     * they still deserve to see the address the kitchen would be sent to, and
     * the distance check then tells them honestly whether we reach them. With a
     * bbox, a Bryanston customer who shares their location gets nothing at all —
     * no address and no fee explanation.
     */

    const res = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;

    const body = await res.json();
    const features = Array.isArray(body?.features) ? body.features : [];

    /*
     * Prefer a result that names a street. Reverse geocoding often returns the
     * nearest *named thing* first — a park, a shopping centre — which makes an
     * address a driver cannot use. `mapPhotonReverse` already refuses those, but
     * a street with no house number is still worth having: the customer typed
     * nothing, and a street they can correct beats an empty box.
     */
    const found = mapPhotonReverse(body, options.settings ?? null);
    if (found) return { ...found, lat, lng };

    /* Nothing with a street: fall back to whatever the map did say, if anything. */
    for (const feature of features) {
      const suggestion = mapPhotonResponse({ features: [feature] }, options.settings ?? null)[0];
      if (suggestion) return { ...suggestion, lat, lng };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
   * The address in parts, filled by `mapPhotonFeature`. The checkout shows one
   * line, but the parts are still what lets a picked suggestion move the delivery
   * area and put the typed house number back on a street-only match. `suburb` is
   * the map's locality tag — a postal fact — not the delivery area the order is
   * priced against.
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

/**
 * The address at a pair of coordinates — what "Use my current location" fills in.
 *
 * The owner hit this on her phone: she allowed the location, the checkout worked
 * out "9.3 km away — R30,00 delivery fee added" correctly, and the delivery
 * address box stayed empty. The button had only ever answered "how far is it",
 * and an empty address box is an order that cannot be delivered.
 *
 * Never throws, and never invents an address. A refused request, a timeout or a
 * result with no street all come back as `null`, and the caller tells the
 * customer to type it instead — the same advice the denied path gives, because
 * the customer's next step is identical.
 *
 * The coordinates are the ones passed in, not the ones the geocoder echoes back:
 * they are what the fee was calculated from, and the address must describe the
 * same place the customer is charged for.
 */
export async function addressAtLocation(
  lat: number,
  lng: number,
  options: {
    settings?: {
      deliveryAreas?: string[];
      maxDeliveryKm?: number;
      deliveryOrigin?: { lat: number; lng: number };
    } | null;
    /** Photon asks for `lat,lon` — the reverse of GeoJSON's `[lon, lat]`. */
    timeoutMs?: number;
  } = {},
): Promise<AddressSuggestion | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
  try {
    const url = new URL(PHOTON_REVERSE_ENDPOINT);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('lang', 'en');
    url.searchParams.set('limit', '5');
    /*
     * No bbox here, deliberately. A bbox on a reverse lookup means "only answer
     * if the address is inside this box", and the interesting case is precisely
     * the customer standing outside it — they still deserve to see the address
     * the kitchen would be sent to, and the distance check then tells them the
     * truth about whether we reach them.
     */

    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    const found = mapPhotonReverse(body, options.settings ?? null);
    if (!found) return null;

    return { ...found, lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
