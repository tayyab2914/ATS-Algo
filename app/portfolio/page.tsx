import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { AreaChart } from "@/components/dashboard/AreaChart";
import { BarChart } from "@/components/dashboard/BarChart";
import { MultiLineChart } from "@/components/dashboard/MultiLineChart";
import { StatsWindowTabs } from "@/components/portfolio/StatsWindowTabs";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { cn } from "@/lib/cn";
import {
  loadPortfolioAnalytics,
  parseStatWindow,
  type MetricSet,
  type PortfolioAnalytics,
  type TradingAnalysis,
} from "@/lib/portfolio/analytics";

export const metadata: Metadata = {
  title: "Portfolio · ATS-ALGO",
};

// ── formatting ───────────────────────────────────────────────────────────────
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}%`;
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const profitFactor = (pf: number | null) => (pf === null ? "∞" : pf.toFixed(2));

/** "1 d. 15 h. 28 min. 30 sec." — omit leading zero units, matching the design. */
function duration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const parts: string[] = [];
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) parts.push(`${d} d.`);
  if (h || d) parts.push(`${h} h.`);
  if (m || h || d) parts.push(`${m} min.`);
  parts.push(`${sec} sec.`);
  return parts.join(" ");
}

type Tone = "pos" | "neg" | "neutral";
const toneOf = (n: number): Tone => (n > 0 ? "pos" : n < 0 ? "neg" : "neutral");
const toneClass = (t: Tone) => (t === "pos" ? "text-success" : t === "neg" ? "text-[#D2031E]" : "text-white");

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ stats?: string }> }) {
  const { session, tier, entitled } = await getPageAccess();
  // Guests can't reach Portfolio — expired ones go to Billing, active ones see
  // the members-only lock below.
  blockExpiredGuest(tier);

  const statsWindow = parseStatWindow((await searchParams).stats);
  const data = session && entitled ? await loadPortfolioAnalytics(session.sub, statsWindow) : null;

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Portfolio</h1>
        <p className="text-sm leading-[21px] text-muted">
          Overview of your entire portfolio performance, wallet, and analytics.
        </p>
      </header>

      {!session ? (
        <GuestGate title="Portfolio" returnTo="/portfolio">
          <TabPreviewSkeleton />
        </GuestGate>
      ) : !entitled ? (
        <SubscriptionGate title="Portfolio">
          <TabPreviewSkeleton />
        </SubscriptionGate>
      ) : data && data.hasBots ? (
        <PortfolioView data={data} statsWindow={statsWindow} />
      ) : (
        <>
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-6 py-20 text-center">
            <h2 className="text-lg font-semibold text-white">Your portfolio is taking shape</h2>
            <p className="max-w-sm text-sm leading-[21px] text-muted">
              Add bots from the library to start tracking performance and analytics here.
            </p>
            <Link
              href="/bot-library"
              className="mt-1 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
            >
              Browse Bot Library
            </Link>
          </div>
          <CustodyNote />
        </>
      )}
    </AppShell>
  );
}

function PortfolioView({ data, statsWindow }: { data: PortfolioAnalytics; statsWindow: PortfolioAnalytics["stats"]["window"] }) {
  return (
    <>
      {!data.hasTrades && (
        <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-3 text-xs text-muted">
          Your bots haven&apos;t closed a trade yet, so every figure below reads zero. Numbers become real the moment the
          engine books a fill.
        </p>
      )}
      <MetricsTable data={data} />
      <StatsSection data={data} statsWindow={statsWindow} />
      <EquitySection data={data} />
      <TradingAnalysisSection analysis={data.analysis} />
      <CustodyNote />
    </>
  );
}

// ── metrics table ────────────────────────────────────────────────────────────
type RowCell = { node: React.ReactNode; tone: Tone };
type Row = { label: string; cell: (m: MetricSet) => RowCell };

const dash: RowCell = { node: "—", tone: "neutral" };

const ROWS: Row[] = [
  { label: "AVG P/L (%)", cell: (m) => (m.hasData ? { node: pct(m.avgPlPct), tone: toneOf(m.avgPlPct) } : dash) },
  {
    label: "P/L",
    cell: (m) => (m.hasData ? { node: `${money(m.plUsd)} · ${pct(m.plPct)}`, tone: toneOf(m.plUsd) } : dash),
  },
  { label: "ROI", cell: (m) => (m.hasData ? { node: pct(m.roiPct), tone: toneOf(m.roiPct) } : dash) },
  {
    label: "Max Loss/Gain (%)",
    cell: (m) =>
      m.hasData
        ? {
            node: (
              <span>
                <span className="text-[#D2031E]">{pct(m.maxLossPct)}</span>
                <span className="text-muted"> / </span>
                <span className="text-success">{pct(m.maxGainPct)}</span>
              </span>
            ),
            tone: "neutral",
          }
        : dash,
  },
  { label: "Volume", cell: (m) => (m.hasData ? { node: money(m.volume), tone: "neutral" } : dash) },
  {
    label: "Trades",
    cell: (m) =>
      m.hasData
        ? { node: `${m.tradesLosses}L · ${m.tradesTotal} · ${m.tradesWins}W`, tone: "neutral" }
        : dash,
  },
  { label: "AVG Time In Trade", cell: (m) => (m.hasData ? { node: duration(m.avgTimeInTradeMs), tone: "neutral" } : dash) },
  {
    label: "Profit Factor",
    cell: (m) => (m.hasData ? { node: profitFactor(m.profitFactor), tone: m.profitFactor === null || m.profitFactor >= 1 ? "pos" : "neg" } : dash),
  },
  { label: "Profit / Volume (%)", cell: (m) => (m.hasData ? { node: pct(m.profitOverVolumePct), tone: toneOf(m.profitOverVolumePct) } : dash) },
  {
    label: "Percent Profitable",
    cell: (m) => (m.hasData ? { node: `${num(m.percentProfitable)}%`, tone: m.percentProfitable >= 50 ? "pos" : "neg" } : dash),
  },
];

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-11 -top-10 size-[102px] rounded-full bg-accent/20 blur-3xl"
      />
      <div className="relative">{children}</div>
    </section>
  );
}

function MetricsTable({ data }: { data: PortfolioAnalytics }) {
  const cols: { key: keyof Pick<PortfolioAnalytics, "allTime" | "month" | "week">; label: string }[] = [
    { key: "allTime", label: "All Time" },
    { key: "month", label: "Month" },
    { key: "week", label: "Week" },
  ];
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="px-4 py-3" />
              {cols.map((c) => (
                <th key={c.key} className="px-4 py-3 text-center text-xs font-semibold text-muted">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 text-sm font-semibold text-white">{row.label}</td>
                {cols.map((c) => {
                  const cell = row.cell(data[c.key]);
                  return (
                    <td key={c.key} className={cn("px-4 py-3 text-center text-sm font-semibold", toneClass(cell.tone))}>
                      {cell.node}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ── stats (three charts + window toggle) ─────────────────────────────────────
function ChartCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative isolate flex flex-1 flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-background p-4">
      <span aria-hidden className="pointer-events-none absolute -left-11 -top-10 size-[102px] rounded-full bg-accent/20 blur-3xl" />
      <div className="relative flex items-center gap-2">
        <span className="h-1 w-3 rounded-full bg-accent" />
        <span className="text-sm text-muted">{label}</span>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function StatsSection({ data, statsWindow }: { data: PortfolioAnalytics; statsWindow: PortfolioAnalytics["stats"]["window"] }) {
  const { stats } = data;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Stats</h2>
        <StatsWindowTabs active={statsWindow} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ChartCard label="P/L (%)">
          <BarChart values={stats.plPct} labels={stats.labels} />
        </ChartCard>
        <ChartCard label="Cumulative P/L (%)">
          <MultiLineChart series={[{ label: "Cumulative P/L %", color: "#28B8D5", points: stats.cumulativePct }]} labels={stats.labels} height={256} />
        </ChartCard>
        <ChartCard label="Open Positions">
          <BarChart values={stats.openCounts} labels={stats.labels} negColor="#28B8D5" />
        </ChartCard>
      </div>
    </Panel>
  );
}

// ── monthly equity + cumulative pnl ──────────────────────────────────────────
function EquitySection({ data }: { data: PortfolioAnalytics }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel>
        <h2 className="mb-4 text-base font-semibold text-white">Monthly Equity</h2>
        <MultiLineChart
          series={[{ label: "Total PnL %", color: "#23E774", points: data.monthlyEquity.totalPnlPct }]}
          labels={data.monthlyEquity.labels}
        />
      </Panel>
      <Panel>
        <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
          <span className="h-1 w-3 rounded-full bg-accent" />
          Cumulative PnL
        </h2>
        <AreaChart points={data.cumulativePnl.curve} />
        <div className="mt-2 flex justify-between text-[11px] text-muted">
          {data.cumulativePnl.labels.map((l, i) => (
            <span key={`${l}-${i}`} className="flex-1 text-center">
              {l}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ── trading analysis ─────────────────────────────────────────────────────────
function TradingAnalysisSection({ analysis }: { analysis: TradingAnalysis }) {
  const rows: { label: string; node: React.ReactNode; tone: Tone }[] = [
    { label: "Trading Volume", node: num(analysis.volume), tone: "neutral" },
    { label: "Closed Orders", node: String(analysis.closedOrders), tone: "neutral" },
    { label: "Winning Closed Orders", node: String(analysis.winningClosed), tone: "neutral" },
    { label: "Win Rate Of Closed Orders", node: analysis.closedOrders ? `${num(analysis.winRate)}%` : "—", tone: "neutral" },
    { label: "PnL of Closed Long Orders", node: analysis.closedOrders ? money(analysis.pnlLong) : "—", tone: toneOf(analysis.pnlLong) },
    { label: "PnL of Closed Short Orders", node: analysis.closedOrders ? money(analysis.pnlShort) : "—", tone: toneOf(analysis.pnlShort) },
  ];
  return (
    <Panel>
      <h2 className="mb-2 text-base font-semibold text-white">Trading Analysis</h2>
      <div className="flex flex-col">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between border-b border-line/60 py-4 last:border-0">
            <span className="text-sm text-white">{r.label}</span>
            <span className={cn("text-sm font-semibold", toneClass(r.tone))}>{r.node}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * The spec asks for a "deposit funds" wallet here. It also says, in capitals, NO
 * WALLET CONNECTION — because holding member funds is what creates liability. Both
 * cannot be true, so nothing that takes custody is built. This states the model
 * instead, which is also the honest answer to "where is my money?".
 */
function CustodyNote() {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-base font-semibold text-white">Where your funds live</h2>
      <p className="text-sm leading-[21px] text-muted">
        ATS-ALGO never holds your money. Your capital stays in your own exchange account, and bots trade it through the
        API key you connect — a key that can trade but{" "}
        <span className="text-white">cannot withdraw</span>. Nothing is deposited here, so there is nothing for us to
        lose or freeze.
      </p>
      <p className="text-sm leading-[21px] text-muted">
        The subscription is billed separately through Stripe.{" "}
        <Link href="/billing" className="font-semibold text-accent hover:underline">
          Manage billing
        </Link>
      </p>
    </section>
  );
}
