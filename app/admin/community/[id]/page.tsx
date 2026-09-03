import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { CommunityLinkHeader } from "@/components/admin/CommunityLinkHeader";
import { CommunityMembers } from "@/components/admin/CommunityMembers";
import { CommunityStats } from "@/components/admin/CommunityStats";
import { compactMoney } from "@/lib/community/format";
import { appBaseUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth/session";
import { conversionPct, type CommunityTotals } from "@/lib/community/calendar";
import { loadCommunityDetail } from "@/lib/community/stats";

/**
 * One community's full breakdown.
 *
 * Top to bottom: the link and its on/off switch, the headline numbers, the
 * calendar + columns + growth chart, then the roster. That order is the order the
 * questions get asked — "what's the URL", "is it working", "how is it trending",
 * "who came in".
 *
 * All the reading and paging happens client-side from one payload; see
 * {@link CommunityStats}.
 */
export default async function AdminCommunityDetailPage({ params }: PageProps<"/admin/community/[id]">) {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const { id } = await params;
  const detail = await loadCommunityDetail(id);
  if (!detail) notFound();

  const totals: CommunityTotals = detail.days.reduce(
    (sum, day) => ({
      clicks: sum.clicks + day.clicks,
      signups: sum.signups + day.signups,
      volume: sum.volume + day.volume,
      activeDays: sum.activeDays + 1,
    }),
    { clicks: 0, signups: 0, volume: 0, activeDays: 0 },
  );

  const conversion = conversionPct(totals);
  // The roster is the authority on how many people joined: `days` buckets by the
  // attribution timestamp, and a member whose row predates that column would be
  // counted in one and not the other.
  const memberCount = detail.members.length;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="community" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <Link
            href="/admin/community"
            className="w-fit text-xs font-semibold text-muted transition-colors hover:text-accent"
          >
            ← Community Access Links
          </Link>
        </div>

        <CommunityLinkHeader
          id={detail.id}
          name={detail.name}
          slug={detail.slug}
          active={detail.active}
          baseUrl={appBaseUrl()}
          signups={memberCount}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Clicks" value={totals.clicks.toLocaleString("en-US")} hint="Unique visitors per day" />
          <Stat label="Sign ups" value={memberCount.toLocaleString("en-US")} hint="Accounts from this link" />
          <Stat
            label="Conversion"
            value={conversion === null ? "—" : `${conversion.toFixed(conversion >= 10 ? 0 : 1)}%`}
            hint="Visitors who registered"
          />
          <Stat
            label="Trade volume"
            value={compactMoney(totals.volume)}
            hint="Notional opened, live trades only"
          />
        </div>

        <CommunityStats days={detail.days} nowIso={new Date().toISOString()} />

        <CommunityMembers members={detail.members} />
      </main>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="text-2xl font-semibold leading-8 text-white">{value}</span>
      <span className="text-[11px] leading-4 text-muted">{hint}</span>
    </div>
  );
}
