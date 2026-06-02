"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  CATEGORIES,
  formatUsers,
  perfTone,
  plainPct,
  signedPct,
  type BotRow,
  type Category,
  type RiskClass,
} from "@/lib/bot-library";

const RISK_BADGE: Record<RiskClass, string> = {
  Low: "bg-success/10 text-success",
  Medium: "bg-accent/10 text-accent",
  High: "bg-[#D2031E]/10 text-[#D2031E]",
};

const PERF_TONE: Record<"muted" | "success" | "danger", string> = {
  muted: "font-normal text-muted",
  success: "font-semibold text-success",
  danger: "font-semibold text-[#D2031E]",
};

const COLUMNS = [
  "Bot Name",
  "Timeframe",
  "Risk Class",
  "Win Rate",
  "PF",
  "30 Days",
  "90 Days",
  "180 Days",
  "360 Days",
  "Avg. Trade",
  "Users",
  "Action",
] as const;

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.333" />
      <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.333" strokeLinecap="round" />
    </svg>
  );
}

function PerfCell({ value }: { value: number | null }) {
  return <td className={cn("px-4 py-4 text-center text-sm", PERF_TONE[perfTone(value)])}>{signedPct(value)}</td>;
}

/**
 * Bot Library table with asset-class tabs and live search. Filtering is local
 * to the client (the full catalogue arrives as a prop), so switching tabs and
 * typing in the search box are instant — no round-trips.
 */
export function BotLibraryBrowser({ bots }: { bots: Record<Category, BotRow[]> }) {
  const [category, setCategory] = useState<Category>("crypto");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = bots[category] ?? [];
    if (!q) return list;
    return list.filter(
      (b) => b.name.toLowerCase().includes(q) || b.pair.toLowerCase().includes(q),
    );
  }, [bots, category, query]);

  return (
    <div className="flex flex-col gap-6">
      {/* controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit gap-1 rounded-lg border border-line bg-surface p-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-medium leading-[18px] transition-colors",
                c.key === category ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
              )}
            >
              {c.label}
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

      {/* table card */}
      <div className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4">
        <span
          aria-hidden
          className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[102px] rounded-full bg-accent/20 blur-[32px]"
        />
        <div className="relative z-[1] overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {COLUMNS.map((label, i) => (
                  <th
                    key={label}
                    className={cn(
                      "px-4 py-4 text-xs font-semibold leading-[18px] text-muted",
                      i === 0 ? "text-left" : "text-center",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((bot) => (
                <tr key={bot.slug} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-4">
                    <Link
                      href={`/bot-library/${bot.slug}`}
                      className="text-sm font-semibold text-white transition-colors hover:text-accent"
                    >
                      {bot.name}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{bot.timeframe}</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-[3.5px] text-sm font-semibold",
                        RISK_BADGE[bot.risk],
                      )}
                    >
                      {bot.risk}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{plainPct(bot.winRate)}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{bot.pf.toFixed(2)}</td>
                  <PerfCell value={bot.d30} />
                  <PerfCell value={bot.d90} />
                  <PerfCell value={bot.d180} />
                  <PerfCell value={bot.d360} />
                  <td className="px-4 py-4 text-center text-sm text-muted">{plainPct(bot.avgTrade)}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{formatUsers(bot.users)}</td>
                  <td className="px-4 py-4 text-center">
                    <Link
                      href={`/bot-library/${bot.slug}`}
                      className="inline-flex h-8 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-[#121212] transition-opacity hover:opacity-90"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-muted">
                    No bots match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
