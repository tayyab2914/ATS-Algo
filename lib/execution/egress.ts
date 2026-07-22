/**
 * The public IP every exchange call leaves from.
 *
 * Members can IP-whitelist their exchange API key (Bitget: optional but
 * recommended; Bybit: keys WITHOUT a whitelist auto-expire after 90 days), and
 * that only works if every call we make comes from ONE address they can type in.
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
