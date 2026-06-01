"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";

/** Request a password-reset link by email. */
export function ForgotPasswordCard() {
  const [email, setEmail] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      setBanner({
        type: "success",
        message: "If an account exists for that email, a reset link has been sent. Check your inbox.",
      });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-[450px] flex-col items-start gap-6">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-semibold leading-[31px] text-heading">Reset password</h1>
        <p className="text-xs leading-[18px] text-muted">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </header>

      <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {banner && <Notice notice={banner} />}

        <TextField
          id="email"
          label="Email Address"
          type="email"
          placeholder="Enter"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>

        <Link href="/login" className="self-center text-xs text-muted transition-colors hover:text-accent">
          Back to login
        </Link>
      </form>
    </div>
  );
}
