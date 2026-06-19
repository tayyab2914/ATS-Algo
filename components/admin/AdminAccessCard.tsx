"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PinInput } from "@/components/admin/PinInput";
import { Button } from "@/components/ui/Button";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";

type Step = "request" | "verify";

/**
 * Admin access via emailed one-time code.
 *
 * Step 1 ("request"): the admin enters their email and presses "Get Code". The
 * backend emails a 4-digit code only when that address belongs to an admin, but
 * the response is the same either way so it can't reveal who the admins are.
 * Step 2 ("verify"): the admin enters that code to sign in and is redirected to
 * the admin dashboard.
 */
export function AdminAccessCard({ initialEmail = "" }: { initialEmail?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode() {
    setBanner(null);
    if (!email.trim()) {
      setBanner({ type: "error", message: "Enter your admin email address." });
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/admin/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not send the code." });
        return;
      }
      setStep("verify");
      setCode("");
      setBanner({
        type: "success",
        message: "If that email belongs to an admin, a 4-digit code is on its way. Check your inbox.",
      });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestCode();
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
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Verification failed." });
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
            ? "Enter your admin email to get a one-time code"
            : "Enter the 4-digit code sent to your email"}
        </p>
      </header>

      {banner && <Notice notice={banner} />}

      {step === "request" ? (
        <form className="flex w-full flex-col gap-4" onSubmit={submitRequest} noValidate>
          <TextField
            id="admin-email"
            label="Email Address"
            type="email"
            placeholder="Enter"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Sending…" : "Get Code"}
          </Button>
        </form>
      ) : (
        <form className="flex w-full flex-col gap-4" onSubmit={verifyCode}>
          <div className="flex w-full flex-col gap-2">
            <span className="text-xs leading-[18px] text-muted">Verification Code</span>
            <PinInput length={4} onChange={setCode} />
          </div>

          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Verifying…" : "Verify"}
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
