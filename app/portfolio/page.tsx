import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Portfolio · Adrian Trading System",
};

export default async function PortfolioPage() {
  const session = await getSession();

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Portfolio</h1>
        <p className="text-sm leading-[21px] text-muted">
          Track allocation, balance, and live performance across your deployed bots.
        </p>
      </header>

      {session ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-6 py-20 text-center">
          <h2 className="text-lg font-semibold text-white">Your portfolio is taking shape</h2>
          <p className="max-w-sm text-sm leading-[21px] text-muted">
            Add bots from the library to start tracking allocation and balance here.
          </p>
          <Link
            href="/bot-library"
            className="mt-1 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
          >
            Browse Bot Library
          </Link>
        </div>
      ) : (
        <GuestGate title="Portfolio" returnTo="/portfolio">
          <TabPreviewSkeleton />
        </GuestGate>
      )}
    </AppShell>
  );
}
