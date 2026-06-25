"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PrimaryAction, SettingsCard } from "@/components/account/SettingsCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/lib/cn";

type Step = "idle" | "enter" | "current" | "new";

const ENDPOINT = "/api/account/email-change";

/** HTTP statuses that mean "this flow is dead — send the user back to the start". */
const TERMINAL = new Set([404, 409, 410, 429]);

/**
 * Email Address section. Changing the address is a two-step verification flow:
 *   1. a code is emailed to the CURRENT address (prove you own the account),
 *   2. a code is emailed to the NEW address (prove you own the destination),
 * and only then is the change committed. The new address is also checked for
 * availability up front so a duplicate is rejected before any code is sent.
 */
export function EmailChangeSection({ email, verified }: { email: string; verified: boolean }) {
  const router = useRouter();
  const [currentEmail, setCurrentEmail] = useState(email);
  const [isVerified, setIsVerified] = useState(verified);

  const [step, setStep] = useState<Step>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  // Resume an in-progress change after a page refresh.
  useEffect(() => {
    let active = true;
    fetch(ENDPOINT)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data?.pending) return;
        setStep(data.pending.stage === "new" ? "new" : "current");
        setSentTo(data.pending.sentTo);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function reset() {
    setStep("idle");
    setNewEmail("");
    setCode("");
    setSentTo("");
  }

  /** Map a failed response to a banner and, for terminal errors, bounce to start. */
  function handleError(res: Response, data: { error?: string }) {
    setBanner({ type: "error", message: data.error ?? "Something went wrong. Please try again." });
    if (TERMINAL.has(res.status)) {
      // Keep the typed address so the user can simply resubmit.
      setStep((s) => (s === "idle" ? "idle" : "enter"));
      setCode("");
    }
  }

  async function send(path: string, body?: unknown) {
    const res = await fetch(`${ENDPOINT}${path}`, {
      method: body === undefined && path === "" ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    setPending(true);
    try {
      const { res, data } = await send("", { email: newEmail });
      if (!res.ok) return handleError(res, data);
      setSentTo(data.sentTo);
      setCode("");
      setStep("current");
      setBanner({ type: "info", message: `We sent a 6-digit code to ${data.sentTo}.` });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    setPending(true);
    const stage = step; // "current" | "new"
    try {
      const path = stage === "current" ? "/verify-current" : "/verify-new";
      const { res, data } = await send(path, { code });
      if (!res.ok) return handleError(res, data);

      if (stage === "current") {
        setSentTo(data.sentTo);
        setCode("");
        setStep("new");
        setBanner({ type: "info", message: `Code confirmed. We sent a new code to ${data.sentTo}.` });
      } else {
        setCurrentEmail(data.email);
        setIsVerified(true);
        reset();
        setBanner({ type: "success", message: `Your email is now ${data.email}.` });
        router.refresh(); // update the sidebar + session-derived UI
      }
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setBanner(null);
    setPending(true);
    try {
      const { res, data } = await send("/resend", {});
      if (!res.ok) return handleError(res, data);
      setSentTo(data.sentTo);
      setBanner({ type: "info", message: `New code sent to ${data.sentTo}.` });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    setBanner(null);
    setPending(true);
    try {
      await fetch(ENDPOINT, { method: "DELETE" });
    } catch {
      /* best-effort */
    } finally {
      reset();
      setPending(false);
    }
  }

  const inChange = step === "current" || step === "new";

  return (
    <SettingsCard
      title="Email Address"
      subtitle="Change the email on your account. We verify both your current and new address before anything changes."
    >
      {banner && <Notice notice={banner} />}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-background/40 px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Current email</span>
          <span className="text-sm font-medium text-white">{currentEmail}</span>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            isVerified
              ? "border-success/30 bg-success/10 text-success"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400",
          )}
        >
          {isVerified ? "Verified" : "Unverified"}
        </span>
      </div>

      {step === "idle" && (
        <PrimaryAction type="button" onClick={() => setStep("enter")}>
          Change email
        </PrimaryAction>
      )}

      {step === "enter" && (
        <form className="flex flex-col gap-3" onSubmit={start} noValidate>
          <TextField
            id="newEmail"
            label="New email address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
          <p className="text-[11px] leading-[16px] text-muted/70">
            We&apos;ll send a code to your current email first, then to the new one. The change
            only applies once both are confirmed.
          </p>
          <div className="flex items-center gap-3">
            <PrimaryAction type="submit" disabled={pending || !newEmail.trim()}>
              {pending ? "Sending…" : "Send verification code"}
            </PrimaryAction>
            <TextButton onClick={cancel} disabled={pending}>
              Cancel
            </TextButton>
          </div>
        </form>
      )}

      {inChange && (
        <form className="flex flex-col gap-3" onSubmit={verify} noValidate>
          <p className="text-xs leading-[18px] text-muted">
            <span className="font-semibold text-white">Step {step === "current" ? "1" : "2"} of 2</span>{" "}
            — enter the 6-digit code we sent to{" "}
            <span className="font-medium text-white">{sentTo}</span>{" "}
            ({step === "current" ? "your current email" : "your new email"}).
          </p>
          <TextField
            id="emailChangeCode"
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
          />
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryAction type="submit" disabled={pending || code.length !== 6}>
              {pending ? "Verifying…" : step === "current" ? "Verify & continue" : "Confirm new email"}
            </PrimaryAction>
            <TextButton onClick={resend} disabled={pending}>
              Resend code
            </TextButton>
            <TextButton onClick={cancel} disabled={pending}>
              Cancel
            </TextButton>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}

/** Subtle inline text button for secondary actions (resend / cancel). */
function TextButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="text-sm font-semibold text-muted transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
