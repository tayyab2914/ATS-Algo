import { redirect } from "next/navigation";
import { AccessRequests, type AccessRequestRow } from "@/components/admin/AccessRequests";
import { AddTeamMember } from "@/components/admin/AddTeamMember";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { MembersTable, type MemberRow, type MemberSubscription } from "@/components/admin/MembersTable";
import { isSuperAdminEmail } from "@/lib/auth/account";
import { getSession, hasLiveSession } from "@/lib/auth/session";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";
import type { SubscriptionModel } from "@/lib/generated/prisma/models";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The subscription columns the members pill is derived from. */
type SubscriptionView = Pick<SubscriptionModel, "currentPeriodEnd">;

/**
 * Collapse a grant into the pill the members table shows.
 *
 * Liveness comes from the shared {@link isSubscriptionActive} rather than an
 * inline re-implementation: this pill and the gate the member actually hits must
 * never be able to disagree about who has access.
 */
function toSubscriptionView(sub: SubscriptionView | null, requested: boolean): MemberSubscription {
  if (!sub) {
    return { label: requested ? "Requested" : "No access", active: false, granted: false, requested };
  }
  const active = isSubscriptionActive(sub);
  return { label: active ? "Access granted" : "Access ended", active, granted: true, requested };
}

/** Read the clock. Kept out of the component body for React lint purity. */
function nowMs(): number {
  return Date.now();
}

/** "2 hours ago" / "3 days ago" for the request queue. */
function timeAgo(date: Date, now: number): string {
  const mins = Math.max(0, Math.round((now - date.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} mins ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export default async function AdminManagementPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const isSuperAdmin = isSuperAdminEmail(session.email);

  // Select only what the row mapping needs, instead of whole user rows (which
  // would pull passwordHash and every other column for every member).
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
      subscription: { select: { currentPeriodEnd: true } },
      subscriptionRequest: { select: { status: true, requestedAt: true } },
      communityLink: { select: { id: true, name: true } },
    },
  });

  const now = nowMs();

  const members: MemberRow[] = users.map((user) => {
    const subscription = toSubscriptionView(
      user.subscription,
      user.subscriptionRequest?.status === "PENDING",
    );
    // A non-admin without live access is a read-only Guest. There is no trial to
    // report any more — the platform is closed to individual members, so a guest
    // simply stays one until an admin uses "Make member".
    const hasAccess = user.role === "ADMIN" || subscription.active;
    return {
      id: user.id,
      name: user.name?.trim() || user.email.split("@")[0],
      email: user.email,
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
      status: user.status,
      loggedIn: hasLiveSession(user),
      joined: formatDate(user.createdAt),
      subscription,
      guest: !hasAccess,
      // Which community's link brought them in. "Individual" (null) is now the
      // exception worth spotting, not the norm.
      community: user.communityLink,
      // The acting admin's own row (no self-targeting) and the protected superadmin.
      isSelf: user.id === session.sub,
      isProtected: isSuperAdminEmail(user.email),
    };
  });

  // Derived from the same rows the table already loaded rather than a second
  // query, and sorted oldest-first so the person who has been waiting longest is
  // actioned first. Admin rows are excluded: /api/admin/members refuses every
  // subscription action against an admin, so one here could never be cleared.
  const pendingRequests: AccessRequestRow[] = users
    .filter((u) => u.role !== "ADMIN" && u.subscriptionRequest?.status === "PENDING")
    .sort(
      (a, b) =>
        (a.subscriptionRequest?.requestedAt.getTime() ?? 0) -
        (b.subscriptionRequest?.requestedAt.getTime() ?? 0),
    )
    .map((u) => ({
      memberId: u.id,
      name: u.name?.trim() || u.email.split("@")[0],
      email: u.email,
      requestedAgo: timeAgo(u.subscriptionRequest!.requestedAt, now),
      /** A lapsed grant still leaves the row behind; say so, it changes the call. */
      returning: u.subscription !== null,
    }));

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
        <AccessRequests requests={pendingRequests} />
        <MembersTable members={members} isSuperAdmin={isSuperAdmin} />
      </main>
    </div>
  );
}
