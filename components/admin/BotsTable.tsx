"use client";

import { useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BotRowActions } from "@/components/admin/BotRowActions";
import { cn } from "@/lib/cn";
import { RISK_LABEL, RISK_ORDER, riskBadgeClass } from "@/lib/risk";

export type BotTableRow = {
  id: string;
  name: string;
  category: string;
  ticker: string | null;
  timeframe: string;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  status: "ACTIVE" | "DISABLED";
  trades: number;
  winRate: number;
  profitFactor: number;
  d30: number;
  d90: number;
  d180: number;
  d360: number;
  avgTrade: number;
};

/** Sort accessor key for each sortable column; `null` columns aren't sortable. */
type SortKey =
  | "name"
  | "timeframe"
  | "riskClass"
  | "winRate"
  | "profitFactor"
  | "d30"
  | "d90"
  | "d180"
  | "d360"
  | "avgTrade"
  | "status";

const COLUMNS: { label: string; sort: SortKey | null }[] = [
  { label: "Bot Name", sort: "name" },
  { label: "Timeframe", sort: "timeframe" },
  { label: "Risk Class", sort: "riskClass" },
  { label: "Win Rate", sort: "winRate" },
  { label: "PF", sort: "profitFactor" },
  { label: "30 Days", sort: "d30" },
  { label: "90 Days", sort: "d90" },
  { label: "180 Days", sort: "d180" },
  { label: "360 Days", sort: "d360" },
  { label: "Avg. Trade", sort: "avgTrade" },
  { label: "Status", sort: "status" },
  { label: "Action", sort: null },
];

type SortState = { key: SortKey; dir: "asc" | "desc" };

/** Active sorts before disabled when ascending. */
const STATUS_ORDER: Record<BotTableRow["status"], number> = { ACTIVE: 0, DISABLED: 1 };

/** Compare two rows by `key`, honouring direction. */
function compareRows(a: BotTableRow, b: BotTableRow, key: SortKey, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  if (key === "name" || key === "timeframe") {
    return a[key].localeCompare(b[key]) * mul;
  }
  if (key === "riskClass") {
    return (RISK_ORDER[a.riskClass] - RISK_ORDER[b.riskClass]) * mul;
  }
  if (key === "status") {
    return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * mul;
  }
  return (a[key] - b[key]) * mul;
}

function Perf({ value }: { value: number }) {
  return (
    <span className={cn("font-semibold", value >= 0 ? "text-success" : "text-[#D2031E]")}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function BotsTable({
  bots,
  emptyLabel = "No bots yet. Use “Add New Bot” to create one.",
}: {
  bots: BotTableRow[];
  emptyLabel?: string;
}) {
  const [sort, setSort] = useState<SortState | null>(null);

  // Clicking a header sorts by it ascending (alphabetical / low→high); clicking
  // the same header again flips to descending.
  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  const rows = useMemo(() => {
    if (!sort) return bots;
    return [...bots].sort((a, b) => compareRows(a, b, sort.key, sort.dir));
  }, [bots, sort]);

  return (
    <AdminCard title="Bots" subtitle="Every bot you've created, with its latest backtest metrics.">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[980px] text-left">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-xs font-semibold text-muted">
              {COLUMNS.map((col, i) => {
                const active = sort?.key === col.sort;
                return (
                  <th
                    key={col.label}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("px-4 py-3", i === 0 ? "text-left" : "text-center")}
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sort!)}
                        className={cn(
                          "inline-flex items-center gap-1 transition-colors hover:text-white",
                          i === 0 ? "justify-start" : "justify-center",
                          active && "text-white",
                        )}
                      >
                        {col.label}
                        <span aria-hidden className="text-[10px] leading-none">
                          {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-sm text-muted">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <tr key={b.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-4 text-sm font-semibold text-white">{b.name}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{b.timeframe}</td>
                  <td className="px-4 py-4 text-center">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", riskBadgeClass(b.riskClass))}>
                      {RISK_LABEL[b.riskClass]}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-white">{b.winRate.toFixed(2)}%</td>
                  <td className="px-4 py-4 text-center text-sm text-white">{b.profitFactor.toFixed(2)}</td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d30} /></td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d90} /></td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d180} /></td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d360} /></td>
                  <td className="px-4 py-4 text-center text-sm text-white">{b.avgTrade.toFixed(2)}%</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        b.status === "ACTIVE" ? "bg-success/10 text-success" : "bg-muted/10 text-muted",
                      )}
                    >
                      {b.status === "ACTIVE" ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <BotRowActions botId={b.id} botName={b.name} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
