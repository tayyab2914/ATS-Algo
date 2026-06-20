import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { type BotConfig } from "@/lib/backtest/engine";
import { backtestBotColumns } from "@/lib/backtest/bot-record";
import { prisma } from "@/lib/db";

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
  const { name, category, timeframe, riskClass, config, csvText, csvFilename } = parsed.data;

  const cfg = config as BotConfig;
  if (!cfg || typeof cfg !== "object" || !cfg.profiles?.balanced) {
    return fail("Config JSON is missing trading profiles (safe / balanced / aggressive).", 422);
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
      exchange: cfg.exchange ?? null,
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
