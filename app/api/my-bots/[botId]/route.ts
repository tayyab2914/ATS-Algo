import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { requireMember } from "@/lib/auth/guards";
import { chosenExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { errorDetail, logExec } from "@/lib/execution/log";
import { prepareDeployment } from "@/lib/execution/prepare";
import { botReadiness } from "@/lib/my-bots/readiness";

/**
 * Update or remove one of the member's bots. Keyed by `botId` (a user holds at
 * most one row per bot), so the client always has the id to hand.
 *
 * PATCH  — activate/deactivate (`active`) or set the allocated capital.
 * DELETE — remove the bot from My Bots entirely.
 */

// ccxt (via the post-response exchange warm-up) needs the Node runtime and room
// to finish after the response has been sent.
export const runtime = "nodejs";
export const maxDuration = 30;
const patchSchema = z
  .object({
    active: z.boolean().optional(),
    allocatedCapital: z.number().min(0).max(1_000_000_000).optional(),
    // Bot Settings fields.
    allocationType: z.enum(["FIXED", "PERCENTAGE"]).optional(),
    capitalPerTrade: z.number().min(0).max(1_000_000_000).optional(),
    compounding: z.boolean().optional(),
    exchangeSource: z.string().max(64).nullable().optional(),
    /** Arms real-money execution for this deployment. Never inferred. */
    liveArmed: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Nothing to update",
  });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const { botId } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  // Load the current row once when any gate or the capital invariant needs it.
  const touchesCapital =
    parsed.data.allocationType !== undefined ||
    parsed.data.capitalPerTrade !== undefined ||
    parsed.data.allocatedCapital !== undefined;
  const needsRow =
    touchesCapital ||
    parsed.data.liveArmed === true ||
    parsed.data.exchangeSource !== undefined ||
    parsed.data.active === true;
  const current = needsRow
    ? await prisma.userBot.findUnique({
        where: { userId_botId: { userId: session.sub, botId } },
        select: {
          allocationType: true,
          capitalPerTrade: true,
          allocatedCapital: true,
          exchangeSource: true,
          bot: { select: { exchanges: true } },
        },
      })
    : null;
  if (needsRow && !current) return fail("Bot not in your list", 404);

  // THE CAPITAL INVARIANT. `allocatedCapital` is the single "Allocated" figure
  // every page shows AND the base PERCENTAGE sizing divides into. FIXED: it always
  // equals capitalPerTrade (the pool IS the per-trade amount). PERCENTAGE: it is
  // the user-set pool. Resolving it here — not trusting the client — is what keeps
  // display, sizing, and the activation gate from ever disagreeing.
  const effType = parsed.data.allocationType ?? current?.allocationType ?? "FIXED";
  const effPerTrade = parsed.data.capitalPerTrade ?? current?.capitalPerTrade ?? 0;
  const effAllocated =
    effType === "FIXED" ? effPerTrade : (parsed.data.allocatedCapital ?? current?.allocatedCapital ?? 0);

  const data = { ...parsed.data };
  if (touchesCapital) data.allocatedCapital = effAllocated;

  // Arming real money, activating, or picking an exchange gate on a fully
  // configured, tradeable deployment. Disarming/deactivating only reduce risk.
  if (current && (parsed.data.liveArmed === true || parsed.data.active === true || parsed.data.exchangeSource !== undefined)) {
    const exchanges = current.bot.exchanges;

    // The user may only pick an exchange the admin allows for this bot.
    if (parsed.data.exchangeSource && !exchanges.includes(parsed.data.exchangeSource)) {
      return fail("That exchange isn't allowed for this bot.", 400);
    }

    if (parsed.data.liveArmed === true || parsed.data.active === true) {
      const source = parsed.data.exchangeSource !== undefined ? parsed.data.exchangeSource : current.exchangeSource;
      const chosen = chosenExchange(source, exchanges);
      const connection = chosen
        ? await prisma.exchangeConnection.findUnique({
            where: { userId_exchange: { userId: session.sub, exchange: chosen } },
            select: { apiKeyEnc: true },
          })
        : null;
      const { ready, missing } = botReadiness({
        exchanges,
        chosen,
        connected: Boolean(connection?.apiKeyEnc),
        capitalPerTrade: effPerTrade,
        allocationType: effType,
        allocatedCapital: effAllocated,
      });
      if (!ready) {
        const verb = parsed.data.liveArmed === true ? "arm live trading" : "activate";
        return fail(`Can't ${verb} yet — ${missing.join("; ")}.`, 400);
      }
    }
  }

  // updateMany scopes the write to the owner, so one user can't touch another's row.
  const result = await prisma.userBot.updateMany({
    where: { userId: session.sub, botId },
    data,
  });
  if (result.count === 0) return fail("Bot not in your list", 404);

  // Warm the exchange account (one-way mode, ISOLATED margin, profile leverage) once
  // the response has gone out, so the deployment's first order doesn't pay three
  // REST round-trips ahead of its entry. Never blocks activation: the executor
  // re-checks the fingerprint and prepares itself if this didn't land.
  if (parsed.data.active === true) {
    after(async () => {
      try {
        const outcome = await prepareDeployment(session.sub, botId);
        if (!outcome.prepared) {
          await logExec({ level: "warn", event: "prepare.skipped", botId, detail: { reason: outcome.reason } });
        } else if (outcome.contacted) {
          await logExec({
            level: "info",
            event: "prepare.applied",
            botId,
            detail: { symbol: outcome.symbol, leverage: outcome.leverage, substituted: outcome.substituted },
          });
        }
      } catch (error) {
        await logExec({ level: "error", event: "prepare.failed", botId, detail: errorDetail(error) });
      }
    });
  }

  return ok({ updated: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const { botId } = await params;
  const result = await prisma.userBot.deleteMany({ where: { userId: session.sub, botId } });
  if (result.count === 0) return fail("Bot not in your list", 404);

  return ok({ removed: true });
}
