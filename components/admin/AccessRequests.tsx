"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BanIcon, GiftIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/** One member waiting on an admin decision. */
export type AccessRequestRow = {
  memberId: string;
  name: string;
  email: string;
  /** Relative age of the request, e.g. "2 hours ago". Formatted server-side. */
  requestedAgo: string;
  /** True when a (now lapsed) grant already exists — this is a renewal, not a first ask. */
  returning: boolean;
};

/**
 * How long a grant runs. Mirrors MembersTable's GRANT_OPTIONS so the two entry
 * points into the same action can never offer different terms; `0` means no
 * expiry.
 */
const GRANT_OPTIONS: { label: string; months: number }[] = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "12 months", months: 12 },
  { label: "Lifetime", months: 0 },
];

/**
 * The access-request queue, pinned above the members table.
 *
 * It sits on the same screen as Members Management on purpose: granting and
 * revoking already live in that table's row menu, so keeping the inbox here
 * means every access decision is made in one place. This card is the fast path
 * (act on who is waiting); the table stays the complete path (act on anyone).
 *
 * Posts to the same `/api/admin/members` endpoint the row menu uses — one
 * server-side authorisation path, not two — then `router.refresh()` re-renders
 * the server component so the row leaves the queue and the member's pill in the
 * table below updates in the same paint.
 */
export function AccessRequests({ requests }: { requests: AccessRequestRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openGrant, setOpenGrant] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeData | null>(null);

  async function run(row: AccessRequestRow, action: "grantFree" | "declineRequest", durationMonths?: number) {
    setBusyId(row.memberId);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: row.memberId, action, durationMonths }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Action failed. Please try again." });
        return;
      }
      const who = row.name || row.email;
      setNotice({
        type: "success",
        message:
          action === "grantFree"
            ? `Access granted to ${who}.`
            : `Request from ${who} declined.`,
      });
      setOpenGrant(null);
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminCard
      title={`Access requests${requests.length > 0 ? ` (${requests.length})` : ""}`}
      subtitle="Members waiting for you to grant access. Oldest first."
    >
      {notice && <Notice notice={notice} />}

      {requests.length === 0 ? (
        <p className="text-sm text-muted">No one is waiting — every request has been actioned.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.map((row) => {
            const busy = busyId === row.memberId;
            const grantOpen = openGrant === row.memberId;
            return (
              <li
                key={row.memberId}
                className="flex flex-col gap-3 rounded-xl border border-line bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">{row.name}</span>
                    {row.returning && (
                      <span className="rounded-full bg-muted/15 px-2 py-0.5 text-[11px] font-medium text-muted">
                        Returning
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {row.email} · {row.requestedAgo}
                  </span>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {grantOpen ? (
                    <>
                      <span className="text-xs text-muted">Grant for</span>
                      {GRANT_OPTIONS.map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          disabled={busy}
                          onClick={() => run(row, "grantFree", opt.months)}
                          className="inline-flex h-8 items-center rounded-lg border border-line px-2.5 text-xs font-semibold text-white transition-colors hover:border-accent/40 hover:bg-accent/10 disabled:opacity-50"
                        >
                          {opt.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setOpenGrant(null)}
                        className="text-xs text-muted underline-offset-4 transition-colors hover:text-white hover:underline disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setOpenGrant(row.memberId)}
                        className={cn(
                          "inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-[#121212] transition-opacity hover:opacity-90 disabled:opacity-50",
                          "[&>svg]:size-4",
                        )}
                      >
                        <GiftIcon />
                        Grant access
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(row, "declineRequest")}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-[#D2031E] transition-colors hover:border-[#D2031E]/40 disabled:opacity-50 [&>svg]:size-4"
                      >
                        <BanIcon />
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminCard>
  );
}
