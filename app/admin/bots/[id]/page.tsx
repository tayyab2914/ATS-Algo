import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { PencilIcon } from "@/components/admin/admin-icons";
import { BotExecutionPanel } from "@/components/admin/BotExecutionPanel";
import { ExchangePills } from "@/components/admin/ExchangePills";
import { SignalSettings } from "@/components/admin/SignalSettings";
import { TradingViewSetup } from "@/components/admin/TradingViewSetup";
import { EquityChart } from "@/components/bot-library/EquityChart";
import { RISK_TO_PROFILE, type BotConfig } from "@/lib/backtest/engine";
import { buildBotEquity } from "@/lib/backtest/equity-view";
import { configAtrValue, ratchetPct } from "@/lib/bot-config";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/db";
import { parseSignalMap } from "@/lib/execution/signal-map";
import { signalSecret } from "@/lib/execution/signal-secret";
import { RISK_LABEL, RISK_TEXT_CLASS, riskBadgeClass } from "@/lib/risk";

const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
const tone = (x: number): Tone => (x >= 0 ? "success" : "danger");

export default async function ViewBotPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const { id } = await params;
  // Select only what this view renders — notably skipping the heavy `results`
  // JSON, which is never read here.
  const bot = await prisma.bot.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      ticker: true,
      exchange: true,
      exchanges: true,
      assetType: true,
      category: true,
      riskClass: true,
      config: true,
      signalMap: true,
      csvData: true,
      trades: true,
      winRate: true,
      profitFactor: true,
      totalReturn: true,
      d30: true,
      d90: true,
      d180: true,
      d360: true,
      revisions: {
        orderBy: { createdAt: "desc" },
        select: { id: true, message: true, createdAt: true },
      },
    },
  });
  if (!bot) notFound();

  const config = bot.config as unknown as BotConfig;
  const riskKey = RISK_TO_PROFILE[bot.riskClass];
  const profile = config.profiles?.[riskKey];
  const tps = profile?.tp ?? [];
  const weights = profile?.w ?? [];

  const subtitle = [bot.ticker, bot.assetType ?? bot.category].filter(Boolean).join(" · ");

  const statCards: Stat[] = [
    { label: "30 Days Performance", value: signedPct(bot.d30), tone: tone(bot.d30) },
    { label: "90 Days Performance", value: signedPct(bot.d90), tone: tone(bot.d90) },
    { label: "180 Days Performance", value: signedPct(bot.d180), tone: tone(bot.d180) },
    { label: "360 Days Performance", value: signedPct(bot.d360), tone: tone(bot.d360) },
    { label: "Winrate", value: `${bot.winRate.toFixed(1)}%` },
    { label: "Profit Factor", value: bot.profitFactor.toFixed(2) },
  ];

  const equity = bot.csvData ? buildBotEquity(config, bot.csvData, riskKey) : null;

  // Mirrors what the member sees on /bot-library/[id] — same names, so an admin
  // reading this page is reading the page their members read.
  const atr = configAtrValue(config);
  const tighten = profile ? ratchetPct(profile) : null;
  const breakEven: Stat = tighten
    ? { label: "Break-even System", value: `${tighten}% / TP`, tone: "success" }
    : profile?.be
      ? { label: "Break-even System", value: `From TP${profile.be}`, tone: "success" }
      : { label: "Break-even System", value: "Off" };

  const metrics: Stat[] = [
    { label: "Stop Loss", value: profile?.sl != null ? `${profile.sl}%` : "—", tone: "danger" },
    { label: "TP Levels", value: tps.length ? `${tps.length} levels` : "—" },
    breakEven,
    { label: "ATR Value", value: atr != null ? String(atr) : "—" },
    { label: "Leverage", value: profile?.lev != null ? `${profile.lev}x` : "—" },
    { label: "Trade Count", value: bot.trades.toLocaleString("en-US") },
    { label: "Winrate", value: `${bot.winRate.toFixed(1)}%`, tone: "success" },
    { label: "Net Profit", value: signedPct(bot.totalReturn), tone: tone(bot.totalReturn) },
    { label: "Maximum Drawdown", value: equity ? `-${equity.maxDrawdown.toFixed(1)}%` : "—", tone: "danger" },
  ];

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="bots" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/admin/bots" className="text-xs text-muted transition-colors hover:text-accent">
            ← Back to Bot Management
          </Link>
          <Link
            href={`/admin/bots/${bot.id}/edit`}
            className="inline-flex items-center gap-2 rounded-xl border border-accent px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
          >
            <PencilIcon className="size-4" />
            Edit
          </Link>
        </div>

        {/* title */}
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white sm:text-3xl">{bot.name}</h1>
          <p className="text-sm leading-[21px] text-muted">
            {subtitle || "—"} · <span className={cn("font-semibold", RISK_TEXT_CLASS[bot.riskClass])}>{RISK_LABEL[bot.riskClass]}</span> risk
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Runs on</span>
            <ExchangePills exchanges={bot.exchanges} />
          </div>
        </header>

        {/* headline stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {statCards.map((c) => (
            <StatTile key={c.label} {...c} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <BotExecutionPanel botId={bot.id} botName={bot.name} />
          <TradingViewSetup
            webhookUrl={`${process.env.APP_URL ?? ""}/api/signals/${bot.id}`}
            // One value for every bot, read straight from the server environment:
            // it is entered once in the indicator's settings, not per alert. This
            // page is admin-only, which is the only reason it can be shown at all.
            secret={signalSecret()}
            // Straight from the profile this bot trades, so the alert it tells you to
            // paste always describes the ladder the executor will actually place.
            profile={profile ? { tp: profile.tp, sl: profile.sl, be: profile.be, lev: profile.lev, sl_tighten_pct: profile.sl_tighten_pct } : null}
            riskLabel={RISK_LABEL[bot.riskClass]}
          />
        </div>

        {/* The words this bot's alerts use — and the bodies to paste, generated from them. */}
        <SignalSettings
          botId={bot.id}
          secret={signalSecret()}
          initial={parseSignalMap(bot.signalMap)}
          tpRungs={tps.length}
        />


        {/* equity */}
        {equity ? (
          <EquityChart
            curve={equity.curve}
            months={equity.months}
            periods={[
              { key: "30", label: "30D", points: 3, value: signedPct(bot.d30) },
              { key: "90", label: "90D", points: 4, value: signedPct(bot.d90) },
              { key: "180", label: "180D", points: 6, value: signedPct(bot.d180) },
              { key: "360", label: "360D", points: equity.curve.length, value: signedPct(bot.d360) },
            ]}
          />
        ) : (
          <section className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
            Not enough trade history to chart the equity curve.
          </section>
        )}

        {/* trade profile + trading metrics, side by side */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* trade profile */}
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-white">Trade Profile</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-70 border-collapse">
              <thead>
                <tr className="border-b border-line text-xs font-semibold text-muted">
                  <th className="px-2 py-3 text-left">Take Profit</th>
                  <th className="px-2 py-3 text-left">Target</th>
                  <th className="px-2 py-3 text-right">Allocation</th>
                </tr>
              </thead>
              <tbody>
                {tps.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-center text-sm text-muted">
                      No take-profit ladder in this bot&apos;s config.
                    </td>
                  </tr>
                ) : (
                  tps.map((target, i) => (
                    <tr key={i} className="border-b border-line last:border-b-0">
                      <td className="px-2 py-4 text-sm font-semibold text-white">Take profit {i + 1}</td>
                      <td className="px-2 py-4 text-sm font-semibold text-success">{target}%</td>
                      <td className="px-2 py-4 text-right text-sm text-muted">
                        {Math.round((weights[i] ?? 0) * 100)}% of assets
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* trading metrics */}
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-base font-semibold text-white">Bot Trading Metrics</h2>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", riskBadgeClass(bot.riskClass))}>
              {RISK_LABEL[bot.riskClass]} profile
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {metrics.map((m) => (
              <StatTile key={m.label} {...m} />
            ))}
          </div>
        </section>
        </div>

        {/* strategy update / change log */}
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <h2 className="mb-5 text-base font-semibold text-white">Strategy Update</h2>
          {bot.revisions.length === 0 ? (
            <p className="text-sm text-muted">No changes recorded yet.</p>
          ) : (
            <ol className="flex flex-col">
              {bot.revisions.map((r, i) => {
                const last = i === bot.revisions.length - 1;
                const first = i === 0;
                const version = `v${bot.revisions.length - i}`;
                const date = r.createdAt.toLocaleString("en-US", { month: "short", year: "numeric" });
                return (
                  <li key={r.id} className="relative flex gap-4 pb-6 last:pb-0">
                    {!last && <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-line" />}
                    <span
                      aria-hidden
                      className={cn(
                        "relative z-[1] mt-1 size-2.5 shrink-0 rounded-full",
                        first ? "bg-accent shadow-[0_0_8px_rgba(40,184,213,0.7)]" : "bg-line",
                      )}
                    />
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm text-white">
                        <span className="font-mono font-semibold text-accent">{version}</span>{" "}
                        <span className="font-semibold">— {r.message}</span>
                      </p>
                      <span className="text-xs text-muted">{date}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

type Tone = "default" | "success" | "danger";
type Stat = { label: string; value: string; tone?: Tone };

const TONE: Record<Tone, string> = {
  default: "text-white",
  success: "text-success",
  danger: "text-[#D2031E]",
};

function StatTile({ label, value, tone = "default" }: Stat) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-background p-4">
      <span className="text-xs leading-[18px] text-muted">{label}</span>
      <span className={cn("text-lg font-semibold leading-6", TONE[tone])}>{value}</span>
    </div>
  );
}
