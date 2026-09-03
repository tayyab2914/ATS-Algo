import { AuthForm } from "@/components/auth/AuthForm";
import { AuthTabs } from "@/components/auth/AuthTabs";
import type { NoticeData } from "@/components/ui/Notice";
import { AUTH_COPY, type AuthMode } from "@/lib/auth-config";

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 19v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V19" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 19v-1.5a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/**
 * Right-hand authentication card: tab switcher, heading and the credential
 * form. Composed on the server; only {@link AuthForm} crosses into the client.
 *
 * On the sign-up side it also confirms the Community Access Link a registration
 * arrived through, when there is one — see `app/(auth)/signup/page.tsx`.
 *
 * @param notice - Optional banner forwarded to the form (e.g. ?verified=1).
 */
export function AuthCard({
  mode,
  notice,
  next,
  initialEmail,
  lockEmail,
  community,
}: {
  mode: AuthMode;
  notice?: NoticeData;
  next?: string;
  /** Pre-fill the email field (e.g. from an invite link). */
  initialEmail?: string;
  /** Prevent editing the email (invited members sign up as-is). */
  lockEmail?: boolean;
  /** The Community Access Link this registration arrived through, if any. */
  community?: { name: string; slug: string };
}) {
  const copy = AUTH_COPY[mode];

  return (
    <div className="flex w-full max-w-[450px] flex-col items-start gap-6">
      <AuthTabs active={mode} />

      <header className="flex flex-col gap-0.5">
        <h2 className="text-2xl font-semibold leading-[31px] text-heading">{copy.title}</h2>
        <p className="text-xs leading-[18px] text-muted">{copy.subtitle}</p>
      </header>

      {/* Confirms the invite landed. Without it the community's members have no
          way to tell an invited registration from an ordinary one until after
          they log in and find out whether the bots are available. */}
      {community && (
        <div className="flex w-full items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.07] px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <UsersIcon />
          </span>
          <p className="text-xs leading-[18px] text-muted">
            Joining with the <span className="font-semibold text-white">{community.name}</span> invite — full
            access to the bots is enabled as soon as you confirm your email.
          </p>
        </div>
      )}

      <AuthForm
        mode={mode}
        notice={notice}
        next={next}
        initialEmail={initialEmail}
        lockEmail={lockEmail}
        communityRef={community?.slug}
      />
    </div>
  );
}
