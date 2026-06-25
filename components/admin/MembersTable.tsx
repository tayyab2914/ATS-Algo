"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import {
  BanIcon,
  CheckIcon,
  DotsIcon,
  GiftIcon,
  LogoutIcon,
  RotateIcon,
  TrashIcon,
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

/** Guest Mode trial standing, present only for non-paying, non-admin accounts. */
export type MemberGuest = {
  /** "notStarted" before first login, "active" mid-trial, "expired" after. */
  state: "notStarted" | "active" | "expired";
  /** Whole days remaining in the trial (0 once expired). */
  daysLeft: number;
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
  /** Trial standing for a Guest account; null for paying members and admins. */
  guest: MemberGuest | null;
  /** This row is the acting admin's own account (no self-targeting). */
  isSelf: boolean;
  /** This row is the superadmin (can't be demoted/deleted by others). */
  isProtected: boolean;
};

/** The viewer-facing kind of an account, used for the coloured type pill + filter. */
type MemberType = "ADMIN" | "MEMBER" | "GUEST";

/** Admins are red, paying members keep the accent colour, guests are grey. */
const TYPE_PILL: Record<MemberType, string> = {
  ADMIN: "bg-[#D2031E]/10 text-[#D2031E]",
  MEMBER: "bg-accent/10 text-accent",
  GUEST: "bg-muted/15 text-muted",
};

const TYPE_LABEL: Record<MemberType, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  GUEST: "Guest",
};

/** Admin → ADMIN; a non-admin with active access → MEMBER; otherwise → GUEST. */
function memberType(m: MemberRow): MemberType {
  if (m.role === "ADMIN") return "ADMIN";
  return m.guest ? "GUEST" : "MEMBER";
}

type MemberAction =
  | "suspend"
  | "ban"
  | "reactivate"
  | "forceLogout"
  | "grantFree"
  | "revokeFree"
  | "delete"
  | "demote";

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
    case "delete":
      return `${who} has been permanently deleted.`;
    case "demote":
      return `${who} is no longer an admin and has been signed out.`;
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

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2v8m0 0L5 7m3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Sub-label under the "Guest" pill describing trial standing. */
function guestTrialText(guest: MemberGuest): string {
  if (guest.state === "expired") return "Trial expired";
  if (guest.state === "notStarted") return "Not started";
  return guest.daysLeft === 1 ? "1 day left" : `${guest.daysLeft} days left`;
}

/** Free-subscription grant lengths offered in the row menu. `0` = perpetual. */
const GRANT_OPTIONS: { label: string; months: number }[] = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "12 months", months: 12 },
  { label: "Lifetime", months: 0 },
];

type MenuView = "main" | "grant" | "confirmDelete";

/** Viewport-fixed coordinates for an open row menu (escapes the table's overflow clip). */
type MenuAnchor = { top: number; bottom: number; right: number; openUp: boolean };

/** Worst-case menu height used to decide whether to drop the menu up or down. */
const MENU_MAX_HEIGHT = 280;

export function MembersTable({
  members,
  isSuperAdmin = false,
}: {
  members: MemberRow[];
  /** Whether the current admin is the superadmin (only they may delete). */
  isSuperAdmin?: boolean;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<MenuView>("main");
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | MemberType>("ALL");

  const q = search.trim().toLowerCase();
  // Memoised so unrelated state changes (opening a row menu, an in-flight
  // action, a notice) don't re-scan the whole member list.
  const filtered = useMemo(
    () =>
      members.filter((m) => {
        if (typeFilter !== "ALL" && memberType(m) !== typeFilter) return false;
        if (!q) return true;
        return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
      }),
    [members, q, typeFilter],
  );

  /** Download the currently-filtered members as a CSV (emails for marketing etc.). */
  function exportCsv() {
    const cell = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["Name", "Email", "Type", "Plan", "Trial days left", "Status", "Session", "Joined"];
    const rows = filtered.map((m) => {
      const type = memberType(m);
      const plan = type === "MEMBER" ? m.subscription.label : "";
      const trial = m.guest
        ? m.guest.state === "expired"
          ? "expired"
          : m.guest.state === "notStarted"
            ? "not started"
            : String(m.guest.daysLeft)
        : "";
      return [m.name, m.email, TYPE_LABEL[type], plan, trial, STATUS_LABEL[m.status], m.loggedIn ? "Signed in" : "Signed out", m.joined];
    });
    const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    // Prepend a BOM so Excel reads UTF-8 emails/names correctly.
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openMenu(id: string, button: HTMLElement) {
    const rect = button.getBoundingClientRect();
    // Position relative to the viewport so the menu isn't clipped by the table's
    // horizontal-scroll container. Drop upward when there's little room below.
    setAnchor({
      top: rect.bottom + 8,
      bottom: window.innerHeight - rect.top + 8,
      right: window.innerWidth - rect.right,
      openUp: window.innerHeight - rect.bottom < MENU_MAX_HEIGHT,
    });
    setView("main");
    setOpenId(id);
  }

  function closeMenu() {
    setOpenId(null);
    setView("main");
    setAnchor(null);
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

      {/* Search + type filter + CSV export */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="h-9 w-full rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none sm:w-64"
          />
          <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
            {(["ALL", "ADMIN", "MEMBER", "GUEST"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  typeFilter === t ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
                )}
              >
                {t === "ALL" ? "All" : t === "ADMIN" ? "Admins" : t === "MEMBER" ? "Members" : "Guests"}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-muted transition-colors hover:border-accent/40 hover:text-white disabled:opacity-40"
        >
          <DownloadIcon />
          Export CSV{typeFilter !== "ALL" || q ? ` (${filtered.length})` : ""}
        </button>
      </div>

      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[960px] text-left">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 text-center font-semibold">Email</th>
              <th className="px-4 py-3 text-center font-semibold">Role</th>
              <th className="px-4 py-3 text-center font-semibold">Plan</th>
              <th className="px-4 py-3 text-center font-semibold">Joined</th>
              <th className="px-4 py-3 text-center font-semibold">Session</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                  {members.length === 0 ? "No members yet." : "No members match your filters."}
                </td>
              </tr>
            ) : (
              filtered.map((member) => {
                const isAdmin = member.role === "ADMIN";
                const type = memberType(member);
                // Members/guests always have a menu. Admin rows get one only for
                // a peer (never your own row, never the protected superadmin
                // unless you are them — which is your own row, so still excluded).
                const hasMenu = !isAdmin || (!member.isSelf && (isSuperAdmin || !member.isProtected));
                const menuOpen = openId === member.id;
                return (
                  <tr key={member.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-4 text-sm font-semibold text-white">{member.name}</td>
                    <td className="px-4 py-4 text-center text-sm text-muted">{member.email}</td>
                    <td className="px-4 py-4 text-center">
                      <Pill className={TYPE_PILL[type]}>{TYPE_LABEL[type]}</Pill>
                    </td>
                    <td className="px-4 py-4 text-center">
                      {type === "GUEST" ? (
                        <span className="text-xs text-muted">{member.guest ? guestTrialText(member.guest) : "—"}</span>
                      ) : type === "ADMIN" ? (
                        <span className="text-sm text-muted">—</span>
                      ) : (
                        <Pill className="bg-accent/10 text-accent">{member.subscription.label}</Pill>
                      )}
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
                      {!hasMenu ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div className="relative inline-block text-left">
                          <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label={`Actions for ${member.name}`}
                            onClick={(e) =>
                              menuOpen ? closeMenu() : openMenu(member.id, e.currentTarget)
                            }
                            className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-white"
                          >
                            <DotsIcon />
                          </button>

                          {menuOpen && anchor && (
                            <RowMenu
                              member={member}
                              view={view}
                              busy={busy}
                              isSuperAdmin={isSuperAdmin}
                              anchor={anchor}
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
  isSuperAdmin,
  anchor,
  onClose,
  onView,
  onAction,
}: {
  member: MemberRow;
  view: MenuView;
  busy: boolean;
  isSuperAdmin: boolean;
  anchor: MenuAnchor;
  onClose: () => void;
  onView: (view: MenuView) => void;
  onAction: (member: MemberRow, action: MemberAction, durationMonths?: number) => void;
}) {
  const isAdmin = member.role === "ADMIN";
  const hasComp = member.subscription.isComp;
  const canGrant = !member.subscription.active || hasComp;

  // Fixed to the viewport, anchored under (or above) the trigger so the table's
  // horizontal-scroll container can't clip it.
  const position = anchor.openUp
    ? { bottom: anchor.bottom, right: anchor.right }
    : { top: anchor.top, right: anchor.right };

  return (
    <>
      {/* Click-away backdrop. */}
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="fixed inset-0 z-40 cursor-default" />
      <div
        role="menu"
        style={position}
        className="fixed z-50 w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]"
      >
        {view === "confirmDelete" ? (
          <>
            <p className="px-3 py-2 text-xs font-semibold text-muted">
              Permanently delete this {isAdmin ? "admin" : "member"}? This can&apos;t be undone.
            </p>
            <MenuItem
              icon={<TrashIcon />}
              label="Yes, delete"
              tone="danger"
              disabled={busy}
              onClick={() => onAction(member, "delete")}
            />
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<RotateIcon />} label="Cancel" disabled={busy} onClick={() => onView("main")} />
          </>
        ) : view === "grant" ? (
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
        ) : isAdmin ? (
          // Peer-admin actions: any admin may remove another's admin rights;
          // only the superadmin may also delete. (Own row / superadmin row never
          // reach here — they get no menu.)
          <>
            {!member.isProtected && (
              <MenuItem
                icon={<BanIcon />}
                label="Remove admin access"
                tone="danger"
                disabled={busy}
                onClick={() => onAction(member, "demote")}
              />
            )}
            {isSuperAdmin && (
              <>
                {!member.isProtected && <div className="my-1 h-px bg-line" />}
                <MenuItem
                  icon={<TrashIcon />}
                  label="Delete admin"
                  tone="danger"
                  disabled={busy}
                  onClick={() => onView("confirmDelete")}
                />
              </>
            )}
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

            {isSuperAdmin && (
              <>
                <div className="my-1 h-px bg-line" />
                <MenuItem
                  icon={<TrashIcon />}
                  label="Delete member"
                  tone="danger"
                  disabled={busy}
                  onClick={() => onView("confirmDelete")}
                />
              </>
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
