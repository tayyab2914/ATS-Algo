"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { DEFAULTS, calculate, positionSizeForRisk, type Side } from "@/lib/portfolio/calculator";

/**
 * Leverage / PnL calculator. Everything is derived in the browser from
 * `lib/portfolio/calculator.ts`; nothing is sent anywhere.
 */

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function Field({ label, value, onChange, suffix, step = "any", min = 0 }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; step?: string; min?: number }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex items-center rounded-xl border border-line bg-background focus-within:border-accent/50">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full bg-transparent px-3 text-sm text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="pr-3 text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "success" | "danger"; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-background p-3">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={cn("text-base font-semibold", tone === "success" ? "text-success" : tone === "danger" ? "text-[#D2031E]" : "text-white")}>
        {value}
      </span>
      {hint && <span className="text-[10px] leading-3 text-muted">{hint}</span>}
    </div>
  );
}

export function LeverageCalculator() {
  const [side, setSide] = useState<Side>("long");
  const [entry, setEntry] = useState("64000");
  const [exit, setExit] = useState("66000");
  const [quantity, setQuantity] = useState("0.05");
  const [leverage, setLeverage] = useState("7");
  const [fee, setFee] = useState(String(DEFAULTS.feePct));

  // Risk sizing is an independent question: how big may the position be?
  const [balance, setBalance] = useState("1000");
  const [riskPct, setRiskPct] = useState("1");
  const [stop, setStop] = useState("61440");

  const n = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const result = useMemo(
    () =>
      calculate({
        side,
        entryPrice: n(entry),
        exitPrice: n(exit),
        quantity: n(quantity),
        leverage: Math.max(n(leverage), 1),
        feePct: n(fee),
        maintenanceMarginPct: DEFAULTS.maintenanceMarginPct,
      }),
    [side, entry, exit, quantity, leverage, fee],
  );

  const suggestedSize = useMemo(
    () => positionSizeForRisk(n(balance), n(riskPct), n(entry), n(stop)),
    [balance, riskPct, entry, stop],
  );

  const profitable = result.netPnl >= 0;

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-white">Leverage &amp; PnL calculator</h2>
        <p className="text-xs text-muted">Runs entirely in your browser. Nothing is saved or sent.</p>
      </div>

      <div className="flex gap-1 self-start rounded-lg border border-line bg-background p-1">
        {(["long", "short"] as Side[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSide(option)}
            className={cn(
              "rounded-md px-4 py-1.5 text-xs font-semibold capitalize transition-colors",
              side === option
                ? option === "long"
                  ? "bg-success text-[#06141a]"
                  : "bg-[#D2031E] text-white"
                : "text-muted hover:text-white",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Field label="Entry price" value={entry} onChange={setEntry} suffix="USDT" />
        <Field label="Exit price" value={exit} onChange={setExit} suffix="USDT" />
        <Field label="Quantity" value={quantity} onChange={setQuantity} suffix="BTC" />
        <Field label="Leverage" value={leverage} onChange={setLeverage} suffix="x" min={1} />
        <Field label="Taker fee" value={fee} onChange={setFee} suffix="%" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Position size" value={money(result.notional)} />
        <Stat label="Margin required" value={money(result.margin)} />
        <Stat label="Fees (round trip)" value={money(result.fees)} />
        <Stat label="Net PnL" value={signed(result.netPnl)} tone={profitable ? "success" : "danger"} hint={`gross ${signed(result.grossPnl)}`} />
        <Stat label="ROI on margin" value={pct(result.roi)} tone={profitable ? "success" : "danger"} hint={`price ${pct(result.priceMove)}`} />
        <Stat
          label="Est. liquidation"
          value={money(result.liquidationPrice)}
          tone="danger"
          hint={`${result.distanceToLiquidation.toFixed(2)}% away`}
        />
      </div>

      <p className="text-[11px] leading-4 text-muted">
        Liquidation is an estimate for an isolated position at a {DEFAULTS.maintenanceMarginPct}% maintenance margin.
        Funding, fees and a venue&apos;s tiered margin table move the real level, and cross-margin shares collateral
        across positions. Treat it as a guide, never a guarantee.
      </p>

      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-white">Position size from risk</h3>
          <p className="text-xs text-muted">
            How large a position can be if being stopped out costs a fixed share of the account. Leverage doesn&apos;t
            change the answer — only the stop distance does.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Account balance" value={balance} onChange={setBalance} suffix="USDT" />
          <Field label="Risk per trade" value={riskPct} onChange={setRiskPct} suffix="%" />
          <Field label="Stop price" value={stop} onChange={setStop} suffix="USDT" />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Suggested quantity</span>
            <div className="flex h-11 items-center justify-between rounded-xl border border-accent/40 bg-accent/5 px-3">
              <span className="text-sm font-semibold text-accent">{suggestedSize > 0 ? suggestedSize.toFixed(6) : "—"}</span>
              <span className="text-xs text-muted">BTC</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
