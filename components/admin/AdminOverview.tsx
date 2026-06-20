import Link from "next/link";
import type { ReactNode } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BotIcon, ClockIcon, GiftIcon, ShieldUsersIcon, ToggleIcon, UserIcon } from "@/components/admin/admin-icons";
import { cn } from "@/lib/cn";

const RISK_LABEL = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

export type AdminOverviewData = {
  activeBots: number;
  totalBots: number;
  users: number;
  subscribers: number;
  newSignups: number;
  byCategory: { name: string; count: number }[];
  byRisk: { risk: "LOW" | "MEDIUM" | "HIGH"; count: number }[];
  topBots: { id: string; name: string; category: string; winRate: number; profitFactor: number; d30: number }[];
  revisions: { id: string; botId: string; botName: string; message: string; date: string }[];
  signups: { id: string; name: string; date: string }[];
};

const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

export function AdminOverview({ data }: { data: AdminOverviewData }) {
  const disabledBots = Math.max(0, data.totalBots - data.activeBots);

  return (
    <div className="flex flex-col gap-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Active Bots" value={String(data.activeBots)} sub={`of ${data.totalBots} total`} Icon={ToggleIcon} />
        <KpiTile label="Users" value={data.users.toLocaleString("en-US")} Icon={ShieldUsersIcon} />
        <KpiTile label="Paying Subscribers" value={data.subscribers.toLocaleString("en-US")} Icon={GiftIcon} />
        <KpiTile label="New Signups" value={data.newSignups.toLocaleString("en-US")} sub="last 30 days" Icon={UserIcon} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Bots overview */}
        <AdminCard title="Bots overview" subtitle="Health and best performers across the catalogue.">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Active" value={data.activeBots} tone="success" Icon={BotIcon} />
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
                      <span className="truncate text-sm text-white">{s.name}</span>
                      <span className="shrink-0 text-xs text-muted">{s.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </AdminCard>
      </div>
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

function MiniStat({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "success" | "muted";
  Icon: (p: { className?: string }) => ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-background p-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tone === "success" ? "bg-success/10 text-success" : "bg-muted/10 text-muted",
        )}
      >
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
