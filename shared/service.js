/**
 * Service-window and delivery-area rules.
 *
 * The business cooks on Thursdays and Fridays only, serving delivery and
 * delivery between 12:00 and 13:30, in Sandton and Rosebank and up to 10 km out.
 * These helpers decide what the storefront may promise, in one place, so the
 * API and the page copy can never drift apart.
 *
 * All business times are South African Standard Time (Africa/Johannesburg,
 * UTC+2 all year — there is no daylight saving).
 */

export const SERVICE_TZ = 'Africa/Johannesburg';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Minutes since midnight for an "HH:MM" value, or null when malformed. */
export function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const pad = (n) => String(n).padStart(2, '0');
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMinutes(total) {
  const safe = ((Math.round(Number(total) || 0) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** Wall-clock day/hour/minute in Johannesburg, whatever the host timezone is. */
export function sastNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SERVICE_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const shortDay = get('weekday');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(shortDay);
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const dayOfMonth = Number(get('day')) || 1;
  const month = Number(get('month')) || 1;

  return {
    day: day >= 0 ? day : 0,
    dayLabel: DAY_LABELS[day >= 0 ? day : 0],
    minutes: hour * 60 + minute,
    timeLabel: `${pad(hour)}:${pad(minute)}`,
    dayOfMonth,
    month,
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The configured opening entry for a weekday, or null when closed. */
export function hoursFor(settings, day) {
  const entry = (settings?.hours ?? []).find((h) => h.day === day);
  if (!entry || entry.closed) return null;
  const open = toMinutes(entry.open);
  const close = toMinutes(entry.close);
  if (open === null || close === null || close <= open) return null;
  return { ...entry, openMinutes: open, closeMinutes: close, label: entry.label ?? DAY_LABELS[day] };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_LABELS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse a special-days env value into ISO date strings.
 *
 * Accepts comma, semicolon or whitespace separated entries:
 *   "2026-11-14"                    one day, the configured service window
 *   "2026-11-14 2026-12-05"         several
 * Anything that is not a real calendar date is dropped, so a typo can never
 * open the shop on an unexpected day. Returned entries are de-duplicated and
 * sorted.
 */
export function parseSpecialServiceDays(value) {
  if (!value) return [];
  const out = new Set();
  for (const chunk of String(value).split(/[\s,;]+/)) {
    const token = chunk.trim();
    const match = DATE_RE.exec(token);
    if (!match) continue;
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      date.getUTCFullYear() !== Number(y) ||
      date.getUTCMonth() !== Number(m) - 1 ||
      date.getUTCDate() !== Number(d)
    ) {
      continue;
    }
    out.add(token);
  }
  return [...out].sort();
}

/**
 * The special opening configured for a calendar date (SAST), or null.
 *
 * `settings.specialServiceDays` carries the owner's one-off service days — a
 * single Saturday market, a holiday trading day — as either an ISO date string
 * ("2026-11-14", the configured `serviceWindow` applies) or an object
 * ({ date: '2026-11-14', open: '11:00', close: '14:00', label?, note? }).
 *
 * The shape returned matches `hoursFor` (openMinutes / closeMinutes / label) so
 * the rest of the service rules apply unchanged — a special day can be before
 * the window, inside it, or after it just like a Thursday. `special: true` is
 * added so callers can say "special opening" rather than implying it is the
 * weekly rhythm.
 */
export function specialServiceDayFor(settings, dateKey, weekday) {
  const list = Array.isArray(settings?.specialServiceDays) ? settings.specialServiceDays : [];
  if (!DATE_RE.test(String(dateKey ?? ''))) return null;
  const wanted = String(dateKey);

  for (const raw of list) {
    const entry = typeof raw === 'string' ? { date: raw } : raw && typeof raw === 'object' ? raw : null;
    if (!entry || String(entry.date ?? '').trim() !== wanted) continue;

    const fallback = settings?.serviceWindow ?? {};
    const open = toMinutes(entry.open ?? fallback.open ?? '12:00');
    const close = toMinutes(entry.close ?? fallback.close ?? '13:30');
    if (open === null || close === null || close <= open) return null;

    const day = typeof weekday === 'number' ? weekday : new Date(`${wanted}T00:00:00Z`).getUTCDay();
    const [y, m, d] = wanted.split('-').map(Number);
    const label =
      String(entry.label ?? '').trim() ||
      `${DAY_LABELS_FULL[day]} ${d} ${MONTH_SHORT[m - 1]} (special opening)`;

    return {
      day,
      label,
      open: formatMinutes(open),
      close: formatMinutes(close),
      closed: false,
      special: true,
      note: String(entry.note ?? '').trim() || null,
      openMinutes: open,
      closeMinutes: close,
      date: wanted,
    };
  }
  return null;
}

/** Merge env-provided dates into the catalogue's special days (catalogue wins per date). */
export function mergeSpecialServiceDays(settings, envDates) {
  const fromEnv = (Array.isArray(envDates) ? envDates : []).map((date) => ({ date }));
  const fromSeed = Array.isArray(settings?.specialServiceDays) ? settings.specialServiceDays : [];
  const seen = new Set();
  const merged = [];
  for (const entry of [...fromSeed, ...fromEnv]) {
    const date = typeof entry === 'string' ? entry : String(entry?.date ?? '').trim();
    if (!date || seen.has(date)) continue;
    seen.add(date);
    merged.push(entry);
  }
  return { ...settings, specialServiceDays: merged };
}

export function windowLabel(settings) {
  const entry = (settings?.hours ?? []).find((h) => !h.closed) ?? null;
  const open = entry?.open ?? settings?.serviceWindow?.open ?? '12:00';
  const close = entry?.close ?? settings?.serviceWindow?.close ?? '13:30';
  return `${open}–${close}`;
}

/**
 * Where we are in the weekly rhythm.
 *
 * `open` is true only inside a service window. Everywhere else the storefront
 * accepts a pre-order and says which window it will be cooked in, rather than
 * pretending the kitchen is standing by.
 */
export function serviceStatus(settings, now = new Date()) {
  const at = sastNow(now);
  /*
   * A one-off special opening (a Saturday market, a holiday trading day) is a
   * service day like any other. It is looked up by calendar date, not weekday,
   * so "the 14th" trades once and never again. The weekly rhythm is unchanged
   * on every other day.
   */
  const [cy, cm, cd] = at.dateKey.split('-').map(Number);
  const keyFor = (offset) => {
    const shifted = new Date(Date.UTC(cy, cm - 1, cd + offset));
    return { key: shifted.toISOString().slice(0, 10), weekday: shifted.getUTCDay() };
  };
  const today = specialServiceDayFor(settings, at.dateKey, at.day) ?? hoursFor(settings, at.day);
  const open = Boolean(today && at.minutes >= today.openMinutes && at.minutes <= today.closeMinutes);

  const isSpecial = Boolean(today?.special);
  const ahead = [];
  for (let offset = 1; offset <= 7; offset += 1) {
    const { key, weekday } = keyFor(offset);
    const entry = specialServiceDayFor(settings, key, weekday) ?? hoursFor(settings, weekday);
    if (entry) ahead.push({ ...entry, offset, date: new Date(now.getTime() + offset * 86400000) });
  }

  let next = null;
  if (today && at.minutes < today.openMinutes) {
    next = { dayLabel: today.label, open: today.open, close: today.close, offset: 0 };
  } else if (ahead.length) {
    const n = ahead[0];
    next = { dayLabel: n.label, open: n.open, close: n.close, offset: n.offset };
  }

  const nextWindowLabel = next ? `${next.dayLabel} ${next.open}–${next.close}` : null;
  const serviceDays = (settings?.hours ?? []).filter((h) => !h.closed).map((h) => h.label);
  // "We cook on Thursdays and Fridays" reads as a schedule; "Thursday and
  // Friday" reads as one weekend. The headline keeps the singular day name.
  const dayList = listLabel(serviceDays.map((label) => (/s$/i.test(label) ? label : `${label}s`)));
  const window = windowLabel(settings);

  /*
   * Two ways the site reads when the kitchen is not cooking, and they must not
   * read the same:
   *
   *   - outside the window on a cooking day (early morning, before the pots),
   *   - a day we never cook on at all (Monday to Wednesday, weekends).
   *
   * Telling someone on a Wednesday that "we are closed right now" reads like a
   * temporary glitch; they need to know the kitchen simply is not open today,
   * when it will be, and that the plan is to trade every day. The wording stays
   * warm without promising a date the business has not given us.
   *
   * After the window on a cooking day there is no third reading: the owner's
   * instruction (20 Nov 2026) is that once the pots are done the site says what
   * any rest day says — "{Day} is a rest day" and the scheduling note — instead
   * of the old "Today's window has closed / Next cooking day: …" closure notice.
   * The same-day order rule is unchanged; only the words are.
   */
  const isServiceDay = Boolean(today);
  /*
   * The one closed state that must stop taking orders outright: we are on a
   * cooking day and the window has already gone by. Before the pots go on
   * (early morning) and on a rest day the site deliberately takes pre-orders
   * for the next window and says so, so neither of those is `orderingClosed`.
   */
  const orderingClosed = Boolean(today && at.minutes > today.closeMinutes);
  let headline;
  let message;
  let shortMessage;

  if (open) {
    headline = isSpecial ? 'Special opening — serving now' : 'Serving now';
    message = isSpecial
      ? `We are trading today, ${today.open}–${today.close}, as a special opening — delivering until ${today.close}.`
      : `We are serving now — delivering until ${today.close}.`;
    shortMessage = `Serving now until ${today.close}.`;
  } else if (isServiceDay && at.minutes < today.openMinutes) {
    headline = 'Not cooking yet';
    message = isSpecial
      ? `Today is a special opening. The pots go on at ${today.open}. Place your order now and it goes in first — today's window is ${today.open}–${today.close}.`
      : `The pots go on at ${today.open}. Place your order now and it goes in first — today's window is ${today.open}–${today.close}.`;
    shortMessage = `Pots go on at ${today.open} — order now and you are first in the queue.`;
  } else {
    /*
     * A rest day — and, since 20 Nov 2026, also a cooking day whose window has
     * gone by. The kitchen is not cooking now, and both states say exactly the
     * same thing: which days it does cook, when the next one is, that ordering
     * ahead is open, and the notice the kitchen needs. The day name in the
     * headline is today's own, so Thursday evening reads "Thursday is a rest
     * day" — from the customer's side the kitchen is done for the day, which
     * is the same fact.
     */
    headline = `${at.dayLabel} is a rest day`;
    /*
     * What a rest day actually means for the customer, in their terms.
     *
     * The old copy said "the pots are resting" and left the practical question
     * unanswered: can I order at all today? The answer is yes — you are never
     * blocked, you choose the cooking day you want — but the kitchen needs the
     * order before it starts, so it can buy and prep. Hence the ask for a day
     * or two's notice, with 24 hours as the hard floor.
     *
     * Catering is offered here too: it is the one thing people ask about that
     * cannot be handled in a normal slot, and putting it beside the schedule is
     * where someone planning an event will look.
     */
    message = [
      `We are not cooking today.`,
      dayList ? `The kitchen cooks on ${dayList}, ${window}.` : 'The kitchen cooks on selected days.',
      nextWindowLabel ? `The next one is ${nextWindowLabel}.` : '',
      `You can still order — nothing is blocked. Pick any cooking day ahead when you check out, and schedule as far forward as you like.`,
      `Please order a day or two before the day you want, and at least 24 hours ahead, so the kitchen has time to buy and prep.`,
      `Catering for an event? Ask us on WhatsApp.`,
    ].filter(Boolean).join(' ');
    /*
     * The strip is one line on a phone. It carries the three things a customer
     * standing on this page needs: we are shut, when we are open, and that they
     * can still schedule. The full speech is in the panel below.
     */
    shortMessage = `Not cooking today — the kitchen cooks ${dayList}, ${window}. You can still schedule any cooking day ahead; please order at least 24 hours before it. Catering? Ask us on WhatsApp.`;
  }

  return {
    open,
    /** True only once today's window has passed — ordering is refused. */
    orderingClosed,
    isServiceDay,
    /** True when today's service comes from `specialServiceDays`, not the weekly rhythm. */
    specialToday: isSpecial,
    timeZone: SERVICE_TZ,
    dayLabel: at.dayLabel,
    timeLabel: at.timeLabel,
    windowLabel: window,
    todayLabel: today ? `${today.label} ${today.open}–${today.close}` : `${at.dayLabel}: closed`,
    nextWindowLabel,
    headline,
    message,
    /** One line, for the site-wide status strip. */
    shortMessage,
    serviceDays,
  };
}

/** "Thursday and Friday", "Thursday, Friday and Saturday". */
function listLabel(values) {
  const list = (values ?? []).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Which approved delivery area an address falls in, if any.
 * Matching is on whole words so "Sandton" does not match "Sandtonville" and a
 * street named "Rosebank Avenue" in another suburb still needs the suburb.
 */
export function deliveryAreaFor(address, settings) {
  const haystack = String(address ?? '').toLowerCase();
  if (!haystack.trim()) return null;
  for (const area of settings?.deliveryAreas ?? []) {
    const needle = String(area).toLowerCase().trim();
    if (!needle) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack)) return area;
  }
  return null;
}

/**
 * Which delivery area the checkout should start on.
 *
 * The business asked for Rosebank to be preselected: most orders go there, and a
 * select that opens on "Choose an area" is a required choice the customer has to
 * make before they can even see whether the plate can reach them. Rosebank is
 * preferred by name rather than by position so that reordering the area list in
 * the catalogue does not silently change which one is the default.
 *
 * @param {{ deliveryAreas?: string[] } | null} [settings]
 * @returns {string} the area to preselect, or '' if none is configured
 */
export function defaultDeliveryArea(settings) {
  const areas = settings?.deliveryAreas ?? [];
  return areas.find((area) => String(area).toLowerCase() === 'rosebank') ?? areas[0] ?? '';
}

/**
 * Every approved area named in a piece of text.
 *
 * `deliveryAreaFor` answers "which area does this belong to", which is the wrong
 * question when the customer has already chosen an area: it returns the first
 * match, so "12 Oxford Road, Illovo, Sandton" with Rosebank selected silently
 * became a Rosebank order. The checkout needs to know *all* the areas a typed
 * address mentions, so it can tell the customer when the two disagree.
 */
export function areasNamedIn(text, settings) {
  const haystack = String(text ?? '').toLowerCase();
  if (!haystack.trim()) return [];
  const found = [];
  for (const area of settings?.deliveryAreas ?? []) {
    const needle = String(area).toLowerCase().trim();
    if (!needle) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack)) found.push(area);
  }
  return found;
}

/**
 * Does the typed address belong to the area the customer picked?
 *
 * Returns `null` when it is fine, or `{ level, message }`:
 *
 *   level 'error'  the address names a different delivery area. The order must
 *                  not go through, because the kitchen would deliver outside the
 *                  boundary the customer believes they ordered inside.
 *   level 'warn'   the address names no area at all. A street address such as
 *                  "12 Oxford Road" is normal and often carries no suburb, so
 *                  this must never block an order — it asks the customer to
 *                  confirm instead.
 *
 * `hintArea` is what a geocoder said the picked address belongs to (the
 * address typeahead knows the suburb from OpenStreetMap). It outranks the text
 * match: a suggestion whose suburb is a known area but not the selected one is
 * an error even when the street line never repeats the suburb.
 *
 * @param {string} address          what the customer typed
 * @param {string} area             the delivery area they selected
 * @param {{ deliveryAreas?: string[] } | null} [settings]
 * @param {string | null} [hintArea] area the chosen suggestion belongs to
 * @returns {{ level: 'error' | 'warn', message: string } | null}
 */
export function deliveryAddressProblem(address, area, settings, hintArea = null) {
  const chosen = String(area ?? '').trim();
  const typed = String(address ?? '').trim();
  if (!chosen) return null;
  /*
   * "Other / outside Sandton & Rosebank" is a legitimate answer now.
   *
   * The rules are distance-based (owner, 14 Nov 2026): inside the two suburbs
   * delivery is included, outside them a fee applies, and past the limit we refuse.
   * So an address in Bryanston is not a contradiction of the area select — it is
   * simply outside the included ring, and the distance check prices it. Checking
   * it against a two-suburb list would refuse exactly the customers the fee
   * exists for.
   */
  if (isOutsideAreaChoice(chosen)) return null;

  const known = settings?.deliveryAreas ?? [];
  const hinted = String(hintArea ?? '').trim();
  const hintIsKnown = Boolean(hinted) && known.some((a) => a.toLowerCase() === hinted.toLowerCase());

  if (hintIsKnown && hinted.toLowerCase() !== chosen.toLowerCase()) {
    return {
      level: 'error',
      message: `That address is in ${hinted}, but you chose ${chosen}. Change the delivery area to ${hinted}, or enter a ${chosen} address.`,
    };
  }

  const named = areasNamedIn(typed, settings);
  if (!named.length) {
    if (hintIsKnown) return null;
    if (!typed) return null;
    return {
      level: 'warn',
      message: `Check the suburb — include a street, suburb and city, or pick the address from the list as you type.`,
    };
  }
  if (named.some((a) => a.toLowerCase() === chosen.toLowerCase())) return null;

  return {
    level: 'error',
    message: `That address is in ${named.join(' and ')}, but you chose ${chosen}. Change the delivery area, or enter a ${chosen} address.`,
  };
}

/**
 * The value the "Delivery area" select uses for anywhere that is not Sandton or
 * Rosebank.
 *
 * It exists because the radius made the two-name select wrong: a customer in
 * Bryanston had no honest answer to "which of these two suburbs are you in".
 * Picking a lie is worse than a third option, so the third option is "other" and
 * the distance check does the deciding.
 *
 * The wording is "Another area" and not "Other — outside Sandton & Rosebank"
 * (owner, 16 Nov 2026: "remove Outside Sandton & Rosebank"). That phrase
 * restated the two-suburb boundary as a wall, one line after the site had
 * explained there is one radius — so the customer read a closed list and a
 * fee they could not see the reason for. The option is simply the third answer to
 * "where are you": somewhere else, priced by its distance.
 */
export const OUTSIDE_AREA = 'Another area — within 10 km';

/**
 * Is this select value the "somewhere else" option?
 *
 * Both spellings are accepted on purpose. A browser holding a cached bundle, or a
 * saved checkout form session, still sends the old long label; refusing it would
 * turn an existing customer's saved area into an empty choice. The new one is
 * what every surface shows from now on.
 */
export function isOutsideAreaChoice(area) {
  const value = String(area ?? '').trim().toLowerCase();
  return value.startsWith('other') || value.startsWith('another area') || value === 'other';
}

/**
 * The select's options: the approved suburbs first, then "other".
 *
 * Kept in one place so the live checkout, the preview checkout and any other
 * surface cannot disagree about what can be chosen.
 */
export function deliveryAreaOptions(settings) {
  const named = settings?.deliveryAreas ?? [];
  return [...named, OUTSIDE_AREA];
}

export function deliveryAreasLabel(settings) {
  const areas = settings?.deliveryAreas ?? [];
  if (areas.length <= 1) return areas[0] ?? '';
  return `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
}

/**
 * The cooking days a customer can book *ahead*, not just the next one.
 *
 * The owner's complaint (16 Nov 2026) was that the site made people wait for
 * "the" Thursday: a customer browsing on a Saturday saw one date, and if that
 * date did not suit them there was nothing else to choose. Every Thursday and
 * Friday the kitchen cooks, so every Thursday and Friday inside the booking
 * horizon is a day an order can be placed for.
 *
 * The horizon is 8 weeks rather than unlimited on purpose. A plate ordered for
 * a date three months out is not a booking, it is a note the kitchen will have
 * lost by then — and the price list, the menu and even the days the kitchen
 * trades can all change inside that time. Eight weeks is long enough to cover
 * "the end of the month" and the month after it, which is how people here
 * actually plan a family lunch.
 *
 * Today is included only while it is still orderable: after the window closes
 * it drops out, because the kitchen is done cooking and asking for it would be
 * a request it cannot meet. Rest days and special openings are honoured exactly
 * as the rest of the service rules honour them.
 *
 * @param {any} settings
 * @param {Date} [now]
 * @param {{ weeks?: number, limit?: number }} [options]
 * @returns {{ date: string, dayLabel: string, label: string, open: string, close: string, isToday: boolean }[]}
 */
export function bookableDates(settings, now = new Date(), options = {}) {
  const weeks = Math.max(1, Math.min(26, Math.floor(Number(options.weeks) || 8)));
  const limit = Math.max(1, Math.min(60, Math.floor(Number(options.limit) || 24)));
  const at = sastNow(now);
  const [cy, cm, cd] = at.dateKey.split('-').map(Number);
  const todayEntry = specialServiceDayFor(settings, at.dateKey, at.day) ?? hoursFor(settings, at.day);
  const todayStillOrderable = Boolean(todayEntry && at.minutes <= todayEntry.closeMinutes);

  const out = [];
  const days = weeks * 7;
  for (let offset = 0; offset <= days && out.length < limit; offset += 1) {
    if (offset === 0 && !todayStillOrderable) continue;
    const shifted = new Date(Date.UTC(cy, cm - 1, cd + offset));
    const key = shifted.toISOString().slice(0, 10);
    const weekday = shifted.getUTCDay();
    const entry = specialServiceDayFor(settings, key, weekday) ?? hoursFor(settings, weekday);
    if (!entry) continue;
    /* A cooking day whose window has already gone is not bookable — today is
       the only such day that can appear inside a forward-only scan. */
    if (offset === 0 && at.minutes > entry.closeMinutes) continue;
    out.push({
      date: key,
      dayLabel: entry.special ? entry.label : DAY_LABELS[weekday],
      label: entry.special ? entry.label : `${DAY_LABELS[weekday]} ${shifted.getUTCDate()} ${MONTH_SHORT[shifted.getUTCMonth()]}`,
      /* What the customer and the kitchen both read: a day, not a range. The
         range belongs to the window, and the window is the same one every week. */
      shortLabel: `${DAY_LABELS[weekday]} ${shifted.getUTCDate()} ${MONTH_SHORT[shifted.getUTCMonth()]}`,
      open: entry.open,
      close: entry.close,
      isToday: offset === 0,
      special: Boolean(entry.special),
    });
  }
  return out;
}

/**
 * Is `date` a day this kitchen will cook for, given `settings`?
 *
 * The checkout lets a customer name any cooking day inside the horizon, and the
 * server must check that name rather than trust it — otherwise a hand-made
 * request books a plate for a Sunday in 2031. Returns the matched booking (with
 * its label and window) or null.
 *
 * @param {any} settings
 * @param {string} date  "YYYY-MM-DD"
 * @param {Date} [now]
 * @returns {{ date: string, label: string, open: string, close: string, isToday: boolean, special: boolean } | null}
 */
export function bookableDateFor(settings, date, now = new Date()) {
  const wanted = String(date ?? '').trim();
  if (!DATE_RE.test(wanted)) return null;
  return bookableDates(settings, now, { limit: 60 }).find((d) => d.date === wanted) ?? null;
}

/**
 * A pre-order note stored on every order so the kitchen knows which window it
 * belongs to.
 *
 * `plannedDate` is the customer's own answer when they booked ahead — an order
 * placed on a Saturday for a specific Friday is a different thing from one
 * placed on that Friday morning, and the receipt, the kitchen alert and the
 * WhatsApp message all have to name the right day. When no date was chosen the
 * note falls back to the next window, which is what an order sent outside the
 * window has always meant.
 *
 * @param {any} settings
 * @param {Date} [now]
 * @param {{ date?: string, label?: string } | null} [booking]  validated by `bookableDateFor`
 */
export function serviceWindowFor(settings, now = new Date(), booking = null) {
  const status = serviceStatus(settings, now);
  const booked = booking?.date ? booking : null;
  if (booked) {
    return {
      date: booked.date,
      plannedFor: booked.label ?? booked.date,
      isPreOrder: true,
      booked: true,
      label: booked.label ?? booked.date,
    };
  }
  return {
    date: status.open ? status.todayLabel : null,
    plannedFor: status.open ? status.todayLabel : status.nextWindowLabel,
    isPreOrder: !status.open,
    booked: false,
    label: status.open ? `Now — ${status.windowLabel}` : status.nextWindowLabel ?? 'To be confirmed',
  };
}

/* --------------------------------------------------------------------- */
/* Extras: how many of a thing, and what that costs                      */
/* --------------------------------------------------------------------- */

/**
 * How many of this extra one line may carry.
 *
 * `max` is the catalogue's word for it and is optional, because most choices are
 * not extras: a starch is one, and picking a different one replaces it. `1` is
 * therefore the default, and a plate group's own `max` (which is about how many
 * *selections* fit in a group) is clamped to the same number so the two can
 * never disagree about whether two ginger beers is allowed.
 *
 * The ceiling of 20 is not a business rule — it is a sanity limit so a malicious
 * client cannot ask the kitchen to pack 10,000 drinks, exactly as the line
 * quantity is capped at 20/50 elsewhere.
 *
 * @param {{ max?: number, multiple?: boolean } | null | undefined} group
 * @param {{ max?: number } | null | undefined} [choice]
 * @returns {number}
 */
export function maxPerExtra(group, choice) {
  const raw = [choice?.max, group?.max].find((v) => Number.isFinite(Number(v)) && Number(v) >= 1);
  const n = Math.floor(Number(raw ?? 1));
  return Math.max(1, Math.min(20, n));
}

/**
 * The money a *second portion* of a starch or a vegetable side adds.
 *
 * This is a different rule from `extraCost`, and the difference is the whole
 * point: `extraCost` prices every unit of a priced extra (a drink, where nothing
 * is included), whereas a starch or side inside a plate already includes its
 * first portion in the plate price. Asking R30 for the pap that the R100 plate
 * is supposed to come with would be a second charge for the same food.
 *
 * So the count is split. Portions up to `extraAfter` are free; each one beyond
 * it costs `extraPrice`. One pap is 0, two pap is 30, three is 60 — and the same
 * rule applies to every side, so a plate with double pap and double chakalaka is
 * plate + 60.
 *
 * @param {{ extraAfter?: number, extraPrice?: number, price?: number } | null | undefined} choice
 * @param {number} [count]
 * @returns {number}
 */
export function portionCost(choice, count) {
  const n = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));
  const included = Math.max(0, Math.floor(Number(choice?.extraAfter) || 0));
  const charged = Math.max(0, n - included);
  if (!charged) return 0;
  const unit = Number(choice?.extraPrice);
  return Math.round((Number.isFinite(unit) ? unit : 0) * charged * 100) / 100;
}

/**
 * How many portions of this choice one line may carry.
 *
 * A portioned extra goes to four — two for the plate, two more on request —
 * which is what the catalogue's `max` says. Everything else is one.
 *
 * @param {{ max?: number } | null | undefined} choice
 * @returns {number}
 */
export function maxPortions(choice) {
  const n = Math.floor(Number(choice?.max ?? 1));
  return Math.max(1, Math.min(20, n));
}

/**
 * The money one priced extra adds to a line: unit price × how many.
 *
 * Kept here, rather than inline in the two pricing paths, because the browser and
 * the server must agree to the cent — a basket that says R150 and a server that
 * charges R175 is the bug this whole shared module exists to prevent.
 *
 * @param {number} priceDelta
 * @param {number} [qty]
 * @returns {number}
 */
export function extraCost(priceDelta, qty) {
  const unit = Number(priceDelta) || 0;
  const n = Math.max(1, Math.min(20, Math.floor(Number(qty) || 1)));
  return Math.round(unit * n * 100) / 100;
}

/**
 * How a picked extra reads in a basket line, a receipt and the WhatsApp order.
 *
 * One is silent — "Ginger gemere" — and more than one is stated, because the
 * quantity is the part the kitchen has to act on: `2 × Ginger gemere`.
 *
 * @param {string} label
 * @param {number} [qty]
 * @returns {string}
 */
export function extraLabel(label, qty) {
  /* Clamped with the same ceiling as the money, so a label can never claim a
     quantity the price did not charge for. */
  const n = Math.max(1, Math.min(20, Math.floor(Number(qty) || 1)));
  return n > 1 ? `${n} × ${label}` : String(label ?? '');
}
