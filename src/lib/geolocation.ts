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
 *    delivery limit, a three-kilometre error is the difference between "free"
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

/**
 * How good the fix actually is, decided by the accuracy the device *reported* —
 * not by which code path happened to answer.
 *
 * The distinction matters because the fix prices a delivery fee. A laptop on
 * Wi-Fi, or a phone that fell back to a cell tower, can report ±3 000 m: round
 * that to the nearest suburb and the customer is quoted a fee for somewhere they
 * are not. `precise` is the only grade allowed to decide a fee boundary without
 * the customer confirming the address.
 */
export type LocationGrade = 'precise' | 'close' | 'coarse';

/** A fix at or under this radius is GPS-grade and can price a delivery fee. */
export const PRECISE_ACCURACY_M = 50;
/** Outdoors-but-not-GPS: usable to fill the box, not to settle a fee boundary. */
export const CLOSE_ACCURACY_M = 150;

/**
 * Grade a fix from the accuracy the device reported.
 *
 * `Infinity` (a browser that would not say) is treated as coarse: an unknown
 * accuracy is not evidence of a good one, and the safe direction is to ask the
 * customer to confirm the address rather than to charge from a guess.
 */
export function gradeFor(accuracyM: number): LocationGrade {
  if (!Number.isFinite(accuracyM)) return 'coarse';
  if (accuracyM <= PRECISE_ACCURACY_M) return 'precise';
  if (accuracyM <= CLOSE_ACCURACY_M) return 'close';
  return 'coarse';
}

export type LocationResult =
  | { status: 'ok'; lat: number; lng: number; accuracyM: number; grade: LocationGrade }
  | {
      status: 'denied';
      reason:
        | 'insecure'
        | 'blocked'
        /** A Permissions-Policy header denies geolocation to this origin. */
        | 'policy'
        /** The browser would not even show the prompt. */
        | 'prompt'
        | 'unavailable'
        | 'timeout'
        | 'unsupported';
    };

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
 * The Permissions API's view of geolocation for *this* origin, when the browser
 * offers one.
 *
 * Why this exists: on Safari and Firefox, and on Chrome when a Permissions-Policy
 * header blocks the feature, `getCurrentPosition` fails with a bare
 * PERMISSION_DENIED — the same code a customer tapping "Block" produces. Those
 * two situations need opposite advice, so the real state is read first, before
 * anything is asked for. `unknown` means the browser does not implement it, which
 * is not an error; the request is still made.
 */
async function geoPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!permissions?.query) return 'unknown';
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    return status.state as 'granted' | 'denied' | 'prompt';
  } catch {
    /* A browser that refuses the query refuses nothing else. */
    return 'unknown';
  }
}

/**
 * Has this customer already allowed location on this site?
 *
 * This is the question that decides whether the checkout may locate them by
 * itself. Only `granted` counts as a yes. Anything else — `prompt`, `denied`, or
 * a browser that cannot answer — means no automatic request, because:
 *
 *  - a request without permission raises the browser's prompt, and a permission
 *    prompt that appears unprompted, before the customer has asked for anything,
 *    is both intrusive and unreliable (Safari suppresses it entirely outside a
 *    tap, and Chrome throttles repeated ones);
 *  - a customer who tapped Block last week must not be re-asked on every visit.
 *
 * So the automatic fill is limited to people who have already said yes once. For
 * everyone else the fill happens on the tap that submits the order — a real user
 * gesture, where the prompt is guaranteed to appear and obviously belongs there.
 */
export async function hasLocationPermission(): Promise<boolean> {
  return (await geoPermission()) === 'granted';
}

/**
 * Ask for the customer's location, precise first — and ask *for permission*
 * first, so the prompt actually appears.
 *
 * Resolves — never rejects. Every failure becomes a `denied` result with a reason
 * the caller can word differently: "you blocked it", "this site is not allowed to
 * ask" and "we could not get a fix" need three different sentences.
 */
export async function requestLocation(): Promise<LocationResult> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return { status: 'denied', reason: 'unsupported' };
  }

  /*
   * Is this page even allowed to ask? The API is checked before the fix is
   * requested, so a header that denies geolocation is reported as `policy` rather
   * than as the customer having blocked something. `getCurrentPosition` is still
   * attempted when the permission state is `prompt`, because that call is what
   * makes the browser show its prompt.
   */
  if (typeof window !== 'undefined' && window.isSecureContext && navigator.geolocation === undefined) {
    return { status: 'denied', reason: 'policy' };
  }

  /*
   * The order matters, and it is the bug the owner hit.
   *
   * Browsers only expose geolocation on a secure origin — https, or localhost.
   * On plain http (an IP address, a LAN host, some preview links) the permission
   * prompt NEVER APPEARS: `getCurrentPosition` fails immediately with
   * PERMISSION_DENIED, and this code used to report that as "you blocked it,
   * allow it in your site settings". The customer had blocked nothing, and the
   * advice sent them hunting for a switch that would not help.
   *
   * Checking `isSecureContext` first means the message can say the true reason.
   */
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { status: 'denied', reason: 'insecure' };
  }

  /*
   * The browser's own record of whether this origin may ask.
   *
   * One case is decisive and is answered here: `denied` means no prompt will
   * appear, so calling `getCurrentPosition` would only produce the same
   * PERMISSION_DENIED with no chance of recovery. It is reported straight away
   * rather than as a wasted round trip.
   *
   * `prompt` and `unknown` are NOT pre-judged. `prompt` is exactly the state in
   * which the fix request is what raises the browser's prompt — the permission
   * this site has to ask for — and `unknown` is a browser that does not implement
   * the query at all. Both fall through to the request below, and the value is
   * kept only to word a later failure accurately: PERMISSION_DENIED while the
   * state was `prompt` means something other than the customer said no.
   */
  const permission = await geoPermission();
  if (permission === 'denied') return { status: 'denied', reason: 'blocked' };

  /*
   * Precise first, and FRESH.
   *
   * `maximumAge: 0` is the part that actually makes it precise. The browser is
   * free to answer a request from its cache, and a cached fix up to a minute old
   * is a position from wherever the phone was a minute ago — through a suburban
   * block, or a whole off-ramp. Asking for zero refuses the cache; the device has
   * to answer where it is now.
   */
  const preciseAttempt = () =>
    askPosition({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });

  try {
    const precise = await preciseAttempt();
    return { status: 'ok', lat: precise.lat, lng: precise.lng, accuracyM: precise.accuracy, grade: gradeFor(precise.accuracy) };
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    /*
     * 1 = PERMISSION_DENIED. Asking again coarsely would only annoy the browser
     * and cannot succeed, so it is reported straight away. `prompt` means the
     * browser never showed the prompt at all — a policy or a sandbox did the
     * refusing — which the customer cannot fix from a site setting.
     */
    if (code === 1) {
      return { status: 'denied', reason: permission === 'prompt' ? 'policy' : 'blocked' };
    }

    /*
     * A high-accuracy fix can miss its window indoors or in a car park. The
     * timeout is passed through rather than swallowed so the coarse fallback below
     * can still run: a second precise attempt here was worse on both counts — it
     * doubled the wait for the customer, and it removed the fallback that makes the
     * button work at all indoors.
     */
  }

  /*
   * Last resort: a normal fix, much more likely to answer indoors.
   *
   * It is reported with the accuracy it actually has, and on most devices that
   * is `coarse`. The caller is expected to treat a coarse fix as "we know roughly
   * where you are" — good enough to fill the box and start from — and to ask the
   * customer to confirm the address before it settles a fee boundary. Returning
   * it as though it were precise is how a customer gets quoted a fee for the
   * suburb centre instead of their house.
   */
  try {
    const coarse = await askPosition({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 });
    return { status: 'ok', lat: coarse.lat, lng: coarse.lng, accuracyM: coarse.accuracy, grade: gradeFor(coarse.accuracy) };
  } catch (err) {
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) return { status: 'denied', reason: permission === 'prompt' ? 'policy' : 'blocked' };
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
    case 'insecure':
      /*
       * The honest version of the message that used to say "blocked". This
       * happens on any http:// address and is not something the customer can fix
       * from their side, so the advice has to be a working alternative — the
       * address box — rather than a switch that does not exist for them.
       */
      return 'Location needs a secure (https) connection, so this page cannot ask for it. Type your address and pick it from the list — that works just as well.';
    case 'blocked':
      /*
       * The customer answered the browser's prompt with Block on a previous
       * visit, or the browser is holding a decision the page cannot change.
       * Only the customer can undo it, so the message names the switch — the
       * icon beside the address bar, under Location, which is where every
       * browser puts a site permission — and offers the address box, because
       * the second route is usually faster.
       */
      return 'Location is blocked for this site. Tap the icon beside the address bar (under Location) and allow it, then tap the button again — or type your address and pick it from the list.';
    case 'policy':
      /*
       * Nothing the customer did. The page is not permitted to ask — a
       * Permissions-Policy header, or an embedded frame, is refusing on the
       * origin's behalf — so there is no prompt to answer and no site setting
       * that would help. Pointing at the address box is the only honest advice,
       * and it is a full substitute: the distance is measured from the picked
       * address instead of from the device.
       */
      return 'This site is not allowed to ask for your location here. Type your address and pick it from the list — the delivery check works exactly the same way.';
    case 'unsupported':
      return 'This browser cannot share a location. Type your address and pick it from the list instead.';
    case 'timeout':
      return 'We could not get a location in time. Try again, or type your address and pick it from the list.';
    default:
      return 'We could not get your location. Type your address and pick it from the list instead.';
  }
}
