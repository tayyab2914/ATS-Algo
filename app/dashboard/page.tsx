import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { toPublicUser } from "@/lib/auth/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Dashboard · Adrian Trading System",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const record = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!record) redirect("/login");

  const user = toPublicUser(record);
  const { verified } = await searchParams;

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-[512px] flex-col gap-6">
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-2xl font-semibold leading-[31px] text-heading">Dashboard</h1>
            <p className="text-xs leading-[18px] text-muted">You are signed in.</p>
          </div>
          <LogoutButton />
        </header>

        {verified === "1" && (
          <p className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            Your email address has been verified.
          </p>
        )}

        {!user.emailVerified && (
          <p className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
            Please verify your email — check your inbox for the confirmation link.
          </p>
        )}

        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
          <Row label="Email" value={user.email} />
          <Row
            label="Role"
            value={
              <span
                className={
                  user.role === "ADMIN"
                    ? "rounded-md bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent"
                    : "rounded-md bg-white/5 px-2 py-0.5 text-xs font-semibold text-muted"
                }
              >
                {user.role}
              </span>
            }
          />
          <Row label="Email verified" value={user.emailVerified ? "Yes" : "No"} />
          <Row label="User ID" value={<span className="font-mono text-xs">{user.id}</span>} />
        </section>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
  );
}
