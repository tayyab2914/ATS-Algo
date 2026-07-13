import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { errorDetail, logExec } from "@/lib/execution/log";
import { rotateSignalSecret } from "@/lib/execution/signal-secret";

/**
 * Mint a fresh signal secret for a bot and return it once.
 *
 * The secret is stored encrypted and can never be read back, so this is also the
 * "reveal" endpoint: generating a new one is the only way to see a value. That is
 * deliberate — a leaked alert body must not be recoverable from the database.
 *
 * Rotating invalidates the old secret immediately, so the bot's TradingView alert
 * stops working until the new payload is pasted in.
 */
export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id: botId } = await params;
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { id: true, signalSecretEnc: true } });
  if (!bot) return fail("Bot not found", 404);

  try {
    const secret = await rotateSignalSecret(botId);
    await logExec({
      level: "warn",
      event: "signal.secretRotated",
      botId,
      detail: { by: session.sub, replacedExisting: bot.signalSecretEnc !== null },
    });
    return ok({ secret, replacedExisting: bot.signalSecretEnc !== null });
  } catch (error) {
    await logExec({ level: "error", event: "signal.secretRotateFailed", botId, detail: errorDetail(error) });
    return fail("Could not generate a secret — is ENCRYPTION_KEY set?", 500);
  }
}
