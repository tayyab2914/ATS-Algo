"use client";

import { useState } from "react";
import { SettingsCard } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";

/**
 * Toggle email-based two-factor authentication. When enabled, future logins
 * require a one-time code emailed to the account address after the password.
 */
export function TwoFactorSection({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<NoticeData | null>(null);

  async function setTwoFactor(next: boolean) {
    setPending(true);
    setBanner(null);
    try {
      const res = await fetch("/api/account/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        setEnabled(next);
        setBanner({
          type: "success",
          message: next
            ? "Two-factor authentication is on. We'll email a code at your next login."
            : "Two-factor authentication is off.",
        });
      } else {
        setBanner({ type: "error", message: "Couldn't update two-factor authentication. Please try again." });
      }
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard
      title="Two-Factor Authentication"
      subtitle="Require a one-time code, emailed to your address, each time you sign in."
    >
      {banner && <Notice notice={banner} />}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-background/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              enabled ? "bg-success shadow-[0_0_8px_rgba(34,197,94,0.7)]" : "bg-muted/50",
            )}
          />
          <span className="text-sm font-medium text-white">{enabled ? "Enabled" : "Disabled"}</span>
          {pending && <span className="text-xs text-muted">Saving…</span>}
        </div>

        <Switch
          checked={enabled}
          disabled={pending}
          onChange={setTwoFactor}
          ariaLabel="Toggle two-factor authentication"
        />
      </div>
    </SettingsCard>
  );
}
