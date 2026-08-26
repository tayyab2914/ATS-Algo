"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BotsTable, type BotTableRow } from "@/components/admin/BotsTable";
import { cn } from "@/lib/cn";

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.333" />
      <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.333" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Member-facing Bot Library table. Reuses the exact admin {@link BotsTable} (same
 * columns, sorting and styling) but hides the admin-only Status column and swaps
 * the row action menu for a single "View" button. Category tabs + live search
 * filter the catalogue client-side, so switching tabs and typing are instant.
 */
export function BotLibraryBrowser({ bots, categories }: { bots: BotTableRow[]; categories: string[] }) {
  const tabs = ["All", ...categories];
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bots.filter((b) => {
      const inCategory = filter === "All" || b.category.toLowerCase() === filter.toLowerCase();
      if (!inCategory) return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.ticker ?? "").toLowerCase().includes(q) ||
        b.exchanges.some((e) => e.toLowerCase().includes(q))
      );
    });
  }, [bots, filter, query]);

  const filtered = filter !== "All" || query.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      {/* controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-medium leading-[18px] transition-colors",
                t === filter ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="flex h-[42px] w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 sm:w-72">
          <span className="text-muted">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bot or asset"
            className="w-full bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
          />
        </label>
      </div>

      <BotsTable
        bots={rows}
        showStatus={false}
        showRunning={false}
        title="Available Bots"
        subtitle="Browse automated trading bots and view their latest backtest metrics."
        emptyLabel={filtered ? "No bots match your filter." : "No bots are available yet. Check back soon."}
        renderAction={(b) => (
          <div className="flex justify-center">
            <Link
              href={`/bot-library/${b.id}`}
              className="inline-flex h-8 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-[#121212] transition-opacity hover:opacity-90"
            >
              View
            </Link>
          </div>
        )}
      />
    </div>
  );
}
