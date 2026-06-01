"use client";

import { useState } from "react";
import { PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";
import { cn } from "@/lib/cn";

export function TradingViewSection({ initialConnected }: { initialConnected: boolean }) {
  const [connected, setConnected] = useState(initialConnected);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      const res = await fetch("/api/account/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "tradingview", connected: !connected }),
      });
      if (res.ok) setConnected((value) => !value);
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard
      title="TradingView Connection"
      subtitle="Connect TradingView alerts to automate entries, stop loss, and take profits."
    >
      <div className="flex flex-wrap items-center gap-6">
        <PrimaryAction type="button" onClick={toggle} disabled={pending}>
          {connected ? "Disconnect" : "Connect Trading View"}
        </PrimaryAction>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-sm font-semibold",
            connected ? "bg-success/10 text-success" : "bg-muted/10 text-muted",
          )}
        >
          {connected ? "Connected" : "Not Connected"}
        </span>
      </div>
    </SettingsCard>
  );
}
