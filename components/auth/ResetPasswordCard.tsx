"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { PasswordField } from "@/components/ui/PasswordField";

/** Set a new password using the token from the emailed reset link. */
export function ResetPasswordCard({ token }: { token?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(
    token ? null : { type: "error", message: "This reset link is invalid or has expired." },
  );
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      router.push("/login?reset=1");
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
        <h1 className="text-2xl font-semibold leading-[31px] text-heading">Set a new password</h1>
        <p className="text-xs leading-[18px] text-muted">Choose a new password for your account</p>
      </header>

      <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {banner && <Notice notice={banner} />}

        <PasswordField
          id="password"
          label="New Password"
          placeholder="Enter"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={!token}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm Password"
          placeholder="Enter"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={!token}
        />

        <Button type="submit" variant="primary" disabled={pending || !token}>
          {pending ? "Updating…" : "Reset password"}
        </Button>

        <Link href="/login" className="self-center text-xs text-muted transition-colors hover:text-accent">
          Back to login
        </Link>
      </form>
    </div>
  );
}
