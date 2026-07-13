/**
 * Static-egress routing for every exchange call.
 *
 * Members can IP-whitelist their exchange API key (Bitget: optional but
 * recommended; Bybit: keys WITHOUT a whitelist auto-expire after 90 days), but
 * Vercel serverless has no fixed outbound IP on any plan. When
 * `EXCHANGE_PROXY_URL` is set, every ccxt request tunnels through that HTTP(S)
 * CONNECT proxy, so the exchange always sees the proxy's fixed address — which
 * is what `STATIC_EGRESS_IP` publishes to members on the account page as the
 * IP to whitelist.
 *
 * The two env vars travel together:
 *   EXCHANGE_PROXY_URL  http://user:pass@proxy-host:port  (secret — carries creds)
 *   STATIC_EGRESS_IP    203.0.113.7                       (public — shown in UI)
 * Setting only the first locks egress without telling members; setting only the
 * second advertises an IP we don't actually use. Both mistakes fail closed for
 * the member (their whitelist simply rejects us), but set both.
 *
 * There is deliberately NO fallback to a direct connection when the proxy is
 * down. A member who whitelisted our IP would have every direct call rejected
 * by the exchange anyway, so a fallback would only convert one clear proxy
 * outage into a fog of per-member auth failures. Fail loudly; the reconcile
 * cron picks up anything that was mid-flight.
 *
 * ccxt does the tunnelling itself: setting `httpsProxy` makes it lazily load
 * its *vendored* https-proxy-agent (no new npm dependency), which CONNECTs
 * through the proxy for every https:// call. A SOCKS proxy would need an
 * external module, so this accepts HTTP(S) CONNECT proxies only — which is
 * what static-IP egress services (QuotaGuard, Fixie, …) provide.
 */

type ProxyCapable = { httpsProxy?: string };

/** The CONNECT proxy every exchange call tunnels through, or null for direct. */
export function egressProxyUrl(): string | null {
  const url = process.env.EXCHANGE_PROXY_URL?.trim();
  return url ? url : null;
}

/** The fixed public IP members whitelist on their exchange key, if published. */
export function staticEgressIp(): string | null {
  const ip = process.env.STATIC_EGRESS_IP?.trim();
  return ip ? ip : null;
}

/** Route a ccxt instance through the static-egress proxy. No-op when unset. */
export function applyEgress<T extends ProxyCapable>(ex: T): T {
  const url = egressProxyUrl();
  if (url) ex.httpsProxy = url;
  return ex;
}
