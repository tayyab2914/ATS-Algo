/**
 * Resolve the public base URL for links we email to users (account verification,
 * password reset). These must never resolve to a localhost URL once deployed, or
 * recipients receive dead links that only open on the developer's machine.
 *
 * Resolution order:
 *  1. APP_URL — explicit override, but IGNORED when it points at localhost so a
 *     stray local value (e.g. copied into a deployment's env) can't leak out.
 *  2. VERCEL_PROJECT_PRODUCTION_URL — the project's canonical production domain,
 *     injected automatically by Vercel at build and runtime.
 *  3. VERCEL_URL — the per-deployment URL (preview / non-production deployments).
 *  4. APP_URL as-is (covers local dev, where localhost is the correct target),
 *     else http://localhost:3000.
 *
 * We deliberately do NOT derive this from the request's Host header: that header
 * is attacker-controllable, and a forged value would point a password-reset link
 * at a domain the attacker controls (host-header injection).
 */
const stripTrailingSlashes = (url: string) => url.replace(/\/+$/, "");

const isLocalhost = (url: string) => /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);

export function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit && !isLocalhost(explicit)) return stripTrailingSlashes(explicit);

  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionDomain) return `https://${stripTrailingSlashes(productionDomain)}`;

  const deploymentDomain = process.env.VERCEL_URL?.trim();
  if (deploymentDomain) return `https://${stripTrailingSlashes(deploymentDomain)}`;

  return stripTrailingSlashes(explicit || "http://localhost:3000");
}
