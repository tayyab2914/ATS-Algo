/**
 * Server-boot hook. Next calls `register` once per server instance, before the
 * first request is served.
 *
 * Two jobs, with deliberately opposite failure behaviour:
 *
 *  1. Validate APP_URL — and THROW if it's missing or localhost in production.
 *     Refusing to boot is the point: systemd surfaces it immediately and
 *     update.sh's probe fails, whereas booting anyway means every verification
 *     and password-reset email goes out with a dead link until someone notices.
 *
 *  2. Warm ccxt — and never throw. The first `import("ccxt")` costs ~679 ms
 *     (see lib/execution/client.ts); paying it here means no member's order
 *     ever does. On a long-lived process it's a one-time boot cost, which is
 *     why there's no keep-warm cron. If it fails, the import simply retries on
 *     first use — not a reason to keep the site down.
 */
export async function register() {
  // `register` also runs in the Edge runtime (for proxy.ts), where ccxt cannot
  // be imported and process env checks would run twice. Node instances only.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertAppUrl } = await import("@/lib/app-url");
  assertAppUrl();

  try {
    const { warmCcxt } = await import("@/lib/execution/client");
    const { importSource, ms } = await warmCcxt();
    console.log(`[boot] ccxt warm via ${importSource} in ${ms}ms`);
  } catch (error) {
    console.error("[boot] ccxt warm failed; the first trade will pay the import", error);
  }
}
