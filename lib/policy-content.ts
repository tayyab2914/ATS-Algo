/**
 * Content model for the mandatory Rules & Policy acceptance gate
 * (`app/policy/page.tsx`). Every authenticated user must accept these once
 * before they can reach any in-app route.
 *
 * Kept deliberately concise so the whole gate fits on one screen without
 * scrolling. Bump `POLICY_VERSION` whenever the terms change materially — it is
 * recorded with the acceptance timestamp so a future change can require
 * re-consent.
 */

export const POLICY_VERSION = "2026-06-02";

export type PolicySection = {
  title: string;
  body: string;
};

export const POLICY_INTRO =
  "Please read and accept the rules below before you access the dashboard.";

export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    title: "Risk acknowledgement",
    body: "Crypto trading can lose your entire capital. Bots can lose as fast as they gain — trade only what you can afford to lose.",
  },
  {
    title: "Not financial advice",
    body: "The platform, its metrics, and bots are tools, not investment advice. Every trading decision is yours alone.",
  },
  {
    title: "Account & security",
    body: "Keep your credentials and API keys private, grant the minimum permissions, and report any unauthorised access.",
  },
  {
    title: "Acceptable use",
    body: "You are of legal age, permitted to trade in your jurisdiction, and will not use the platform for any unlawful activity.",
  },
  {
    title: "Service & liability",
    body: "The service is provided “as is”. We are not liable for trading losses and may update these rules over time.",
  },
] as const;
