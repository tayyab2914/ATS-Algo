import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { getSession } from "@/lib/auth/session";
import { recordCommunityClick } from "@/lib/community/track";
import { prisma } from "@/lib/db";
import { normalizeSlug } from "@/lib/community/slug";

/**
 * A community's invite landing URL — `ats-algo.com/houseofcrypto`.
 *
 * ## Why this sits at the root of the app
 *
 * Because that is the link communities are given to share. It is a dynamic
 * segment, so it also becomes the catch-all for every unmatched single-segment
 * path on the domain: Next resolves static routes first, so `/dashboard` and
 * `/login` still reach their own pages, and anything left over lands here and
 * either resolves to a community or 404s. `lib/community/slug.ts` keeps a
 * community from ever claiming a real route name in the first place.
 *
 * ## What it does
 *
 * Counts the visit (once per visitor per day) and forwards straight to the
 * sign-up form carrying `?ref=<slug>`. There is no interstitial: the community
 * already sold the platform to their members, so a second "continue" button is
 * one more place to lose them. The referral is carried in the query string
 * rather than a cookie because the sign-up route re-validates the slug against
 * the database anyway — the URL is a hint, never the authority on who gets access.
 *
 * A signed-in visitor is sent to their dashboard instead. The invite grants
 * access AT REGISTRATION; it deliberately cannot upgrade an account that already
 * exists, so that an admin's decision to leave somebody read-only can't be undone
 * by that person finding any community's link. Those cases are handled from
 * Members Management ("Make member").
 */
export default async function CommunityLandingPage({ params }: PageProps<"/[community]">) {
  const { community } = await params;

  // Normalise before the lookup so `/HouseOfCrypto` and `/HOUSEOFCRYPTO` both
  // reach the row that a link shared with different casing was meant to point at.
  //
  // No decoding step: Next has already percent-decoded the dynamic segment by the
  // time it reaches `params`, and decoding again here would be a second pass over
  // text that is no longer encoded. A URL too malformed to decode never gets this
  // far either — the router rejects it with a 400 before this page runs.
  const slug = normalizeSlug(community);
  if (!slug) notFound();

  const link = await prisma.communityLink.findUnique({
    where: { slug },
    select: { id: true, name: true, active: true },
  });
  if (!link) notFound();

  // Counted before the fork, and for paused links too: traffic a community is
  // still sending is exactly what an operator needs to see before deciding
  // whether to switch the link back on.
  await recordCommunityClick(link.id, await headers());

  const session = await getSession();
  if (session) redirect("/dashboard");

  if (link.active) redirect(`/signup?ref=${encodeURIComponent(slug)}`);

  return <PausedNotice name={link.name} />;
}

/**
 * What a member of a paused community sees. It says the invite is closed without
 * implying the community did something wrong, and still leaves a route in for
 * somebody who already has an account.
 */
function PausedNotice({ name }: { name: string }) {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-white">
      <Logo />

      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-surface px-8 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-[#F4A825]/10 text-[#F4A825]">
          <PauseIcon />
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-white">Invitations are paused</h1>
          <p className="text-sm leading-[21px] text-muted">
            The invite link for <span className="font-semibold text-white">{name}</span> is not accepting new
            registrations right now. Check with your community for an update.
          </p>
        </div>

        <p className="text-xs text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}

function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="5" width="3.5" height="14" rx="1.4" fill="currentColor" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1.4" fill="currentColor" />
    </svg>
  );
}
