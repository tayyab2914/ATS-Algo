"use client";

import { useState } from "react";
import { PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";

function shorten(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function WalletSection({
  initialConnected,
  initialAddress,
}: {
  initialConnected: boolean;
  initialAddress: string | null;
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [address, setAddress] = useState(initialAddress);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      const res = await fetch("/api/account/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "wallet", connected: !connected }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConnected(!connected);
        setAddress(!connected ? (data.walletAddress ?? null) : null);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard title="Wallet Connection">
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryAction type="button" onClick={toggle} disabled={pending}>
          {connected ? "Disconnect Wallet" : "Connect Wallet"}
        </PrimaryAction>
        {connected && address && (
          <span className="flex items-center gap-2 text-sm text-muted">
            <span className="size-2 rounded-full bg-success" />
            <span className="font-mono">{shorten(address)}</span>
          </span>
        )}
      </div>
    </SettingsCard>
  );
}
