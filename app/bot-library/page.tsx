import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { BotLibraryBrowser } from "@/components/bot-library/BotLibraryBrowser";
import { BOTS_BY_CATEGORY } from "@/lib/bot-library";

export const metadata: Metadata = {
  title: "Bot Library · ATS-ALGO",
};

/**
 * Public Bot Library. Open to everyone (signed in or not) — it's the landing
 * destination for the "Check out Bot Library" CTA. The other dashboard tabs
 * gate guests behind a locked overlay; this one never does.
 */
export default function BotLibraryPage() {
  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Library</h1>
        <p className="text-sm leading-[21px] text-muted">
          Browse automated trading bots available for deployment.
        </p>
      </header>

      <BotLibraryBrowser bots={BOTS_BY_CATEGORY} />
    </AppShell>
  );
}
