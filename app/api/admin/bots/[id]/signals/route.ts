import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  normalizeSignalMap,
  SIGNAL_COMMANDS,
  signalMapError,
  type SignalCommand,
  type SignalMap,
} from "@/lib/execution/signal-map";

/**
 * Save one bot's JSON signal vocabulary — which key its alert bodies carry the
 * command under, and what words the ATS indicator actually sends for each command.
 *
 * Its own route rather than a field on the bot PATCH: this touches nothing the
 * backtest depends on, so it must not drag a re-run (or a change note, or a
 * re-validation of a legacy config) along with it. An admin re-wording an alert is
 * fixing a live wiring problem and needs it to save on the spot.
 */
/**
 * Every command optional. Deliberately NOT `z.record(z.enum(SIGNAL_COMMANDS), …)`:
 * zod treats an enum-keyed record as exhaustive, so that form rejects a body that
 * only carries the commands the admin actually filled in — and rejects any command
 * added to `SIGNAL_COMMANDS` after a client was cached.
 */
const wordsSchema = z
  .object(
    Object.fromEntries(SIGNAL_COMMANDS.map((command) => [command, z.array(z.string()).max(20)])) as Record<
      SignalCommand,
      z.ZodArray<z.ZodString>
    >,
  )
  .partial();

const signalMapSchema = z.object({
  field: z.string().trim().max(40).optional(),
  words: wordsSchema.optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const parsed = signalMapSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  // Trim first, THEN validate: an admin who typed "  BUY  " into the long-entry box
  // must get the collision error about `buy`, not a pass on the whitespace.
  const draft: SignalMap = {
    field: parsed.data.field,
    words: Object.fromEntries(
      Object.entries(parsed.data.words ?? {}).map(([command, list]) => [
        command,
        (list ?? []).map((w) => w.trim()).filter(Boolean),
      ]),
    ) as Partial<Record<SignalCommand, string[]>>,
  };

  const invalid = signalMapError(draft);
  if (invalid) return fail(invalid, 422);

  // `null` when the mapping adds nothing to the built-ins — storing an empty object
  // would make "has this bot been customised?" answer yes for every bot ever saved.
  const signalMap = normalizeSignalMap(draft);

  // `DbNull`, not `null`: on a nullable Json column a bare `null` means the JSON
  // value `null`, which is not the same as an empty column and would read back as a
  // customised bot. Clearing the panel has to leave the column truly empty.
  const updated = await prisma.bot.updateMany({ where: { id }, data: { signalMap: signalMap ?? Prisma.DbNull } });
  if (updated.count === 0) return fail("Bot not found", 404);

  return ok({ signalMap });
}
