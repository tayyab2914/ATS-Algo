import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fanOut, killSwitchOn } from "@/lib/execution/dispatch";
import { errorDetail, logExec } from "@/lib/execution/log";
import { secretFingerprint, signalSecret, signalSecretMatches } from "@/lib/execution/signal-secret";
import type { PositionSide, SignalAction } from "@/lib/generated/prisma/enums";

/**
 * TradingView signal receiver.
 *
 * Unauthenticated by necessity — TradingView posts a static JSON body to a fixed
 * URL and cannot sign a request — so the shared secret travels inside the payload
 * and is compared in constant time. `proxy.ts` does not guard `/api/*`, which is
 * what makes this reachable at all.
 *
 * The body is read with `request.text()` and parsed once, mirroring the Stripe
 * webhook. Status codes are chosen for the sender's retry logic: 4xx means "never
 * send this again", 5xx means "try again".
 *
 * THE PAYLOAD IS TWO CONSTANT STRINGS. NOTHING IN IT IS SUBSTITUTED:
 *
 *     {"action":"enter_long","secret":"…"}
 *     {"action":"exit","secret":"…"}
 *     {"action":"tp3","secret":"…"}
 *
 * There is no `bot_id` (the URL names the bot), no `side` (the action names it),
 * no `ts`, and no `price`. Every one of those needed a value filled in per alert,
 * and this webhook body is delivered verbatim — TradingView expanded neither the
 * indicator's own `{TIME}`/`{SIDE}`/`{PRICE}` nor its documented `{{close}}`, so
 * each of them arrived as a literal and killed the entry. The entry price is read
 * from the venue at fan-out instead (dispatch.ts), which is closer to the fill
 * than a bar close anyway.
 *
 * Dropping `ts` costs the old `(botId, action, ts)` replay guard, so the receiver
 * derives its own idempotency key instead — see `dedupeKeyFor`. That guard is not
 * decoration: a new ENTER *reverses* an open position (dispatch.ts), so a
 * redelivered entry would close a good position and reopen it, paying the spread
 * and fees and resetting the ladder.
 *
 * Every outcome that is not "signal accepted" writes a `signal.rejected` audit
 * line carrying the reason and the redacted body. The sender is a machine that
 * cannot read the response, so without that line a rejected alert is invisible:
 * the bot simply does not trade and nothing anywhere says why. The secret is
 * reduced to a fingerprint on the way in — the audit log must never become a
 * place the credential can be read back out of.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** Signals arrive at most a handful of times per bar; this only catches a flood. */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;

/**
 * How close together two signals of the same action have to be to be treated as
 * one delivery. A redelivery lands within seconds; the shortest bar any bot trades
 * is orders of magnitude longer than this, so no genuine second signal is ever
 * inside the window. Fixed rather than derived from `bot.timeframe`, which is
 * free-text an admin types and must not be load-bearing for a money guard.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const payloadSchema = z
  .object({
    action: z.string().min(1),
    secret: z.string().min(1, "Missing secret"),
    price: z.union([z.string(), z.number()]).optional(),
  })
  .loose();

const TP_ACTIONS: Record<string, SignalAction> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`tp${i + 1}`, `TP${i + 1}` as SignalAction]),
);

type Normalized = { action: SignalAction; side: PositionSide | null };

/**
 * The direction lives in the action, not a separate field: TradingView substitutes
 * nothing into `side`, so an alert that had to name its own direction could only
 * ever be written by a patched indicator. `buy`/`sell` stay as aliases for the
 * reference templates that already use them.
 */
function normalizeAction(action: string): Normalized | null {
  const a = action.trim().toLowerCase();
  if (a === "enter_long" || a === "buy") return { action: "ENTER", side: "LONG" };
  if (a === "enter_short" || a === "sell") return { action: "ENTER", side: "SHORT" };
  if (a === "exit") return { action: "EXIT", side: null };
  const tp = TP_ACTIONS[a];
  return tp ? { action: tp, side: null } : null;
}

/**
 * The idempotency key for a webhook signal, unique per bot via the index on
 * `signals(botId, dedupeKey)`.
 *
 * Two deliveries of the same alert land in the same window and collide, so the
 * second is dropped by the database rather than by a read-then-write the two
 * concurrent deliveries observed in production would race straight through. A
 * window boundary falling between a delivery and its retry is the one gap, and
 * `recentDuplicate` closes it: the index handles the simultaneous case, the
 * lookback handles the straddling case.
 */
function dedupeKeyFor({ action, side }: Normalized, at: number): string {
  return `${action}${side ? `:${side}` : ""}:${Math.floor(at / DEDUPE_WINDOW_MS)}`;
}

/** Has this exact action already been accepted for this bot inside the window? */
async function recentDuplicate(botId: string, { action, side }: Normalized): Promise<boolean> {
  const found = await prisma.signal.findFirst({
    where: { botId, action, side, source: "tradingview", createdAt: { gt: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
    select: { id: true },
  });
  return found !== null;
}

/** Fields the pre-2026-07 alert body carried. Harmless now, but they date the template. */
const LEGACY_FIELDS = ["bot_id", "ts", "side"] as const;

const accept = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Room for a whole alert body in the log without room for a payload that bloats the table. */
const MAX_FIELD = 120;
const MAX_RAW = 400;

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

/**
 * `{TIME}`, `{SIDE}`, `{PRICE}` are substituted by the indicator, `{{timenow}}` by
 * TradingView, and `<paste-your-secret>` by whoever set the alert up. Any of them
 * arriving intact means a template was copied but never filled in — by far the most
 * common way an otherwise correct alert gets rejected, so name it in the log.
 */
const looksLikePlaceholder = (value: unknown) => typeof value === "string" && /^(\{\{?.+\}?\}|<.+>)$/.test(value.trim());

/** The body as it is safe to store: secret fingerprinted, strings clipped, nesting flattened to a type tag. */
function redactPayload(payload: unknown, raw: string): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return { unparsed: clip(raw, MAX_RAW) };

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (key === "secret") {
      out.secret = typeof value === "string" ? `${value.length} chars #${secretFingerprint(value)}` : `not a string (${typeof value})`;
    } else if (typeof value === "string") {
      out[key] = clip(value, MAX_FIELD);
    } else if (value === null || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = `«${Array.isArray(value) ? "array" : typeof value}»`;
    }
  }
  return out;
}

/**
 * A rejection log costs a database write, and this endpoint is unauthenticated —
 * so a flood of garbage must not turn into a row per request. A bot that is
 * behaving gets a handful of signals per bar and never approaches the cap; one
 * that trips it is misconfigured or hostile, and the first `signal.rejected`
 * lines already say which.
 */
const LOG_BUDGET = 30;
const LOG_WINDOW_MS = 60_000;
const logBudget = new Map<string, { resetAt: number; used: number }>();

function claimLogSlot(botId: string): "log" | "last" | "silent" {
  const now = Date.now();
  const entry = logBudget.get(botId);

  if (!entry || now > entry.resetAt) {
    // botId comes from the URL, so an attacker picks the keys — drop expired ones.
    if (logBudget.size > 200) for (const [key, value] of logBudget) if (now > value.resetAt) logBudget.delete(key);
    logBudget.set(botId, { resetAt: now + LOG_WINDOW_MS, used: 1 });
    return "log";
  }

  entry.used++;
  if (entry.used < LOG_BUDGET) return "log";
  return entry.used === LOG_BUDGET ? "last" : "silent";
}

type RejectionContext = {
  botId: string;
  status: number;
  reason: string;
  payload?: Record<string, unknown>;
  sender: { ip: string | null; ua: string | null };
  extra?: Record<string, unknown>;
};

async function auditRejection({ botId, status, reason, payload, sender, extra }: RejectionContext): Promise<void> {
  const slot = claimLogSlot(botId);
  if (slot === "silent") return;

  await logExec({
    level: "warn",
    event: "signal.rejected",
    botId,
    detail: {
      status,
      reason,
      ...extra,
      payload: payload ?? null,
      sender,
      ...(slot === "last" ? { note: `rejection logging for this bot is capped at ${LOG_BUDGET}/min — further rejections this minute are not recorded` } : {}),
    },
  });
}

// No GET keep-warm handler: ccxt is imported once at server boot by
// instrumentation.ts and stays resident, so an entry never pays the import.

export async function POST(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const sender = {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: request.headers.get("user-agent")?.slice(0, 80) ?? null,
  };

  /** Redacted body, filled in as soon as there is one — every rejection log carries it. */
  let logged: Record<string, unknown> | undefined;

  const reject = async (message: string, status: number, reason: string, extra?: Record<string, unknown>) => {
    await auditRejection({ botId, status, reason, payload: logged, sender, extra });
    return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
  };

  const raw = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    logged = redactPayload(undefined, raw);
    return reject("Body is not valid JSON", 400, "badJson", { bytes: raw.length, ...errorDetail(error) });
  }
  logged = redactPayload(payload, raw);

  if (killSwitchOn()) {
    // 200, because the sender must not retry — but this is the answer to "the
    // alert fired and nothing happened", so it cannot go unrecorded.
    await auditRejection({ botId, status: 200, reason: "killSwitch", payload: logged, sender });
    return accept({ ignored: "kill switch" });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "body";
    return reject(issue ? `${field}: ${issue.message}` : "Invalid signal payload", 400, "schema", {
      field,
      issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    });
  }

  if (!signalSecretMatches(parsed.data.secret)) {
    return reject("Invalid signal credentials", 401, "badSecret", {
      ...(!signalSecret() ? { hint: "SIGNAL_SECRET is not set on this server — no alert can be accepted until it is" } : {}),
      ...(looksLikePlaceholder(parsed.data.secret) ? { hint: "the secret is still a placeholder — paste the value from the bot's setup card" } : {}),
    });
  }

  // Only after the secret: an unknown bot id must not be distinguishable from a bad
  // secret by anyone who cannot already fire signals, or this enumerates bot ids.
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true } });
  if (!bot) return reject("Invalid signal credentials", 401, "unknownBot");

  const normalized = normalizeAction(parsed.data.action);
  if (!normalized) {
    return reject(`Unrecognised action "${parsed.data.action}" — expected enter_long, enter_short, exit or tp1…tp10`, 400, "badAction", {
      ...(looksLikePlaceholder(parsed.data.action) ? { hint: "the alert body still holds an unsubstituted placeholder — copy a fresh one from the bot's setup card" } : {}),
    });
  }

  const stale = LEGACY_FIELDS.filter((field) => field in (payload as Record<string, unknown>));
  if (stale.length > 0) {
    // Ignored, not rejected — they do no harm and refusing would strand a live
    // alert. But an old body is worth knowing about before it drifts further.
    await logExec({ level: "warn", event: "signal.legacyPayload", botId, detail: { fields: stale, payload: logged } });
  }

  const recent = await prisma.signal.count({ where: { botId, createdAt: { gt: new Date(Date.now() - RATE_WINDOW_MS) } } });
  if (recent >= RATE_MAX) return reject("Too many signals", 429, "rateLimited", { recent, windowMs: RATE_WINDOW_MS });

  if (await recentDuplicate(botId, normalized)) {
    await logExec({ level: "info", event: "signal.duplicate", botId, detail: { action: normalized.action, side: normalized.side, caughtBy: "window" } });
    return accept({ duplicate: true });
  }

  const dedupeKey = dedupeKeyFor(normalized, Date.now());
  let signalId: string;
  try {
    const signal = await prisma.signal.create({
      // `logged`, not `payload`: the audit copy keeps the fingerprint, not the
      // secret. One shared secret sitting in every signal row would mean a read of
      // this table hands over the key to every bot.
      data: { botId, action: normalized.action, side: normalized.side, dedupeKey, source: "tradingview", raw: logged as object },
      select: { id: true },
    });
    signalId = signal.id;
  } catch (error) {
    // P2002 on (botId, dedupeKey): a redelivery that raced the lookback above and
    // reached the insert at the same moment. Acknowledge it and do nothing — this
    // is the case a read-then-write cannot catch, so the index has to.
    if ((error as { code?: string }).code === "P2002") {
      await logExec({ level: "info", event: "signal.duplicate", botId, detail: { action: normalized.action, side: normalized.side, dedupeKey, caughtBy: "index" } });
      return accept({ duplicate: true });
    }
    // Anything else is ours to fix — 5xx so the sender retries.
    await logExec({ level: "error", event: "signal.persistFailed", botId, detail: { ...errorDetail(error), action: normalized.action, dedupeKey, payload: logged } });
    return new Response(JSON.stringify({ error: "Could not record signal" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  // Acknowledge immediately; execute after the response. TradingView's delivery
  // timeout is short and unrelated to how long the exchange takes.
  after(async () => {
    try {
      const outcome = await fanOut(signalId);
      await logExec({
        level: "info", event: "fanout.complete", botId, signalId,
        detail: { action: outcome.action, placed: outcome.placed.length, skipped: outcome.skipped.length, failed: outcome.failed.length, synced: outcome.synced, closed: outcome.closed },
      });
    } catch (error) {
      await logExec({ level: "error", event: "fanout.failed", botId, signalId, detail: errorDetail(error) });
    }
  });

  return accept({ received: true, signalId, action: normalized.action });
}
