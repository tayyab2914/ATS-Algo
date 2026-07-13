import "server-only";
import { prisma } from "@/lib/db";

/**
 * Append-only audit of the execution path. Every decision a user's money depends
 * on — an order placed, a deployment skipped, a venue error — lands here with the
 * reason, so "why didn't my bot trade?" is answerable after the fact.
 *
 * Writing a log line must never be able to break the thing it is describing, so
 * failures are swallowed and mirrored to the console.
 */

export type ExecLevel = "info" | "warn" | "error";

export type ExecLogEntry = {
  level: ExecLevel;
  /** Dotted and stable, e.g. "order.placed", "fanout.skip.liveNotArmed". */
  event: string;
  botId?: string | null;
  userBotId?: string | null;
  signalId?: string | null;
  positionId?: string | null;
  detail?: Record<string, unknown>;
};

export async function logExec(entry: ExecLogEntry): Promise<void> {
  try {
    await prisma.executionLog.create({
      data: {
        level: entry.level,
        event: entry.event,
        botId: entry.botId ?? null,
        userBotId: entry.userBotId ?? null,
        signalId: entry.signalId ?? null,
        positionId: entry.positionId ?? null,
        detail: entry.detail ? (entry.detail as object) : undefined,
      },
    });
  } catch (error) {
    console.error(`[exec:${entry.level}] ${entry.event}`, entry.detail ?? {}, "(log write failed)", error);
  }
}

/** Shorten an unknown throwable for a `detail` payload. */
export function errorDetail(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}
