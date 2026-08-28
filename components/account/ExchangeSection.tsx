"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiGuideDialog } from "@/components/account/ApiGuideDialog";
import { DangerAction, PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { type ExchangeName } from "@/lib/account";
import { BOT_EXCHANGES, exchangeEnabled, exchangeRequiresPassphrase } from "@/lib/bot-exchanges";
import { guideFor, type ExchangeGuide } from "@/lib/exchange-guides";

type Connections = Partial<Record<ExchangeName, { permissions: string }>>;

const inputClass =
  "h-[42px] w-full rounded-lg border border-line bg-surface px-3 text-sm text-white placeholder-muted outline-none focus:border-accent";

export function ExchangeSection({
  initial,
  egressIp = null,
}: {
  initial: Connections;
  /** The platform's fixed egress IP, when exchange calls are proxied through one. */
  egressIp?: string | null;
}) {
  const router = useRouter();
  const [connections, setConnections] = useState<Connections>(initial);
  const [adding, setAdding] = useState<ExchangeName | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  // Only ever sent for a venue that cannot reveal it from the key itself (BingX).
  const [sandbox, setSandbox] = useState(false);
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);
  // The open walkthrough, if any. One dialog for the whole list rather than one
  // per row — only ever one is open.
  const [guide, setGuide] = useState<ExchangeGuide | null>(null);

  function openForm(exchange: ExchangeName) {
    setBanner(null);
    setApiKey("");
    setApiSecret("");
    setPassphrase("");
    setSandbox(false); // default LIVE — the safe direction; a demo key on the live host fails loudly
    setAdding(exchange);
  }

  async function connect(exchange: ExchangeName) {
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/account/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange, apiKey, apiSecret, passphrase, sandbox }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not connect." });
        return;
      }
      setConnections((prev) => ({ ...prev, [exchange]: { permissions: data.permissions } }));
      setAdding(null);
      // Re-sync the server-rendered connection list for back/forward navigation.
      router.refresh();
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
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard title="Exchange API Connections">
      {banner && <Notice notice={banner} />}

      <ul className="flex flex-col">
        {BOT_EXCHANGES.map((venue) => {
          const exchange = venue.value as ExchangeName;
          const connection = connections[exchange];
          const isAdding = adding === exchange;
          const needsPassphrase = exchangeRequiresPassphrase(exchange);
          // The registry predicate, NOT the raw `connectable` flag: a venue whose
          // execution path isn't wired must not offer a form, or the key validates and
          // then every signal is silently dropped.
          const canConnect = exchangeEnabled(exchange);
          const venueGuide = guideFor(exchange);
          return (
            <li
              key={exchange}
              className="flex flex-col gap-4 border-b border-line/60 py-4 first:pt-0 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-white">{venue.label}</span>
                  <span className="text-xs text-muted">
                    {!canConnect
                      ? "Coming soon"
                      : connection
                        ? `API Connected • ${connection.permissions}`
                        : "Not connected"}
                  </span>
                  {canConnect && venue.connectNote && (
                    <span className="text-xs text-[#F4A825]">{venue.connectNote}</span>
                  )}
                  {canConnect && venue.thirdPartyAppName && (
                    <span className="text-xs text-[#F4A825]">
                      Create the key under{" "}
                      <span className="text-white">&ldquo;Connect to Third-Party Applications&rdquo;</span> and choose{" "}
                      <span className="font-semibold text-white">{venue.thirdPartyAppName}</span> — a key scoped to
                      anything else is rejected when we place orders.
                    </span>
                  )}
                  {canConnect && venueGuide && (
                    <button
                      type="button"
                      onClick={() => setGuide(venueGuide)}
                      className="w-fit text-xs font-medium text-accent transition-opacity hover:opacity-80"
                    >
                      Full guide: how to set up the {venue.label} API →
                    </button>
                  )}
                </div>

                {!canConnect ? (
                  <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
                    Coming soon
                  </span>
                ) : connection ? (
                  <DangerAction type="button" onClick={() => remove(exchange)} disabled={pending}>
                    Remove
                  </DangerAction>
                ) : (
                  <PrimaryAction type="button" onClick={() => openForm(exchange)} disabled={pending}>
                    Add Exchange
                  </PrimaryAction>
                )}
              </div>

              {isAdding && canConnect && !connection && (
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-background p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input
                      placeholder="API Key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      placeholder="API Secret"
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      className={inputClass}
                    />
                    {needsPassphrase && (
                      <input
                        placeholder="Passphrase"
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        className={inputClass}
                      />
                    )}
                  </div>
                  {!venue.paperDetectableFromKey && (
                    <label className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={sandbox}
                        onChange={(e) => setSandbox(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-accent"
                      />
                      <span className="text-xs text-muted">
                        This is a <span className="text-white">Demo (VST) key</span> — tick only if
                        you want bots on this connection to trade {venue.label}&apos;s paper engine
                        with virtual funds.
                        <br />
                        {venue.label} uses the <span className="text-white">same API key</span> for
                        demo and live, so we can&apos;t detect this for you. Left unticked, this
                        connection trades <span className="text-white">real money</span>.
                      </span>
                    </label>
                  )}
                  <p className="text-xs text-muted">
                    Use a <span className="text-white">trade-only</span> key with{" "}
                    <span className="text-white">withdrawal disabled</span>.
                    {needsPassphrase && ` ${venue.label} also requires the passphrase you set on the key.`}{" "}
                    {egressIp ? (
                      <>
                        For extra safety, restrict the key to our fixed IP{" "}
                        <code className="select-all rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-accent">
                          {egressIp}
                        </code>{" "}
                        — every order we place reaches {exchange} from this address only.
                      </>
                    ) : (
                      <>
                        For now, leave the key <span className="text-white">not IP-restricted</span> —
                        we&apos;ll publish a fixed IP to whitelist later.
                      </>
                    )}
                  </p>
                  {/* Only where the venue actually deletes idle keys. Without this the advice
                      above ("leave it un-IP-restricted") quietly comes with an expiry date. */}
                  {!egressIp && venue.unusedKeyExpiryDays !== undefined && (
                    <p className="text-xs text-[#F4A825]">
                      Note: {venue.label} automatically deletes an API key that has trading
                      permission, no IP restriction, and{" "}
                      <span className="text-white">no API activity for {venue.unusedKeyExpiryDays} days</span>.
                      If your bot goes that long without trading you may need to create a new key.
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <PrimaryAction type="button" onClick={() => connect(exchange)} disabled={pending}>
                      {pending ? "Validating…" : "Save Connection"}
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

      <ApiGuideDialog open={guide !== null} guide={guide} onClose={() => setGuide(null)} />
    </SettingsCard>
  );
}
