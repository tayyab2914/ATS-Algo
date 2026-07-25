import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { publicPrice } from "@/lib/execution/client";
import { fanOut, killSwitchOn, liveDeploymentCount } from "@/lib/execution/dispatch";
import { executionError } from "@/lib/execution/execute";
import { errorDetail, logExec } from "@/lib/execution/log";
import { resolveSymbol } from "@/lib/execution/symbol";

/**
 * Fire a signal by hand, without waiting for TradingView.
 *
 * Builds the same `Signal` row the webhook does and calls the same `fanOut`, so
 * this exercises the real pipeline rather than a parallel one. Unlike the webhook
 * it runs the fan-out synchronously — an admin is waiting to see what happened,
 * and no delivery timeout is pressing.
 *
 * Real money needs an explicit confirmation: any member who has armed live trading
 * on a non-sandbox key will trade for real when this is clicked.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const dispatchSchema = z
  .object({
    action: z.enum(["enter", "exit"]),
    side: z.enum(["long", "short"]).optional(),
    /** Required once any member would trade real funds. */
    confirmLive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "enter" && !data.side) {
      ctx.addIssue({ code: "custom", path: ["side"], message: "An entry needs a side (long or short)" });
    }
  });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id: botId } = await params;
  const parsed = dispatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { action, side, confirmLive } = parsed.data;

  if (killSwitchOn()) return fail("SIGNALS_KILL_SWITCH is on — every signal is a no-op.", 409);

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, status: true, ticker: true } });
  if (!bot) return fail("Bot not found", 404);
  if (bot.status !== "ACTIVE") return fail("This bot is disabled — enable it before dispatching signals.", 409);

  // The gate, restated for a human: say how many people's real money is at stake.
  //
  // Only an ENTRY needs confirming. An exit closes positions — it reduces exposure,
  // and an admin flattening everyone in a hurry must never meet a dialog.
  const liveDeployments = await liveDeploymentCount(botId);
  if (action === "enter" && liveDeployments > 0 && confirmLive !== true) {
    const who = liveDeployments === 1 ? "1 member has" : `${liveDeployments} members have`;
    return Response.json(
      {
        error: `${who} armed LIVE trading on this bot. This will place real orders with real funds.`,
        requiresConfirmation: true,
        liveDeployments,
      },
      { status: 409 },
    );
  }

  try {
    // Price the entry the way a TradingView alert would: the venue's last trade.
    // Read from the public feed, so no member's key is touched to build the signal.
    let price: number | undefined;
    if (action === "enter") {
      const { symbol } = await resolveSymbol("Bitget", bot.ticker, false);
      price = await publicPrice("Bitget", symbol);
    }

    const raw = { action, side, price, source: "admin", admin: session.sub };
    const signal = await prisma.signal.create({
      data: {
        botId,
        action: action === "enter" ? "ENTER" : "EXIT",
        side: side === "long" ? "LONG" : side === "short" ? "SHORT" : null,
        // Never deduped: an admin firing the same signal twice means it twice, and
        // the confirmation dialog has already asked whether they are sure.
        dedupeKey: `admin:${randomUUID()}`,
        source: "admin",
        raw,
      },
      select: { id: true },
    });

    await logExec({ level: "info", event: "signal.admin", botId, signalId: signal.id, detail: { action, side, price, liveDeployments } });

    const result = await fanOut(signal.id);
    return ok({ signalId: signal.id, liveDeployments, ...result });
  } catch (error) {
    await logExec({ level: "error", event: "signal.admin.failed", botId, detail: errorDetail(error) });
    const { message, status } = executionError(error);
    return fail(message, status);
  }
}
