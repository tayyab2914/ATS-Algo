import Link from "next/link";
import { cn } from "@/lib/cn";
import { STAT_WINDOWS, STAT_WINDOW_LABEL, type StatWindow } from "@/lib/portfolio/analytics";

/**
 * Week / Month / All Time toggle for the Stats charts. URL-driven (`?stats=`) so
 * it needs no client state and the choice survives a refresh or a shared link.
 */
export function StatsWindowTabs({ active }: { active: StatWindow }) {
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-background p-1">
      {STAT_WINDOWS.map((w) => (
        <Link
          key={w}
          href={`/portfolio?stats=${w}`}
          scroll={false}
          aria-current={w === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs leading-[18px] transition-colors",
            w === active ? "bg-accent font-semibold text-[#121212]" : "text-muted hover:text-white",
          )}
        >
          {STAT_WINDOW_LABEL[w]}
        </Link>
      ))}
    </div>
  );
}
