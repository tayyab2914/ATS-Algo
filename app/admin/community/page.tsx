import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { CommunityLinkCreate } from "@/components/admin/CommunityLinkCreate";
import { CommunityLinksTable, type CommunityLinkRow } from "@/components/admin/CommunityLinksTable";
import { appBaseUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth/session";
import { loadCommunitySummaries } from "@/lib/community/stats";

/**
 * Community Access Links — the admin surface for onboarding whole groups.
 *
 * ATS is sold to communities, so this is where access is actually handed out:
 * one link per group, and everyone who registers through it is a member from
 * their first login. Members Management remains the per-person surface for the
 * individuals who arrive on their own.
 */
export default async function AdminCommunityPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const summaries = await loadCommunitySummaries();

  const links: CommunityLinkRow[] = summaries.map((link) => ({
    id: link.id,
    name: link.name,
    slug: link.slug,
    active: link.active,
    clicks: link.clicks,
    signups: link.signups,
    tradeVolume: link.tradeVolume,
  }));

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="community" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Community Access Links</h1>
          <p className="text-sm leading-[21px] text-muted">
            Give a community its own invite URL, track what it brings in, and pause it when you need to.
          </p>
        </header>

        <CommunityLinkCreate baseUrl={appBaseUrl()} />
        <CommunityLinksTable links={links} baseUrl={appBaseUrl()} />
      </main>
    </div>
  );
}
