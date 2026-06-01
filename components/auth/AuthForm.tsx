"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { TextField } from "@/components/ui/TextField";
import type { AuthMode } from "@/lib/auth-config";

/**
 * Credential form for login and signup.
 *
 * - Signup: creates the account, then redirects to /login with a "verification
 *   sent" banner. The user is NOT signed in until they confirm their email.
 * - Login: signs in and redirects to the dashboard; unverified accounts are
 *   rejected with a clear message.
 *
 * @param notice - Optional banner seeded from the page (e.g. ?verified=1).
 */
export function AuthForm({ mode, notice }: { mode: AuthMode; notice?: NoticeData }) {
  const isSignup = mode === "signup";
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [banner, setBanner] = useState<NoticeData | null>(notice ?? null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);
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
        setBanner({ type: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }

      if (isSignup) {
        // Bounce to the login page with the "check your email" banner.
        router.push("/login?registered=1");
        router.refresh();
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setBanner({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
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
        {pending ? "Please wait…" : "Sign Up"}
      </Button>

      <Divider label="or continue with" />

      <Button type="button" variant="outline">
        Connect Wallet
      </Button>
    </form>
  );
}
