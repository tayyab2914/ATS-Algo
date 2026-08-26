"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BotRowActions } from "@/components/admin/BotRowActions";
import { ExchangeCluster } from "@/components/admin/ExchangeCluster";
import { cn } from "@/lib/cn";
import { RISK_LABEL, RISK_ORDER, riskBadgeClass } from "@/lib/risk";

export type BotTableRow = {
  id: string;
  name: string;
  category: string;
  ticker: string | null;
  exchange: string | null; // display-primary (exchanges[0]); kept for sorting/search
  exchanges: string[]; // admin-allowed venues
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  status: "ACTIVE" | "DISABLED";
  trades: number;
  winRate: number;
  profitFactor: number;
  d30: number;
  d90: number;
  d180: number;
  d360: number;
  /** How many members have deployed this bot, and how many are running it. */
  users: number;
  running: number;
};

/** Sort accessor key for each sortable column; `null` columns aren't sortable. */
type SortKey =
  | "name"
  | "exchange"
  | "riskClass"
  | "winRate"
  | "profitFactor"
  | "d30"
  | "d90"
  | "d180"
  | "d360"
  | "users"
  | "status";

const COLUMNS: { label: string; sort: SortKey | null }[] = [
  { label: "Bot Name", sort: "name" },
  { label: "Exchange", sort: "exchange" },
  { label: "Risk Class", sort: "riskClass" },
  { label: "Win Rate", sort: "winRate" },
  { label: "PF", sort: "profitFactor" },
  { label: "30 Days", sort: "d30" },
  { label: "90 Days", sort: "d90" },
  { label: "180 Days", sort: "d180" },
  { label: "360 Days", sort: "d360" },
  { label: "Users", sort: "users" },
  { label: "Status", sort: "status" },
  { label: "Action", sort: null },
];

type SortState = { key: SortKey; dir: "asc" | "desc" };

/** Active sorts before disabled when ascending. */
const STATUS_ORDER: Record<BotTableRow["status"], number> = { ACTIVE: 0, DISABLED: 1 };

/** Compare two rows by `key`, honouring direction. */
function compareRows(a: BotTableRow, b: BotTableRow, key: SortKey, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  if (key === "name") {
    return a.name.localeCompare(b.name) * mul;
  }
  if (key === "exchange") {
    return (a.exchange ?? "").localeCompare(b.exchange ?? "") * mul;
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
  title = "Bots",
  subtitle = "Every bot you've created, with its latest backtest metrics.",
  showStatus = true,
  showUsers = true,
  showRunning = true,
  botHref,
  renderAction,
}: {
  bots: BotTableRow[];
  emptyLabel?: string;
  title?: string;
  subtitle?: string;
  /** Show the admin-only Status column (active/disabled). Hidden on public surfaces. */
  showStatus?: boolean;
  /** Show the adoption ("Users" / running) column. */
  showUsers?: boolean;
  /**
   * Show the "N running" badge beside the user count.
   *
   * Admin-only by default. On the member-facing library the count is adoption —
   * how many people use this bot — and the extra badge read as live-trading
   * telemetry about other members' accounts, which is neither the question a
   * member is asking there nor ours to answer.
   */
  showRunning?: boolean;
  /** Link target for the bot name. Rendered as plain text when omitted. */
  botHref?: (bot: BotTableRow) => string;
  /** Render the per-row Action cell. Defaults to the admin kebab menu. */
  renderAction?: (bot: BotTableRow) => ReactNode;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const action = renderAction ?? ((b: BotTableRow) => <BotRowActions botId={b.id} botName={b.name} />);
  const hidden = new Set<SortKey>();
  if (!showStatus) hidden.add("status");
  if (!showUsers) hidden.add("users");
  const columns = COLUMNS.filter((c) => !(c.sort && hidden.has(c.sort)));

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
    <AdminCard title={title} subtitle={subtitle}>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-xs font-semibold text-muted">
              {columns.map((col, i) => {
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
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-muted">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <tr key={b.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-4 text-sm font-semibold text-white">
                    {botHref ? (
                      <Link href={botHref(b)} className="transition-colors hover:text-accent">
                        {b.name}
                      </Link>
                    ) : (
                      b.name
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <span className="flex justify-center"><ExchangeCluster exchanges={b.exchanges} /></span>
                  </td>
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
                  {showUsers && (
                    <td className="px-4 py-4 text-center text-sm">
                      <span className="text-white">{b.users}</span>
                      {showRunning && b.running > 0 && (
                        <span className="ml-1.5 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                          {b.running} running
                        </span>
                      )}
                    </td>
                  )}
                  {showStatus && (
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
                  )}
                  <td className="px-4 py-4">{action(b)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
