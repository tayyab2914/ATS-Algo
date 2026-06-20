"use client";

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
 * Category tabs (default "All") + live search over the bots table. The full
 * list arrives as a prop and filtering happens client-side, so switching tabs
 * and typing are instant.
 */
export function BotsBrowser({ bots, categories }: { bots: BotTableRow[]; categories: string[] }) {
  const filters = ["All", ...categories];
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bots.filter((b) => {
      const inCategory = filter === "All" || b.category.toLowerCase() === filter.toLowerCase();
      if (!inCategory) return false;
      if (!q) return true;
      return b.name.toLowerCase().includes(q) || (b.ticker ?? "").toLowerCase().includes(q);
    });
  }, [bots, filter, query]);

  const filtered = filter !== "All" || query.trim() !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit gap-1 rounded-lg border border-line bg-background p-1">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-medium leading-[18px] transition-colors",
                f === filter ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <label className="flex h-[42px] w-full items-center gap-2 rounded-lg border border-line bg-background px-3 sm:w-72">
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
        emptyLabel={filtered ? "No bots match your filter." : "No bots yet. Use “Add New Bot” to create one."}
      />
    </div>
  );
}
