import { AuthForm } from "@/components/auth/AuthForm";
import { AuthTabs } from "@/components/auth/AuthTabs";
import { GuestModeOptions } from "@/components/auth/GuestModeOptions";
import type { NoticeData } from "@/components/ui/Notice";
import { AUTH_COPY, type AuthMode } from "@/lib/auth-config";

/**
 * Right-hand authentication card: tab switcher, heading and the credential
 * form. Composed on the server; only {@link AuthForm} crosses into the client.
 *
 * @param notice - Optional banner forwarded to the form (e.g. ?verified=1).
 */
export function AuthCard({
  mode,
  notice,
  next,
  initialEmail,
  lockEmail,
}: {
  mode: AuthMode;
  notice?: NoticeData;
  next?: string;
  /** Pre-fill the email field (e.g. from an invite link). */
  initialEmail?: string;
  /** Prevent editing the email (invited members sign up as-is). */
  lockEmail?: boolean;
}) {
  const copy = AUTH_COPY[mode];

  return (
    <div className="flex w-full max-w-[450px] flex-col items-start gap-6">
      <AuthTabs active={mode} />

      <header className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-semibold leading-[31px] text-heading">{copy.title}</h2>
        <p className="text-xs leading-[18px] text-muted">{copy.subtitle}</p>
      </header>

      {mode === "login" && <GuestModeOptions />}

      <AuthForm mode={mode} notice={notice} next={next} initialEmail={initialEmail} lockEmail={lockEmail} />
    </div>
  );
}
