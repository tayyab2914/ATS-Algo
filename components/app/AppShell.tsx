import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Standard authenticated-app frame: the fixed sidebar plus a scrollable main
 * column. Pages drop their header + sections into `children`.
 *
 * Looks up the signed-in user so the sidebar can show their name + avatar; for
 * guests it passes `null` and the sidebar omits the profile footer.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const session = await getSession();
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.sub },
        select: { name: true, email: true, avatarUrl: true },
      })
    : null;

  return (
    <div className="flex min-h-screen w-full bg-background text-white">
      <Sidebar user={user} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">{children}</main>
    </div>
  );
}
