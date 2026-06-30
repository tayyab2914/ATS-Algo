"use server";

import { revalidatePath } from "next/cache";

/**
 * Drop the whole client Router Cache after a subscription is activated outside a
 * Route Handler — specifically the billing-page self-heal path, which reconciles
 * a dropped-webhook user during a Server Component render where `revalidatePath`
 * cannot be called. The client invokes this once it sees `justActivated`, so the
 * previously-cached (locked / guest-banner) renders of Dashboard, Portfolio, My
 * Bots and Account are refetched fresh on the next visit instead of replayed.
 *
 * Pure cache invalidation, no data returned and nothing user-specific touched —
 * it only marks this browser's cached route segments stale.
 */
export async function dropClientCacheAfterActivation(): Promise<void> {
  revalidatePath("/", "layout");
}
