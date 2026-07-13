import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { type BotConfig } from "@/lib/backtest/engine";
import { backtestBotColumns } from "@/lib/backtest/bot-record";
import { matchBotExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { botConfigError } from "@/lib/validation";

/**
 * Create a bot: run the backtest on the uploaded JSON config + signal CSV for
 * every risk profile, store the headline metrics for the chosen risk class, and
 * persist the full per-profile results plus the raw CSV (so the backtest can be
 * re-run when the engine is recalibrated).
 */
const createBotSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  category: z.string().trim().min(1, "Category is required").max(60),
  timeframe: z.string().trim().min(1, "Timeframe is required").max(20),
  exchanges: z.array(z.string()).max(3).optional(),
  exchange: z.string().trim().max(40).optional(), // legacy / JSON-config fallback
  riskClass: z.enum(["LOW", "MEDIUM", "HIGH"]),
  config: z.any(),
  csvText: z.string().min(1, "CSV data is required"),
  csvFilename: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = createBotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { name, category, timeframe, exchanges, exchange, riskClass, config, csvText, csvFilename } = parsed.data;

  // The live executor places one resting order per rung, so a malformed ladder is
  // a real-money bug — validate the whole config, and require the exact profile
  // this bot's risk class will trade.
  const configError = botConfigError(config, riskClass);
  if (configError) return fail(configError, 422);
  const cfg = config as BotConfig;

  // Normalize the admin-allowed exchanges to known venues (dedup); fall back to the
  // legacy single field / JSON config. `exchange` mirrors the first allowed one.
  const rawExchanges = exchanges?.length ? exchanges : [exchange ?? cfg.exchange ?? ""];
  const allowed = [...new Set(rawExchanges.map((e) => matchBotExchange(e)).filter(Boolean))];
  if (allowed.length === 0) {
    return fail("Pick at least one exchange for this bot.", 422);
  }

  let metrics;
  try {
    metrics = backtestBotColumns(cfg, csvText, riskClass);
  } catch (error) {
    console.error("Backtest failed:", error);
    return fail("Backtest failed — check that the CSV matches the expected signal format.", 422);
  }

  const bot = await prisma.bot.create({
    data: {
      name,
      category,
      timeframe,
      riskClass,
      ticker: cfg.ticker ?? null,
      assetType: cfg.type ?? null,
      exchange: allowed[0], // display-primary, mirrors exchanges[0]
      exchanges: allowed, // admin-allowed set the user picks one from
      config,
      csvFilename: csvFilename ?? null,
      csvData: csvText,
      ...metrics,
      revisions: { create: { message: "Bot created" } },
    },
    select: { id: true, name: true },
  });

  return ok({ bot }, 201);
}
