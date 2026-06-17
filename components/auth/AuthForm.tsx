"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PinInput } from "@/components/admin/PinInput";
import { Button } from "@/components/ui/Button";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import type { AuthMode } from "@/lib/auth-config";

/**
 * Credential form for login and signup.
 *
 * - Signup: creates the account, then redirects to /login with a "verification
 *   sent" banner. The user is NOT signed in until they confirm their email.
 * - Login: signs in and redirects to the dashboard; unverified accounts are
 *   rejected with a clear message. When the account has two-factor enabled, the
 *   form switches to a code step and the session only starts once the emailed
 *   6-digit code is verified.
 *
 * @param notice - Optional banner seeded from the page (e.g. ?verified=1).
 */
export function AuthForm({
  mode,
  notice,
  next,
}: {
  mode: AuthMode;
  notice?: NoticeData;
  /** Where to land after a successful login (defaults to the dashboard). */
  next?: string;
}) {
  const isSignup = mode === "signup";
  const router = useRouter();
  const destination = next ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(notice ?? null);
  const [pending, setPending] = useState(false);

  // Two-factor login challenge (login mode only).
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");

  // Login was blocked because the address isn't verified yet — offer a resend.
  const [needsVerification, setNeedsVerification] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    setNeedsVerification(false);
    setPending(true);
    try {
      const endpoint = isSignup ? "/api/auth/signup" : "/api/auth/login";
      const body = isSignup ? { email, password, confirmPassword } : { email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Only the unverified-email block offers a resend link; other 403s
        // (e.g. a banned account) just show their message.
        if (!isSignup && data.needsVerification) setNeedsVerification(true);
        setBanner({ type: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }

      if (isSignup) {
        // Bounce to the login page with the "check your email" banner.
        router.push("/login?registered=1");
        router.refresh();
        return;
      }

      // Two-factor enabled: move to the code step instead of redirecting.
      if (data.twoFactorRequired) {
        setAwaitingCode(true);
        setCode("");
        setBanner({ type: "success", message: "We emailed a 6-digit code to your address. Enter it below to continue." });
        return;
      }

      router.push(destination);
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
    if (code.length !== 6) {
      setBanner({ type: "error", message: "Enter the 6-digit code from your email." });
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Verification failed." });
        return;
      }
      router.push(destination);
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function resendVerification() {
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not send the link. Please try again." });
        return;
      }
      setNeedsVerification(false);
      setBanner({ type: "success", message: "Verification email sent. Check your inbox, then log in." });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  async function resendCode() {
    setBanner(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/2fa/resend", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner({ type: "error", message: data.error ?? "Could not resend the code." });
        return;
      }
      setBanner({ type: "success", message: "A new code is on its way. Check your inbox." });
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  if (awaitingCode) {
    return (
      <form className="flex w-full flex-col gap-4" onSubmit={verifyCode}>
        {banner && <Notice notice={banner} />}

        <div className="flex w-full flex-col gap-2">
          <span className="text-xs leading-[18px] text-muted">Verification Code</span>
          <PinInput length={6} onChange={setCode} />
        </div>

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Verifying…" : "Verify & Sign In"}
        </Button>

        <button
          type="button"
          onClick={resendCode}
          disabled={pending}
          className="self-center text-xs text-muted underline-offset-4 transition-colors hover:text-accent hover:underline disabled:opacity-60"
        >
          Didn&apos;t get it? Resend code
        </button>
      </form>
    );
  }

  return (
    <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {banner && <Notice notice={banner} />}

      <div className="flex w-full flex-col gap-6">
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
        <TextField
          id="password"
          label="Password"
          type="password"
          placeholder="Enter"
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {isSignup && (
          <TextField
            id="confirm-password"
            label="Confirm Password"
            type="password"
            placeholder="Enter"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        )}
      </div>

      {!isSignup && (
        <Link
          href="/forgot-password"
          className="-mt-1 self-end text-xs text-muted transition-colors hover:text-accent"
        >
          Forgot password?
        </Link>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Please wait…" : isSignup ? "Sign Up" : "Login"}
      </Button>

      {!isSignup && needsVerification && (
        <button
          type="button"
          onClick={resendVerification}
          disabled={pending}
          className="self-center text-xs text-muted underline-offset-4 transition-colors hover:text-accent hover:underline disabled:opacity-60"
        >
          Didn&apos;t get the email? Resend verification link
        </button>
      )}
    </form>
  );
}
