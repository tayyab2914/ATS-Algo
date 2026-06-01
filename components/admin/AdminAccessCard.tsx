"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PinInput } from "@/components/admin/PinInput";
import { Button } from "@/components/ui/Button";
import { Notice, type NoticeData } from "@/components/ui/Notice";

type Step = "request" | "verify";

/**
 * Admin access via emailed one-time code.
 *
 * Step 1 ("request"): "Get Code" emails a 4-digit code to the admin address.
 * Step 2 ("verify"): the admin enters that code to sign in and is redirected
 * to the admin dashboard.
 */
export function AdminAccessCard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [code, setCode] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode() {
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/request-code", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not send the code." });
        return;
      }
      setStep("verify");
      setCode("");
      setBanner({ type: "success", message: "A 4-digit code has been sent to the admin email. Check your inbox." });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    if (code.length !== 4) {
      setBanner({ type: "error", message: "Enter the 4-digit code from your email." });
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Unlock failed." });
        return;
      }
      router.push("/admin/dashboard");
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-[450px] flex-col items-start gap-6">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-semibold leading-[31px] text-heading">Admin Access</h1>
        <p className="text-xs leading-[18px] text-muted">
          {step === "request"
            ? "Request a one-time code to continue"
            : "Enter the 4-digit code sent to your email"}
        </p>
      </header>

      {banner && <Notice notice={banner} />}

      {step === "request" ? (
        <div className="flex w-full flex-col gap-4">
          <Button type="button" variant="primary" onClick={requestCode} disabled={pending}>
            {pending ? "Sending…" : "Get Code"}
          </Button>
        </div>
      ) : (
        <form className="flex w-full flex-col gap-4" onSubmit={verifyCode}>
          <div className="flex w-full flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Verification Code</span>
            <PinInput length={4} onChange={setCode} />
          </div>

          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Verifying…" : "Unlock"}
          </Button>

          <button
            type="button"
            onClick={requestCode}
            disabled={pending}
            className="self-center text-xs text-muted underline-offset-4 transition-colors hover:text-accent hover:underline disabled:opacity-60"
          >
            Didn&apos;t get it? Resend code
          </button>
        </form>
      )}
    </div>
  );
}
