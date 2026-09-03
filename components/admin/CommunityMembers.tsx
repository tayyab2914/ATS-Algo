"use client";

import { useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { compactMoney } from "@/lib/community/format";
import { cn } from "@/lib/cn";
import type { CommunityMemberRow } from "@/lib/community/stats";

const STATUS_PILL: Record<CommunityMemberRow["status"], string> = {
  ACTIVE: "bg-success/10 text-success",
  SUSPENDED: "bg-[#F4A825]/10 text-[#F4A825]",
  BANNED: "bg-[#D2031E]/10 text-[#D2031E]",
};

const STATUS_LABEL: Record<CommunityMemberRow["status"], string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  BANNED: "Banned",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Everyone who joined through this link, newest first, with a search box.
 *
 * The Access column is not decoration: a community member is granted access at
 * registration, so anything other than "Member" here means an admin has since
 * revoked that person or the account was suspended. It is the one place those
 * exceptions are visible per community rather than buried in the platform-wide
 * members table.
 *
 * Search filters in the browser over a list the server already sent whole — a
 * community is hundreds of people, not millions, and a round trip per keystroke
 * would be slower than the filter.
 */
export function CommunityMembers({ members }: { members: CommunityMemberRow[] }) {
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q ? members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : members,
    [members, q],
  );

  return (
    <AdminCard
      title={`Members (${members.length})`}
      subtitle="Accounts registered through this community's link."
    >
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name or email"
        className="h-9 w-full rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none sm:w-64"
      />

      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 text-center font-semibold">Joined</th>
              <th className="px-4 py-3 text-center font-semibold">Access</th>
              <th className="px-4 py-3 text-center font-semibold">Bots</th>
              <th className="px-4 py-3 text-center font-semibold">Volume</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                  {members.length === 0
                    ? "Nobody has registered through this link yet."
                    : "No members match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((member) => (
                <tr key={member.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-4 text-sm font-semibold text-white">{member.name}</td>
                  <td className="px-4 py-4 text-sm text-muted">{member.email}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{formatDate(member.joinedAt)}</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                        member.entitled ? "bg-accent/10 text-accent" : "bg-muted/15 text-muted",
                      )}
                    >
                      {member.entitled ? "Member" : "Revoked"}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{member.deployments}</td>
                  <td className="px-4 py-4 text-center text-sm text-white">{compactMoney(member.volume)}</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                        STATUS_PILL[member.status],
                      )}
                    >
                      {STATUS_LABEL[member.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
