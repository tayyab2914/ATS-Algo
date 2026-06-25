import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AddTeamMember } from "@/components/admin/AddTeamMember";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { MembersTable, type MemberRow, type MemberSubscription } from "@/components/admin/MembersTable";
import { isSuperAdminEmail } from "@/lib/auth/account";
import { getSession, hasLiveSession } from "@/lib/auth/session";
import { hasActiveSubscription } from "@/lib/billing";
import { prisma } from "@/lib/db";
import type { SubscriptionModel } from "@/lib/generated/prisma/models";
import { guestTrialFrom } from "@/lib/guest";

export const metadata: Metadata = {
  title: "Members Management · ATS-ALGO",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The subscription columns the members pill is derived from. */
type SubscriptionView = Pick<SubscriptionModel, "plan" | "status" | "currentPeriodEnd" | "isComp">;

/** Collapse a subscription row into the pill the members table shows. */
function toSubscriptionView(sub: SubscriptionView | null): MemberSubscription {
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

  const isSuperAdmin = isSuperAdminEmail(session.email);

  // Select only what the row mapping needs, instead of whole user rows (which
  // would pull passwordHash, stripeCustomerId, etc. for every member).
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      sessionsValidFrom: true,
      createdAt: true,
      guestExpiresAt: true,
      subscription: {
        select: { plan: true, status: true, currentPeriodEnd: true, isComp: true },
      },
    },
  });

  const members: MemberRow[] = users.map((user) => {
    const subscription = toSubscriptionView(user.subscription);
    // A non-admin without active access is a Guest. Surface their trial state so
    // admins can tell explorers from paying members at a glance.
    const isPaying = user.role === "ADMIN" || subscription.active;
    const trial = guestTrialFrom(user.guestExpiresAt ?? null);
    return {
      id: user.id,
      name: user.name?.trim() || user.email.split("@")[0],
      email: user.email,
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
      status: user.status,
      loggedIn: hasLiveSession(user),
      joined: formatDate(user.createdAt),
      subscription,
      guest: isPaying ? null : { state: trial.state, daysLeft: trial.daysLeft },
      // The acting admin's own row (no self-targeting) and the protected superadmin.
      isSelf: user.id === session.sub,
      isProtected: isSuperAdminEmail(user.email),
    };
  });

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="management" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Members Management</h1>
          <p className="text-sm leading-[21px] text-muted">
            Manage team members, roles, and access permissions.
          </p>
        </header>

        <AddTeamMember />
        <MembersTable members={members} isSuperAdmin={isSuperAdmin} />
      </main>
    </div>
  );
}
