// Backtest calibration harness.
//
// Goal: reproduce the reference metrics for "Alpha BTC Bot" (balanced / Medium)
// from fixtures/BTC.json + fixtures/BTC.csv, so we can lock the engine algorithm
// before wiring it into the app.
//
//   Reference (from lib/bot-library.ts / the design):
//     winRate 87.88 | PF 5.78 | avgTrade 7.16
//     d30 2.49 | d90 38.98 | d180 93.53 | d360 236.37
//
// Run:  node scripts/calibrate-backtest.mjs
//
// The simulation is intentionally parameterized (see CONFIG) and prints metrics
// under several interpretations (additive vs compounded, avg-of-all vs avg-win)
// so we can see which definition matches and freeze it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Tunable assumptions (the knobs we calibrate) ─────────────────────────────
const CONFIG = {
  profile: "balanced",
  windowDays: 180, // backtest only the last N days (JSON optimized_period = 180); 0 = all
  entryAt: "close", // "close" of the signal bar, or "nextOpen"
  stopSource: "trailATR", // "trailATR" (CSV column) or "profileSL" (entry ± sl%)
  tpBeforeStop: true, // within a bar, realize TP rungs before checking the stop
  applyFees: true, // subtract taker fee on entry + exit (× leverage notional)
};

// Real target for the BTC sample (balanced/Medium), per the user:
//   trades 12 | winRate 91.67% | return -8.73% | PF 0.506
const REFERENCE = { trades: 12, winRate: 91.67, pf: 0.506, totalReturn: -8.73 };

// ── Load fixtures ────────────────────────────────────────────────────────────
const config = JSON.parse(readFileSync(join(ROOT, "fixtures", "BTC.json"), "utf8"));
let csvText;
try {
  csvText = readFileSync(join(ROOT, "fixtures", "BTC.csv"), "utf8");
} catch {
  console.error("\n  Missing fixtures/BTC.csv — drop the sample CSV there, then re-run.\n");
  process.exit(1);
}

// ── Parse candles ────────────────────────────────────────────────────────────
// columns: time,open,high,low,close,Buy,Sell,Baseline,Trailing ATR,Buy Entry Signal,Sell Entry Signal,Exit Signal,Volume
function parseCandles(text) {
  const lines = text.trim().split(/\r?\n/);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 12) continue;
    const num = (x) => (x === "" || x == null ? null : Number(x));
    rows.push({
      time: new Date(p[0]),
      open: Number(p[1]),
      high: Number(p[2]),
      low: Number(p[3]),
      close: Number(p[4]),
      trailATR: num(p[8]),
      buyEntry: p[9] === "1",
      sellEntry: p[10] === "1",
      exit: p[11] === "1",
    });
  }
  return rows;
}

let candles = parseCandles(csvText);

// Restrict to the backtest window (last N days) if configured.
if (CONFIG.windowDays > 0) {
  const last = candles[candles.length - 1].time.getTime();
  const cutoff = last - CONFIG.windowDays * 86400_000;
  candles = candles.filter((c) => c.time.getTime() >= cutoff);
}

// ── Simulate one profile ─────────────────────────────────────────────────────
function runBacktest(candles, profile, fees, cfg) {
  const { tp, w, sl, be, lev } = profile;
  const taker = (fees?.taker_fee_pct ?? 0) / 100;
  const feePerTrade = cfg.applyFees ? taker * 2 * 100 * lev : 0; // entry+exit on lev notional, in %

  const trades = [];
  let pos = null;

  const openPos = (side, c) => {
    const entry = cfg.entryAt === "nextOpen" ? c.open : c.close;
    const stop = cfg.stopSource === "profileSL"
      ? (side === "long" ? entry * (1 - sl / 100) : entry * (1 + sl / 100))
      : c.trailATR ?? (side === "long" ? entry * (1 - sl / 100) : entry * (1 + sl / 100));
    pos = { side, entry, time: c.time, realized: 0, remaining: 1, hits: 0, stop };
  };

  const settle = (exitTime) => {
    const gross = pos.realized * lev;
    const ret = gross - feePerTrade;
    trades.push({ entryTime: pos.time, exitTime, ret, side: pos.side });
    pos = null;
  };

  const closeAt = (price, exitTime) => {
    const dir = pos.side === "long" ? 1 : -1;
    pos.realized += pos.remaining * dir * ((price - pos.entry) / pos.entry) * 100;
    pos.remaining = 0;
    settle(exitTime);
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    if (pos) {
      const dir = pos.side === "long" ? 1 : -1;
      if (cfg.stopSource === "trailATR" && c.trailATR != null) pos.stop = c.trailATR;

      const tryTPs = () => {
        for (let k = pos.hits; k < tp.length; k++) {
          const tpPrice = pos.entry * (1 + dir * tp[k] / 100);
          const hit = pos.side === "long" ? c.high >= tpPrice : c.low <= tpPrice;
          if (!hit) break;
          pos.realized += w[k] * tp[k];
          pos.remaining -= w[k];
          pos.hits = k + 1;
          if (pos.hits >= be) pos.stop = pos.entry; // breakeven
        }
      };
      const tryStop = () => {
        const stopHit = pos.side === "long" ? c.low <= pos.stop : c.high >= pos.stop;
        if (pos.remaining > 1e-9 && stopHit) {
          pos.realized += pos.remaining * dir * ((pos.stop - pos.entry) / pos.entry) * 100;
          pos.remaining = 0;
        }
      };

      if (cfg.tpBeforeStop) { tryTPs(); tryStop(); } else { tryStop(); tryTPs(); }

      if (pos.remaining <= 1e-9) { settle(c.time); }
      else if (c.exit) { closeAt(c.close, c.time); }
      else if (pos.side === "long" && c.sellEntry) { closeAt(c.close, c.time); openPos("short", c); }
      else if (pos.side === "short" && c.buyEntry) { closeAt(c.close, c.time); openPos("long", c); }
      continue;
    }

    if (c.buyEntry) openPos("long", c);
    else if (c.sellEntry) openPos("short", c);
  }

  return trades;
}

const trades = runBacktest(candles, config.profiles[CONFIG.profile], config.fees, CONFIG);

// ── Metrics under several interpretations ────────────────────────────────────
const end = candles[candles.length - 1].time.getTime();
const DAY = 86400_000;
const within = (t, days) => end - t.exitTime.getTime() <= days * DAY;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const compound = (rets) => (rets.reduce((p, r) => p * (1 + r / 100), 1) - 1) * 100;

const rets = trades.map((t) => t.ret);
const wins = rets.filter((r) => r > 0);
const losses = rets.filter((r) => r < 0);
const winRate = (wins.length / trades.length) * 100;
const pf = Math.abs(sum(losses)) < 1e-9 ? Infinity : sum(wins) / Math.abs(sum(losses));

const windowRets = (days) => trades.filter((t) => within(t, days)).map((t) => t.ret);

const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : "∞");
const row = (label, val, ref) => {
  const diff = ref == null ? "" : `   (ref ${ref}, Δ ${fmt(val - ref)})`;
  console.log(`  ${label.padEnd(22)} ${fmt(val).padStart(9)}${diff}`);
};

row("trades", trades.length, REFERENCE.trades);
console.log(`  (wins ${wins.length}, losses ${losses.length})\n`);
console.log("  ── core ──");
row("winRate", winRate, REFERENCE.winRate);
row("profitFactor", pf, REFERENCE.pf);
row("totalReturn (additive)", sum(rets), REFERENCE.totalReturn);
row("totalReturn (compound)", compound(rets), REFERENCE.totalReturn);
row("avgTrade (all)", sum(rets) / rets.length, null);
row("avgWin", wins.length ? sum(wins) / wins.length : 0, null);

console.log("\n  ── period returns: ADDITIVE (sum of trade %) ──");
row("d30", sum(windowRets(30)), REFERENCE.d30);
row("d90", sum(windowRets(90)), REFERENCE.d90);
row("d180", sum(windowRets(180)), REFERENCE.d180);
row("d360", sum(windowRets(360)), REFERENCE.d360);

console.log("\n  ── period returns: COMPOUNDED ──");
row("d30", compound(windowRets(30)), REFERENCE.d30);
row("d90", compound(windowRets(90)), REFERENCE.d90);
row("d180", compound(windowRets(180)), REFERENCE.d180);
row("d360", compound(windowRets(360)), REFERENCE.d360);

console.log("\n  ── trades (entry → exit : return%) ──");
for (const t of trades) {
  const e = t.entryTime.toISOString().slice(0, 10);
  const x = t.exitTime.toISOString().slice(0, 10);
  console.log(`    ${t.side.padEnd(5)} ${e} → ${x}  ${t.ret >= 0 ? "+" : ""}${t.ret.toFixed(2)}%`);
}
console.log(`\n  CONFIG: ${JSON.stringify(CONFIG)}\n`);
