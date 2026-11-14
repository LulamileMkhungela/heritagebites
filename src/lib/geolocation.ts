/**
 * Asking the browser where the customer is, in the one way that is useful for a
 * delivery radius.
 *
 * What the button does, in the customer's terms: the browser shows its own
 * "Allow this site to know your location?" prompt. The customer says yes or no —
 * nothing is taken before that — and the coordinates come back to this page. They
 * are used to measure the distance to the kitchen, and are sent with the order so
 * the kitchen can check the same number.
 *
 * Why precise, and why a fallback:
 *
 *  - `enableHighAccuracy: true` is what asks for GPS/Wi-Fi positioning. Without
 *    it a browser hands back a coarse fix — often the centre of the suburb, or a
 *    cell-tower location several kilometres away. On a 6 km included ring and a
 *    50 km hard limit, a three-kilometre error is the difference between "free"
 *    and "R30", or between "delivered" and "refused". A coarse fix cannot decide
 *    that honestly.
 *  - It can, however, fail or take too long — indoors, in a car park, on a laptop
 *    with Wi-Fi positioning off. So a high-accuracy attempt that fails or times
 *    out falls back to a normal fix rather than leaving the customer stuck with a
 *    button that never completes. A rough answer they can see and question beats
 *    no answer at all.
 *
 * The permission prompt only appears on a secure origin (https, or localhost).
 * On plain http a browser refuses the request, which is reported as `denied` —
 * the same path as a customer tapping "Block", because the customer's next step
 * is identical: type the address and pick it from the list.
 */

export type LocationResult =
  | { status: 'ok'; lat: number; lng: number; accuracyM: number; precise: boolean }
  | { status: 'denied'; reason: 'blocked' | 'unavailable' | 'timeout' | 'unsupported' };

interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
}

/** One `getCurrentPosition` call, as a promise, so it can be awaited and raced. */
function askPosition(options: PositionOptions): Promise<Coords> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? Infinity }),
      (err) => reject(err),
      options,
    );
  });
}

/**
 * Ask for the customer's location, precise first.
 *
 * Resolves — never rejects. Every failure becomes a `denied` result with a reason
 * the caller can word differently: "you blocked it" and "we could not get a fix"
 * need different advice.
 */
export async function requestLocation(): Promise<LocationResult> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return { status: 'denied', reason: 'unsupported' };
  }

  /* Precise first. A GPS fix is worth waiting for; it is what the radius needs. */
  try {
    const precise = await askPosition({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
    return { status: 'ok', lat: precise.lat, lng: precise.lng, accuracyM: precise.accuracy, precise: true };
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    /* 1 = PERMISSION_DENIED. Asking again coarsely would only annoy the browser
       and cannot succeed, so it is reported straight away. */
    if (code === 1) return { status: 'denied', reason: 'blocked' };
  }

  /* Then a normal fix: lower accuracy, much more likely to answer indoors. */
  try {
    const coarse = await askPosition({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
    return { status: 'ok', lat: coarse.lat, lng: coarse.lng, accuracyM: coarse.accuracy, precise: false };
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) return { status: 'denied', reason: 'blocked' };
    if (code === 3) return { status: 'denied', reason: 'timeout' };
    return { status: 'denied', reason: 'unavailable' };
  }
}

/**
 * The line under the button after a refusal.
 *
 * Each is actionable: a blocked customer is told where the switch is, because
 * "denied" with no route forward is how a checkout loses an order.
 */
export function deniedMessage(reason: Extract<LocationResult, { status: 'denied' }>['reason']): string {
  switch (reason) {
    case 'blocked':
      return 'Location is blocked for this site. Allow it in your browser’s site settings, or type your address and pick it from the list.';
    case 'unsupported':
      return 'This browser cannot share a location. Type your address and pick it from the list instead.';
    case 'timeout':
      return 'We could not get a location in time. Try again, or type your address and pick it from the list.';
    default:
      return 'We could not get your location. Type your address and pick it from the list instead.';
  }
}
