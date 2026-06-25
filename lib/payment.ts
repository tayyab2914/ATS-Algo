/**
 * Helpers for the Account Settings → Payment Methods section.
 *
 * Mirrors the philosophy of {@link maskApiKey} in `lib/account.ts`: a raw secret
 * (here the full card number) is accepted only transiently to derive the few
 * non-sensitive bits we keep — never persisted. The CVV is never transmitted.
 */

/** How many cards a single user may save. Guards against unbounded growth. */
export const MAX_PAYMENT_METHODS = 10;

/** Card networks we can name from the leading digits. */
export type CardBrand =
  | "Visa"
  | "Mastercard"
  | "American Express"
  | "Discover"
  | "Diners Club"
  | "JCB"
  | "UnionPay"
  | "Card";

/** Strip spaces/dashes a user may type between digit groups. */
export function normalizeCardNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/**
 * Identify the card network from its leading digits (IIN/BIN ranges). Returns
 * the generic "Card" when nothing matches, so an unknown-but-valid card still
 * saves rather than being rejected outright.
 */
export function detectCardBrand(rawNumber: string): CardBrand {
  const n = normalizeCardNumber(rawNumber);
  if (/^4\d{0,}$/.test(n)) return "Visa";
  // Mastercard: 51–55 or the 2221–2720 range.
  if (/^5[1-5]/.test(n) || /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "American Express";
  if (/^6(011|5|4[4-9]|22)/.test(n)) return "Discover";
  if (/^3(0[0-5]|[68])/.test(n)) return "Diners Club";
  if (/^35(2[89]|[3-8]\d)/.test(n)) return "JCB";
  if (/^62/.test(n)) return "UnionPay";
  return "Card";
}

/**
 * Luhn (mod-10) checksum — the standard structural check every real card number
 * satisfies. Catches typos and obviously fake numbers without contacting a
 * network. Requires 12–19 digits.
 */
export function luhnValid(rawNumber: string): boolean {
  const n = normalizeCardNumber(rawNumber);
  if (!/^\d{12,19}$/.test(n)) return false;
  let sum = 0;
  let double = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let digit = n.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** The only part of the PAN we keep. */
export function cardLast4(rawNumber: string): string {
  return normalizeCardNumber(rawNumber).slice(-4);
}

/**
 * True if a card with this expiry has already lapsed, evaluated at `now`. A card
 * is valid through the LAST day of its expiry month, so 06/2026 is good until
 * 2026-06-30. `now` is injectable to keep the logic testable and deterministic.
 */
export function isCardExpired(expMonth: number, expYear: number, now: Date = new Date()): boolean {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1–12
  if (expYear < currentYear) return true;
  if (expYear === currentYear && expMonth < currentMonth) return true;
  return false;
}

/** Client-safe representation of a saved card (no sensitive data ever leaves). */
export type PaymentMethodView = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
  label: string | null;
  isDefault: boolean;
  expired: boolean;
};

/** Two-digit zero-padded expiry month for display ("MM"). */
export function formatExpiry(expMonth: number, expYear: number): string {
  return `${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`;
}
