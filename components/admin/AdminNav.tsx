"use client";

import Link from "next/link";
import type { SVGProps } from "react";
import { useEffect, useState } from "react";
import { BotIcon, GearIcon, ShieldUsersIcon, UserIcon } from "@/components/admin/admin-icons";
import { Logo } from "@/components/brand/Logo";
import { ProfileMenu, type SidebarUser } from "@/components/dashboard/ProfileMenu";
import { cn } from "@/lib/cn";

export type AdminTab = "dashboard" | "management" | "bots" | "account";

const NAV = [
  { key: "dashboard", label: "Admin Dashboard", Icon: GearIcon, href: "/admin/dashboard" },
  { key: "management", label: "Members Management", Icon: ShieldUsersIcon, href: "/admin/management" },
  { key: "bots", label: "Bot Management", Icon: BotIcon, href: "/admin/bots" },
  { key: "account", label: "Account Management", Icon: UserIcon, href: "/admin/account" },
] as const;

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

/** Logo, nav links and the profile footer — shared by the rail and the drawer. */
function NavContent({
  active,
  user,
  onNavigate,
}: {
  active: AdminTab;
  user: SidebarUser | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-24 items-center justify-center border-b border-line px-6">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 p-4">
        {NAV.map(({ key, label, Icon, href }) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-2 rounded-r-2xl px-4 text-sm transition-colors",
                isActive
                  ? "bg-[linear-gradient(111deg,#020344_0%,#28B8D5_100%)] font-semibold text-white"
                  : "font-normal text-white/90 hover:bg-white/5",
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(40,184,213,0.6)]" />
              )}
              <Icon className="shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-line p-4">
          {/* Admins sign out back to the admin login. */}
          <ProfileMenu
            user={user}
            redirectTo="/admin"
            accountHref="/admin/account"
            onNavigate={onNavigate}
          />
        </div>
      )}
    </>
  );
}

/**
 * Admin navigation. On `lg`+ it's a fixed rail; below that the rail is replaced
 * by a top bar with a hamburger that opens an off-canvas drawer, so the admin
 * nav and sign-out stay reachable on phones.
 */
export function AdminNav({ active = "dashboard", user }: { active?: AdminTab; user: SidebarUser | null }) {
  const [open, setOpen] = useState(false);

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
        <NavContent active={active} user={user} />
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
          <NavContent active={active} user={user} onNavigate={() => setOpen(false)} />
        </aside>
      </div>
    </>
  );
}
