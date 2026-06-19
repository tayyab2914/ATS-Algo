"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SVGProps } from "react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

export type SidebarUser = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
};

/** First one or two initials for the avatar fallback. */
function initials(user: SidebarUser): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

function Avatar({ user }: { user: SidebarUser }) {
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/30 bg-accent/15 bg-cover bg-center text-sm font-semibold uppercase text-accent"
      style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
    >
      {!user.avatarUrl && (initials(user) || <UserIcon />)}
    </span>
  );
}

/**
 * Sidebar profile control. Shows the signed-in user's avatar, name and email;
 * pressing it opens a popover with an optional link to Account Settings and a
 * Sign out action. Signing out asks for confirmation first, then clears the
 * session and navigates to `redirectTo`.
 *
 * @param redirectTo - Where to land after signing out (default "/"; the admin
 *   panel passes "/admin").
 * @param accountHref - Account-settings link target; pass null to hide it (the
 *   admin panel has no in-panel account page).
 */
export function ProfileMenu({
  user,
  onNavigate,
  redirectTo = "/",
  accountHref = "/account",
}: {
  user: SidebarUser;
  onNavigate?: () => void;
  redirectTo?: string;
  accountHref?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // Close the popover on Escape (the confirm dialog handles its own Escape).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function handleSignOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push(redirectTo);
      router.refresh();
    } finally {
      setPending(false);
      setConfirmOpen(false);
      setOpen(false);
    }
  }

  const name = user.name?.trim() || "Your account";

  return (
    <div className="relative">
      {open && (
        <>
          {/* Click-away backdrop. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]"
          >
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar user={user} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-white">{name}</span>
                <span className="truncate text-xs text-muted">{user.email}</span>
              </span>
            </div>

            <div className="my-1 h-px bg-line" />

            {accountHref && (
              <Link
                href={accountHref}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-white transition-colors hover:bg-white/5"
              >
                <GearIcon className="shrink-0" />
                Account settings
              </Link>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-[#D2031E] transition-colors hover:bg-[#D2031E]/10"
            >
              <LogoutIcon className="shrink-0" />
              Sign out
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
          open ? "border-accent/40 bg-accent/10" : "border-line bg-background hover:bg-white/5",
        )}
      >
        <Avatar user={user} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold leading-[21px] text-white">{name}</span>
          <span className="truncate text-xs leading-[18px] text-muted">{user.email}</span>
        </span>
        <ChevronUpIcon className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Sign out?"
        description="You'll be signed out of this device and need to log in again to access your dashboard."
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        pending={pending}
        onConfirm={handleSignOut}
        onCancel={() => {
          if (!pending) setConfirmOpen(false);
        }}
      />
    </div>
  );
}

function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </svg>
  );
}

function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" />
      <path d="M10 12h11M18 9l3 3-3 3" />
    </svg>
  );
}

function ChevronUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}
