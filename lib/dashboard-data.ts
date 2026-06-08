/**
 * Static content for the dashboard UI. All numeric/data values are intentionally
 * rendered as the placeholder below — this screen is presentation-only.
 */
export const PH = "…";

export type MetricIconKey =
  | "bot"
  | "target"
  | "barChart"
  | "percent"
  | "shield"
  | "layers"
  | "trendingUp"
  | "activity";

export type Metric = {
  id: string;
  label: string;
  icon: MetricIconKey;
  /** up → green sparkline + delta; none → footer hidden (per design). */
  trend: "up" | "none";
};

export const METRICS: Metric[] = [
  { id: "active-bots", label: "Active Bots", icon: "bot", trend: "up" },
  { id: "win-rate", label: "Win Rate", icon: "target", trend: "up" },
  { id: "total-trades", label: "Total Trades", icon: "barChart", trend: "up" },
  { id: "avg-return", label: "Avg Return", icon: "percent", trend: "up" },
  { id: "risk", label: "Risk Exposure", icon: "shield", trend: "none" },
  { id: "open-positions", label: "Open Positions", icon: "layers", trend: "up" },
  { id: "profit-factor", label: "Profit Factor", icon: "trendingUp", trend: "up" },
  { id: "best-timeframe", label: "Best Timeframe", icon: "activity", trend: "none" },
];

export const TOP_BOTS = [
  { id: "alpha", name: "Alpha BTC Bot", pair: "BTC/USDT" },
  { id: "gold", name: "Gold Momentum", pair: "XAU/USD" },
  { id: "eurusd", name: "EURUSD Trend", pair: "EUR/USD" },
];

export const MY_BOTS = [
  { id: "alpha", name: "Alpha BTC Bot", profile: "Balanced", pnlPositive: true },
  { id: "aapl", name: "Apple Swing", profile: "Conservative", pnlPositive: true },
  { id: "sql", name: "SQL Breakout", profile: "Aggressive", pnlPositive: false },
];

export const HOLDINGS = [
  { id: "btc", label: "BTC", color: "#28B8D5", segment: 45 },
  { id: "eth", label: "ETH", color: "#5CC9DE", segment: 25 },
  { id: "sol", label: "SOL", color: "#23E774", segment: 15 },
  { id: "usdt", label: "USDT", color: "#8A8F98", segment: 10 },
  { id: "other", label: "Other", color: "#E8852B", segment: 5 },
];

export const TOP_ASSETS = [
  { id: "btc", pair: "BTC/USDT", positive: true },
  { id: "eth", pair: "ETH/USDT", positive: true },
  { id: "sol", pair: "SOL/USDT", positive: true },
  { id: "xrp", pair: "XRP/USDT", positive: false },
  { id: "doge", pair: "DOGE/USDT", positive: false },
];

export const PORTFOLIO_MONTHS = ["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
