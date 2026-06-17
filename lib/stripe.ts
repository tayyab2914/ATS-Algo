import Stripe from "stripe";
import { BillingPlan } from "@/lib/generated/prisma/enums";

/**
 * Stripe client + plan catalog.
 *
 * The client is created lazily and cached so importing this module never throws
 * at build time when `STRIPE_SECRET_KEY` is absent (e.g. during `next build`);
 * the error only surfaces when a route actually tries to call Stripe.
 *
 * The API version is intentionally left unset so the SDK uses the version it was
 * pinned to (`stripe@22` → `2026-05-27.dahlia`), which matches the types we
 * compile against and the shape the webhook handler expects.
 */
let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY is not set");
  client = new Stripe(apiKey, { typescript: true });
  return client;
}

/** A purchasable plan, paired with the env var holding its Stripe price id. */
type PlanConfig = {
  plan: BillingPlan;
  /** Name of the env var that holds the Stripe price id for this plan. */
  priceEnv: "STRIPE_PRICE_MONTHLY" | "STRIPE_PRICE_YEARLY";
  label: string;
  /** Amount in the smallest currency unit (cents), for display only. */
  amount: number;
  interval: "month" | "year";
};

export const PLAN_CONFIG: Record<BillingPlan, PlanConfig> = {
  MONTHLY: {
    plan: BillingPlan.MONTHLY,
    priceEnv: "STRIPE_PRICE_MONTHLY",
    label: "Monthly",
    amount: 4900,
    interval: "month",
  },
  YEARLY: {
    plan: BillingPlan.YEARLY,
    priceEnv: "STRIPE_PRICE_YEARLY",
    label: "Yearly",
    amount: 55900,
    interval: "year",
  },
};

/** Resolve the configured Stripe price id for a plan, or throw if unset. */
export function priceIdForPlan(plan: BillingPlan): string {
  const priceId = process.env[PLAN_CONFIG[plan].priceEnv];
  if (!priceId) throw new Error(`${PLAN_CONFIG[plan].priceEnv} is not set`);
  return priceId;
}

/**
 * Map a Stripe price id back to one of our plans. Returns `null` for an
 * unrecognized price (e.g. a legacy or test price) so callers can decide how to
 * handle it rather than guessing.
 */
export function planForPriceId(priceId: string): BillingPlan | null {
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return BillingPlan.MONTHLY;
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return BillingPlan.YEARLY;
  return null;
}
