import type { ReactNode } from "react";
import { GuestNotice } from "@/components/app/GuestNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { getPageAccess } from "@/lib/auth/guards";

/**
 * Standard authenticated-app frame: the fixed sidebar plus a scrollable main
 * column. Pages drop their header + sections into `children`.
 *
 * Reuses the React-cached {@link getPageAccess} that the page itself calls, so
 * the sidebar profile + guest notice cost no extra DB query. For visitors the
 * profile is `null` and the sidebar omits the profile footer. When the viewer is
 * a guest, a read-only notice is pinned above the page content so the reason
 * their controls are locked follows them across every tab.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const { tier, profile } = await getPageAccess();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <Sidebar user={profile} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
        {tier === "guest" && <GuestNotice />}
        {children}
      </main>
    </div>
  );
}
