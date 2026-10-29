/**
 * Service-window and delivery-area rules.
 *
 * The business cooks on Thursdays and Fridays only, serving delivery and
 * collection between 12:00 and 13:30, and delivers in Rosebank and Sandton.
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

export function formatMinutes(total) {
  const safe = ((Math.round(Number(total) || 0) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

/** Wall-clock day/hour/minute in Johannesburg, whatever the host timezone is. */
export function sastNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SERVICE_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const shortDay = get('weekday');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(shortDay);
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return {
    day: day >= 0 ? day : 0,
    dayLabel: DAY_LABELS[day >= 0 ? day : 0],
    minutes: hour * 60 + minute,
    timeLabel: `${pad(hour)}:${pad(minute)}`,
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
  const today = hoursFor(settings, at.day);
  const open = Boolean(today && at.minutes >= today.openMinutes && at.minutes <= today.closeMinutes);

  const days = today ? [today] : [];
  const ahead = [];
  for (let offset = 1; offset <= 7; offset += 1) {
    const entry = hoursFor(settings, (at.day + offset) % 7);
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
   * Three different closed states, and they must not read the same.
   *
   *   - outside the window on a cooking day (early morning, after lunch),
   *   - a day we never cook on at all (Monday to Wednesday, weekends).
   *
   * Telling someone on a Wednesday that "we are closed right now" reads like a
   * temporary glitch; they need to know the kitchen simply is not open today,
   * when it will be, and that the plan is to trade every day. The wording stays
   * warm without promising a date the business has not given us.
   */
  const isServiceDay = Boolean(today);
  let headline;
  let message;
  let shortMessage;

  if (open) {
    headline = 'Serving now';
    message = `We are serving now — delivery and collection until ${today.close}.`;
    shortMessage = `Serving now until ${today.close}.`;
  } else if (isServiceDay && at.minutes < today.openMinutes) {
    headline = 'Not cooking yet';
    message = `The pots go on at ${today.open}. Place your order now and it goes in first — today's window is ${today.open}–${today.close}.`;
    shortMessage = `Pots go on at ${today.open} today — order now and you are first in the queue.`;
  } else if (isServiceDay) {
    headline = "Today's window has closed";
    message = nextWindowLabel
      ? `Today's ${today.open}–${today.close} window has closed, but the next one is ${nextWindowLabel}. Place your order now and it will be cooked then.`
      : `Today's ${today.open}–${today.close} window has closed. Please contact us on WhatsApp to arrange an order.`;
    shortMessage = `Today's window has closed${nextWindowLabel ? ` — next up ${nextWindowLabel.replace(' 12:00–13:30', '')}` : ''}.`;
  } else {
    headline = `${at.dayLabel} is a rest day`;
    message = [
      `The pots are resting today — and honestly, so are we.`,
      dayList ? `We cook on ${dayList}, ${window},` : 'We cook on selected days,',
      `and we are working towards being open every day.`,
      nextWindowLabel ? `Your order will go in first for ${nextWindowLabel}.` : '',
    ].filter(Boolean).join(' ');
    const nextDay = next ? next.dayLabel : null;
    shortMessage = `Rest day — we cook ${dayList}, ${window}. ${nextDay ? `Your order goes in first on ${nextDay}.` : 'Please message us to arrange a day.'}`;
  }

  return {
    open,
    isServiceDay,
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
      message: `Check the suburb — we deliver in ${deliveryAreasLabel(settings)} only. Add "${chosen}" to the address, or choose collection.`,
    };
  }
  if (named.some((a) => a.toLowerCase() === chosen.toLowerCase())) return null;

  return {
    level: 'error',
    message: `That address is in ${named.join(' and ')}, but you chose ${chosen}. Change the delivery area, or enter a ${chosen} address.`,
  };
}

export function deliveryAreasLabel(settings) {
  const areas = settings?.deliveryAreas ?? [];
  if (areas.length <= 1) return areas[0] ?? '';
  return `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`;
}

/** A pre-order note stored on every order so the kitchen knows which window it belongs to. */
export function serviceWindowFor(settings, now = new Date()) {
  const status = serviceStatus(settings, now);
  return {
    plannedFor: status.open ? status.todayLabel : status.nextWindowLabel,
    isPreOrder: !status.open,
    label: status.open ? `Now — ${status.windowLabel}` : status.nextWindowLabel ?? 'To be confirmed',
  };
}
