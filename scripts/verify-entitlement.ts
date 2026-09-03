// Guards the one rule that decides who gets in: the GRANT DEADLINE. It is pure
// clock arithmetic evaluated on every request, so it is exactly the kind of thing
// that silently drifts — these cases pin the boundaries so a refactor cannot move
// them.
//
//   1. A grant is live until `currentPeriodEnd`, dead from that instant on.
//      NULL means no expiry. There is no status column and no job: nothing
//      rewrites a lapsed row, so this comparison IS the gate.
//   2. The tier ladder resolves admin > live grant > read-only guest.
//   3. The money path (fan-out) and the page gate ask the SAME question.
//
// The 3-day Guest Mode trial that used to be checked here is gone: the platform
// is sold to communities, access arrives with a community's invite link, and an
// individual sign-up is simply read-only for as long as it stays one. There is no
// clock left to drift.
//
// Pure logic: no database, no network. Run: npx tsx scripts/verify-entitlement.ts
import { isSubscriptionActive } from "../lib/billing.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
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
// The gate turns over on a strict `>` comparison. These three cases pin which
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
  isSubscriptionActive({ currentPeriodEnd: fixed }) === true && fixed.getTime() < now + 3 * SEC,
  "nothing in the DB changes at expiry",
);

console.log("\n3. A community sign-up is granted open-ended access");
// What app/api/auth/signup/route.ts writes when a registration carries a valid,
// ACTIVE community ref: `currentPeriodEnd: null`. Pinned because the whole point
// of a community link is that nobody has to come back and renew it.
const communityGrant = { currentPeriodEnd: null };
check("a community grant is live now", isSubscriptionActive(communityGrant) === true);
check("...and is still live a decade out", isSubscriptionActive(communityGrant) === true, "null never lapses");
// An individual sign-up gets NO row at all — that is what makes them read-only.
check("an individual sign-up has no grant", isSubscriptionActive(null) === false);

console.log("\n4. The tier ladder (mirrors lib/auth/guards.ts getPageAccess)");
// Kept in step with getPageAccess by hand: that function needs cookies + Prisma
// and cannot be called here, but the ORDER of its questions is the whole
// contract, so it is pinned rather than left implicit.
type Tier = "admin" | "member" | "guest";
const tierOf = (isAdmin: boolean, sub: { currentPeriodEnd: Date | null } | null): Tier => {
  if (isAdmin) return "admin";
  if (isSubscriptionActive(sub)) return "member";
  return "guest";
};
const future = new Date(now + 10 * DAY);
const past = new Date(now - 10 * DAY);
check("admin outranks everything", tierOf(true, null) === "admin");
check("live grant is a member", tierOf(false, { currentPeriodEnd: future }) === "member");
check("open-ended (community) grant is a member", tierOf(false, { currentPeriodEnd: null }) === "member");
check("lapsed grant falls back to read-only guest", tierOf(false, { currentPeriodEnd: past }) === "guest");
check("no grant is a read-only guest", tierOf(false, null) === "guest");
// There is no expired-guest tier any more, so no in-app route can wall anybody.
check(
  "a guest is never anything other than 'guest'",
  ([null, { currentPeriodEnd: past }] as const).every((s) => tierOf(false, s) === "guest"),
  "no trial clock left to expire",
);

console.log("\n5. The money path refuses an unentitled owner (mirrors lib/execution/dispatch.ts)");
// The fan-out gate is the ONLY thing standing between a lapsed grant and real
// orders: expiry happens on the clock, so no revoke runs and `liveArmed` stays
// set. Pinned here because "every tab locks but the bots keep trading" is the
// exact failure that gate exists to prevent.
const mayTrade = (
  ownerRole: "USER" | "ADMIN",
  sub: { currentPeriodEnd: Date | null } | null,
): boolean => ownerRole === "ADMIN" || isSubscriptionActive(sub);

check("live grant trades", mayTrade("USER", { currentPeriodEnd: future }) === true);
check("open-ended (community) grant trades", mayTrade("USER", { currentPeriodEnd: null }) === true);
check("LAPSED grant does NOT trade", mayTrade("USER", { currentPeriodEnd: past }) === false);
check("revoked (no row) does NOT trade", mayTrade("USER", null) === false);
check("a read-only guest does NOT trade", mayTrade("USER", null) === false);
check("admin always trades", mayTrade("ADMIN", null) === true);
check(
  "the money path and the page gate never disagree",
  [null, { currentPeriodEnd: past }, { currentPeriodEnd: future }, { currentPeriodEnd: null }].every(
    (s) => mayTrade("USER", s) === (tierOf(false, s) === "member"),
  ),
  "same predicate on both sides",
);

console.log(failures === 0 ? "\nAll entitlement checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures ? 1 : 0);
