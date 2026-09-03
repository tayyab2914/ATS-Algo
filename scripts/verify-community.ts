// Guards the Community Access Link rules that are pure logic:
//
//   1. A slug NEVER collides with a real route. This one matters most — the link
//      lives at the root of the domain, so a bad slug produces a URL that opens
//      the members' dashboard instead of a sign-up form, and the admin only finds
//      out when the community reports that nobody can join.
//   2. Normalisation is idempotent and agrees with what the create form previews.
//   3. The calendar buckets clicks, sign-ups and volume onto the UTC+2 day, and a
//      week's total counts only the days inside the month being shown — so the
//      twelve monthly totals add up to the year exactly.
//   4. Conversion is null over zero clicks rather than NaN or 0%.
//
// Pure logic: no database, no network. Run: npx tsx scripts/verify-community.ts
import {
  buildCommunityMonth,
  buildCommunityYear,
  conversionPct,
  type CommunityDay,
} from "../lib/community/calendar.ts";
import {
  communityLinkUrl,
  normalizeSlug,
  RESERVED_SLUGS,
  slugProblem,
  SLUG_MAX,
  SLUG_MIN,
} from "../lib/community/slug.ts";
import { calendarBounds, canStepMonth, stepMonth } from "../lib/portfolio/calendar.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log("\n1. A slug can never shadow a real route");
// Every one of these is a page this app actually serves. Next resolves static
// routes before `app/[community]`, so a community holding one of these names
// would have a link that silently opens somebody else's screen.
for (const route of ["dashboard", "login", "signup", "admin", "api", "account", "my-bots", "bot-library", "portfolio", "policy"]) {
  check(`/${route} is refused`, slugProblem(route) !== null, slugProblem(route) ?? "ACCEPTED");
}
check("the retired /billing route is still held back", slugProblem("billing") !== null);
check("Next's /_next internals are refused", slugProblem("_next") !== null);
check("every RESERVED_SLUGS entry is actually refused", [...RESERVED_SLUGS].every((s) => slugProblem(s) !== null));
check("a real community name is accepted", slugProblem("houseofcrypto") === null, slugProblem("houseofcrypto") ?? "");
check("...and a hyphenated one too", slugProblem("house-of-crypto") === null);

console.log("\n2. Slug shape");
check(`shorter than ${SLUG_MIN} is refused`, slugProblem("ab") !== null);
check(`longer than ${SLUG_MAX} is refused`, slugProblem("a".repeat(SLUG_MAX + 1)) !== null);
check("uppercase is refused (normalise first)", slugProblem("HouseOfCrypto") !== null);
check("a leading hyphen is refused", slugProblem("-house") !== null);
check("a trailing hyphen is refused", slugProblem("house-") !== null);
check("a double hyphen is refused", slugProblem("house--crypto") !== null);
check("a leading underscore is refused", slugProblem("_house") !== null);
check("a dot is refused (would shadow a static file)", slugProblem("logo.svg") !== null);

console.log("\n3. Normalisation is what the admin is shown, and is stable");
check('"House of Crypto" → house-of-crypto', normalizeSlug("House of Crypto") === "house-of-crypto", normalizeSlug("House of Crypto"));
check("accents fold rather than vanish", normalizeSlug("Café Crypto") === "cafe-crypto", normalizeSlug("Café Crypto"));
check("punctuation collapses to one hyphen", normalizeSlug("A.P.E  ///  Club!!") === "a-p-e-club", normalizeSlug("A.P.E  ///  Club!!"));
check("surrounding junk is trimmed", normalizeSlug("  --House--  ") === "house", normalizeSlug("  --House--  "));
check("emoji-only input yields nothing to route", normalizeSlug("🚀🚀") === "");
// Idempotence is what lets the form preview and the server agree: the server
// normalises again on receipt, and must not get a different answer.
for (const input of ["House of Crypto", "café crypto", "a-p-e-club", "houseofcrypto"]) {
  const once = normalizeSlug(input);
  check(`normalise(normalise("${input}")) is stable`, normalizeSlug(once) === once, `${once} vs ${normalizeSlug(once)}`);
}

console.log("\n4. The URL an admin copies");
check(
  "built from the app's base URL",
  communityLinkUrl("https://ats-algo.com", "houseofcrypto") === "https://ats-algo.com/houseofcrypto",
);
check(
  "a trailing slash on the base doesn't double up",
  communityLinkUrl("https://ats-algo.com/", "houseofcrypto") === "https://ats-algo.com/houseofcrypto",
);

console.log("\n5. Calendar arithmetic");
const days: CommunityDay[] = [
  { date: "2026-03-02", clicks: 40, signups: 10, volume: 5_000 },
  { date: "2026-03-03", clicks: 25, signups: 5, volume: 2_500 },
  // Deliberately in the last week of the month, which the grid pads with April.
  { date: "2026-03-31", clicks: 10, signups: 2, volume: 1_000 },
  { date: "2026-04-01", clicks: 8, signups: 1, volume: 500 },
];
const now = new Date("2026-05-15T10:00:00Z");
const march = buildCommunityMonth(days, 2026, 2, now);

check("March totals count only March", march.totals.clicks === 75 && march.totals.signups === 17, `${march.totals.clicks}/${march.totals.signups}`);
check("...and its volume too", near(march.totals.volume, 8_500), String(march.totals.volume));
check("active days are counted, not calendar days", march.totals.activeDays === 3, String(march.totals.activeDays));
check("the busiest sign-up day is found", march.bestDay?.date === "2026-03-02");
check("the grid is whole weeks", march.weeks.every((w) => w.days.length === 7));
check("weeks are Monday-first", march.weeks[0].days[0].date === "2026-02-23", march.weeks[0].days[0].date);

// The padding-day rule: April 1st is RENDERED in March's last week but must not
// be COUNTED there, or the twelve months would over-add against the year.
const lastWeek = march.weeks[march.weeks.length - 1];
check("April 1st is rendered inside March's grid", lastWeek.days.some((d) => d.date === "2026-04-01"));
check("...but is marked out of month", lastWeek.days.find((d) => d.date === "2026-04-01")?.inMonth === false);
const weekSum = march.weeks.reduce((sum, w) => sum + w.totals.signups, 0);
check("week totals sum to the month exactly", weekSum === march.totals.signups, `${weekSum} vs ${march.totals.signups}`);

const year = buildCommunityYear(days, 2026, now);
const monthSum = year.months.reduce((sum, m) => sum + m.totals.signups, 0);
check("month totals sum to the year exactly", monthSum === year.totals.signups && year.totals.signups === 18, String(year.totals.signups));
check("the running total is cumulative, not per-month", year.months[3].cumulativeSignups === 18, String(year.months[3].cumulativeSignups));
check("May 2026 is not yet in the future", year.months[4].isFuture === false);
check("June 2026 IS in the future", year.months[5].isFuture === true);
check("the busiest month is found", year.bestMonth?.month === 2);

console.log("\n6. Navigation is bounded by the data");
const bounds = calendarBounds(days, now);
check("it starts at the first active day's month", bounds.first.year === 2026 && bounds.first.month === 2);
check("it ends at the current month", bounds.last.year === 2026 && bounds.last.month === 4);
check("you can't page before the first activity", canStepMonth({ year: 2026, month: 2 }, -1, bounds) === false);
check("you can't page into the future", canStepMonth({ year: 2026, month: 4 }, 1, bounds) === false);
const stepped = stepMonth({ year: 2026, month: 2 }, 1, bounds);
check("forward from March lands on April", stepped.year === 2026 && stepped.month === 3);

console.log("\n7. Conversion is honest about having no data");
check("no clicks yields null, not 0% or NaN", conversionPct({ clicks: 0, signups: 0, volume: 0, activeDays: 0 }) === null);
check("10 of 40 is 25%", near(conversionPct({ clicks: 40, signups: 10, volume: 0, activeDays: 1 })!, 25));
// Reported as-is rather than clamped: over 100% means the link is being forwarded
// past the landing page, which is real information.
check("above 100% is reported, not clamped", near(conversionPct({ clicks: 1, signups: 2, volume: 0, activeDays: 1 })!, 200));

console.log("\n8. An empty link renders rather than throwing");
const emptyMonth = buildCommunityMonth([], 2026, 2, now);
check("a link with no activity still builds a grid", emptyMonth.weeks.length > 0);
check("...with zero totals", emptyMonth.totals.signups === 0 && emptyMonth.totals.activeDays === 0);
check("...and no best day", emptyMonth.bestDay === null);
const emptyBounds = calendarBounds([], now);
check("bounds collapse to the current month", emptyBounds.first.month === 4 && emptyBounds.last.month === 4);

console.log(failures === 0 ? "\nAll community checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures ? 1 : 0);
