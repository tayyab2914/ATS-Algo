/**
 * Entitlement — the one question the whole paywall asks.
 *
 * There is no payment processor and no plan catalog. A `Subscription` row exists
 * if and only if an admin granted that member access from Members Management,
 * and revoking is a delete. So "is this person entitled" reduces to: does a row
 * exist, and has its end date passed?
 *
 * Expiry is evaluated HERE, at read time, against the wall clock — never stored.
 * Nothing rewrites a lapsed row and no cron sweeps the table, which is
 * deliberate: a job that fails to run would leave expired grants opening gates,
 * whereas a comparison that happens on every request cannot be skipped.
 */

/**
 * Authoritative "does this grant access right now" check.
 *
 * `null` (no row) is no access. A row with `currentPeriodEnd === null` is an
 * open-ended ("Lifetime") grant and never lapses. Anything else is live until
 * its end date and dead the instant after.
 *
 * The parameter is structural rather than the full model so callers can pass a
 * narrow Prisma `select` — every gate in the app fetches only this one column.
 */
export function isSubscriptionActive(sub: { currentPeriodEnd: Date | null } | null): boolean {
  if (!sub) return false;
  return sub.currentPeriodEnd === null || sub.currentPeriodEnd > new Date();
}
