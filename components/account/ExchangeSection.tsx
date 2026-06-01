"use client";

import { useState } from "react";
import { DangerAction, PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { EXCHANGES, type ExchangeName } from "@/lib/account";

type Connections = Partial<Record<ExchangeName, { permissions: string }>>;

export function ExchangeSection({ initial }: { initial: Connections }) {
  const [connections, setConnections] = useState<Connections>(initial);
  const [adding, setAdding] = useState<ExchangeName | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  function openForm(exchange: ExchangeName) {
    setBanner(null);
    setApiKey("");
    setApiSecret("");
    setAdding(exchange);
  }

  async function connect(exchange: ExchangeName) {
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/account/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange, apiKey, apiSecret }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not connect." });
        return;
      }
      setConnections((prev) => ({ ...prev, [exchange]: { permissions: data.permissions } }));
      setAdding(null);
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function remove(exchange: ExchangeName) {
    setPending(true);
    try {
      const res = await fetch("/api/account/exchanges", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange }),
      });
      if (res.ok) {
        setConnections((prev) => {
          const next = { ...prev };
          delete next[exchange];
          return next;
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard title="Exchange API Connections">
      {banner && <Notice notice={banner} />}

      <ul className="flex flex-col">
        {EXCHANGES.map((exchange) => {
          const connection = connections[exchange];
          const isAdding = adding === exchange;
          return (
            <li key={exchange} className="flex flex-col gap-4 border-b border-line/60 py-4 first:pt-0 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-white">{exchange}</span>
                  <span className="text-xs text-muted">
                    {connection ? `API Connected • ${connection.permissions}` : "Not connected"}
                  </span>
                </div>

                {connection ? (
                  <DangerAction type="button" onClick={() => remove(exchange)} disabled={pending}>
                    Remove
                  </DangerAction>
                ) : (
                  <PrimaryAction type="button" onClick={() => openForm(exchange)} disabled={pending}>
                    Add Exchange
                  </PrimaryAction>
                )}
              </div>

              {isAdding && !connection && (
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-background p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input
                      placeholder="API Key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-white placeholder-muted outline-none focus:border-accent"
                    />
                    <input
                      placeholder="API Secret"
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      className="h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-white placeholder-muted outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <PrimaryAction type="button" onClick={() => connect(exchange)} disabled={pending}>
                      {pending ? "Connecting…" : "Save Connection"}
                    </PrimaryAction>
                    <button
                      type="button"
                      onClick={() => setAdding(null)}
                      className="text-sm text-muted transition-colors hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
