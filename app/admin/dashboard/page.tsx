import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BotCycleTable } from "@/components/admin/BotCycleTable";
import { BotMenu } from "@/components/admin/BotMenu";
import { DateStatusPanel } from "@/components/admin/DateStatusPanel";
import { UploadHistoryTable } from "@/components/admin/UploadHistoryTable";
import { UploadMetricsCard } from "@/components/admin/UploadMetricsCard";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Admin Staging Dashboard · ATS-ALGO",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const [uploads, total] = await Promise.all([
    prisma.metricUpload.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.metricUpload.count(),
  ]);

  const latest = uploads[0];
  const stats = {
    lastUpload: latest ? formatDate(latest.createdAt) : "—",
    version: latest ? latest.version : "v00",
    syncStatus: total > 0 ? "Synced" : "—",
    totalUploads: total,
  };
  const history = uploads.map((u) => ({
    filename: u.filename,
    date: formatDate(u.createdAt),
    version: u.version,
    status: u.status as "SUCCESS" | "FAILED",
  }));

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="dashboard" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Admin Staging Dashboard</h1>
          <p className="text-sm leading-[21px] text-muted">Manage platform data and update trading metrics.</p>
        </header>

        <UploadMetricsCard />
        <BotCycleTable />
        <BotMenu />
        <DateStatusPanel stats={stats} />
        <UploadHistoryTable rows={history} />
      </main>
    </div>
  );
}
