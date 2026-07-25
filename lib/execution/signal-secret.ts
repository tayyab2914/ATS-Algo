import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The shared secret every bot's TradingView alert carries in its JSON body.
 *
 * TradingView can only post a static payload to a fixed URL — it cannot sign a
 * request — so the "signature" is a bearer token compared in constant time.
 *
 * It is ONE value for every bot, held in `SIGNAL_SECRET`, because it is entered
 * once in the ATS indicator's own settings: the indicator has no idea which bot a
 * given chart is wired to, so a per-bot secret had nowhere to come from. The
 * trade-off is deliberate and worth stating — the alert body is no longer
 * bot-scoped, so anyone holding it can fire signals at any bot id, and the URL is
 * the only thing that selects which bot acts. Rotating means changing the
 * environment and restarting, which invalidates every alert at once.
 *
 * Kept out of the database on purpose: an operator-level setting sits with
 * `SIGNALS_KILL_SWITCH` and the exchange keys, not in a table an admin session can
 * reach.
 */

/** The configured secret, or null if the environment has none. */
export function signalSecret(): string | null {
  const value = process.env.SIGNAL_SECRET?.trim();
  return value ? value : null;
}

/**
 * A short, non-reversible tag for a secret, safe to write to the audit log.
 *
 * A rejection logs the fingerprint of the presented value and the setup card shows
 * the fingerprint of the configured one, so "the alert is carrying a stale secret"
 * is visible without the value itself ever reaching the database.
 */
export function secretFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/**
 * Constant-time check of a presented secret against `SIGNAL_SECRET`.
 *
 * Both sides are hashed before comparison so the comparison is over fixed-length
 * buffers: `timingSafeEqual` throws on a length mismatch, and short-circuiting on
 * length would leak how long the real secret is.
 *
 * With no secret configured nothing can ever be triggered.
 */
export function signalSecretMatches(presented: string | undefined): boolean {
  const expected = signalSecret();
  if (!expected || !presented) return false;

  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(a, b);
}
