import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "My Bots · ATS-ALGO",
};

export default async function MyBotsPage() {
  const session = await getSession();

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">My Bots</h1>
        <p className="text-sm leading-[21px] text-muted">
          Manage the bots you&apos;ve deployed and monitor their live activity.
        </p>
      </header>

      {session ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-6 py-20 text-center">
          <h2 className="text-lg font-semibold text-white">No bots yet</h2>
          <p className="max-w-sm text-sm leading-[21px] text-muted">
            Deploy your first bot from the library and it&apos;ll show up here with live stats.
          </p>
          <Link
            href="/bot-library"
            className="mt-1 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
          >
            Browse Bot Library
          </Link>
        </div>
      ) : (
        <GuestGate title="My Bots" returnTo="/my-bots">
          <TabPreviewSkeleton />
        </GuestGate>
      )}
    </AppShell>
  );
}
