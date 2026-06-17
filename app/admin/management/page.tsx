import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AddTeamMember } from "@/components/admin/AddTeamMember";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { MembersTable, type MemberRow, type MemberSubscription } from "@/components/admin/MembersTable";
import { PermissionsControl } from "@/components/admin/PermissionsControl";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getSession, hasLiveSession } from "@/lib/auth/session";
import { hasActiveSubscription } from "@/lib/billing";
import { prisma } from "@/lib/db";
import type { SubscriptionModel } from "@/lib/generated/prisma/models";

export const metadata: Metadata = {
  title: "Admin Management · ATS-ALGO",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Collapse a subscription row into the pill the members table shows. */
function toSubscriptionView(sub: SubscriptionModel | null): MemberSubscription {
  if (!sub) return { label: "Free", active: false, isComp: false };

  // Comp grants have no Stripe webhook to flip their status, so honour the
  // granted end date here; paid plans are driven by their synced Stripe status.
  const active = sub.isComp
    ? sub.status === "ACTIVE" && (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date())
    : hasActiveSubscription(sub.status);

  if (sub.isComp) {
    return { label: active ? "Free grant" : "Free (ended)", active, isComp: true };
  }
  return { label: sub.plan === "YEARLY" ? "Yearly" : "Monthly", active, isComp: false };
}

export default async function AdminManagementPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { subscription: true },
  });

  const members: MemberRow[] = users.map((user) => ({
    id: user.id,
    name: user.name?.trim() || user.email.split("@")[0],
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    status: user.status,
    loggedIn: hasLiveSession(user),
    joined: formatDate(user.createdAt),
    subscription: toSubscriptionView(user.subscription),
  }));

  return (
    <div className="flex min-h-screen w-full bg-background text-white">
      <AdminSidebar active="management" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold leading-[31px] text-white">Admin Management</h1>
            <p className="text-sm leading-[21px] text-muted">
              Manage team members, roles, and access permissions.
            </p>
          </div>
          <LogoutButton redirectTo="/admin" />
        </header>

        <MembersTable members={members} />
        <AddTeamMember />
        <PermissionsControl />
      </main>
    </div>
  );
}
