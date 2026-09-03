/**
 * Shared number formatting for the Community Access Link screens.
 *
 * It lives in `lib/` rather than beside the table that first needed it because
 * both server components (the detail page's stat tiles) and client components
 * (the list, the calendar, the roster) format the same figures. A helper
 * exported from a `"use client"` module is a CLIENT REFERENCE, not a function:
 * calling it during a server render throws "Attempted to call compactMoney()
 * from the server". Pure modules like this one are importable from either side.
 */

/**
 * Money at a glance — `$0`, `$840`, `$50k`, `$1.2M`.
 *
 * These are trade-volume figures shown in table cells and stat tiles, where the
 * question is "is this community worth anything" rather than "what exactly did
 * they trade". One extra digit of precision below each threshold, so `$1.2M`
 * stays readable while `$12M` doesn't waste a character on a meaningless `.3`.
 *
 * Negatives are not expected — notional is a magnitude — so anything at or below
 * zero collapses to `$0` rather than inventing a minus sign the callers would
 * then have to explain.
 */
export function compactMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(value)}`;
}
