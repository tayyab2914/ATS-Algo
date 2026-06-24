import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { BotLibraryBrowser } from "@/components/bot-library/BotLibraryBrowser";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { BOTS_BY_CATEGORY } from "@/lib/bot-library";

export const metadata: Metadata = {
  title: "Bot Library · ATS-ALGO",
};

/**
 * Bot Library. Open to visitors and active guests (read-only browsing) as well
 * as members — it's the landing destination for the "Check out Bot Library" CTA,
 * and one of the three surfaces a Guest Mode trial may explore. Expired guests
 * are walled to Billing like every other tab.
 */
export default async function BotLibraryPage() {
  const { tier } = await getPageAccess();
  blockExpiredGuest(tier);

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
