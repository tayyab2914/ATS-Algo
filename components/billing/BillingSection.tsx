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
}: {
  subscription: SubscriptionView | null;
  hasCustomer: boolean;
}) {
  const params = useSearchParams();
  const returnStatus = params.get("status");

  const [banner, setBanner] = useState<NoticeData | null>(
    returnStatus === "success"
      ? { type: "success", message: "Payment received. Your subscription will appear here within a few seconds." }
      : returnStatus === "cancelled"
        ? { type: "info", message: "Checkout cancelled — you haven't been charged." }
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

  const subscribe = (plan: PlanKey) => redirectTo("/api/billing/checkout", { plan }, plan);
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
                <span className="text-base font-semibold text-white">{PLANS[subscription.plan].label} plan</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    active ? "bg-success/15 text-success" : "bg-red-500/15 text-red-400",
                  )}
                >
                  {STATUS_LABEL[subscription.status] ?? subscription.status}
                </span>
              </div>
              <span className="text-xs text-muted">
                {subscription.cancelAtPeriodEnd
                  ? `Access ends ${formatDate(subscription.currentPeriodEnd)}`
                  : active
                    ? `Renews ${formatDate(subscription.currentPeriodEnd)}`
                    : "Update your payment method to restore access."}
              </span>
            </div>
            <PrimaryAction onClick={openPortal} disabled={pending !== null}>
              {pending === "portal" ? "Opening…" : "Manage billing"}
            </PrimaryAction>
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
                    {isPending ? "Redirecting…" : `Subscribe ${plan.label.toLowerCase()}`}
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
