"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { BotExchange } from "@/lib/bot-exchanges";

export type BotSettingsValues = {
  allocationType: "FIXED" | "PERCENTAGE";
  capitalPerTrade: number;
  compounding: boolean;
  exchangeSource: string | null;
};

/**
 * Bot Settings form — capital allocation, compounding and exchange source for a
 * deployment. Persists to `PATCH /api/my-bots/[botId]`. The Performance Overview
 * panel is passed in as `children` (static, server-rendered) and shown above the
 * Save button, matching the design.
 */
export function BotSettingsForm({
  botId,
  initial,
  exchanges,
  children,
}: {
  botId: string;
  initial: BotSettingsValues;
  exchanges: BotExchange[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [allocationType, setAllocationType] = useState(initial.allocationType);
  const [capital, setCapital] = useState(initial.capitalPerTrade ? String(initial.capitalPerTrade) : "");
  const [compounding, setCompounding] = useState(initial.compounding);
  const [exchangeSource, setExchangeSource] = useState(initial.exchangeSource ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function save() {
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch(`/api/my-bots/${botId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocationType,
          capitalPerTrade: Math.max(0, Number(capital) || 0),
          compounding,
          exchangeSource: exchangeSource || null,
        }),
      });
      if (res.ok) {
        setStatus("saved");
        router.refresh();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  }

  const isPercent = allocationType === "PERCENTAGE";

  return (
    <div className="flex flex-col gap-5">
      {/* Capital Allocation */}
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="mb-5 text-base font-semibold text-white">Capital Allocation</h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted">Choose Allocation Type</span>
            <div className="flex gap-1 rounded-2xl border border-line bg-background p-1">
              {(["FIXED", "PERCENTAGE"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAllocationType(t)}
                  className={cn(
                    "h-11 flex-1 rounded-xl px-4 text-sm font-semibold transition-colors",
                    allocationType === t ? "bg-accent text-[#06141a]" : "text-muted hover:text-white",
                  )}
                >
                  {t === "FIXED" ? "Fixed Amount" : "Percentage Allocation"}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted">
              {isPercent
                ? "Each trade risks a percentage of the allocated balance."
                : "Every trade uses the same fixed capital."}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted">Capital per Trade</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted">
                {isPercent ? "%" : "$"}
              </span>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                placeholder="Enter"
                className="h-11 w-full rounded-2xl border border-line bg-background pl-8 pr-4 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Compounding Mode */}
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Compounding Mode</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={compounding}
            onClick={() => setCompounding((c) => !c)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              compounding ? "bg-accent" : "bg-line",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-white transition-transform",
                compounding ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
          <span className="text-sm font-semibold text-white">Enable Compounding</span>
        </div>
        <p className="mt-2 text-sm text-muted">Bot increases position size based on growth.</p>
      </section>

      {/* Exchange / Wallet Source */}
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Exchange / Wallet Source</h2>
        <select
          value={exchangeSource}
          onChange={(e) => setExchangeSource(e.target.value)}
          className="h-11 w-full max-w-md rounded-2xl border border-line bg-background px-4 text-sm text-white focus:border-accent focus:outline-none"
        >
          <option value="">Select</option>
          {exchanges.map((ex) => (
            <option key={ex.value} value={ex.value}>
              {ex.label}
            </option>
          ))}
        </select>
      </section>

      {/* Performance Overview (static, server-rendered) */}
      {children}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-6 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Setting"}
        </button>
        {status === "saved" && <span className="text-sm text-success">Settings saved.</span>}
        {status === "error" && <span className="text-sm text-[#D2031E]">Couldn&apos;t save. Try again.</span>}
      </div>
    </div>
  );
}
