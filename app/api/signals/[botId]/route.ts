import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { warmCcxt } from "@/lib/execution/client";
import { authorizeCron } from "@/lib/execution/cron";
import { fanOut, killSwitchOn } from "@/lib/execution/dispatch";
import { errorDetail, logExec } from "@/lib/execution/log";
import { signalSecretMatches } from "@/lib/execution/signal-secret";
import type { PositionSide, SignalAction } from "@/lib/generated/prisma/enums";

/**
 * TradingView signal receiver.
 *
 * Unauthenticated by necessity — TradingView posts a static JSON body to a fixed
 * URL and cannot sign a request — so the bot's own secret travels inside the
 * payload and is compared in constant time. `proxy.ts` does not guard `/api/*`,
 * which is what makes this reachable at all.
 *
 * The body is read with `request.text()` and parsed once, mirroring the Stripe
 * webhook. Status codes are chosen for the sender's retry logic: 4xx means "never
 * send this again", 5xx means "try again".
 *
 * Replay protection is the `signals(botId, action, ts)` unique index, not a time
 * window. TradingView retries deliver a byte-identical body, and `ts` is the
 * indicator's bar-open timestamp — so a retried `enter` collides and is dropped
 * rather than opening a second real position.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** Signals arrive at most a handful of times per bar; this only catches a flood. */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;
/** A bar-open timestamp can legitimately be a whole timeframe old — but not a week. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const payloadSchema = z
  .object({
    action: z.string().min(1),
    secret: z.string().min(1, "Missing secret"),
    ts: z.union([z.string(), z.number()]),
    side: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional(),
  })
  .loose();

const TP_ACTIONS: Record<string, SignalAction> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`tp${i + 1}`, `TP${i + 1}` as SignalAction]),
);

/** `buy`/`sell` come from the reference alert templates; `enter` + side from the indicator. */
function normalizeAction(action: string, side?: string): { action: SignalAction; side: PositionSide | null } | null {
  const a = action.trim().toLowerCase();
  if (a === "buy") return { action: "ENTER", side: "LONG" };
  if (a === "sell") return { action: "ENTER", side: "SHORT" };
  if (a === "exit") return { action: "EXIT", side: null };
  if (a === "enter") {
    const s = side?.trim().toLowerCase();
    if (s === "long" || s === "buy") return { action: "ENTER", side: "LONG" };
    if (s === "short" || s === "sell") return { action: "ENTER", side: "SHORT" };
    return null; // an entry with no direction is unexecutable
  }
  const tp = TP_ACTIONS[a];
  return tp ? { action: tp, side: null } : null;
}

const reject = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
const accept = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/**
 * Keep-warm. On Vercel each route handler is its own lambda, so warming a generic
 * health endpoint would warm the wrong function — the ping has to land here, on
 * the route that places orders, or an entry pays the 679 ms ccxt import.
 *
 * Reads nothing and writes nothing. `botId` is ignored; point the cron at any path,
 * e.g. `/api/signals/warm`.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return new Response("Unauthorized", { status: 401 });
  return accept({ warm: true, ...(await warmCcxt()) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;

  if (killSwitchOn()) return accept({ ignored: "kill switch" });

  const raw = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reject("Body is not valid JSON", 400);
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return reject(parsed.error.issues[0]?.message ?? "Invalid signal payload", 400);

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, signalSecretEnc: true } });
  // Same response for an unknown bot and a bad secret, so the endpoint can't be
  // used to enumerate which bot ids exist.
  if (!bot || !signalSecretMatches(botId, bot.signalSecretEnc, parsed.data.secret)) {
    await logExec({ level: "warn", event: "signal.rejected", botId, detail: { reason: bot ? "bad secret" : "unknown bot" } });
    return reject("Invalid signal credentials", 401);
  }

  const normalized = normalizeAction(parsed.data.action, parsed.data.side);
  if (!normalized) return reject(`Unrecognised action "${parsed.data.action}" (an "enter" needs side long|short)`, 400);

  const ts = String(parsed.data.ts).trim();
  const tsMs = Number(ts);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return reject("`ts` must be the indicator's bar timestamp in epoch milliseconds", 400);
  const age = Date.now() - tsMs;
  if (age > MAX_AGE_MS) return reject("Signal is too old", 400);
  if (age < -MAX_SKEW_MS) return reject("Signal is timestamped in the future", 400);

  if (normalized.action === "ENTER" && !Number.isFinite(Number(parsed.data.price))) {
    return reject("An `enter` must carry `price` (the signal bar's close) to size the order", 400);
  }

  const recent = await prisma.signal.count({ where: { botId, createdAt: { gt: new Date(Date.now() - RATE_WINDOW_MS) } } });
  if (recent >= RATE_MAX) {
    await logExec({ level: "warn", event: "signal.rateLimited", botId, detail: { recent } });
    return reject("Too many signals", 429);
  }

  let signalId: string;
  try {
    const signal = await prisma.signal.create({
      data: { botId, action: normalized.action, side: normalized.side, ts, source: "tradingview", raw: payload as object },
      select: { id: true },
    });
    signalId = signal.id;
  } catch (error) {
    // P2002 on (botId, action, ts): TradingView redelivered an alert we already
    // acted on. Acknowledge it, do nothing, and never open a second position.
    if ((error as { code?: string }).code === "P2002") return accept({ duplicate: true });
    // Anything else is ours to fix — 5xx so the sender retries.
    await logExec({ level: "error", event: "signal.persistFailed", botId, detail: errorDetail(error) });
    return reject("Could not record signal", 500);
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
