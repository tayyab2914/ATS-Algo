import type { FeatureIconName } from "@/components/icons";

/** Marketing hero copy for the left brand panel. */
export const HERO = {
  title: "Automate Your Trading.",
  highlight: "Maximize Returns.",
  description:
    "Advanced algorithmic trading bots powered by real-time market data. Deploy strategies across crypto, forex, and commodities with institutional-grade automation.",
} as const;

export type Feature = {
  id: string;
  icon: FeatureIconName;
  title: string;
  description: string;
};

/** Feature cards shown beneath the hero. */
export const FEATURES: readonly Feature[] = [
  { id: "bots", icon: "bot", title: "Active Bots", description: "AI-powered strategies" },
  { id: "analytics", icon: "chart", title: "Analytics", description: "Real-Time Performance" },
  { id: "risk", icon: "shield", title: "Risk Mgmt", description: "Advanced Protection" },
] as const;

export type Stat = {
  id: string;
  label: string;
  /** Renders the green live-indicator dot before the label. */
  indicator?: boolean;
};

/** Social-proof stats row. */
export const STATS: readonly Stat[] = [
  { id: "users", label: "1,200+ Active Users", indicator: true },
  { id: "volume", label: "$50M+ Volume Traded" },
  { id: "winrate", label: "68%+ Avg Win Rate" },
] as const;
