/**
 * The public IP every exchange call leaves from.
 *
 * Members can IP-whitelist their exchange API key, and that only works if every
 * call we make comes from ONE address they can type in.
 *
 *   Bitget — optional but recommended.
 *   Bybit  — NOT optional in practice. Its own key form says "If an API key isn't
 *            linked to an IP address, it will expire in 3 months", and the key list
 *            says IP-bound keys "are permanently valid". (Bybit states MONTHS, never
 *            a day count — an earlier note here said "90 days", which Bybit's UI
 *            does not say anywhere. Verified against the live form 2026-08-03.)
 *            So without a published egress IP, every Bybit member's bot silently
 *            stops trading a quarter after they connect it, and the symptom looks
 *            exactly like a revoked key. Publishing STATIC_EGRESS_IP is therefore a
 *            PREREQUISITE for offering Bybit, not a hardening step.
 * On EC2 that address is the instance's Elastic IP: connections go out direct
 * and the exchange sees the EIP. Nothing to tunnel, nothing to route — which is
 * why there is no proxy plumbing here.
 *
 * `STATIC_EGRESS_IP` publishes that address on the account page. It is
 * presentation only — the value never routes anything — so the single failure
 * that matters is it disagreeing with reality. Advertise an IP we don't egress
 * from and every member who whitelists it starts getting auth errors that look,
 * from their side, like a bad API key. Re-check it after anything that can move
 * the address (releasing the EIP, putting the instance behind a NAT gateway,
 * rebuilding the box):
 *
 *     curl -s https://api.ipify.org        # must equal STATIC_EGRESS_IP
 *
 * or run `npx tsx scripts/verify-egress.ts`, which asserts exactly that.
 *
 * Unset ⇒ the account page tells members to leave their key un-restricted.
 */

/** The fixed public IP members whitelist on their exchange key, if published. */
export function staticEgressIp(): string | null {
  const ip = process.env.STATIC_EGRESS_IP?.trim();
  return ip ? ip : null;
}
