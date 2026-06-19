import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BotWizard } from "@/components/admin/BotWizard";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Add New Bot · ATS-ALGO",
};

export default async function NewBotPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="bots" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <Link href="/admin/bots" className="text-xs text-muted transition-colors hover:text-accent">
            ← Back to Bot Management
          </Link>
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Add New Bot</h1>
          <p className="text-sm leading-[21px] text-muted">Upload a config and signals, backtest, then save.</p>
        </header>

        <BotWizard />
      </main>
    </div>
  );
}
