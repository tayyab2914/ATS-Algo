"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { dropClientCacheAfterActivation } from "@/app/billing/actions";
import { SettingsCard, PrimaryAction } from "@/components/account/SettingsCard";
import { AuthRequiredDialog } from "@/components/billing/AuthRequiredDialog";
import { RequestSentDialog } from "@/components/billing/RequestSentDialog";
import { Notice, type NoticeData } from "@/components/ui/Notice";

/** Client-safe view of the viewer's admin-granted access. */
export type SubscriptionView = {
  /** Whether the grant currently opens the gated tabs. */
  active: boolean;
  /** When it ends; null is an open-ended grant. */
  currentPeriodEnd: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  // Pin the locale so SSR (server locale) and the client (browser locale) format
  // identically — an `undefined` locale renders e.g. "30 July 2026" vs
  // "July 30, 2026" and triggers a hydration mismatch.
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function BillingSection({
  subscription,
  authenticated,
  requestPending,
  justActivated = false,
}: {
  subscription: SubscriptionView | null;
  /** False for a signed-out visitor; gates the request action behind sign-in. */
  authenticated: boolean;
  /** A request is already with the admin — the button stays disabled and says so. */
  requestPending: boolean;
  /**
   * True when this render consumed an APPROVED request, i.e. an admin granted
   * access from THEIR browser. The other tabs may still be cached as locked in
   * this one; we purge that cache once so they unlock without a manual refresh.
   */
  justActivated?: boolean;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const gated = params.get("gated");
  const expired = params.get("expired");

  // One-shot: when a grant just landed, drop the stale (locked) Router Cache for
  // every other tab, then re-render the current route. Guarded so
  // router.refresh()'s re-render can't retrigger it into a loop.
  const bustedRef = useRef(false);
  useEffect(() => {
    if (!justActivated || bustedRef.current) return;
    bustedRef.current = true;
    void dropClientCacheAfterActivation().then(() => router.refresh());
  }, [justActivated, router]);

  const [banner, setBanner] = useState<NoticeData | null>(
    expired
      ? {
          type: "error",
          message:
            "Your free guest trial has ended. Request access to get back into the dashboard and your bots.",
        }
      : gated
        ? { type: "info", message: "Request access to unlock the dashboard, portfolio, and your bots." }
        : null,
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [authPrompt, setAuthPrompt] = useState(false);

  /** Ask an admin for access. Idempotent server-side, so a re-click is harmless. */
  async function requestAccess() {
    // Visitors can read the page, but a request needs an account to attach to.
    // Rather than bounce them to login (which feels like the click was ignored),
    // explain why and offer both log in and sign up.
    if (!authenticated) {
      setAuthPrompt(true);
      return;
    }
    setSending(true);
    setBanner(null);
    try {
      const res = await fetch("/api/billing/request-access", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setBanner({ type: "error", message: data?.error ?? "Something went wrong. Please try again." });
        return;
      }
      setSent(true);
      // Re-render the server component so the button settles into its
      // "Request pending" state instead of inviting another click.
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSending(false);
    }
  }

  const active = subscription?.active ?? false;

  return (
    <>
      <AuthRequiredDialog
        open={authPrompt}
        onClose={() => setAuthPrompt(false)}
        loginHref={`/login?next=${encodeURIComponent("/billing")}`}
        signupHref="/signup"
      />
      <RequestSentDialog open={sent} onClose={() => setSent(false)} />

      {banner && <Notice notice={banner} />}

      {active ? (
        <SettingsCard title="Your access" subtitle="Access to ATS-ALGO is granted by an admin.">
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-base font-semibold text-white">Full access</span>
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                  Granted
                </span>
              </div>
              <span className="text-xs text-muted">
                {subscription?.currentPeriodEnd
                  ? `Granted by your team · access until ${formatDate(subscription.currentPeriodEnd)}`
                  : "Granted by your team · no expiry"}
              </span>
            </div>
          </div>
        </SettingsCard>
      ) : (
        <SettingsCard
          title="Request access"
          subtitle="Access to ATS-ALGO is granted by an admin — there is nothing to pay for here."
        >
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-background/40 p-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-semibold text-white">
                {requestPending ? "Request with the admin" : "You do not have access yet"}
              </span>
              <span className="text-xs leading-[18px] text-muted">
                {requestPending
                  ? "Your request has been sent and is waiting on an admin. You will get the dashboard, your bots and live performance the moment it is approved."
                  : "Send a request and an admin will review it. Once approved you unlock the dashboard, deploy bots, and track live performance."}
              </span>
            </div>
            <PrimaryAction onClick={requestAccess} disabled={sending || requestPending}>
              {requestPending ? "Request pending" : sending ? "Sending…" : "Request access"}
            </PrimaryAction>
          </div>
        </SettingsCard>
      )}
    </>
  );
}
