import type { FeatureIconName } from "@/components/icons";

/**
 * Content model for the marketing landing page (`app/page.tsx`). Kept apart
 * from the in-app `lib/content.ts` hero copy so the public surface can evolve
 * without touching the authenticated brand panel.
 */

/** Top nav anchor links. */
export const NAV_LINKS: readonly { label: string; href: string }[] = [
  { label: "Features", href: "#features" },
  { label: "Platform", href: "#platform" },
  { label: "How it works", href: "#how" },
  { label: "Reviews", href: "#reviews" },
] as const;

/** Live-ticker symbols scrolling under the hero (decorative). */
export type Ticker = { symbol: string; price: string; change: string; up: boolean };

export const TICKERS: readonly Ticker[] = [
  { symbol: "BTC/USDT", price: "67,412.80", change: "+2.41%", up: true },
  { symbol: "ETH/USDT", price: "3,548.12", change: "+1.87%", up: true },
  { symbol: "SOL/USDT", price: "176.94", change: "-0.62%", up: false },
  { symbol: "BNB/USDT", price: "612.30", change: "+0.94%", up: true },
  { symbol: "XRP/USDT", price: "0.6218", change: "+3.10%", up: true },
  { symbol: "ADA/USDT", price: "0.4795", change: "-1.04%", up: false },
  { symbol: "AVAX/USDT", price: "38.71", change: "+4.22%", up: true },
  { symbol: "DOGE/USDT", price: "0.1632", change: "+0.51%", up: true },
  { symbol: "LINK/USDT", price: "18.04", change: "-0.33%", up: false },
  { symbol: "MATIC/USDT", price: "0.7188", change: "+2.05%", up: true },
] as const;

/** Animated headline stats — `value` count-up targets are parsed from suffix. */
export type HeroStat = { value: number; prefix?: string; suffix: string; label: string };

export const HERO_STATS: readonly HeroStat[] = [
  { value: 1200, suffix: "+", label: "Active traders" },
  { value: 50, prefix: "$", suffix: "M+", label: "Volume traded" },
  { value: 68, suffix: "%", label: "Avg. win rate" },
  { value: 99.9, suffix: "%", label: "Uptime SLA" },
] as const;

export type LandingFeature = {
  id: string;
  icon: FeatureIconName;
  title: string;
  description: string;
};

/** Six-card capability grid. Icons reuse the in-app feature glyph set. */
export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    id: "bots",
    icon: "bot",
    title: "AI Trading Bots",
    description:
      "Deploy battle-tested strategies that watch the market 24/7 and execute in milliseconds — no screen-watching required.",
  },
  {
    id: "analytics",
    icon: "chart",
    title: "Real-Time Analytics",
    description:
      "Track P&L, win rate, and drawdown live across every bot with institutional-grade dashboards.",
  },
  {
    id: "risk",
    icon: "shield",
    title: "Advanced Risk Controls",
    description:
      "Stop-loss, take-profit, and exposure caps enforced automatically so a bad candle never wrecks your book.",
  },
  {
    id: "multi",
    icon: "chart",
    title: "Multi-Exchange Routing",
    description:
      "Connect Binance, Bybit, Kraken and more with read-or-trade API scopes you control to the permission.",
  },
  {
    id: "backtest",
    icon: "bot",
    title: "Backtest & Simulate",
    description:
      "Validate any strategy against years of historical data before a single dollar goes live.",
  },
  {
    id: "secure",
    icon: "shield",
    title: "Bank-Grade Security",
    description:
      "Two-factor auth, encrypted key vaults, and withdrawal-disabled API keys keep your capital yours.",
  },
] as const;

export type Step = { id: string; title: string; description: string };

/** "How it works" three-step flow. */
export const STEPS: readonly Step[] = [
  {
    id: "connect",
    title: "Connect your exchange",
    description:
      "Link an exchange in seconds with trade-only API keys. Your funds never leave your account.",
  },
  {
    id: "deploy",
    title: "Deploy a strategy",
    description:
      "Pick from proven bots or tune your own. Backtest, then go live with one tap.",
  },
  {
    id: "earn",
    title: "Track & compound",
    description:
      "Watch performance in real time and let automation compound your edge around the clock.",
  },
] as const;

/** Exchanges shown in the trust marquee. */
export const EXCHANGES: readonly string[] = [
  "Binance",
  "Bybit",
  "Kraken",
  "Coinbase",
  "OKX",
  "KuCoin",
  "Bitget",
  "Gate.io",
] as const;

export type Testimonial = { id: string; quote: string; name: string; role: string; initials: string };

export const TESTIMONIALS: readonly Testimonial[] = [
  {
    id: "t1",
    quote:
      "I went from refreshing charts at 3am to letting Adrian run my grid bots. My win rate is up and my sleep is back.",
    name: "Marcus Reed",
    role: "Full-time crypto trader",
    initials: "MR",
  },
  {
    id: "t2",
    quote:
      "The risk controls are the real deal. Exposure caps saved my account during the last flash crash — set and forget.",
    name: "Priya Nair",
    role: "Quant hobbyist",
    initials: "PN",
  },
  {
    id: "t3",
    quote:
      "Backtesting plus multi-exchange routing in one place. It replaced three tools I was duct-taping together.",
    name: "Diego Alvarez",
    role: "Prop desk analyst",
    initials: "DA",
  },
] as const;
