import type { Exchange } from "ccxt";
import { ccxtIdFor, exchangeRequiresPassphrase } from "@/lib/bot-exchanges";
import { adapterFor, clockOffsetFor } from "@/lib/execution/client";

export type ValidateInput = { apiKey: string; apiSecret: string; passphrase?: string };

export type ValidateResult =
  | { ok: true; permissions: string; sandbox: boolean }
  | { ok: false; status: number; message: string };

type CcxtModule = typeof import("ccxt");
type ExchangeCtor = new (config: Record<string, unknown>) => Exchange;

/**
 * Validate an exchange API key and AUTO-DETECT whether it's a LIVE or a DEMO key.
 * Bitget demo keys are separate credentials that only work in sandbox mode, so we:
 *   1. try the key against production (a read-only `fetchBalance`) — success ⇒ live,
 *   2. if that fails on auth, try it in sandbox/demo mode — success ⇒ demo,
 *   3. otherwise it's invalid.
 * The resulting `sandbox` flag is stored on the connection and later decides
 * whether execution runs against the paper engine or real money.
 *
 * Node runtime only (ccxt). Callers must run on `runtime = "nodejs"`.
 */
export async function validateExchangeKey(
  exchange: string,
  creds: ValidateInput,
): Promise<ValidateResult> {
  const ccxtId = ccxtIdFor(exchange);
  if (!ccxtId) return { ok: false, status: 400, message: `Unsupported exchange: ${exchange}` };

  if (exchangeRequiresPassphrase(exchange) && !creds.passphrase) {
    return { ok: false, status: 400, message: `${exchange} requires a passphrase.` };
  }

  const ccxt = await import("ccxt");
  const Ctor = (ccxt as unknown as Record<string, ExchangeCtor | undefined>)[ccxtId];
  if (!Ctor) return { ok: false, status: 400, message: `Exchange not available: ${exchange}` };

  // The venue's own connection facts — the SAME ones the executor uses. Sharing them is the
  // point: validation must authenticate against exactly the host that will later place orders,
  // or a key can validate here and fail there (or the reverse).
  //
  // A venue can be listed in BOT_EXCHANGES (so `ccxtIdFor` resolves) while having no adapter
  // yet — that is the normal in-progress state. `adapterFor` THROWS for those, so it is caught
  // and turned into the same typed result as every other rejection. The connect route already
  // gates on `exchangeEnabled`, so this is a backstop rather than the primary check; it exists
  // so a registry entry can never crash the route.
  let adapter: ReturnType<typeof adapterFor>;
  try {
    adapter = adapterFor(exchange);
  } catch {
    return { ok: false, status: 400, message: `${exchange} isn't available for connection yet.` };
  }
  // A clock-sensitive venue needs its offset here too. Without it Bybit answers every signed
  // call with 10002, ccxt raises InvalidNonce, and this function tells the member their key is
  // invalid — which it is not.
  const timeDifference = adapter.syncClock ? await clockOffsetFor(exchange) : 0;

  const build = (sandbox: boolean) => {
    // Validation leaves from the same address as trading — the instance's
    // Elastic IP — so a member who already whitelisted our published IP passes
    // here exactly as they will when the bot trades.
    const ex = new Ctor({
      apiKey: creds.apiKey,
      secret: creds.apiSecret,
      password: creds.passphrase, // ccxt names the passphrase "password"
      timeout: 8000,
      enableRateLimit: true,
      options: { ...adapter.options, ...(adapter.syncClock ? { timeDifference } : {}) },
    });
    // NOT `setSandboxMode` — that is the executor's mistake to avoid too. On Bybit it selects
    // api-TESTNET, a separate exchange with its own registration and its own keys, while the
    // demo engine is api-demo. A member's Bybit demo key would fail BOTH attempts and be
    // reported as invalid. `paperMode` picks the right paper host per venue.
    if (sandbox) adapter.paperMode(ex, true);
    return ex;
  };

  // Attempt 1 — LIVE (production).
  try {
    await build(false).fetchBalance();
    return { ok: true, permissions: "Read & Trade (withdrawal unverified)", sandbox: false };
  } catch (err) {
    // Only bail on a network/timeout error (we genuinely can't tell). ANY other
    // failure means it's not a working live key — it may be a demo key, so try that.
    if (isNetworkError(ccxt, err)) return mapCcxtError(ccxt, err);
  }

  // Attempt 2 — DEMO (sandbox / PAPTRADING).
  try {
    await build(true).fetchBalance();
    return { ok: true, permissions: "Read & Trade (demo)", sandbox: true };
  } catch (err) {
    return mapCcxtError(ccxt, err); // neither a valid live nor demo key
  }
}

function isNetworkError(ccxt: CcxtModule, err: unknown): boolean {
  const is = (name: keyof CcxtModule) => {
    const cls = ccxt[name] as unknown;
    return typeof cls === "function" && err instanceof (cls as new (...a: unknown[]) => Error);
  };
  return is("RequestTimeout") || is("NetworkError") || is("ExchangeNotAvailable") || is("DDoSProtection");
}

function mapCcxtError(
  ccxt: CcxtModule,
  err: unknown,
): { ok: false; status: number; message: string } {
  const is = (name: keyof CcxtModule) => {
    const cls = ccxt[name] as unknown;
    return typeof cls === "function" && err instanceof (cls as new (...a: unknown[]) => Error);
  };
  if (is("AuthenticationError") || is("InvalidNonce")) {
    return { ok: false, status: 400, message: "Invalid API key, secret, or passphrase." };
  }
  if (is("PermissionDenied")) {
    return { ok: false, status: 400, message: "This API key lacks the required read permission." };
  }
  if (is("RequestTimeout")) {
    return { ok: false, status: 504, message: "The exchange didn't respond in time. Please try again." };
  }
  if (is("DDoSProtection") || is("ExchangeNotAvailable") || is("NetworkError")) {
    return {
      ok: false,
      status: 502,
      message: "Couldn't reach the exchange right now. Please try again shortly.",
    };
  }
  return {
    ok: false,
    status: 400,
    message: "Couldn't validate this API key. Double-check the key, secret, and passphrase.",
  };
}
