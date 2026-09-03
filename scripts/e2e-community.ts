// End-to-end check of the Community Access Link flow against a RUNNING server:
// the invite URL, the click counter, the sign-up grant, the pause switch, and
// the fact that a root-level catch-all route did not eat the rest of the site.
//
// It seeds one link, drives it over HTTP exactly as a real invitee would, then
// deletes the link and the account it created in a `finally` — so it is safe to
// point at a live environment and leaves nothing behind either way.
//
//   npm run dev
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/e2e-community.ts
//
// `E2E_BASE` overrides the target (Next picks another port when 3000 is taken).
// The admin sections need `ADMIN_EMAIL` set, and plant a one-time admin sign-in
// code for that address — which invalidates any code that address has in flight,
// since only the newest one per admin is valid.
// The react-server condition is required because lib/community is `server-only`,
// the same way scripts/verify-client.ts needs it.
import { config } from "dotenv";

// `.env.local` first, the way Next loads it. A bare `dotenv/config` reads only
// `.env`, which this project does not have — see scripts/run-reconcile.ts.
config({ path: [".env.local", ".env"], quiet: true });

const BASE = process.env.E2E_BASE ?? process.env.APP_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

// One fixed identity for every request, so the per-visitor-per-day click dedupe
// is genuinely exercised rather than accidentally satisfied by varying headers.
const VISITOR = { "user-agent": "ats-e2e-probe/1.0", "x-forwarded-for": "203.0.113.7" };

/**
 * Sign in as the configured admin by planting a known one-time code and
 * redeeming it — the same trick scripts/e2e-admin.ts uses, but scoped to this
 * one address rather than clearing every pending code in the table.
 */
async function adminCookie(
  prisma: { adminLoginCode: { deleteMany: (a: unknown) => Promise<unknown>; create: (a: unknown) => Promise<unknown> } },
  hashPassword: (p: string) => Promise<string>,
): Promise<string> {
  const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase();
  if (!email) return "";
  await prisma.adminLoginCode.deleteMany({ where: { email } });
  await prisma.adminLoginCode.create({
    data: { email, codeHash: await hashPassword("4321"), expiresAt: new Date(Date.now() + 600_000) },
  });
  const res = await fetch(`${BASE}/api/admin/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: "4321" }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function main() {
  // lib/db reads DATABASE_URL at module scope, so it has to load AFTER config()
  // above — a static import would be hoisted ahead of it and connect with nothing.
  const { prisma } = await import("../lib/db.ts");
  const { isSubscriptionActive } = await import("../lib/billing.ts");

  const stamp = Date.now().toString(36);
  const slug = `zz-e2e-${stamp}`;
  const name = "E2E Test Community";
  const email = `zz-e2e-${stamp}@example.com`;

  const get = (path: string) => fetch(`${BASE}${path}`, { headers: VISITOR, redirect: "manual" });

  const link = await prisma.communityLink.create({ data: { name, slug } });

  try {
    console.log(`\n1. The invite URL forwards to sign-up  (${BASE}/${slug})`);
    const first = await get(`/${slug}`);
    check("responds with a redirect", first.status === 307 || first.status === 308, `HTTP ${first.status}`);
    check(
      "...to the sign-up form, carrying the ref",
      (first.headers.get("location") ?? "").endsWith(`/signup?ref=${slug}`),
      first.headers.get("location") ?? "(no location header)",
    );

    console.log("\n2. A shared link resolves in whatever case it was pasted");
    const upper = await get(`/${slug.toUpperCase()}`);
    check(
      "an upper-cased URL reaches the same community",
      (upper.headers.get("location") ?? "").endsWith(`/signup?ref=${slug}`),
      upper.headers.get("location") ?? `HTTP ${upper.status}`,
    );

    console.log("\n3. Clicks count once per visitor per day");
    await get(`/${slug}`);
    await get(`/${slug}`);
    const clicks = await prisma.communityLinkClick.count({ where: { linkId: link.id } });
    check("four visits from one visitor count as one", clicks === 1, `${clicks} row(s)`);

    console.log("\n4. The sign-up form names the community");
    const form = await fetch(`${BASE}/signup?ref=${slug}`, { headers: VISITOR });
    const formHtml = await form.text();
    check("the form loads", form.status === 200, `HTTP ${form.status}`);
    check("...and confirms which invite is being used", formHtml.includes(name));

    console.log("\n5. Registering through the link grants access immediately");
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: "POST",
      headers: { ...VISITOR, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123", confirmPassword: "password123", ref: slug }),
    });
    const body = (await signup.json().catch(() => null)) as { community?: string | null } | null;
    check("the account is created", signup.status === 201, `HTTP ${signup.status}`);
    check("...and the response names the community", body?.community === name, String(body?.community));

    const member = await prisma.user.findUnique({
      where: { email },
      select: { id: true, communityLinkId: true, communityJoinedAt: true, subscription: true },
    });
    check("the account is attributed to the link", member?.communityLinkId === link.id);
    check("...with a join timestamp for the calendar", member?.communityJoinedAt != null);
    check("...and holds a live access grant", isSubscriptionActive(member?.subscription ?? null));
    check("...open-ended, so it never lapses", member?.subscription?.currentPeriodEnd === null);

    console.log("\n6. A deactivated link stops granting access");
    await prisma.communityLink.update({ where: { id: link.id }, data: { active: false } });

    const paused = await get(`/${slug}`);
    const pausedHtml = await paused.text();
    check("the landing page stops redirecting", paused.status === 200, `HTTP ${paused.status}`);
    check("...and says invitations are paused", pausedHtml.includes("Invitations are paused"));

    // The important half: a form already open in somebody's tab still posts the
    // old ref, and must NOT be honoured once the link is off.
    const staleEmail = `zz-e2e-stale-${stamp}@example.com`;
    const stale = await fetch(`${BASE}/api/auth/signup`, {
      method: "POST",
      headers: { ...VISITOR, "content-type": "application/json" },
      body: JSON.stringify({ email: staleEmail, password: "password123", confirmPassword: "password123", ref: slug }),
    });
    const staleUser = await prisma.user.findUnique({
      where: { email: staleEmail },
      select: { id: true, communityLinkId: true, subscription: true },
    });
    check("a stale ref still creates the account", stale.status === 201, `HTTP ${stale.status}`);
    check("...but grants NO access", !isSubscriptionActive(staleUser?.subscription ?? null));
    check("...and is not attributed to the paused link", staleUser?.communityLinkId === null);
    if (staleUser) await prisma.user.delete({ where: { id: staleUser.id } });

    console.log("\n7. The catch-all did not eat the rest of the site");
    check("an unknown slug 404s", (await get("/definitely-not-a-community-xyz")).status === 404);
    const dashboard = await get("/dashboard");
    check(
      "/dashboard still reaches the real page",
      dashboard.status === 200 || dashboard.status === 307,
      `HTTP ${dashboard.status}`,
    );
    check("/login still reaches the real page", (await get("/login")).status === 200);
    check("/bot-library still reaches the real page", (await get("/bot-library")).status === 200);
    // Next's router rejects an undecodable path before the page runs. The
    // property worth pinning is only that it is never a server error.
    const malformed = await get("/%");
    check("a malformed URL is rejected, not a 5xx", malformed.status < 500, `HTTP ${malformed.status}`);

    console.log("\n8. The admin API refuses anyone who is not an admin");
    const anon = await fetch(`${BASE}/api/admin/community`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Should Not Exist" }),
    });
    check("creating a link without a session is refused", anon.status === 403, `HTTP ${anon.status}`);

    const { hashPassword } = await import("../lib/auth/password.ts");
    const cookie = await adminCookie(prisma, hashPassword);
    if (!cookie) {
      console.log("  · ADMIN_EMAIL is not set, so the admin screens were not exercised");
      return;
    }

    console.log("\n9. The admin screens create, show and retire a link");
    const created = await fetch(`${BASE}/api/admin/community`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: `Admin Probe ${stamp}` }),
    });
    const createdBody = (await created.json().catch(() => null)) as
      | { link?: { id: string; slug: string; active: boolean } }
      | null;
    const probeId = createdBody?.link?.id;
    check("a link is created from the admin API", created.status === 201, `HTTP ${created.status}`);
    check("...with a slug derived from the name", createdBody?.link?.slug === `admin-probe-${stamp}`, String(createdBody?.link?.slug));
    check("...and is active by default", createdBody?.link?.active === true);

    // The guard that matters most: a slug that would shadow a real page.
    const reserved = await fetch(`${BASE}/api/admin/community`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Dashboard" }),
    });
    check("a slug that collides with a real route is refused", reserved.status === 422, `HTTP ${reserved.status}`);

    const duplicate = await fetch(`${BASE}/api/admin/community`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: `Admin Probe ${stamp}` }),
    });
    check("a duplicate slug is refused", duplicate.status === 409, `HTTP ${duplicate.status}`);

    const listPage = await fetch(`${BASE}/admin/community`, { headers: { cookie } });
    const listHtml = await listPage.text();
    check("the list screen renders", listPage.status === 200, `HTTP ${listPage.status}`);
    check("...and shows the new community", listHtml.includes(`Admin Probe ${stamp}`));
    check("...with the Trade volume column", listHtml.includes("Trade volume"));

    if (probeId) {
      const detailPage = await fetch(`${BASE}/admin/community/${probeId}`, { headers: { cookie } });
      const detailHtml = await detailPage.text();
      check("the detail screen renders", detailPage.status === 200, `HTTP ${detailPage.status}`);
      check("...showing the shareable URL", detailHtml.includes(`admin-probe-${stamp}`));
      check("...the activation control", detailHtml.includes("Deactivate"));
      check("...the activity breakdown", detailHtml.includes("Activity breakdown"));
      check("...and the member roster", detailHtml.includes("Members ("));

      const paused2 = await fetch(`${BASE}/api/admin/community/${probeId}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      check("it can be deactivated", paused2.status === 200, `HTTP ${paused2.status}`);
      const stored = await prisma.communityLink.findUnique({ where: { id: probeId }, select: { active: true } });
      check("...and the pause is persisted", stored?.active === false);

      const removed = await fetch(`${BASE}/api/admin/community/${probeId}`, {
        method: "DELETE",
        headers: { cookie },
      });
      check("it can be deleted", removed.status === 200, `HTTP ${removed.status}`);
      check("...and is gone", (await prisma.communityLink.count({ where: { id: probeId } })) === 0);
    }
  } finally {
    // Clicks cascade with the link. The member is deleted explicitly, because
    // deleting a link deliberately does NOT delete the people who joined by it.
    await prisma.user.deleteMany({ where: { email } });
    await prisma.communityLink.deleteMany({ where: { id: link.id } });
    await prisma.communityLink.deleteMany({ where: { slug: `admin-probe-${stamp}` } });
    const leftLinks = await prisma.communityLink.count({ where: { slug } });
    const leftUsers = await prisma.user.count({ where: { email: { startsWith: `zz-e2e-${stamp}` } } });
    check("cleanup: no test link remains", leftLinks === 0);
    check("cleanup: no test account remains", leftUsers === 0);
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll community e2e checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures ? 1 : 0);
  })
  .catch((error) => {
    console.error("\nFAILED:", (error as Error)?.message ?? error);
    process.exit(1);
  });
