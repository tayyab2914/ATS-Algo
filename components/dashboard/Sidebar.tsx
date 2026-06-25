"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";
import { useEffect, useState } from "react";
import { TrialEndedDialog } from "@/components/app/TrialEndedDialog";
import { Logo } from "@/components/brand/Logo";
import { NAV_ICONS } from "@/components/dashboard/icons";
import { ProfileMenu, type SidebarUser } from "@/components/dashboard/ProfileMenu";
import { cn } from "@/lib/cn";

export type { SidebarUser };

type NavKey = keyof typeof NAV_ICONS;

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "botLibrary", label: "Bot Library", href: "/bot-library" },
  { key: "portfolio", label: "Portfolio", href: "/portfolio" },
  { key: "myBots", label: "My Bots", href: "/my-bots" },
  { key: "settings", label: "Account Settings", href: "/account" },
  { key: "billing", label: "Billing", href: "/billing" },
];

/** True when `pathname` is within (or equal to) `href`'s route segment. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/**
 * Logo, nav links and the profile footer — shared by the desktop rail and the
 * mobile drawer so both stay in sync.
 *
 * @param expired   - True for an expired-trial guest; locks every tab but Billing.
 * @param onNavigate - Called when a link is tapped; the drawer passes a closer.
 * @param onLocked  - Called when an expired guest taps a locked tab; opens the modal.
 */
function SidebarContent({
  pathname,
  user,
  expired = false,
  onNavigate,
  onLocked,
}: {
  pathname: string;
  user?: SidebarUser | null;
  expired?: boolean;
  onNavigate?: () => void;
  onLocked?: () => void;
}) {
  return (
    <>
      <div className="flex h-24 items-center justify-center border-b border-line px-6">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 p-4">
        {NAV.map((item) => {
          const IconCmp = NAV_ICONS[item.key];
          const active = isActive(pathname, item.href);
          // An expired guest is walled to Billing: every other tab is locked and,
          // instead of navigating (which flashed the destination's loading screen
          // before bouncing back), opens the "trial ended" modal.
          const locked = expired && item.href !== "/billing";
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={(e) => {
                if (locked) {
                  e.preventDefault();
                  onNavigate?.();
                  onLocked?.();
                  return;
                }
                onNavigate?.();
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-2 rounded-r-2xl px-4 text-sm transition-colors",
                locked
                  ? "font-normal text-white/40 hover:bg-white/5"
                  : active
                    ? "bg-[linear-gradient(111deg,#020344_0%,#28B8D5_100%)] font-semibold text-white"
                    : "font-normal text-white/90 hover:bg-white/5",
              )}
            >
              {active && !locked && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(40,184,213,0.6)]" />
              )}
              <IconCmp className="shrink-0" />
              <span>{item.label}</span>
              {locked && <LockIcon className="ml-auto shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-line p-4">
          <ProfileMenu user={user} onNavigate={onNavigate} />
        </div>
      )}
    </>
  );
}

/**
 * Dashboard navigation. On `lg`+ it's a fixed rail; below that the rail is
 * replaced by a top bar with a hamburger that opens an off-canvas drawer, so
 * the same links stay reachable on phones. Every item links to its route; the
 * active tab is derived from the current pathname so a nested route (e.g. a bot
 * detail page) keeps its parent tab highlighted. Guests can browse the Bot
 * Library freely — the other routes render a locked overlay until they sign in.
 *
 * When `expired` is set (an elapsed-trial guest), every tab but Billing is
 * locked: tapping one is intercepted client-side to pop the "trial ended" modal
 * instead of navigating, which avoids the dark loading-screen flash the old
 * server redirect caused.
 */
export function Sidebar({ user, expired = false }: { user?: SidebarUser | null; expired?: boolean }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [trialEndedOpen, setTrialEndedOpen] = useState(false);

  // Lock body scroll while the drawer is open so the page behind stays put.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-surface lg:flex">
        <SidebarContent
          pathname={pathname}
          user={user}
          expired={expired}
          onLocked={() => setTrialEndedOpen(true)}
        />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="flex size-10 items-center justify-center rounded-xl border border-line text-white transition-colors hover:bg-white/5"
        >
          <MenuIcon />
        </button>
      </header>

      {/* Mobile drawer + backdrop */}
      <div
        className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-0 bg-black/60 transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex h-full w-72 max-w-[85%] flex-col bg-surface shadow-2xl transition-transform duration-300",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/5"
          >
            <CloseIcon />
          </button>
          <SidebarContent
            pathname={pathname}
            user={user}
            expired={expired}
            onNavigate={() => setOpen(false)}
            onLocked={() => setTrialEndedOpen(true)}
          />
        </aside>
      </div>

      <TrialEndedDialog open={trialEndedOpen} onClose={() => setTrialEndedOpen(false)} />
    </>
  );
}
