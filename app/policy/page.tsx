import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PolicyForm } from "@/components/policy/PolicyForm";
import { getSession } from "@/lib/auth/session";
import { POLICY_INTRO, POLICY_SECTIONS, POLICY_VERSION } from "@/lib/policy-content";

export const metadata: Metadata = {
  title: "Mandatory Rules & Policy · Adrian Trading System",
};

/** Only allow internal, non-protocol-relative redirect targets. */
function safeNext(value?: string): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/dashboard";
}

/**
 * Mandatory Rules & Policy acceptance gate. The edge proxy already routes
 * unaccepted users here before any in-app page; these checks are a server-side
 * backstop so the screen is never shown to guests or users who already accepted.
 */
export default async function PolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  const { next } = await searchParams;
  const destination = safeNext(next);

  if (!session) redirect(`/login?next=/policy`);
  if (session.policyAccepted) redirect(destination);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-6 text-white">
      <div className="flex w-full max-w-[640px] flex-col gap-4 rounded-3xl border border-line bg-surface p-6">
        <header className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
            Adrian Trading System
          </span>
          <h1 className="text-xl font-semibold leading-7 text-heading">
            Mandatory Rules &amp; Policy
          </h1>
          <p className="text-xs leading-[18px] text-muted">{POLICY_INTRO}</p>
        </header>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {POLICY_SECTIONS.map((section) => (
            <section
              key={section.title}
              className="flex flex-col gap-1 rounded-xl border border-line bg-background/60 p-3"
            >
              <h2 className="text-xs font-semibold leading-4 text-heading">{section.title}</h2>
              <p className="text-xs leading-[17px] text-muted">{section.body}</p>
            </section>
          ))}
        </div>

        <PolicyForm next={destination} />

        <p className="text-center text-[11px] leading-[16px] text-muted">
          Policy version {POLICY_VERSION}. Acceptance is required to use the platform.
        </p>
      </div>
    </main>
  );
}
