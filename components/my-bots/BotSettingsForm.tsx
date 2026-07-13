"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ExchangeBadge } from "@/components/admin/ExchangeBadge";
import { cn } from "@/lib/cn";

export type BotSettingsValues = {
  allocationType: "FIXED" | "PERCENTAGE";
  capitalPerTrade: number;
  /** The pool a PERCENTAGE bot sizes off. For FIXED it just mirrors capitalPerTrade. */
  allocatedCapital: number;
  compounding: boolean;
};

/**
 * Bot Settings form — capital allocation and compounding for a deployment.
 * Persists to `PATCH /api/my-bots/[botId]`.
 *
 * The execution exchange is NOT a user choice: it's fixed by the bot (the admin
 * assigns it at creation), so it's shown read-only with a live connection status.
 * The user's job is to connect an API key for that exchange. The Performance
 * Overview panel is passed in as `children` (static, server-rendered).
 */
export function BotSettingsForm({
  botId,
  initial,
  exchanges,
  chosen,
  connectedByExchange,
  children,
}: {
  botId: string;
  initial: BotSettingsValues;
  /** Exchanges the admin allows this bot on. */
  exchanges: string[];
  /** The exchange the user has chosen (null when multiple allowed and none picked). */
  chosen: string | null;
  /** Connection status per allowed exchange — lets switching be instant client-side. */
  connectedByExchange: Record<string, boolean>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [allocationType, setAllocationType] = useState(initial.allocationType);
  const [capital, setCapital] = useState(initial.capitalPerTrade ? String(initial.capitalPerTrade) : "");
  // The total pool, used only in PERCENTAGE mode (FIXED mirrors capital per trade).
  const [allocated, setAllocated] = useState(initial.allocatedCapital ? String(initial.allocatedCapital) : "");
  const [compounding, setCompounding] = useState(initial.compounding);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  // Local, optimistic pick — the highlight + connection status update instantly;
  // the choice persists in the background (no page refresh), reverting on failure.
  const [selected, setSelected] = useState(chosen);

  function selectExchange(ex: string) {
    if (ex === selected) return;
    const prev = selected;
    setSelected(ex);
    fetch(`/api/my-bots/${botId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeSource: ex }),
    })
      .then((res) => {
        if (!res.ok) setSelected(prev);
      })
      .catch(() => setSelected(prev));
  }

  const selectedConnected = selected ? Boolean(connectedByExchange[selected]) : false;

  async function save() {
    setSaving(true);
    setStatus("idle");
    try {
      const perTrade = Math.max(0, Number(capital) || 0);
      // FIXED: the pool IS the per-trade amount, so "Allocated" shows it and nothing
      // drifts. PERCENTAGE: the pool is the separate amount the user entered.
      const pool = allocationType === "FIXED" ? perTrade : Math.max(0, Number(allocated) || 0);
      const res = await fetch(`/api/my-bots/${botId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocationType,
          capitalPerTrade: perTrade,
          allocatedCapital: pool,
          compounding,
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
                ? "Each trade risks a percentage of your allocated capital."
                : "Every trade uses the same fixed capital — that amount is your allocated capital."}
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {/* PERCENTAGE needs a pool to take a % of; FIXED derives the pool from
                the per-trade amount, so this input is hidden there. */}
            {isPercent && (
              <div className="flex flex-col gap-2">
                <span className="text-sm text-muted">Allocated Capital</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={allocated}
                    onChange={(e) => setAllocated(e.target.value)}
                    placeholder="Total pool for this bot"
                    className="h-11 w-full rounded-2xl border border-line bg-background pl-8 pr-4 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            )}

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

      {/* Execution Exchange — the admin allows a set; the user picks one. */}
      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Execution Exchange</h2>
        {exchanges.length === 0 ? (
          <p className="text-sm text-muted">No exchange is assigned to this bot yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {exchanges.length === 1 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Runs on</span>
                <span className="inline-flex items-center gap-2 rounded-full border border-line bg-background px-3 py-1.5 font-semibold">
                  <ExchangeBadge exchange={exchanges[0]} />
                </span>
              </div>
            ) : (
              <>
                <span className="text-sm text-muted">Choose the exchange to run this bot on:</span>
                <div className="flex flex-wrap gap-2">
                  {exchanges.map((ex) => {
                    const on = ex === selected;
                    return (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => selectExchange(ex)}
                        aria-pressed={on}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                          on ? "border-accent bg-accent/10" : "border-line bg-background hover:border-accent/40",
                        )}
                      >
                        <ExchangeBadge exchange={ex} />
                        {on && <span className="text-accent">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {!selected ? (
              <p className="text-sm text-[#f5a623]">⚠ Select an exchange above to run this bot.</p>
            ) : selectedConnected ? (
              <p className="text-sm text-success">✓ {selected} API key connected.</p>
            ) : (
              <p className="text-sm text-[#f5a623]">
                ⚠ Connect your {selected} API key to activate this bot.{" "}
                <Link href="/account" className="font-semibold text-accent hover:underline">
                  Connect now
                </Link>
              </p>
            )}
          </div>
        )}
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
