/**
 * Bot Library data model — the public catalogue of automated trading bots.
 *
 * This module is the single source of truth for the Bot Library table and the
 * per-bot detail page. It is intentionally framework-agnostic (pure data +
 * pure formatters) so it can be imported by both server and client components
 * without dragging in any server-only dependencies.
 */

export type RiskClass = "Low" | "Medium" | "High";

export type Category = "crypto" | "forex" | "commodities" | "stocks";

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "crypto", label: "Crypto" },
  { key: "forex", label: "Forex" },
  { key: "commodities", label: "Commodities" },
  { key: "stocks", label: "Stocks" },
];

/** Canonical metrics shown on the detail page (independent of table columns). */
type DetailOverrides = {
  winrate?: number;
  profitFactor?: number;
  netProfit?: number;
  tradeCount?: number;
  stopLoss?: number;
  leverage?: number;
  slToBe?: string;
};

export type BotRow = {
  slug: string;
  name: string;
  category: Category;
  pair: string;
  strategy: string;
  timeframe: string;
  risk: RiskClass;
  winRate: number;
  pf: number;
  /** Trailing-window performance (%). `null` renders as "N/A". */
  d30: number | null;
  d90: number | null;
  d180: number | null;
  d360: number | null;
  avgTrade: number;
  users: number;
  detail?: DetailOverrides;
};

/* ── Catalogue ─────────────────────────────────────────────────────────────
 * The first four crypto rows mirror the source design exactly; the remaining
 * rows (and the other asset classes) are realistic samples so every tab and
 * every "View" link resolves to a populated page.
 * ----------------------------------------------------------------------- */

const CRYPTO: BotRow[] = [
  {
    slug: "alpha-btc-bot",
    name: "Alpha BTC Bot",
    category: "crypto",
    pair: "BTC/USDT",
    strategy: "Scalping",
    timeframe: "5m",
    risk: "Medium",
    winRate: 87.88,
    pf: 5.78,
    d30: 2.49,
    d90: 38.98,
    d180: 93.53,
    d360: 236.37,
    avgTrade: 7.16,
    users: 1240,
    detail: { winrate: 68.2, profitFactor: 1.84, netProfit: 788.33, tradeCount: 1247, stopLoss: 3, leverage: 7, slToBe: "TP1" },
  },
  {
    slug: "eth-grid-pro",
    name: "ETH Grid Pro",
    category: "crypto",
    pair: "ETH/USDT",
    strategy: "Grid",
    timeframe: "15m",
    risk: "Low",
    winRate: 50.0,
    pf: 2.01,
    d30: -1.88,
    d90: 89.65,
    d180: null,
    d360: null,
    avgTrade: 3.2,
    users: 890,
    detail: { winrate: 50.0, profitFactor: 2.01, netProfit: 89.65, tradeCount: 642, stopLoss: 2, leverage: 3, slToBe: "TP1" },
  },
  {
    slug: "sol-breakout",
    name: "SOL Breakout",
    category: "crypto",
    pair: "SOL/USDT",
    strategy: "Breakout",
    timeframe: "1H",
    risk: "High",
    winRate: 66.67,
    pf: 1.74,
    d30: -10.46,
    d90: 9.51,
    d180: 21.7,
    d360: 28.46,
    avgTrade: 1.05,
    users: 560,
    detail: { winrate: 61.4, profitFactor: 1.74, netProfit: 28.46, tradeCount: 884, stopLoss: 5, leverage: 10, slToBe: "TP2" },
  },
  {
    slug: "xrp-trend-runner",
    name: "XRP Trend Runner",
    category: "crypto",
    pair: "XRP/USDT",
    strategy: "Trend",
    timeframe: "4H",
    risk: "Medium",
    winRate: 72.5,
    pf: 2.34,
    d30: 5.12,
    d90: 18.4,
    d180: 42.8,
    d360: 98.5,
    avgTrade: 2.8,
    users: 720,
    detail: { winrate: 64.0, profitFactor: 2.34, netProfit: 198.5, tradeCount: 503, stopLoss: 4, leverage: 5, slToBe: "TP1" },
  },
  {
    slug: "doge-scalper",
    name: "DOGE Scalper",
    category: "crypto",
    pair: "DOGE/USDT",
    strategy: "Scalping",
    timeframe: "5m",
    risk: "High",
    winRate: 58.3,
    pf: 1.62,
    d30: -4.21,
    d90: 12.74,
    d180: 33.1,
    d360: 61.2,
    avgTrade: 1.4,
    users: 430,
  },
  {
    slug: "bnb-swing",
    name: "BNB Swing",
    category: "crypto",
    pair: "BNB/USDT",
    strategy: "Swing",
    timeframe: "1H",
    risk: "Medium",
    winRate: 64.1,
    pf: 2.18,
    d30: 3.87,
    d90: 22.15,
    d180: 48.6,
    d360: 110.9,
    avgTrade: 2.05,
    users: 610,
  },
];

const FOREX: BotRow[] = [
  { slug: "eurusd-trend", name: "EURUSD Trend", category: "forex", pair: "EUR/USD", strategy: "Trend", timeframe: "1H", risk: "Low", winRate: 61.2, pf: 2.4, d30: 1.92, d90: 8.4, d180: 17.6, d360: 33.2, avgTrade: 0.8, users: 980 },
  { slug: "gbpusd-breakout", name: "GBPUSD Breakout", category: "forex", pair: "GBP/USD", strategy: "Breakout", timeframe: "30m", risk: "Medium", winRate: 55.0, pf: 1.9, d30: -2.1, d90: 6.7, d180: 14.2, d360: 27.9, avgTrade: 0.6, users: 540 },
  { slug: "usdjpy-grid", name: "USDJPY Grid", category: "forex", pair: "USD/JPY", strategy: "Grid", timeframe: "15m", risk: "Low", winRate: 70.5, pf: 2.7, d30: 2.4, d90: 9.8, d180: 19.1, d360: 38.5, avgTrade: 0.5, users: 760 },
  { slug: "audusd-carry", name: "AUDUSD Carry", category: "forex", pair: "AUD/USD", strategy: "Carry", timeframe: "4H", risk: "Medium", winRate: 58.8, pf: 2.0, d30: 1.1, d90: 5.5, d180: null, d360: null, avgTrade: 0.7, users: 410 },
];

const COMMODITIES: BotRow[] = [
  { slug: "gold-momentum", name: "Gold Momentum", category: "commodities", pair: "XAU/USD", strategy: "Momentum", timeframe: "1H", risk: "Medium", winRate: 63.4, pf: 2.2, d30: 3.1, d90: 11.9, d180: 24.5, d360: 52.7, avgTrade: 1.2, users: 870 },
  { slug: "silver-swing", name: "Silver Swing", category: "commodities", pair: "XAG/USD", strategy: "Swing", timeframe: "4H", risk: "High", winRate: 54.2, pf: 1.7, d30: -3.4, d90: 7.2, d180: 15.8, d360: 29.4, avgTrade: 1.5, users: 320 },
  { slug: "crude-oil-trend", name: "Crude Oil Trend", category: "commodities", pair: "WTI/USD", strategy: "Trend", timeframe: "1H", risk: "High", winRate: 57.9, pf: 1.8, d30: -1.2, d90: 9.3, d180: 18.7, d360: 41.1, avgTrade: 1.8, users: 460 },
  { slug: "natgas-breakout", name: "NatGas Breakout", category: "commodities", pair: "NG/USD", strategy: "Breakout", timeframe: "30m", risk: "High", winRate: 51.0, pf: 1.6, d30: -5.6, d90: 4.8, d180: null, d360: null, avgTrade: 2.1, users: 210 },
];

const STOCKS: BotRow[] = [
  { slug: "tesla-momentum", name: "Tesla Momentum", category: "stocks", pair: "TSLA", strategy: "Momentum", timeframe: "15m", risk: "High", winRate: 59.3, pf: 1.9, d30: 2.7, d90: 13.4, d180: 27.8, d360: 58.2, avgTrade: 1.6, users: 1020 },
  { slug: "apple-swing", name: "Apple Swing", category: "stocks", pair: "AAPL", strategy: "Swing", timeframe: "1H", risk: "Low", winRate: 68.7, pf: 2.6, d30: 1.8, d90: 7.9, d180: 16.3, d360: 34.6, avgTrade: 0.9, users: 1340 },
  { slug: "nvidia-breakout", name: "Nvidia Breakout", category: "stocks", pair: "NVDA", strategy: "Breakout", timeframe: "5m", risk: "Medium", winRate: 62.5, pf: 2.3, d30: 4.9, d90: 21.7, d180: 49.2, d360: 121.5, avgTrade: 1.3, users: 1580 },
  { slug: "spy-index-trend", name: "SPY Index Trend", category: "stocks", pair: "SPY", strategy: "Trend", timeframe: "4H", risk: "Low", winRate: 71.2, pf: 2.9, d30: 1.2, d90: 5.6, d180: 11.8, d360: 23.4, avgTrade: 0.4, users: 1990 },
];

export const BOTS_BY_CATEGORY: Record<Category, BotRow[]> = {
  crypto: CRYPTO,
  forex: FOREX,
  commodities: COMMODITIES,
  stocks: STOCKS,
};

const ALL_BOTS: BotRow[] = [...CRYPTO, ...FOREX, ...COMMODITIES, ...STOCKS];

/* ── Formatters ────────────────────────────────────────────────────────── */

/** Signed percentage for performance cells, e.g. `+2.49%` / `-1.88%`. */
export function signedPct(value: number | null): string {
  if (value === null) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Unsigned percentage for rate cells, e.g. `87.88%`. */
export function plainPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatUsers(value: number): string {
  return value.toLocaleString("en-US");
}

/** Tone for a performance value: null → muted, positive → green, else red. */
export function perfTone(value: number | null): "muted" | "success" | "danger" {
  if (value === null) return "muted";
  return value >= 0 ? "success" : "danger";
}

/** Same as {@link perfTone} but mapped to a {@link StatTone} (null → default). */
export function perfStatTone(value: number | null): StatTone {
  if (value === null) return "default";
  return value >= 0 ? "success" : "danger";
}

/* ── Detail model ──────────────────────────────────────────────────────── */

export type StatTone = "default" | "success" | "danger";

export type StatCard = { label: string; value: string; tone?: StatTone };
export type TradeProfileRow = { label: string; target: string; allocation: string };
export type TradingMetric = { label: string; value: string; tone?: StatTone };
export type StrategyUpdate = { version: string; title: string; date: string };

export type BotDetail = {
  row: BotRow;
  /** `Pair · Strategy · Category`, e.g. "BTC/USDT · Scalping · Crypto". */
  subtitle: string;
  statCards: StatCard[];
  /** Monthly equity series, normalised 0..1 (1 = chart top). 8 points. */
  equityCurve: number[];
  equitySafe: number[];
  equityMonths: string[];
  tradeProfile: TradeProfileRow[];
  metrics: TradingMetric[];
  updates: StrategyUpdate[];
};

export const EQUITY_MONTHS = ["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

/** A take-profit ladder mirroring the source design's Trade Profile table. */
const DEFAULT_TRADE_PROFILE: TradeProfileRow[] = [
  { label: "Take profit 1", target: "1.44%", allocation: "7% of assets" },
  { label: "Take profit 2", target: "3.61%", allocation: "38% of assets" },
  { label: "Take profit 3", target: "4.28%", allocation: "19% of assets" },
  { label: "Take profit 4", target: "5.24%", allocation: "18% of assets" },
  { label: "Take profit 5", target: "6.16%", allocation: "8% of assets" },
  { label: "Take profit 6", target: "8.52%", allocation: "10% of assets" },
];

const DEFAULT_UPDATES: StrategyUpdate[] = [
  { version: "v2.3", title: "Entry logic improved", date: "Mar 2026" },
  { version: "v2.2", title: "Risk adjustment added", date: "Feb 2026" },
  { version: "v2.1", title: "Performance optimization", date: "Jan 2026" },
  { version: "v2.0", title: "Strategy upgrade", date: "Dec 2025" },
];

const TITLE: Record<Category, string> = {
  crypto: "Crypto",
  forex: "Forex",
  commodities: "Commodities",
  stocks: "Stocks",
};

/** Stable 0..1 hash from a string — keeps generated curves deterministic. */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** Gently rising, lightly wavy equity series in 0..1 (1 = top of chart). */
function buildEquityCurve(seed: string, smooth: boolean): number[] {
  const base = hash01(seed);
  return EQUITY_MONTHS.map((_, i) => {
    const t = i / (EQUITY_MONTHS.length - 1);
    const wave = smooth ? 0 : Math.sin((t + base) * Math.PI * 2.2) * 0.06;
    // Climb from ~0.7 (bottom area) up toward ~0.22 (near top); y is inverted.
    const y = 0.7 - t * 0.48 + wave;
    return Math.min(0.92, Math.max(0.12, y));
  });
}

/** Build a fully-populated detail object for `slug`, or `null` if unknown. */
export function getBotDetail(slug: string): BotDetail | null {
  const row = ALL_BOTS.find((b) => b.slug === slug);
  if (!row) return null;

  const d = row.detail ?? {};
  const winrate = d.winrate ?? row.winRate;
  const profitFactor = d.profitFactor ?? row.pf;
  const netProfit = d.netProfit ?? row.d360 ?? row.d180 ?? row.d90 ?? 0;
  const tradeCount = d.tradeCount ?? Math.round(row.users * 1.4 + 120);
  const stopLoss = d.stopLoss ?? 3;
  const leverage = d.leverage ?? 5;
  const slToBe = d.slToBe ?? "TP1";

  const statCards: StatCard[] = [
    { label: "30 Days Performance", value: signedPct(row.d30), tone: perfStatTone(row.d30) },
    { label: "90 Days Performance", value: signedPct(row.d90), tone: perfStatTone(row.d90) },
    { label: "180 Days Performance", value: signedPct(row.d180), tone: perfStatTone(row.d180) },
    { label: "360 Days Performance", value: signedPct(row.d360), tone: perfStatTone(row.d360) },
    { label: "Winrate", value: plainPct(winrate) },
    { label: "Profit Factor", value: profitFactor.toFixed(2) },
  ];

  const metrics: TradingMetric[] = [
    { label: "Stop Loss", value: `${stopLoss}%`, tone: "danger" },
    { label: "SL to BE", value: slToBe },
    { label: "Leverage", value: `${leverage}x` },
    { label: "Trade Count", value: formatUsers(tradeCount) },
    { label: "Winrate", value: plainPct(winrate), tone: "success" },
    { label: "Net Profit", value: signedPct(netProfit), tone: netProfit >= 0 ? "success" : "danger" },
  ];

  return {
    row,
    subtitle: `${row.pair} · ${row.strategy} · ${TITLE[row.category]}`,
    statCards,
    equityCurve: buildEquityCurve(row.slug, false),
    equitySafe: buildEquityCurve(`${row.slug}-safe`, true),
    equityMonths: EQUITY_MONTHS,
    tradeProfile: DEFAULT_TRADE_PROFILE,
    metrics,
    updates: DEFAULT_UPDATES,
  };
}

/** All slugs — used to prerender detail pages via generateStaticParams. */
export function allBotSlugs(): string[] {
  return ALL_BOTS.map((b) => b.slug);
}
