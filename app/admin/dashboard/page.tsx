import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Admin Dashboard · Adrian Trading System",
};

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, email: true, role: true, emailVerified: true, createdAt: true },
  });

  return (
    <main className="flex min-h-screen w-full justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-[800px] flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-2xl font-semibold leading-[31px] text-heading">Admin Dashboard</h1>
            <p className="text-xs leading-[18px] text-muted">
              Signed in as {session.email} · {users.length} user{users.length === 1 ? "" : "s"}
            </p>
          </div>
          <LogoutButton redirectTo="/admin" />
        </header>

        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Verified</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3 text-white">{user.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        user.role === "ADMIN"
                          ? "rounded-md bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent"
                          : "rounded-md bg-white/5 px-2 py-0.5 text-xs font-semibold text-muted"
                      }
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{user.emailVerified ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
