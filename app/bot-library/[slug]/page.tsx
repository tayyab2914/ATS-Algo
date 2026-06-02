import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { AddToMyBotsButton } from "@/components/bot-library/AddToMyBotsButton";
import { EquityChart } from "@/components/bot-library/EquityChart";
import { getSession } from "@/lib/auth/session";
import { getBotDetail, type StatTone } from "@/lib/bot-library";
import { cn } from "@/lib/cn";

const TONE: Record<StatTone, string> = {
  default: "text-white",
  success: "text-success",
  danger: "text-[#D2031E]",
};

export async function generateMetadata({ params }: PageProps<"/bot-library/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const detail = getBotDetail(slug);
  return { title: detail ? `${detail.row.name} · Bot Library` : "Bot Library" };
}

function StatTile({ label, value, tone = "default" }: { label: string; value: string; tone?: StatTone }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-4">
      <span className="text-xs leading-[18px] text-muted">{label}</span>
      <span className={cn("text-lg font-semibold leading-6", TONE[tone])}>{value}</span>
    </div>
  );
}

function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function BotDetailPage({ params }: PageProps<"/bot-library/[slug]">) {
  const { slug } = await params;
  const detail = getBotDetail(slug);
  if (!detail) notFound();

  const session = await getSession();

  return (
    <AppShell>
      {/* top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/bot-library"
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-white"
        >
          <BackArrow />
          Back to Library
        </Link>
        <AddToMyBotsButton slug={detail.row.slug} authed={!!session} />
      </div>

      {/* title */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white sm:text-3xl">{detail.row.name}</h1>
        <p className="text-sm leading-[21px] text-muted">{detail.subtitle}</p>
      </header>

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {detail.statCards.map((card) => (
          <StatTile key={card.label} {...card} />
        ))}
      </div>

      {/* equity */}
      <EquityChart curve={detail.equityCurve} safe={detail.equitySafe} months={detail.equityMonths} />

      {/* trade profile */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Trade Profile</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr className="border-b border-line text-xs font-semibold text-muted">
                <th className="px-2 py-3 text-left">Take Profit</th>
                <th className="px-2 py-3 text-left">Target</th>
                <th className="px-2 py-3 text-right">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {detail.tradeProfile.map((tp) => (
                <tr key={tp.label} className="border-b border-line last:border-b-0">
                  <td className="px-2 py-4 text-sm font-semibold text-white">{tp.label}</td>
                  <td className="px-2 py-4 text-sm font-semibold text-success">{tp.target}</td>
                  <td className="px-2 py-4 text-right text-sm text-muted">{tp.allocation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* trading metrics */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">Bot Trading Metrics</h2>
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            360-Day-Period
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {detail.metrics.map((m) => (
            <StatTile key={m.label} {...m} />
          ))}
        </div>
      </section>

      {/* strategy timeline */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-5 text-base font-semibold text-white">Strategy Update</h2>
        <ol className="flex flex-col">
          {detail.updates.map((u, i) => {
            const last = i === detail.updates.length - 1;
            const first = i === 0;
            return (
              <li key={u.version} className="relative flex gap-4 pb-6 last:pb-0">
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
                    <span className="font-mono font-semibold text-accent">{u.version}</span>{" "}
                    <span className="font-semibold">— {u.title}</span>
                  </p>
                  <span className="text-xs text-muted">{u.date}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </AppShell>
  );
}
