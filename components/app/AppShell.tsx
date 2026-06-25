import type { ReactNode } from "react";
import { GuestTrialBanner } from "@/components/app/GuestTrialBanner";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { getPageAccess } from "@/lib/auth/guards";

/**
 * Standard authenticated-app frame: the fixed sidebar plus a scrollable main
 * column. Pages drop their header + sections into `children`.
 *
 * Reuses the React-cached {@link getPageAccess} that the page itself calls, so
 * the sidebar profile + trial banner cost no extra DB query. For visitors the
 * profile is `null` and the sidebar omits the profile footer. When the viewer is
 * a guest, a Guest Mode trial banner is pinned above the page content so the
 * countdown and upgrade CTA follow them across every tab.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const { tier, guest, profile } = await getPageAccess();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <Sidebar user={profile} expired={tier === "guestExpired"} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
        {guest && <GuestTrialBanner expiresAt={guest.expiresAt.toISOString()} />}
        {children}
      </main>
    </div>
  );
}
