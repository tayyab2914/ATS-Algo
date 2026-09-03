// Exercises the Community Access Link feature against the REAL database, to
// prove the migration landed and the constraints behave as the models claim.
//
// Nothing is left behind. The write path runs inside an interactive transaction
// that is deliberately rolled back at the end, so this is safe to run against a
// live database: it creates a link, a click and a member, checks what the schema
// does to them, and then throws so Postgres undoes all of it.
//
// What it pins:
//   1. The new tables and columns exist, and the retired trial column is gone.
//   2. A click is one VISITOR-DAY — the same visitor on the same day cannot
//      produce a second row, which is what makes "Clicks" a number worth trusting.
//   3. A community sign-up gets an OPEN-ENDED grant, so they are a member.
//   4. Deleting a link never deletes its members and never revokes their access —
//      it only clears the attribution (onDelete: SetNull) and drops the clicks.
//   5. The two loaders the admin screens call actually run against real data.
//
// `lib/community/stats.ts` is `server-only`, so the react-server condition must
// be set, exactly as scripts/verify-client.ts requires:
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-community-db.ts
import { config } from "dotenv";
// Pure modules — safe to import statically, they read no environment.
import { isSubscriptionActive } from "../lib/billing.ts";
import { dayKey } from "../lib/portfolio/calendar.ts";

// `.env.local` first, the way Next and prisma.config.ts load it. A plain
// `dotenv/config` would read only `.env`, which this project does not have.
config({ path: [".env.local", ".env"], quiet: true });

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Thrown to roll the transaction back once every assertion has run. */
const ROLLBACK = "__rollback__";

async function main() {
  // IMPORTED HERE, NOT AT THE TOP, and that is not a style choice.
  //
  // ES module imports are HOISTED: every static import is evaluated before the
  // file's first statement runs. `lib/db.ts` reads `process.env.DATABASE_URL` at
  // module scope, so a static import would build the Prisma client against an
  // UNSET connection string no matter where the `config()` call sits above — and
  // the resulting failure is a baffling "SASL: client password must be a string"
  // rather than anything mentioning the environment. (The scripts that get away
  // with `import "dotenv/config"` do so because that is itself an import, hoisted
  // alongside — and ahead of — lib/db.)
  const { prisma } = await import("../lib/db.ts");
  const { loadCommunityDetail, loadCommunitySummaries } = await import("../lib/community/stats.ts");

  try {
    console.log("\n1. The migration landed");
    const [links, clickRows, users, attributed] = await Promise.all([
      prisma.communityLink.count(),
      prisma.communityLinkClick.count(),
      prisma.user.count(),
      prisma.user.count({ where: { communityLinkId: { not: null } } }),
    ]);
    check("community_links is queryable", Number.isInteger(links), `${links} row(s)`);
    check("community_link_clicks is queryable", Number.isInteger(clickRows), `${clickRows} row(s)`);
    check("users.communityLinkId is queryable", Number.isInteger(attributed), `${attributed} of ${users} attributed`);

    // The retired trial column must be gone, or something could still write to it.
    const trialColumn = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'guestExpiresAt'`,
    );
    check("users.guestExpiresAt was dropped", Number(trialColumn[0].count) === 0);

    console.log("\n2. Write path (rolled back — nothing persists)");
    const stamp = Date.now().toString(36);
    const slug = `zz-verify-${stamp}`;
    const email = `zz-verify-${stamp}@example.invalid`;
    const day = dayKey(new Date());

    try {
      await prisma.$transaction(async (tx) => {
        const link = await tx.communityLink.create({ data: { name: "Verify Community", slug } });
        check("a link can be created", link.slug === slug);
        check("...and is active by default", link.active === true);

        // The dedupe contract: same visitor, same day, twice.
        const click = (visitorHash: string) =>
          tx.communityLinkClick.createMany({
            data: [{ linkId: link.id, day, visitorHash }],
            skipDuplicates: true,
          });

        await click("hash-a");
        await click("hash-a");
        const afterRepeat = await tx.communityLinkClick.count({ where: { linkId: link.id } });
        check("the same visitor twice in a day counts ONCE", afterRepeat === 1, `${afterRepeat} row(s)`);

        await click("hash-b");
        const afterSecond = await tx.communityLinkClick.count({ where: { linkId: link.id } });
        check("a different visitor counts separately", afterSecond === 2, `${afterSecond} row(s)`);

        // Mirrors app/api/auth/signup/route.ts for a registration carrying a ref.
        const member = await tx.user.create({
          data: {
            email,
            passwordHash: "not-a-real-hash",
            communityLinkId: link.id,
            communityJoinedAt: new Date(),
          },
        });
        await tx.subscription.create({ data: { userId: member.id, currentPeriodEnd: null } });
        check("a community sign-up is attributed to the link", member.communityLinkId === link.id);

        const grant = await tx.subscription.findUnique({ where: { userId: member.id } });
        check("...and is granted access immediately", isSubscriptionActive(grant));
        check("...open-ended, so it never lapses", grant?.currentPeriodEnd === null);

        // Deleting the link must cost the attribution and NOTHING else.
        await tx.communityLink.delete({ where: { id: link.id } });

        const survivor = await tx.user.findUnique({ where: { id: member.id } });
        check("deleting the link does NOT delete the member", survivor !== null);
        check("...it only clears the attribution", survivor?.communityLinkId === null);

        const grantAfter = await tx.subscription.findUnique({ where: { userId: member.id } });
        check("...and does NOT revoke their access", isSubscriptionActive(grantAfter));

        const clicksAfter = await tx.communityLinkClick.count({ where: { linkId: link.id } });
        check("...while its clicks cascade away", clicksAfter === 0);

        throw new Error(ROLLBACK);
      });
    } catch (error) {
      if ((error as Error).message !== ROLLBACK) throw error;
    }

    // Prove the rollback happened — a verification script that quietly leaves
    // test rows in a live database is worse than no verification at all.
    check("rolled back: no test link remains", (await prisma.communityLink.findUnique({ where: { slug } })) === null);
    check("rolled back: no test user remains", (await prisma.user.findUnique({ where: { email } })) === null);

    console.log("\n3. The admin loaders run against real data");
    const summaries = await loadCommunitySummaries();
    check("loadCommunitySummaries() runs", Array.isArray(summaries), `${summaries.length} link(s)`);
    check(
      "...and every row carries its three numbers",
      summaries.every(
        (s) => Number.isFinite(s.clicks) && Number.isFinite(s.signups) && Number.isFinite(s.tradeVolume),
      ),
    );

    if (summaries[0]) {
      const detail = await loadCommunityDetail(summaries[0].id);
      check("loadCommunityDetail() runs", detail !== null);
      check(
        "...days come back sorted ascending",
        (detail?.days ?? []).every((d, i, all) => i === 0 || all[i - 1].date <= d.date),
      );
    } else {
      console.log("  · no links exist yet, so there is no detail page to load (expected before the first one)");
    }
    check("loadCommunityDetail() returns null for an unknown id", (await loadCommunityDetail("does-not-exist")) === null);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll live community checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures ? 1 : 0);
  })
  .catch((error) => {
    console.error("\nFAILED:", (error as Error)?.message ?? error);
    process.exit(1);
  });
