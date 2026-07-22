import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BotEditor, type BotEditorData } from "@/components/admin/BotEditor";
import { type BacktestResult, type BotConfig } from "@/lib/backtest/engine";
import { getCategoryNames } from "@/lib/categories";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Edit Bot · ATS-ALGO",
};

export default async function EditBotPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const { id } = await params;
  // Deliberately no `csvData` — it can be megabytes per bot, and handing it to a
  // client component put the whole file in the RSC payload on every load. The
  // editor fetches it from /api/admin/bots/[id]/csv only when a re-run needs it.
  // `results` carries the stored metrics so the editor can show them on mount
  // without re-simulating the CSV it no longer has.
  const [bot, categories] = await Promise.all([
    prisma.bot.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        category: true,
        timeframe: true,
        exchange: true,
        exchanges: true,
        riskClass: true,
        status: true,
        csvFilename: true,
        config: true,
        results: true,
      },
    }),
    getCategoryNames(),
  ]);
  if (!bot) notFound();

  const data: BotEditorData = {
    id: bot.id,
    name: bot.name,
    category: bot.category,
    timeframe: bot.timeframe,
    exchanges: bot.exchanges.length ? bot.exchanges : bot.exchange ? [bot.exchange] : [],
    riskClass: bot.riskClass,
    status: bot.status,
    csvFilename: bot.csvFilename,
    config: bot.config as unknown as BotConfig,
    initialResult: (bot.results as unknown as BacktestResult | null) ?? null,
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="bots" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <Link href="/admin/bots" className="text-xs text-muted transition-colors hover:text-accent">
            ← Back to Bot Management
          </Link>
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Edit Bot</h1>
          <p className="text-sm leading-[21px] text-muted">Update the config or signals, re-run the backtest, and save with a change note.</p>
        </header>

        <BotEditor bot={data} categories={categories} />
      </main>
    </div>
  );
}
