import type { Exchange } from "ccxt";
import { ccxtIdFor, exchangeRequiresPassphrase } from "@/lib/bot-exchanges";
import { applyEgress } from "@/lib/execution/egress";

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

  const build = (sandbox: boolean) => {
    // Validation must leave from the same egress IP as trading: a member who
    // already whitelisted our published IP would otherwise fail right here.
    const ex = applyEgress(
      new Ctor({
        apiKey: creds.apiKey,
        secret: creds.apiSecret,
        password: creds.passphrase, // ccxt names the passphrase "password"
        timeout: 8000,
        enableRateLimit: true,
        options: { defaultType: "swap" },
      }),
    );
    if (sandbox) ex.setSandboxMode(true);
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
