"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { NAV_ICONS } from "@/components/dashboard/icons";
import { cn } from "@/lib/cn";

type NavKey = keyof typeof NAV_ICONS;

const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "botLibrary", label: "Bot Library", href: "/bot-library" },
  { key: "portfolio", label: "Portfolio", href: "/portfolio" },
  { key: "myBots", label: "My Bots", href: "/my-bots" },
  { key: "settings", label: "Account Settings", href: "/account" },
];

export type SidebarUser = {
  name: string | null;
  email: string;
  avatarUrl: string | null;
};

/** True when `pathname` is within (or equal to) `href`'s route segment. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** First one or two initials for the avatar fallback. */
function initials(user: SidebarUser): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/**
 * Dashboard sidebar. Every item links to its route; the active tab is derived
 * from the current pathname so a nested route (e.g. a bot detail page) keeps
 * its parent tab highlighted. Guests can browse the Bot Library freely — the
 * other routes render a locked overlay until they sign in.
 */
export function Sidebar({ user }: { user?: SidebarUser | null }) {
  const pathname = usePathname() ?? "";
  const settingsActive = isActive(pathname, "/account");

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-surface lg:flex">
      <div className="flex h-24 items-center justify-center border-b border-line px-6">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 p-4">
        {NAV.map((item) => {
          const IconCmp = NAV_ICONS[item.key];
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-2 rounded-r-2xl px-4 text-sm transition-colors",
                active
                  ? "bg-[linear-gradient(111deg,#020344_0%,#28B8D5_100%)] font-semibold text-white"
                  : "font-normal text-white/90 hover:bg-white/5",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(40,184,213,0.6)]" />
              )}
              <IconCmp className="shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 border-t border-line p-4">
        <div className="relative flex flex-col gap-1 overflow-hidden rounded-2xl border border-line bg-background px-4 py-2">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(35,231,116,0.3),transparent)]"
          />
          <span className="text-xs leading-[18px] text-muted">Connected</span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" />
            <span className="text-sm font-semibold leading-[21px] text-success">Binance API</span>
          </span>
        </div>

        {user && (
          <Link
            href="/account"
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
              settingsActive ? "border-accent/40 bg-accent/10" : "border-line bg-background hover:bg-white/5",
            )}
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/30 bg-accent/15 bg-cover bg-center text-sm font-semibold uppercase text-accent"
              style={user.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
            >
              {!user.avatarUrl && (initials(user) || (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" />
                </svg>
              ))}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold leading-[21px] text-white">
                {user.name?.trim() || "Your account"}
              </span>
              <span className="truncate text-xs leading-[18px] text-muted">{user.email}</span>
            </span>
          </Link>
        )}
      </div>
    </aside>
  );
}
