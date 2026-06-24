import type { ReactNode } from "react";
import { GuestTrialBanner } from "@/components/app/GuestTrialBanner";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { getPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

/**
 * Standard authenticated-app frame: the fixed sidebar plus a scrollable main
 * column. Pages drop their header + sections into `children`.
 *
 * Looks up the signed-in user so the sidebar can show their name + avatar; for
 * visitors it passes `null` and the sidebar omits the profile footer. When the
 * viewer is a guest, a Guest Mode trial banner is pinned above the page content
 * so the countdown and upgrade CTA follow them across every tab.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const { session, guest } = await getPageAccess();
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.sub },
        select: { name: true, email: true, avatarUrl: true },
      })
    : null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <Sidebar user={user} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
        {guest && <GuestTrialBanner expiresAt={guest.expiresAt.toISOString()} />}
        {children}
      </main>
    </div>
  );
}
