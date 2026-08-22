import type { Exchange } from "ccxt";
import { ccxtIdFor, exchangeMeta, exchangeRequiresPassphrase } from "@/lib/bot-exchanges";
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
 * ⚠ THAT INFERENCE DOES NOT HOLD ON EVERY VENUE. It works because a demo credential is a
 * SEPARATE credential that fails against production — true on Bitget, Bybit and BloFin. On
 * BingX demo is a hostname swap and ONE key authenticates on both, so step 1 would always
 * succeed and every key would be recorded as live — including one a member believed was paper.
 * `BotExchange.paperDetectableFromKey` marks such a venue, and there the steps above are
 * replaced entirely by the member's own declaration, validated against the host it names.
 *
 * Also enforces what the key may DO, where the venue reports it — see {@link checkScope}.
 *
 * Node runtime only (ccxt). Callers must run on `runtime = "nodejs"`.
 */
export async function validateExchangeKey(
  exchange: string,
  creds: ValidateInput,
  /**
   * What the MEMBER said this key is, used only where the venue makes auto-detection
   * impossible (`paperDetectableFromKey: false`). Ignored everywhere else, because a
   * declaration that disagrees with the venue would be worse than no declaration: it would let
   * someone label a live key "demo" and have the engine believe it.
   */
  declaredSandbox?: boolean,
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

  // ── The venue cannot tell paper from live, so the MEMBER'S DECLARATION decides ──────────
  //
  // One BingX key authenticates on both hosts, so probing proves nothing about intent. Rather
  // than guess (and always guess "live"), the connect form asks and the answer is validated
  // against the host it names — so a "demo" key is actually exercised on the demo host before
  // it is stored, and a key that only works on one of them still fails honestly.
  const meta = exchangeMeta(exchange);
  if (meta && !meta.paperDetectableFromKey) {
    const sandbox = declaredSandbox === true;
    try {
      const ex = build(sandbox);
      await ex.fetchBalance();
      const scope = await checkScope(ex, adapter);
      if (!scope.ok) return scope;
      return { ok: true, permissions: sandbox ? `${scope.label} (demo)` : scope.label, sandbox };
    } catch (err) {
      return mapCcxtError(ccxt, err);
    }
  }

  // Attempt 1 — LIVE (production).
  try {
    const live = build(false);
    await live.fetchBalance();
    const scope = await checkScope(live, adapter);
    if (!scope.ok) return scope;
    return { ok: true, permissions: scope.label, sandbox: false };
  } catch (err) {
    // Only bail on a network/timeout error (we genuinely can't tell). ANY other
    // failure means it's not a working live key — it may be a demo key, so try that.
    if (isNetworkError(ccxt, err)) return mapCcxtError(ccxt, err);
  }

  // Attempt 2 — DEMO (sandbox / PAPTRADING). Only reached on a venue where a demo credential is
  // genuinely a separate credential; the declaration branch above returned for the others.
  try {
    const demo = build(true);
    await demo.fetchBalance();
    const scope = await checkScope(demo, adapter);
    if (!scope.ok) return scope;
    return { ok: true, permissions: `${scope.label} (demo)`, sandbox: true };
  } catch (err) {
    return mapCcxtError(ccxt, err); // neither a valid live nor demo key
  }
}

/**
 * Enforce what the key is allowed to do, where the venue will tell us.
 *
 * This is the check the owner asked for and that Bitget made impossible: a key with WITHDRAW
 * permission is refused outright rather than stored with a caveat. It runs only where
 * `readKeyScope` exists (BingX today); everywhere else the label stays honest about the fact
 * that nothing was verified.
 *
 * An unreadable scope is NOT treated as a refusal. The key already proved it can authenticate
 * and read a balance, and failing the connection because an extra informational endpoint was
 * unavailable would block a member for no safety gain — the withdraw risk is unchanged from the
 * other three venues, which never had this check at all. So it degrades to the unverified label.
 */
async function checkScope(
  ex: Exchange,
  adapter: ReturnType<typeof adapterFor>,
): Promise<{ ok: true; label: string } | { ok: false; status: number; message: string }> {
  if (!adapter.readKeyScope) return { ok: true, label: "Read & Trade (withdrawal unverified)" };

  const scope = await adapter.readKeyScope(ex).catch(() => null);
  if (!scope) return { ok: true, label: "Read & Trade (withdrawal unverified)" };

  if (scope.withdraw) {
    return {
      ok: false,
      status: 400,
      message:
        "This API key has WITHDRAW permission. For your own safety we don't accept keys that can move funds — create a new key with only Read and Perpetual Futures Trading enabled, then connect that one.",
    };
  }
  if (!scope.trade) {
    return {
      ok: false,
      status: 400,
      message: "This API key can't trade perpetual futures. Edit the key on your exchange and enable Perpetual Futures Trading.",
    };
  }
  // Verified, not assumed — the one venue where the label is a fact.
  return { ok: true, label: `Read & Trade (withdrawal disabled${scope.ipRestricted ? ", IP-locked" : ""})` };
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
