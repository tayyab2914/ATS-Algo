import Link from "next/link";
import type { ReactNode } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BotIcon, ClockIcon, GiftIcon, ShieldUsersIcon, ToggleIcon, UserIcon } from "@/components/admin/admin-icons";
import { cn } from "@/lib/cn";

const RISK_LABEL = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

export type SignupType = "member" | "guest";

export type EngineHealth = {
  /** Distinct bots a member has deployed AND switched on. */
  runningBots: number;
  totalDeployments: number;
  openPositions: number;
  signals24h: number;
  failures24h: number;
  /** Deployments armed to trade REAL money. */
  liveArmed: number;
  recent: { id: string; level: string; event: string; message: string; at: string }[];
};

export type AdminOverviewData = {
  /** Bots listed in the library. Says nothing about whether anyone runs them. */
  publishedBots: number;
  totalBots: number;
  engine: EngineHealth;
  users: number;
  subscribers: number;
  newSignups: number;
  byCategory: { name: string; count: number }[];
  byRisk: { risk: "LOW" | "MEDIUM" | "HIGH"; count: number }[];
  topBots: { id: string; name: string; category: string; winRate: number; profitFactor: number; d30: number }[];
  revisions: { id: string; botId: string; botName: string; message: string; date: string }[];
  signups: { id: string; name: string; date: string; type: SignupType }[];
  /** Members waiting on an access decision. Replaced the churn card: with nothing
   *  to buy there is no past-due or non-renewal to chase, but there IS a queue. */
  requests: {
    pending: number;
    recent: { id: string; name: string; email: string; date: string }[];
  };
};

const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

export function AdminOverview({ data }: { data: AdminOverviewData }) {
  const disabledBots = Math.max(0, data.totalBots - data.publishedBots);
  const { engine } = data;

  return (
    <div className="flex flex-col gap-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Published Bots" value={String(data.publishedBots)} sub={`of ${data.totalBots} total`} Icon={ToggleIcon} />
        <KpiTile label="Users" value={data.users.toLocaleString("en-US")} Icon={ShieldUsersIcon} />
        <KpiTile label="Members with Access" value={data.subscribers.toLocaleString("en-US")} Icon={GiftIcon} />
        <KpiTile label="New Signups" value={data.newSignups.toLocaleString("en-US")} sub="last 30 days" Icon={UserIcon} />
      </div>

      {/* Execution engine — the only view an operator has of what is actually trading. */}
      <AdminCard
        title="Execution engine"
        subtitle="What is running right now, and what went wrong in the last 24 hours."
      >
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MiniStat label="Running bots" value={engine.runningBots} tone={engine.runningBots ? "success" : "muted"} Icon={BotIcon} />
            <MiniStat label="Deployments" value={engine.totalDeployments} tone="muted" Icon={BotIcon} />
            <MiniStat label="Open positions" value={engine.openPositions} tone={engine.openPositions ? "success" : "muted"} Icon={BotIcon} />
            <MiniStat label="Signals (24h)" value={engine.signals24h} tone="muted" Icon={BotIcon} />
            <MiniStat label="Errors (24h)" value={engine.failures24h} tone={engine.failures24h ? "danger" : "muted"} Icon={BotIcon} />
          </div>

          {/* Real money. Never let this be something an operator has to go looking for. */}
          <div
            className={cn(
              "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
              engine.liveArmed > 0 ? "border-[#D2031E]/40 bg-[#D2031E]/10" : "border-line bg-background",
            )}
          >
            <div className="flex flex-col">
              <span className={cn("text-sm font-semibold", engine.liveArmed > 0 ? "text-[#D2031E]" : "text-white")}>
                {engine.liveArmed > 0
                  ? `${engine.liveArmed} deployment${engine.liveArmed === 1 ? "" : "s"} armed for real money`
                  : "No deployment is armed for live trading"}
              </span>
              <span className="text-xs text-muted">
                A signal places real orders only where a member has explicitly armed a live key.
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted">Recent warnings and errors</span>
            {engine.recent.length === 0 ? (
              <p className="text-sm text-muted">Nothing to report.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {engine.recent.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
                    <div className="flex min-w-0 flex-col">
                      <span className={cn("truncate text-xs font-medium", entry.level === "error" ? "text-[#D2031E]" : "text-[#F5A524]")}>
                        {entry.message}
                      </span>
                      <span className="font-mono text-[10px] text-muted">{entry.event}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted">{entry.at}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </AdminCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Bots overview */}
        <AdminCard title="Bots overview" subtitle="Health and best performers across the catalogue.">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Published" value={data.publishedBots} tone="success" Icon={BotIcon} />
              <MiniStat label="Disabled" value={disabledBots} tone="muted" Icon={BotIcon} />
            </div>

            <Breakdown title="By category" items={data.byCategory.map((c) => ({ label: c.name, count: c.count }))} />
            <Breakdown
              title="By risk"
              items={data.byRisk.map((r) => ({ label: RISK_LABEL[r.risk], count: r.count }))}
            />

            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted">Top performers</p>
              {data.topBots.length === 0 ? (
                <p className="text-sm text-muted">No bots yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs font-semibold text-muted">
                        <th className="px-3 py-2">Bot</th>
                        <th className="px-3 py-2 text-center">Win</th>
                        <th className="px-3 py-2 text-center">PF</th>
                        <th className="px-3 py-2 text-center">30D</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topBots.map((b) => (
                        <tr key={b.id} className="border-b border-line/60 last:border-0">
                          <td className="px-3 py-2.5">
                            <Link href={`/admin/bots/${b.id}`} className="font-semibold text-white transition-colors hover:text-accent">
                              {b.name}
                            </Link>
                            <span className="block text-xs text-muted">{b.category}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-white">{b.winRate.toFixed(1)}%</td>
                          <td className="px-3 py-2.5 text-center text-white">{b.profitFactor.toFixed(2)}</td>
                          <td className={cn("px-3 py-2.5 text-center font-semibold", b.d30 >= 0 ? "text-success" : "text-[#D2031E]")}>
                            {pct(b.d30)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </AdminCard>

        {/* Recent activity */}
        <AdminCard title="Recent activity" subtitle="Latest strategy updates and new members.">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-muted">
                <ClockIcon className="size-4" /> Strategy updates
              </p>
              {data.revisions.length === 0 ? (
                <p className="text-sm text-muted">No bot changes recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.revisions.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col">
                        <Link href={`/admin/bots/${r.botId}`} className="truncate text-sm font-semibold text-white transition-colors hover:text-accent">
                          {r.botName}
                        </Link>
                        <span className="truncate text-xs text-muted">{r.message}</span>
                      </div>
                      <span className="shrink-0 text-xs text-muted">{r.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-line pt-5">
              <p className="flex items-center gap-2 text-xs font-semibold text-muted">
                <UserIcon className="size-4" /> New signups
              </p>
              {data.signups.length === 0 ? (
                <p className="text-sm text-muted">No signups yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.signups.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-white">{s.name}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            s.type === "member" ? "bg-accent/10 text-accent" : "bg-muted/15 text-muted",
                          )}
                        >
                          {s.type === "member" ? "Member" : "Guest"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{s.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </AdminCard>
      </div>

      {/* Access requests */}
      <AdminCard
        title="Access requests"
        subtitle="Members who have asked for access and are waiting on a decision."
      >
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MiniStat
              label="Pending"
              value={data.requests.pending}
              tone={data.requests.pending > 0 ? "warning" : "muted"}
              Icon={ClockIcon}
            />
            <MiniStat label="With access" value={data.subscribers} tone="success" Icon={GiftIcon} />
          </div>

          {data.requests.recent.length === 0 ? (
            <p className="text-sm text-muted">Nobody is waiting — the queue is clear.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted">Waiting longest</p>
                <Link href="/admin/management" className="text-xs font-semibold text-accent hover:underline">
                  Review in Members
                </Link>
              </div>
              <ul className="flex flex-col gap-3">
                {data.requests.recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-white">{r.name}</span>
                      <span className="truncate text-xs text-muted">{r.email}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-[#F4A825]/10 px-2 py-0.5 text-[11px] font-semibold text-[#F4A825]">
                        Pending
                      </span>
                      <span className="text-xs text-muted">{r.date}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </AdminCard>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  Icon: (p: { className?: string }) => ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs leading-[18px] text-muted">{label}</span>
        <span className="text-2xl font-semibold leading-7 text-white">{value}</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="size-5" />
      </span>
    </div>
  );
}

const MINISTAT_TONE = {
  success: "bg-success/10 text-success",
  muted: "bg-muted/10 text-muted",
  danger: "bg-[#D2031E]/10 text-[#D2031E]",
  warning: "bg-[#F4A825]/10 text-[#F4A825]",
} as const;

function MiniStat({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: keyof typeof MINISTAT_TONE;
  Icon: (p: { className?: string }) => ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-background p-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", MINISTAT_TONE[tone])}>
        <Icon className="size-5" />
      </span>
      <div className="flex flex-col">
        <span className="text-lg font-semibold leading-6 text-white">{value}</span>
        <span className="text-xs text-muted">{label}</span>
      </div>
    </div>
  );
}

function Breakdown({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-muted">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <span
            key={it.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-background px-2.5 py-1 text-xs text-white"
          >
            {it.label}
            <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">{it.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
