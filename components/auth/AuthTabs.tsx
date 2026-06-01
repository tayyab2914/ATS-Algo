import Link from "next/link";
import { AUTH_COPY, AUTH_MODES, type AuthMode } from "@/lib/auth-config";
import { cn } from "@/lib/cn";

/**
 * Segmented Login / Sign Up switch. Each tab is a real navigation link to its
 * route, so the active state is derived from the current page rather than
 * client state — shareable URLs, no flash, works without JS.
 */
export function AuthTabs({ active }: { active: AuthMode }) {
  return (
    <nav className="flex w-full gap-1 rounded-lg border border-line bg-surface p-1">
      {AUTH_MODES.map((mode) => {
        const isActive = mode === active;
        return (
          <Link
            key={mode}
            href={AUTH_COPY[mode].href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-xs leading-[18px] transition-colors",
              isActive
                ? "bg-accent font-semibold text-[#121212]"
                : "text-muted hover:text-white",
            )}
          >
            {AUTH_COPY[mode].tab}
          </Link>
        );
      })}
    </nav>
  );
}
