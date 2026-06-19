import { AdminNav, type AdminTab } from "@/components/admin/AdminNav";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Sidebar for the admin staging area (distinct nav from the user dashboard).
 * Loads the signed-in admin for the profile/sign-out footer, then hands off to
 * {@link AdminNav} for the desktop rail and mobile drawer.
 */
export async function AdminSidebar({ active = "dashboard" }: { active?: AdminTab }) {
  const session = await getSession();
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.sub },
        select: { name: true, email: true, avatarUrl: true },
      })
    : null;

  return <AdminNav active={active} user={user} />;
}
