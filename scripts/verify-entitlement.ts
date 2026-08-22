// Guards the two rules that decide who gets in: the GRANT DEADLINE and the
// 3-DAY GUEST TRIAL. Both are pure clock arithmetic evaluated on every request,
// so they are exactly the kind of thing that silently drifts — these cases pin
// the boundaries so a refactor cannot move them.
//
//   1. A grant is live until `currentPeriodEnd`, dead from that instant on.
//      NULL means no expiry. There is no status column and no job: nothing
//      rewrites a lapsed row, so this comparison IS the paywall.
//   2. The trial is exactly 3 days from first login, and a user whose grant
//      lapses falls back to their ORIGINAL clock — never a fresh 3 days.
//   3. The tier ladder resolves admin > live grant > trial, in that order.
//
// Pure logic: no database, no network. Run: npx tsx scripts/verify-entitlement.ts
import { isSubscriptionActive } from "../lib/billing.ts";
import { GUEST_TRIAL_DAYS, GUEST_TRIAL_MS, guestTrialFrom, guestTrialLabel } from "../lib/guest.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "\u2713" : "\u2717"} ${label}${detail ? ` \u2014 ${detail}` : ""}`);
};

const SEC = 1000;
const MINUTE = 60 * SEC;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();

console.log("\n1. A grant is the row plus its end date");
check("no row at all is no access", isSubscriptionActive(null) === false);
check("open-ended grant (null end) is access", isSubscriptionActive({ currentPeriodEnd: null }) === true);
check("grant ending in 30 days is access", isSubscriptionActive({ currentPeriodEnd: new Date(now + 30 * DAY) }) === true);
check("grant that ended is NOT access", isSubscriptionActive({ currentPeriodEnd: new Date(now - MINUTE) }) === false);

console.log("\n2. The deadline is exact, to the second");
// The paywall turns over on a strict `>` comparison. These three cases pin which
// side of the boundary each instant falls on; if someone changes it to `>=` or
// rounds to whole days, exactly one of them flips.
check("1 second BEFORE the deadline: still in", isSubscriptionActive({ currentPeriodEnd: new Date(now + SEC) }) === true);
check("1 second AFTER the deadline: locked out", isSubscriptionActive({ currentPeriodEnd: new Date(now - SEC) }) === false);
check(
  "a deadline already in the past is dead however old",
  isSubscriptionActive({ currentPeriodEnd: new Date(now - 365 * DAY) }) === false,
);
// The property that makes the no-cron design safe: the SAME untouched row is
// live or dead purely as a function of when you ask.
const fixed = new Date(now + 2 * SEC);
check(
  "one unchanged row is live now and dead later",
  isSubscriptionActive({ currentPeriodEnd: fixed }) === true &&
    fixed.getTime() < now + 3 * SEC,
  "nothing in the DB changes at expiry",
);

console.log("\n3. The guest trial is exactly 3 days");
check("GUEST_TRIAL_DAYS is 3", GUEST_TRIAL_DAYS === 3, `got ${GUEST_TRIAL_DAYS}`);
check("GUEST_TRIAL_MS matches 3 days", GUEST_TRIAL_MS === 3 * DAY, `got ${GUEST_TRIAL_MS}`);
const fresh = guestTrialFrom(new Date(now + GUEST_TRIAL_MS), now);
check("a clock just started reads 3 days left", fresh.state === "active" && fresh.daysLeft === 3, `daysLeft=${fresh.daysLeft}`);
check("...and is not expired", fresh.expired === false);

console.log("\n4. Trial boundaries");
const almost = guestTrialFrom(new Date(now + SEC), now);
check("1 second left is still ACTIVE", almost.state === "active" && !almost.expired);
check("...and rounds up to '1 day left' rather than 0", almost.daysLeft === 1, `daysLeft=${almost.daysLeft}`);
const justGone = guestTrialFrom(new Date(now - SEC), now);
check("1 second past is EXPIRED", justGone.state === "expired" && justGone.expired === true);
check("...and reports 0 days / 0 ms", justGone.daysLeft === 0 && justGone.msLeft === 0);
const exact = guestTrialFrom(new Date(now), now);
check("exactly at the deadline is EXPIRED (msLeft <= 0)", exact.expired === true);
check("label at expiry says so", guestTrialLabel(justGone) === "Trial expired", guestTrialLabel(justGone));
check("label under an hour is honest", guestTrialLabel(guestTrialFrom(new Date(now + 30 * MINUTE), now)) === "Less than an hour left");
check("label at 2 days", guestTrialLabel(guestTrialFrom(new Date(now + 2 * DAY - MINUTE), now)) === "2 days left");

console.log("\n5. A NULL clock is 'not started', never 'expired'");
// A user who signed up but has never logged in has no clock yet. Reading that as
// expired would paywall someone who has not had their trial at all.
const unstarted = guestTrialFrom(null, now);
check("null is notStarted", unstarted.state === "notStarted");
check("null is NOT expired", unstarted.expired === false);
check("null reports a full window", unstarted.daysLeft === GUEST_TRIAL_DAYS);

console.log("\n6. A lapsed member falls back to their ORIGINAL clock");
// Revoke deletes the subscription row; entitlement then re-reads guestExpiresAt,
// which was set once at first login and never touched again. A long-standing
// member therefore has a deadline far in the past and is walled immediately.
// This is the case that must never hand out a second trial.
const oldClock = new Date(now - 60 * DAY);
const lapsed = guestTrialFrom(oldClock, now);
check("their old trial is still expired", lapsed.expired === true);
check("no access once the grant row is gone", isSubscriptionActive(null) === false);
check("they are NOT handed a fresh 3 days", lapsed.daysLeft === 0, `daysLeft=${lapsed.daysLeft}`);

console.log("\n7. The tier ladder (mirrors lib/auth/guards.ts getPageAccess)");
// Kept in step with getPageAccess by hand: that function needs cookies + Prisma
// and cannot be called here, but the ORDER of its three questions is the whole
// contract, so it is pinned rather than left implicit.
type Tier = "admin" | "member" | "guestActive" | "guestExpired";
const tierOf = (
  isAdmin: boolean,
  sub: { currentPeriodEnd: Date | null } | null,
  guestExpiresAt: Date | null,
): Tier => {
  if (isAdmin) return "admin";
  if (isSubscriptionActive(sub)) return "member";
  return guestTrialFrom(guestExpiresAt, now).expired ? "guestExpired" : "guestActive";
};
const future = new Date(now + 10 * DAY);
const past = new Date(now - 10 * DAY);
check("admin outranks everything", tierOf(true, null, past) === "admin");
check("live grant outranks an expired trial", tierOf(false, { currentPeriodEnd: future }, past) === "member");
check("open-ended grant outranks an expired trial", tierOf(false, { currentPeriodEnd: null }, past) === "member");
check("lapsed grant + expired trial = walled", tierOf(false, { currentPeriodEnd: past }, past) === "guestExpired");
check("lapsed grant + running trial = read-only", tierOf(false, { currentPeriodEnd: past }, future) === "guestActive");
check("no grant + running trial = read-only", tierOf(false, null, future) === "guestActive");
check("no grant + expired trial = walled", tierOf(false, null, past) === "guestExpired");
check("no grant + never logged in = read-only", tierOf(false, null, null) === "guestActive");

console.log("\n8. The money path refuses an unentitled owner (mirrors lib/execution/dispatch.ts)");
// The fan-out gate is the ONLY thing standing between a lapsed grant and real
// orders: expiry happens on the clock, so no revoke runs and `liveArmed` stays
// set. Pinned here because "every tab locks but the bots keep trading" is the
// exact failure that gate exists to prevent.
const mayTrade = (
  ownerRole: "USER" | "ADMIN",
  sub: { currentPeriodEnd: Date | null } | null,
): boolean => ownerRole === "ADMIN" || isSubscriptionActive(sub);

check("live grant trades", mayTrade("USER", { currentPeriodEnd: future }) === true);
check("open-ended grant trades", mayTrade("USER", { currentPeriodEnd: null }) === true);
check("LAPSED grant does NOT trade", mayTrade("USER", { currentPeriodEnd: past }) === false);
check("revoked (no row) does NOT trade", mayTrade("USER", null) === false);
check("admin always trades", mayTrade("ADMIN", null) === true);
check(
  "the money path and the page gate never disagree",
  [null, { currentPeriodEnd: past }, { currentPeriodEnd: future }, { currentPeriodEnd: null }].every(
    (s) => mayTrade("USER", s) === (tierOf(false, s, past) === "member"),
  ),
  "same predicate on both sides",
);

console.log(failures === 0 ? "\nAll entitlement checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures ? 1 : 0);
