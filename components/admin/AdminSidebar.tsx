import Link from "next/link";
import { GearIcon, ShieldUsersIcon } from "@/components/admin/admin-icons";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/cn";

type AdminTab = "dashboard" | "management";

const NAV = [
  { key: "dashboard", label: "Admin Dashboard", Icon: GearIcon, href: "/admin/dashboard" },
  { key: "management", label: "Admin Management", Icon: ShieldUsersIcon, href: "/admin/management" },
] as const;

/** Sidebar for the admin staging area (distinct nav from the user dashboard). */
export function AdminSidebar({ active = "dashboard" }: { active?: AdminTab }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-surface lg:flex">
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

      <div className="border-t border-line p-4">
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
      </div>
    </aside>
  );
}
