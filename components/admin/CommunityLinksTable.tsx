"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { CopyButton } from "@/components/admin/CopyField";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";
import { compactMoney } from "@/lib/community/format";
import { communityLinkUrl } from "@/lib/community/slug";

/** One community, as the list renders it. Numbers are pre-computed server-side. */
export type CommunityLinkRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  clicks: number;
  signups: number;
  tradeVolume: number;
};

/**
 * The community list — the same shape as the bots list, on purpose.
 *
 * Name, Active, Clicks, Sign ups, Trade volume. The name is the link into the
 * full breakdown, because "click the community's name" is how this was asked for
 * and it saves a column of chevrons.
 *
 * The Active switch posts straight from the row: pausing a community mid-campaign
 * is the one action urgent enough that walking into a detail page for it would be
 * the wrong trade.
 */
export function CommunityLinksTable({
  links,
  baseUrl,
}: {
  links: CommunityLinkRow[];
  /** Public origin the links are built from, e.g. `https://ats-algo.com`. */
  baseUrl: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? links.filter((l) => l.name.toLowerCase().includes(q) || l.slug.includes(q)) : links),
    [links, q],
  );

  async function toggle(row: CommunityLinkRow) {
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/community/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Could not update the link." });
        return;
      }
      setNotice({
        type: "success",
        message: row.active
          ? `${row.name} is paused — the link no longer accepts new registrations.`
          : `${row.name} is live again.`,
      });
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminCard
      title="Community links"
      subtitle="Every community, what its link has brought in, and whether it is still open."
    >
      {notice && <Notice notice={notice} />}

      {links.length > 4 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search communities"
          className="h-9 w-full rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none sm:w-64"
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Link</th>
              <th className="px-4 py-3 text-center font-semibold">Active</th>
              <th className="px-4 py-3 text-center font-semibold">Clicks</th>
              <th className="px-4 py-3 text-center font-semibold">Sign ups</th>
              <th className="px-4 py-3 text-center font-semibold">Trade volume</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                  {links.length === 0
                    ? "No community links yet — create one above to start onboarding a group."
                    : "No communities match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const url = communityLinkUrl(baseUrl, row.slug);
                return (
                  <tr key={row.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-4">
                      <Link
                        href={`/admin/community/${row.id}`}
                        className="text-sm font-semibold text-white underline-offset-4 transition-colors hover:text-accent hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <span className="font-mono text-xs text-muted">/{row.slug}</span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                          row.active ? "bg-success/10 text-success" : "bg-[#F4A825]/10 text-[#F4A825]",
                        )}
                      >
                        {row.active ? "Yes" : "Paused"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center text-sm text-white">
                      {row.clicks.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-4 text-center text-sm font-semibold text-white">
                      {row.signups.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-4 text-center text-sm text-white">
                      {compactMoney(row.tradeVolume)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <CopyButton value={url} label="Copy link" />
                        <button
                          type="button"
                          onClick={() => toggle(row)}
                          disabled={busyId === row.id}
                          className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-accent/40 hover:text-white disabled:opacity-50"
                        >
                          {busyId === row.id ? "…" : row.active ? "Pause" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
