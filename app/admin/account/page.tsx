import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminAccountSection } from "@/components/admin/AdminAccountSection";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Account Management · ATS-ALGO",
};

export default async function AdminAccountPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { name: true, email: true, avatarUrl: true },
  });
  if (!user) redirect("/admin");

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="account" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Account Management</h1>
          <p className="text-sm leading-[21px] text-muted">Manage your admin profile and personal details.</p>
        </header>

        <AdminAccountSection
          initial={{ name: user.name ?? "", email: user.email, avatarUrl: user.avatarUrl }}
        />
      </main>
    </div>
  );
}
