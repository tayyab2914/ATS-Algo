import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { PlusIcon } from "@/components/admin/admin-icons";
import { BotsBrowser } from "@/components/admin/BotsBrowser";
import { type BotTableRow } from "@/components/admin/BotsTable";
import { getCategoryNames } from "@/lib/categories";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Bot Management · ATS-ALGO",
};

export default async function BotManagementPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  // Select only the table columns. Crucially this skips `csvData` (raw signal
  // CSV — can be megabytes per bot), `config` and `results` (JSON), which the
  // list never shows but `findMany` would otherwise ship for every row.
  const [rows, categories]: [BotTableRow[], string[]] = await Promise.all([
    prisma.bot.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        ticker: true,
        timeframe: true,
        riskClass: true,
        status: true,
        trades: true,
        winRate: true,
        profitFactor: true,
        d30: true,
        d90: true,
        d180: true,
        d360: true,
        avgTrade: true,
      },
    }),
    getCategoryNames(),
  ]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="bots" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Management</h1>
            <p className="text-sm leading-[21px] text-muted">Create, backtest, and manage trading bots.</p>
          </div>
          <Link
            href="/admin/bots/new"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-[#06141a] transition-colors hover:opacity-90"
          >
            <PlusIcon className="size-4" />
            Create Bot
          </Link>
        </header>

        <BotsBrowser bots={rows} categories={categories} />
      </main>
    </div>
  );
}
