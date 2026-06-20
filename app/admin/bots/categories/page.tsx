import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { CategoryManager, type CategoryRow } from "@/components/admin/CategoryManager";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Categories · ATS-ALGO",
};

export default async function CategoriesPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const [categories, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.bot.groupBy({ by: ["category"], _count: { _all: true } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.category, c._count._all]));
  const rows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    botCount: countMap.get(c.name) ?? 0,
  }));

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="bots" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <Link href="/admin/bots" className="text-xs text-muted transition-colors hover:text-accent">
            ← Back to Bot Management
          </Link>
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Update Categories</h1>
          <p className="text-sm leading-[21px] text-muted">Manage the categories bots can be filed under.</p>
        </header>

        <CategoryManager categories={rows} />
      </main>
    </div>
  );
}
