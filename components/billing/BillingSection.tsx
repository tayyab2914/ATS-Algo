"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SettingsCard, PrimaryAction } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/** Client-safe view of the user's subscription (Stripe stays authoritative). */
export type SubscriptionView = {
  plan: "MONTHLY" | "YEARLY";
  status: string;
  active: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Admin-granted free access — there is no Stripe customer/portal to manage. */
  isComp: boolean;
};

type PlanKey = "MONTHLY" | "YEARLY";

/** Presentational plan catalog. Stripe holds the real, charged amounts. */
const PLANS: Record<PlanKey, { label: string; price: string; cadence: string; blurb: string }> = {
  MONTHLY: { label: "Monthly", price: "$49", cadence: "/month", blurb: "Billed monthly. Cancel anytime." },
  YEARLY: { label: "Yearly", price: "$559", cadence: "/year", blurb: "Two months free vs. monthly." },
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Past due",
  UNPAID: "Unpaid",
  CANCELED: "Canceled",
  INCOMPLETE: "Incomplete",
  INCOMPLETE_EXPIRED: "Expired",
  PAUSED: "Paused",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function BillingSection({
  subscription,
  hasCustomer,
  authenticated,
}: {
  subscription: SubscriptionView | null;
  hasCustomer: boolean;
  /** False for a signed-out visitor browsing plans; gates the checkout action. */
  authenticated: boolean;
}) {
  const params = useSearchParams();
  const returnStatus = params.get("status");
  const gated = params.get("gated");
  const expired = params.get("expired");

  const [banner, setBanner] = useState<NoticeData | null>(
    returnStatus === "success"
      ? { type: "success", message: "Payment received. Your subscription will appear here within a few seconds." }
      : returnStatus === "cancelled"
        ? { type: "info", message: "Checkout cancelled — you haven't been charged." }
        : expired
          ? {
              type: "error",
              message:
                "Your free guest trial has ended. Subscribe to a plan to regain access to the dashboard and your bots.",
            }
          : gated
            ? { type: "info", message: "Subscribe to unlock the dashboard, portfolio, and your bots." }
            : null,
  );
  const [pending, setPending] = useState<"MONTHLY" | "YEARLY" | "portal" | null>(null);

  /** POST to an endpoint that returns `{ url }` and redirect the browser there. */
  async function redirectTo(endpoint: string, body?: object, key?: typeof pending) {
    setPending(key ?? null);
    setBanner(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok && data?.url) {
        window.location.assign(data.url);
        return;
      }
      setBanner({ type: "error", message: data?.error ?? "Something went wrong. Please try again." });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(null);
    }
  }

  const subscribe = (plan: PlanKey) => {
    // Guests can browse plans, but checkout needs an account — send them to sign
    // in first and return here afterwards.
    if (!authenticated) {
      window.location.assign(`/login?next=${encodeURIComponent("/billing")}`);
      return;
    }
    redirectTo("/api/billing/checkout", { plan }, plan);
  };
  const openPortal = () => redirectTo("/api/billing/portal", undefined, "portal");

  const active = subscription?.active ?? false;

  return (
    <>
      {banner && <Notice notice={banner} />}

      {subscription && (active || subscription.status === "PAST_DUE" || subscription.status === "UNPAID") ? (
        <SettingsCard
          title="Current Plan"
          subtitle="Your subscription is managed securely through Stripe."
        >
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span className="text-base font-semibold text-white">
                  {subscription.isComp ? "Complimentary access" : `${PLANS[subscription.plan].label} plan`}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    active ? "bg-success/15 text-success" : "bg-red-500/15 text-red-400",
                  )}
                >
                  {subscription.isComp ? "Granted" : STATUS_LABEL[subscription.status] ?? subscription.status}
                </span>
              </div>
              <span className="text-xs text-muted">
                {subscription.isComp
                  ? subscription.currentPeriodEnd
                    ? `Granted by your team · access until ${formatDate(subscription.currentPeriodEnd)}`
                    : "Granted by your team · no expiry"
                  : subscription.cancelAtPeriodEnd
                    ? `Access ends ${formatDate(subscription.currentPeriodEnd)}`
                    : active
                      ? `Renews ${formatDate(subscription.currentPeriodEnd)}`
                      : "Update your payment method to restore access."}
              </span>
            </div>
            {/* Comp access has no Stripe customer, so there's nothing to manage. */}
            {!subscription.isComp && (
              <PrimaryAction onClick={openPortal} disabled={pending !== null}>
                {pending === "portal" ? "Opening…" : "Manage billing"}
              </PrimaryAction>
            )}
          </div>
        </SettingsCard>
      ) : (
        <SettingsCard
          title="Choose a Plan"
          subtitle="Unlock automated trading, live performance, and your full bot library."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(PLANS) as PlanKey[]).map((key) => {
              const plan = PLANS[key];
              const isPending = pending === key;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-4 rounded-xl border border-line bg-background/40 p-5"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-white">{plan.label}</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-semibold text-white">{plan.price}</span>
                      <span className="text-sm text-muted">{plan.cadence}</span>
                    </div>
                    <span className="text-xs text-muted">{plan.blurb}</span>
                  </div>
                  <PrimaryAction onClick={() => subscribe(key)} disabled={pending !== null}>
                    {isPending
                      ? "Redirecting…"
                      : authenticated
                        ? `Subscribe ${plan.label.toLowerCase()}`
                        : "Sign in to subscribe"}
                  </PrimaryAction>
                </div>
              );
            })}
          </div>

          {hasCustomer && (
            <button
              type="button"
              onClick={openPortal}
              disabled={pending !== null}
              className="w-fit text-xs text-muted underline-offset-4 transition-colors hover:text-white hover:underline disabled:opacity-60"
            >
              {pending === "portal" ? "Opening…" : "View billing history & invoices"}
            </button>
          )}
        </SettingsCard>
      )}
    </>
  );
}
