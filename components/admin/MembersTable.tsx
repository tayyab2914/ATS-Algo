"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import {
  BanIcon,
  CheckIcon,
  DotsIcon,
  GiftIcon,
  LogoutIcon,
  RotateIcon,
} from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

export type MemberStatus = "ACTIVE" | "SUSPENDED" | "BANNED";

export type MemberSubscription = {
  /** Short pill text, e.g. "Yearly", "Free grant", "Free". */
  label: string;
  /** Whether the plan currently grants access. */
  active: boolean;
  /** Granted by an admin (no Stripe charge). */
  isComp: boolean;
};

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  status: MemberStatus;
  /** Whether the member currently holds a live session (signed in). */
  loggedIn: boolean;
  joined: string;
  subscription: MemberSubscription;
};

type MemberAction = "suspend" | "ban" | "reactivate" | "forceLogout" | "grantFree" | "revokeFree";

function successMessage(member: MemberRow, action: MemberAction): string {
  const who = member.name || member.email;
  switch (action) {
    case "suspend":
      return `${who} has been suspended and signed out.`;
    case "ban":
      return `${who} is banned — they can no longer sign in, and any live session was ended.`;
    case "reactivate":
      return `${who} has been unbanned and can sign in again.`;
    case "forceLogout":
      return `${who} has been signed out of all sessions.`;
    case "grantFree":
      return `Free access granted to ${who}.`;
    case "revokeFree":
      return `Free access revoked from ${who}.`;
  }
}

const STATUS_PILL: Record<MemberStatus, string> = {
  ACTIVE: "bg-success/10 text-success",
  SUSPENDED: "bg-[#F4A825]/10 text-[#F4A825]",
  BANNED: "bg-[#D2031E]/10 text-[#D2031E]",
};

const STATUS_LABEL: Record<MemberStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  BANNED: "Banned",
};

/** Free-subscription grant lengths offered in the row menu. `0` = perpetual. */
const GRANT_OPTIONS: { label: string; months: number }[] = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "12 months", months: 12 },
  { label: "Lifetime", months: 0 },
];

export function MembersTable({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"main" | "grant">("main");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);

  function closeMenu() {
    setOpenId(null);
    setView("main");
  }

  async function run(member: MemberRow, action: MemberAction, durationMonths?: number) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id, action, durationMonths }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Action failed. Please try again." });
        return;
      }
      setNotice({ type: "success", message: successMessage(member, action) });
      closeMenu();
      router.refresh();
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminCard title="Members" subtitle="Every account, its plan, and standing. Manage access per member.">
      {notice && <Notice notice={notice} />}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 text-center font-semibold">Email</th>
              <th className="px-4 py-3 text-center font-semibold">Role</th>
              <th className="px-4 py-3 text-center font-semibold">Subscription</th>
              <th className="px-4 py-3 text-center font-semibold">Joined</th>
              <th className="px-4 py-3 text-center font-semibold">Session</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                  No members yet.
                </td>
              </tr>
            ) : (
              members.map((member) => {
                const isAdmin = member.role === "ADMIN";
                const menuOpen = openId === member.id;
                return (
                  <tr key={member.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-4 text-sm font-semibold text-white">{member.name}</td>
                    <td className="px-4 py-4 text-center text-sm text-muted">{member.email}</td>
                    <td className="px-4 py-4 text-center">
                      <Pill className="bg-accent/10 text-accent">{isAdmin ? "Admin" : "Member"}</Pill>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Pill
                        className={
                          member.subscription.active
                            ? "bg-accent/10 text-accent"
                            : "bg-muted/10 text-muted"
                        }
                      >
                        {member.subscription.label}
                      </Pill>
                    </td>
                    <td className="px-4 py-4 text-center text-sm text-muted">{member.joined}</td>
                    <td className="px-4 py-4">
                      <span className="flex items-center justify-center gap-2 text-sm text-muted">
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            member.loggedIn ? "bg-success" : "bg-muted/50",
                          )}
                        />
                        {member.loggedIn ? "Signed in" : "Signed out"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <Pill className={STATUS_PILL[member.status]}>{STATUS_LABEL[member.status]}</Pill>
                    </td>
                    <td className="px-4 py-4 text-right">
                      {isAdmin ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div className="relative inline-block text-left">
                          <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label={`Actions for ${member.name}`}
                            onClick={() => {
                              setView("main");
                              setOpenId(menuOpen ? null : member.id);
                            }}
                            className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-white"
                          >
                            <DotsIcon />
                          </button>

                          {menuOpen && (
                            <RowMenu
                              member={member}
                              view={view}
                              busy={busy}
                              onClose={closeMenu}
                              onView={setView}
                              onAction={run}
                            />
                          )}
                        </div>
                      )}
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

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-sm font-semibold", className)}>
      {children}
    </span>
  );
}

function RowMenu({
  member,
  view,
  busy,
  onClose,
  onView,
  onAction,
}: {
  member: MemberRow;
  view: "main" | "grant";
  busy: boolean;
  onClose: () => void;
  onView: (view: "main" | "grant") => void;
  onAction: (member: MemberRow, action: MemberAction, durationMonths?: number) => void;
}) {
  const hasComp = member.subscription.isComp;
  const canGrant = !member.subscription.active || hasComp;

  return (
    <>
      {/* Click-away backdrop. */}
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="fixed inset-0 z-40 cursor-default" />
      <div
        role="menu"
        className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]"
      >
        {view === "grant" ? (
          <>
            <p className="px-3 py-2 text-xs font-semibold text-muted">Grant free access for…</p>
            {GRANT_OPTIONS.map((opt) => (
              <MenuItem
                key={opt.label}
                icon={<GiftIcon />}
                label={opt.label}
                disabled={busy}
                onClick={() => onAction(member, "grantFree", opt.months)}
              />
            ))}
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<RotateIcon />} label="Back" disabled={busy} onClick={() => onView("main")} />
          </>
        ) : (
          <>
            {member.status === "ACTIVE" ? (
              <MenuItem
                icon={<BanIcon />}
                label="Ban"
                tone="danger"
                disabled={busy}
                onClick={() => onAction(member, "ban")}
              />
            ) : (
              <MenuItem
                icon={<CheckIcon />}
                label="Unban"
                tone="success"
                disabled={busy}
                onClick={() => onAction(member, "reactivate")}
              />
            )}

            {member.loggedIn && (
              <MenuItem
                icon={<LogoutIcon />}
                label="Force logout"
                disabled={busy}
                onClick={() => onAction(member, "forceLogout")}
              />
            )}

            <div className="my-1 h-px bg-line" />

            {hasComp ? (
              <MenuItem
                icon={<GiftIcon />}
                label="Revoke free access"
                disabled={busy}
                onClick={() => onAction(member, "revokeFree")}
              />
            ) : (
              <MenuItem
                icon={<GiftIcon />}
                label="Grant free subscription"
                disabled={busy || !canGrant}
                onClick={() => onView("grant")}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5 disabled:opacity-50",
        tone === "danger" ? "text-[#D2031E]" : tone === "success" ? "text-success" : "text-white",
      )}
    >
      <span className="shrink-0 [&>svg]:size-4">{icon}</span>
      {label}
    </button>
  );
}
