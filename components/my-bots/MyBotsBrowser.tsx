"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ExchangeBadge } from "@/components/admin/ExchangeBadge";
import { cn } from "@/lib/cn";
import { botReadiness } from "@/lib/my-bots/readiness";
import { riskBadgeClass } from "@/lib/risk";

export type MyBotRow = {
  botId: string;
  name: string;
  /** Exchanges the admin allows this bot on. */
  exchanges: string[];
  /** The exchange the user has chosen to run on (null when multiple allowed, none picked). */
  chosen: string | null;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  winRate: number;
  /** Trailing 360-day backtest return — shown as "Last Performance" on idle cards. */
  d360: number;
  active: boolean;
  allocatedCapital: number;
  /** How the bot sizes trades — decides whether the allocated pool is required. */
  allocationType: "FIXED" | "PERCENTAGE";
  /** Per-trade capital set in Settings — must be > 0 to activate. */
  capitalPerTrade: number;
  /** Whether the member has a usable API key for the chosen exchange. */
  connected: boolean;
  /** Realized PnL the reconcile job has booked for this deployment. */
  realizedBalance: number;
  /** Number of take-profit rungs in the traded profile (the ladder length). */
  rungCount: number;
  /** The live position on this deployment right now, or null when flat. */
  open: { side: "LONG" | "SHORT"; tpRungsFilled: number; beMoved: boolean } | null;
};

export type MyBotsKpis = {
  /** Deployments the member has switched ON (UserBot.active) — not published bots. */
  totalActive: number;
  totalCapital: number;
  /** Realized across every trade these bots have closed. */
  realizedPnl: number;
  closedTrades: number;
  winRate: number;
  /** False when `winRate` is the bots' backtested figure, not this member's. */
  winRateIsLive: boolean;
};

/** Risk class → the profile label the design uses. Colours come from riskBadgeClass. */
const PROFILE_LABEL: Record<MyBotRow["riskClass"], string> = {
  LOW: "Conservative",
  MEDIUM: "Balanced",
  HIGH: "Aggressive",
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function MyBotsBrowser({ rows, kpis }: { rows: MyBotRow[]; kpis: MyBotsKpis }) {
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const active = useMemo(() => rows.filter((r) => r.active), [rows]);
  const inactive = useMemo(() => rows.filter((r) => !r.active), [rows]);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Running Bots" value={String(kpis.totalActive)} icon={<BotIcon />} hint="deployed and switched on" />
        <Kpi label="Total Allocated Capital" value={money(kpis.totalCapital)} icon={<DollarIcon />} />
        <Kpi
          label="Total Profit/Loss"
          value={kpis.closedTrades ? `${kpis.realizedPnl >= 0 ? "+" : "-"}$${Math.abs(kpis.realizedPnl).toFixed(2)}` : "—"}
          icon={<TrendIcon />}
          hint={kpis.closedTrades ? `${kpis.closedTrades} closed trade${kpis.closedTrades === 1 ? "" : "s"}` : "no closed trades yet"}
        />
        <Kpi
          label="Average Win Rate"
          value={kpis.closedTrades || kpis.totalActive ? `${kpis.winRate.toFixed(1)}%` : "—"}
          icon={<TargetIcon />}
          hint={kpis.winRateIsLive ? "your closed trades" : "backtest, not your results"}
        />
      </div>

      {/* Tabs */}
      <div className="flex w-fit gap-1 rounded-lg border border-line bg-surface p-1">
        {(["active", "inactive"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              t === tab ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
            )}
          >
            {t === "active" ? `Active Bots (${active.length})` : `Non-Active Bots (${inactive.length})`}
          </button>
        ))}
      </div>

      {tab === "active" ? <ActiveBots rows={active} /> : <InactiveBots rows={inactive} />}
    </div>
  );
}

/* ── Active bots table ─────────────────────────────────────────────────── */

const HEADERS = ["Bot Name", "Profile", "Exchange", "Capital", "PnL", "TP Levels", "Break-Even", "Status", "Action"];

function ActiveBots({ rows }: { rows: MyBotRow[] }) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <header className="mb-4 flex flex-col gap-1">
        <h2 className="text-base font-semibold text-white">Active Bots</h2>
        <p className="text-sm text-muted">Bots currently connected to your exchange and executing trades.</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              {HEADERS.map((h, i) => (
                <th key={h} className={cn("px-4 py-3", i === 0 ? "text-left" : "text-center")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={HEADERS.length} className="px-4 py-10 text-center text-sm text-muted">
                  No active bots. Activate one from the Non-Active Bots tab.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.botId} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-4 text-sm font-semibold text-white">{r.name}</td>
                  <td className="px-4 py-4 text-center">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", riskBadgeClass(r.riskClass))}>
                      {PROFILE_LABEL[r.riskClass]}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-muted">
                    <span className="inline-flex justify-center">
                      <ExchangeBadge exchange={r.chosen ?? r.exchanges[0] ?? null} />
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center text-sm font-medium text-white">{money(r.allocatedCapital)}</td>
                  {/* Realized PnL booked so far (unrealized on an open position needs a
                      live price — shown on the detail page, not summarised here). */}
                  <td
                    className={cn(
                      "px-4 py-4 text-center text-sm font-semibold",
                      r.realizedBalance > 0 ? "text-success" : r.realizedBalance < 0 ? "text-[#D2031E]" : "text-muted",
                    )}
                  >
                    {r.realizedBalance === 0 ? "—" : `${r.realizedBalance >= 0 ? "+" : "-"}$${Math.abs(r.realizedBalance).toFixed(2)}`}
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-muted">
                    {r.open ? `${r.open.tpRungsFilled}/${r.rungCount}` : "—"}
                  </td>
                  <td className="px-4 py-4 text-center text-sm">
                    {r.open ? (
                      <span className={r.open.beMoved ? "font-semibold text-success" : "text-muted"}>
                        {r.open.beMoved ? "Armed" : "Not yet"}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    {r.open ? (
                      <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                        In position · {r.open.side}
                      </span>
                    ) : (
                      <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">Running</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <Link
                      href={`/my-bots/${r.botId}`}
                      className="inline-flex h-8 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-[#121212] transition-opacity hover:opacity-90"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Non-active bots grid ──────────────────────────────────────────────── */

function InactiveBots({ rows }: { rows: MyBotRow[] }) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <header className="mb-4 flex flex-col gap-1">
        <h2 className="text-base font-semibold text-white">Non-Active Bots</h2>
        <p className="text-sm text-muted">Bots added to your library but not currently running.</p>
      </header>

      {rows.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted">
          No idle bots. Add bots from the Bot Library to deploy them here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((r) => (
            <InactiveCard key={r.botId} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function InactiveCard({ row }: { row: MyBotRow }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readiness = botReadiness({
    exchanges: row.exchanges,
    chosen: row.chosen,
    connected: row.connected,
    capitalPerTrade: row.capitalPerTrade,
    allocationType: row.allocationType,
    allocatedCapital: row.allocatedCapital,
  });

  async function activate() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/my-bots/${row.botId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't activate. Try again.");
        setPending(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-background p-5">
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold text-white">{row.name}</span>
        <span className="text-sm text-muted">{PROFILE_LABEL[row.riskClass]} Profile</span>
      </div>

      {!readiness.ready && (
        <p className="text-xs text-[#f5a623]">⚠ Before activating: {readiness.missing.join(" · ")}.</p>
      )}
      {error && <p className="text-xs text-[#D2031E]">{error}</p>}

      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">Last Performance</span>
          <span className={cn("text-sm font-semibold", row.d360 >= 0 ? "text-success" : "text-[#D2031E]")}>
            {signedPct(row.d360)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/my-bots/${row.botId}`}
            className="inline-flex h-10 items-center justify-center rounded-2xl border border-line px-5 text-sm font-semibold text-white transition-colors hover:border-accent hover:text-accent"
          >
            View
          </Link>
          {readiness.ready ? (
            <button
              type="button"
              onClick={activate}
              disabled={pending}
              className="inline-flex h-10 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#121212] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Activating…" : "Activate Bot"}
            </button>
          ) : (
            <Link
              href={`/my-bots/${row.botId}/settings`}
              className="inline-flex h-10 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#121212] transition-opacity hover:opacity-90"
            >
              Set Up
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── KPI card + icons ──────────────────────────────────────────────────── */

function Kpi({ label, value, icon, hint }: { label: string; value: string; icon: React.ReactNode; hint?: string }) {
  return (
    <div className="relative isolate flex flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</span>
      </div>
      <span className="text-2xl font-semibold text-white">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function BotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 4v4M9 13h.01M15 13h.01M9 16h6M2 12v3M22 12v3" />
    </svg>
  );
}
function DollarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v18M16 7.5C16 6 14.5 5 12 5S8 6 8 8s2 2.5 4 3 4 1.5 4 3.5-1.5 3-4 3-4-1-4-2.5" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l6-6 4 4 8-8M21 7h-5M21 7v5" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}
