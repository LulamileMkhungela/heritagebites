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
import { MIN_QUERY_LENGTH, PHOTON_ENDPOINT, mapPhotonResponse } from '../../shared/address.js';

export { MIN_QUERY_LENGTH, PHOTON_ENDPOINT, mapPhotonFeature, mapPhotonResponse } from '../../shared/address.js';

/** One address the customer can pick. Mirrors the typedef in `shared/address.js`. */
export interface AddressSuggestion {
  id: string;
  line: string;
  detail: string;
  area: string | null;
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
  options: { signal?: AbortSignal; settings?: { deliveryAreas?: string[] } | null; limit?: number; timeoutMs?: number } = {},
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(options.limit ?? 6));
  url.searchParams.set('lang', 'en');
  /* Bias, not a bounding box: the customer may legitimately type an address in
     another province, and we want that result to come back so the checkout can
     say "that is not Rosebank or Sandton" rather than pretending it does not exist. */
  url.searchParams.set('lat', String(BIAS.lat));
  url.searchParams.set('lon', String(BIAS.lng));

  /* Its own timeout: fetch has none, and a hanging geocoder must not leave the
     field saying "Searching…" forever. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4500);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    return mapPhotonResponse(await res.json(), options.settings);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
