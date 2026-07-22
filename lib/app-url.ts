/**
 * Resolve the public base URL for links we email to users (account verification,
 * password reset).
 *
 * `APP_URL` is the single source of truth and is REQUIRED in production — there
 * is no platform-injected domain to fall back to when self-hosting, so leaving
 * it unset sends every recipient a localhost link that only opens on the box.
 * deploy/README.md calls this out; `assertAppUrl()` below turns a miss into a
 * loud failure rather than a batch of dead emails.
 *
 * We deliberately do NOT derive this from the request's Host header: that header
 * is attacker-controllable, and a forged value would point a password-reset link
 * at a domain the attacker controls (host-header injection). nginx passes the
 * client's Host through untouched, so that risk is live here.
 */
const stripTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

export function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  return stripTrailingSlashes(explicit || "http://localhost:3000");
}

/**
 * Fail loudly at boot when a production server has no APP_URL, instead of
 * quietly emailing localhost links for days. Called from instrumentation.ts.
 */
export function assertAppUrl(): void {
  if (process.env.NODE_ENV !== "production") return;

  const explicit = process.env.APP_URL?.trim();
  if (!explicit) throw new Error("APP_URL is not set — verification and password-reset emails would link to localhost.");
  if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(explicit)) {
    throw new Error(`APP_URL points at localhost (${explicit}) — emailed links would be dead for every recipient.`);
  }
}
