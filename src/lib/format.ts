/** Formatting helpers used across the public storefront. */

export const zar = (n: number) =>
  `R${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const zarShort = (n: number) => `R${Math.round(Number(n) || 0)}`;

export function timeAgo(iso: string) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

export function dayName(day: number) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ?? '';
}

export const spiceLabel = (n: number) => ['', 'Mild', 'Medium', 'Hot', 'Kasi fire'][n] ?? '';

/**
 * Is this an address we can reply to?
 *
 * Deliberately loose: one @, something on both sides, and a dot in the domain.
 * Anything stricter rejects real addresses (and a typo is recoverable — the
 * kitchen replies to the message, not to the database).
 */
export function isValidEmail(raw: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw ?? '').trim());
}

/**
 * A South African cell number we can actually dial: +27 82 123 4567,
 * 082 123 4567, 27821234567 and the spaced or dashed versions all pass.
 */
export function isValidCellNumber(raw: string) {
  const digits = normalisePhone(raw);
  return /^27[6-8]\d{8}$/.test(digits);
}

/**
 * South African mobile numbers. Accepts +27 and 0 prefixes, spaces and dashes.
 * Used by checkout and the loyalty-card lookup.
 */
export function isValidSaPhone(raw: string) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  return /^(?:\+27|27|0)\d{9}$/.test(digits.replace(/\D/g, '').length === 11 ? digits : digits);
}

export function normalisePhone(raw: string) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('27')) return digits;
  if (digits.startsWith('0')) return `27${digits.slice(1)}`;
  return digits;
}

/** Luhn check duplicated client-side for instant feedback only — the server re-validates. */
export function luhnValid(raw: string) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function detectCardBrand(raw: string) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^3(?:0[0-5]|[68])/.test(d)) return 'diners';
  return '';
}

export function formatCardNumber(raw: string) {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 19);
  if (/^3[47]/.test(d)) {
    return d.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));
  }
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function formatExpiry(raw: string) {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}
